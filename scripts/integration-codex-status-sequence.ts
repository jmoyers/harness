import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { subscribeControlPlaneKeyEvents } from '../src/control-plane/codex-session-stream.ts';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import {
  applyMuxControlPlaneKeyEvent,
  type MuxRuntimeConversationState
} from '../src/mux/runtime-wiring.ts';
import { projectWorkspaceRailConversation } from '../src/mux/workspace-rail-model.ts';

interface ScriptOptions {
  readonly cwd: string;
  readonly prompt: string;
  readonly model: string | null;
  readonly timeoutMs: number;
}

interface RuntimeConversationState extends MuxRuntimeConversationState {
  readonly sessionId: string;
}

interface StatusTimelineEntry {
  readonly atMs: number;
  readonly label: string;
  readonly icon: string;
  readonly phase: string;
  readonly statusText: string;
}

function parseArgs(argv: readonly string[]): ScriptOptions {
  let cwd = process.cwd();
  let prompt = 'say hi in one sentence';
  let model: string | null = null;
  let timeoutMs = 8_000;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const next = argv[index + 1] ?? '';
    if (arg === '--cwd' && next.length > 0) {
      cwd = resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--prompt' && next.length > 0) {
      const parts: string[] = [];
      let cursor = index + 1;
      while (cursor < argv.length) {
        const candidate = argv[cursor] ?? '';
        if (candidate.startsWith('--')) {
          break;
        }
        parts.push(candidate);
        cursor += 1;
      }
      prompt = parts.join(' ').trim();
      index = cursor - 1;
      continue;
    }
    if (arg === '--model' && next.length > 0) {
      model = next;
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms' && next.length > 0) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        timeoutMs = parsed;
      }
      index += 1;
      continue;
    }
  }

  return {
    cwd,
    prompt,
    model,
    timeoutMs
  };
}

function createConversationState(sessionId: string): RuntimeConversationState {
  return {
    sessionId,
    directoryId: null,
    status: 'running',
    attentionReason: null,
    live: true,
    controller: null,
    lastEventAt: null,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    lastTelemetrySource: null
  };
}

function projectedPhase(
  conversation: RuntimeConversationState,
  nowMs: number
): { icon: string; phase: string; statusText: string } {
  const projected = projectWorkspaceRailConversation(
    {
      sessionId: conversation.sessionId,
      directoryKey: conversation.directoryId ?? 'directory-integration',
      title: 'integration thread',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: conversation.lastKnownWork,
      lastKnownWorkAt: conversation.lastKnownWorkAt,
      status: conversation.status,
      attentionReason: conversation.attentionReason,
      startedAt: new Date(nowMs).toISOString(),
      lastEventAt: conversation.lastEventAt,
      controller: conversation.controller
    },
    {
      nowMs
    }
  );
  if (projected.status === 'working' || projected.status === 'starting') {
    return { icon: projected.glyph, phase: 'active', statusText: projected.detailText };
  }
  if (projected.status === 'idle' || projected.status === 'exited') {
    return { icon: projected.glyph, phase: 'inactive', statusText: projected.detailText };
  }
  return {
    icon: projected.glyph,
    phase: projected.status,
    statusText: projected.detailText
  };
}

async function waitFor(
  label: string,
  timeoutMs: number,
  predicate: () => boolean | Promise<boolean>
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label} (${timeoutMs}ms)`);
}

function printTimeline(timeline: readonly StatusTimelineEntry[]): void {
  for (const entry of timeline) {
    const iso = new Date(entry.atMs).toISOString();
    process.stdout.write(`${iso} [${entry.label}] ${entry.icon} ${entry.phase} | ${entry.statusText}\n`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAtMs = Date.now();
  const runId = Date.now().toString(36);
  const tmpDir = mkdtempSync(join(tmpdir(), `harness-codex-status-${runId}-`));
  const stateStorePath = join(tmpDir, 'control-plane.sqlite');
  const directoryId = `directory-status-${randomUUID()}`;
  const conversationId = `conversation-status-${randomUUID()}`;

  const server = await startControlPlaneStreamServer({
    host: '127.0.0.1',
    port: 0,
    stateStorePath,
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: false
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 250
    },
    startSession: (input) => startCodexLiveSession(input)
  });

  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  const conversations = new Map<string, RuntimeConversationState>();
  const timeline: StatusTimelineEntry[] = [];
  const observedStatusTelemetryEventNames = new Set<string>();
  const observedKeyEventNames = new Set<string>();
  const remainingTimeoutMs = (): number => {
    const elapsedMs = Date.now() - startedAtMs;
    return Math.max(200, options.timeoutMs - elapsedMs);
  };

  const emitPhase = (label: string): void => {
    const conversation = conversations.get(conversationId);
    if (conversation === undefined) {
      return;
    }
    const nowMs = Date.now();
    const phase = projectedPhase(conversation, nowMs);
    const previous = timeline[timeline.length - 1];
    if (
      previous !== undefined &&
      previous.icon === phase.icon &&
      previous.phase === phase.phase &&
      previous.statusText === phase.statusText
    ) {
      return;
    }
    timeline.push({
      atMs: nowMs,
      label,
      icon: phase.icon,
      phase: phase.phase,
      statusText: phase.statusText
    });
  };

  const subscription = await subscribeControlPlaneKeyEvents(client, {
    conversationId,
    onEvent: (event) => {
      if (event.type === 'session-status') {
        const telemetryEventName = event.telemetry?.eventName;
        if (typeof telemetryEventName === 'string' && telemetryEventName.trim().length > 0) {
          observedStatusTelemetryEventNames.add(telemetryEventName);
        }
      }
      if (event.type === 'session-telemetry') {
        const eventName = event.keyEvent.eventName;
        if (typeof eventName === 'string' && eventName.trim().length > 0) {
          observedKeyEventNames.add(eventName);
        }
      }
      const updated = applyMuxControlPlaneKeyEvent(event, {
        removedConversationIds: new Set<string>(),
        ensureConversation: (sessionId, seed) => {
          const existing = conversations.get(sessionId);
          if (existing !== undefined) {
            if (seed?.directoryId !== undefined) {
              existing.directoryId = seed.directoryId;
            }
            return existing;
          }
          const created = createConversationState(sessionId);
          if (seed?.directoryId !== undefined) {
            created.directoryId = seed.directoryId;
          }
          conversations.set(sessionId, created);
          return created;
        }
      });
      if (updated !== null) {
        emitPhase(event.type);
      }
    }
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId,
      path: options.cwd
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId,
      directoryId,
      title: 'status integration',
      agentType: 'codex'
    });
    const startArgs: string[] = ['exec', '--skip-git-repo-check'];
    if (options.model !== null) {
      startArgs.push('--model', options.model);
    }
    startArgs.push(options.prompt);
    await client.sendCommand({
      type: 'pty.start',
      sessionId: conversationId,
      args: startArgs,
      cwd: options.cwd,
      initialCols: 120,
      initialRows: 32
    });

    await waitFor('initial status event', remainingTimeoutMs(), () => conversations.has(conversationId));
    emitPhase('poll');

    await waitFor('active startup phase', remainingTimeoutMs(), () => {
      emitPhase('poll');
      return timeline.some((entry) => entry.phase === 'active');
    });

    await waitFor('inactive phase after prompt completion', remainingTimeoutMs(), () => {
      emitPhase('poll');
      const activeIndex = timeline.findIndex((entry) => entry.phase === 'active');
      if (activeIndex < 0) {
        return false;
      }
      const inactiveAfterActive = timeline.findIndex(
        (entry, index) => index > activeIndex && entry.phase === 'inactive'
      );
      return inactiveAfterActive >= 0;
    });

    const startupActiveIndex = timeline.findIndex((entry) => entry.phase === 'active');
    const promptInactiveIndex = timeline.findIndex((entry) => entry.phase === 'inactive');

    assert.equal(startupActiveIndex >= 0, true);
    assert.equal(promptInactiveIndex >= 0, true);
    assert.equal(
      timeline.some((entry) => entry.phase === 'active' && (entry.icon === '◔' || entry.icon === '◆')),
      true
    );
    assert.equal(
      timeline.some(
        (entry, index) =>
          index > startupActiveIndex &&
          entry.phase === 'inactive' &&
          (entry.icon === '○' || entry.icon === '■')
      ),
      true
    );
    assert.equal(
      timeline.some(
        (entry, index) => index > promptInactiveIndex && entry.phase === 'active'
      ),
      false
    );
    assert.equal(timeline.every((entry) => entry.statusText.trim().length > 0), true);
    assert.equal(
      timeline.some((entry) => entry.phase === 'needs-action' || entry.statusText.toLowerCase().includes('telemetry')),
      false
    );
    assert.equal(observedStatusTelemetryEventNames.has('codex.conversation_starts'), true);
    assert.equal(
      observedStatusTelemetryEventNames.has('codex.user_prompt') ||
        observedKeyEventNames.has('codex.user_prompt'),
      true
    );

    process.stdout.write('codex status integration sequence verified\n');
    printTimeline(timeline);
  } catch (error: unknown) {
    process.stderr.write('codex status integration sequence failed\n');
    printTimeline(timeline);
    throw error;
  } finally {
    await subscription.close();
    try {
      await client.sendCommand({
        type: 'session.remove',
        sessionId: conversationId
      });
    } catch {
      // Best-effort cleanup.
    }
    client.close();
    await server.close();
  }
}

await main();

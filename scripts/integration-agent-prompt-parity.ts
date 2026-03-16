import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput,
} from '../src/control-plane/stream-server.ts';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import type { StreamServerEnvelope } from '../src/control-plane/stream-protocol.ts';

type SupportedAgentType = 'codex' | 'claude' | 'cursor';

interface ScriptOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly codexModel: string | null;
  readonly claudeModel: string | null;
  readonly cursorModel: string | null;
  readonly agents: readonly SupportedAgentType[];
}

interface AgentRunConfig {
  readonly agentType: SupportedAgentType;
  readonly conversationId: string;
  readonly prompt1: string;
  readonly prompt2: string;
  readonly expectedProviderEventName: string;
}

const CURSOR_PROMPT_WRAPPER_SCRIPT_PATH = fileURLToPath(
  new URL('./cursor-prompt-wrapper.ts', import.meta.url),
);

function readNonEmptyString(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSessionSettledForNextTurn(statusSummary: Record<string, unknown>): boolean {
  const runtimeStatus = readNonEmptyString(
    typeof statusSummary['status'] === 'string' ? statusSummary['status'] : undefined,
  );
  if (runtimeStatus === 'exited') {
    return true;
  }
  if (runtimeStatus !== 'completed') {
    return false;
  }
  const liveValue = statusSummary['live'];
  if (typeof liveValue !== 'boolean') {
    return true;
  }
  return liveValue === false;
}

function parseSupportedAgents(raw: string | null): readonly SupportedAgentType[] {
  if (raw === null) {
    return ['codex', 'claude', 'cursor'];
  }
  const parsed: SupportedAgentType[] = [];
  for (const token of raw.split(',')) {
    const normalized = token.trim().toLowerCase();
    if (normalized !== 'codex' && normalized !== 'claude' && normalized !== 'cursor') {
      throw new Error(`unsupported agent in --agents: ${token}`);
    }
    if (!parsed.includes(normalized)) {
      parsed.push(normalized);
    }
  }
  if (parsed.length === 0) {
    throw new Error('--agents must include at least one of codex,claude,cursor');
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): ScriptOptions {
  let cwd = process.cwd();
  let timeoutMs = 90_000;
  let codexModel: string | null = null;
  let claudeModel: string | null = 'haiku';
  let cursorModel: string | null = 'gpt-5.3-codex-low-fast';
  let agents: readonly SupportedAgentType[] = ['codex', 'claude', 'cursor'];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const next = argv[index + 1] ?? '';

    if (arg === '--cwd' && next.length > 0) {
      cwd = resolve(next);
      index += 1;
      continue;
    }

    if (arg === '--timeout-ms' && next.length > 0) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`invalid --timeout-ms value: ${next}`);
      }
      timeoutMs = parsed;
      index += 1;
      continue;
    }

    if (arg === '--codex-model' && next.length > 0) {
      codexModel = next === 'none' ? null : next;
      index += 1;
      continue;
    }

    if (arg === '--claude-model' && next.length > 0) {
      claudeModel = next === 'none' ? null : next;
      index += 1;
      continue;
    }

    if (arg === '--cursor-model' && next.length > 0) {
      cursorModel = next === 'none' ? null : next;
      index += 1;
      continue;
    }

    if (arg === '--agents' && next.length > 0) {
      agents = parseSupportedAgents(next);
      index += 1;
      continue;
    }
  }

  return {
    cwd,
    timeoutMs,
    codexModel,
    claudeModel,
    cursorModel,
    agents,
  };
}

function promptTextsForSession(
  envelopes: readonly StreamServerEnvelope[],
  sessionId: string,
  providerEventName: string,
): string[] {
  const texts: string[] = [];
  for (const envelope of envelopes) {
    if (envelope.kind !== 'stream.event') {
      continue;
    }
    if (envelope.event.type !== 'session-prompt-event') {
      continue;
    }
    if (envelope.event.sessionId !== sessionId) {
      continue;
    }
    if (envelope.event.prompt.providerEventName !== providerEventName) {
      continue;
    }
    if (typeof envelope.event.prompt.text === 'string') {
      texts.push(envelope.event.prompt.text);
    }
  }
  return texts;
}

function outputTailForSession(
  envelopes: readonly StreamServerEnvelope[],
  sessionId: string,
  maxLines = 40,
): string {
  let collected = '';
  for (const envelope of envelopes) {
    if (envelope.kind !== 'stream.event') {
      continue;
    }
    if (envelope.event.type !== 'session-output') {
      continue;
    }
    if (envelope.event.sessionId !== sessionId) {
      continue;
    }
    const decoded = Buffer.from(envelope.event.chunkBase64, 'base64').toString('utf8');
    collected += decoded;
  }
  const lines = collected.split(/\r?\n/u);
  return lines.slice(-maxLines).join('\n').trim();
}

async function waitForCondition(
  label: string,
  timeoutMs: number,
  predicate: () => boolean | Promise<boolean>,
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

function buildTurnArgs(
  agentType: SupportedAgentType,
  prompt: string,
  turnIndex: 1 | 2,
  models: {
    codex: string | null;
    claude: string | null;
    cursor: string | null;
  },
): string[] {
  if (agentType === 'codex') {
    if (turnIndex === 1) {
      return [
        'exec',
        '--skip-git-repo-check',
        ...(models.codex === null ? [] : ['--model', models.codex]),
        prompt,
      ];
    }
    return [
      'exec',
      'resume',
      '--last',
      '--skip-git-repo-check',
      ...(models.codex === null ? [] : ['--model', models.codex]),
      prompt,
    ];
  }

  if (agentType === 'claude') {
    return [
      '--print',
      '--output-format',
      'text',
      '--dangerously-skip-permissions',
      ...(turnIndex === 2 ? ['--continue'] : []),
      ...(models.claude === null ? [] : ['--model', models.claude]),
      prompt,
    ];
  }

  return [
    '--print',
    '--output-format',
    'text',
    '--trust',
    '--force',
    ...(turnIndex === 2 ? ['--continue'] : []),
    ...(models.cursor === null ? [] : ['--model', models.cursor]),
    prompt,
  ];
}

function buildStartSessionOptions(
  input: StartControlPlaneSessionInput,
): Parameters<typeof startCodexLiveSession>[0] {
  const sessionOptions: Parameters<typeof startCodexLiveSession>[0] = {
    args: [...input.args],
    initialCols: input.initialCols,
    initialRows: input.initialRows,
    enableSnapshotModel: true,
  };

  if (input.command !== undefined && input.command === 'cursor-agent') {
    sessionOptions.command = process.execPath;
    sessionOptions.baseArgs = [
      CURSOR_PROMPT_WRAPPER_SCRIPT_PATH,
      'cursor-agent',
      ...(input.baseArgs ?? []),
    ];
  } else {
    if (input.command !== undefined) {
      sessionOptions.command = input.command;
    }
    if (input.baseArgs !== undefined) {
      sessionOptions.baseArgs = [...input.baseArgs];
    }
  }

  if (input.useNotifyHook !== undefined) {
    sessionOptions.useNotifyHook = input.useNotifyHook;
  }
  if (input.notifyMode !== undefined) {
    sessionOptions.notifyMode = input.notifyMode;
  }
  if (input.notifyFilePath !== undefined) {
    sessionOptions.notifyFilePath = input.notifyFilePath;
  }
  if (input.env !== undefined) {
    sessionOptions.env = input.env;
  }
  if (input.cwd !== undefined) {
    sessionOptions.cwd = input.cwd;
  }
  if (input.terminalForegroundHex !== undefined) {
    sessionOptions.terminalForegroundHex = input.terminalForegroundHex;
  }
  if (input.terminalBackgroundHex !== undefined) {
    sessionOptions.terminalBackgroundHex = input.terminalBackgroundHex;
  }

  return sessionOptions;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runTag = Date.now().toString(36);
  const stateStoreDir = mkdtempSync(join(tmpdir(), `harness-agent-prompt-live-${runTag}-`));
  const stateStorePath = join(stateStoreDir, 'control-plane.sqlite');

  const tenantId = `tenant-live-${runTag}`;
  const userId = `user-live-${runTag}`;
  const workspaceId = `workspace-live-${runTag}`;
  const directoryId = `directory-live-${runTag}`;

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
      captureMetrics: false,
      captureTraces: false,
      captureVerboseEvents: false,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 5000,
    },
    cursorHooks: {
      managed: false,
    },
    startSession: (input) => startCodexLiveSession(buildStartSessionOptions(input)),
  });

  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observedEnvelopes: StreamServerEnvelope[] = [];
  const unsubscribe = client.onEnvelope((envelope) => {
    observedEnvelopes.push(envelope);
  });

  const runStartAtMs = Date.now();
  const remainingTimeoutMs = (): number =>
    Math.max(300, options.timeoutMs - (Date.now() - runStartAtMs));

  async function waitForSessionToSettle(sessionId: string): Promise<void> {
    await waitForCondition(`session settle: ${sessionId}`, remainingTimeoutMs(), async () => {
      const status = await client.sendCommand({
        type: 'session.status',
        sessionId,
      });
      return isSessionSettledForNextTurn(status);
    });
  }

  async function runTurn(sessionId: string, args: readonly string[]): Promise<void> {
    await client.sendCommand({
      type: 'pty.start',
      sessionId,
      args: [...args],
      cwd: options.cwd,
      initialCols: 120,
      initialRows: 32,
    });
    await waitForSessionToSettle(sessionId);
  }

  const runConfigs: AgentRunConfig[] = options.agents.map((agentType) => ({
    agentType,
    conversationId: `conversation-${agentType}-${randomUUID()}`,
    prompt1: `Reply with exactly: ${agentType.toUpperCase()}-P1-${runTag}`,
    prompt2: `Reply with exactly: ${agentType.toUpperCase()}-P2-${runTag}`,
    expectedProviderEventName:
      agentType === 'codex'
        ? 'codex.user_prompt'
        : agentType === 'claude'
          ? 'claude.userpromptsubmit'
          : 'cursor.beforesubmitprompt',
  }));

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId,
      tenantId,
      userId,
      workspaceId,
      path: options.cwd,
    });

    const subscribeResponse = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId,
      userId,
      workspaceId,
      includeOutput: true,
    });
    assert.equal(typeof subscribeResponse['subscriptionId'], 'string');

    for (const config of runConfigs) {
      await client.sendCommand({
        type: 'conversation.create',
        conversationId: config.conversationId,
        directoryId,
        title: `${config.agentType} live prompt parity`,
        agentType: config.agentType,
      });

      process.stdout.write(
        `running ${config.agentType} turn 1 (model=${
          config.agentType === 'codex'
            ? (options.codexModel ?? 'default')
            : config.agentType === 'claude'
              ? (options.claudeModel ?? 'default')
              : (options.cursorModel ?? 'default')
        })\n`,
      );

      await runTurn(
        config.conversationId,
        buildTurnArgs(config.agentType, config.prompt1, 1, {
          codex: options.codexModel,
          claude: options.claudeModel,
          cursor: options.cursorModel,
        }),
      );

      await waitForCondition(`${config.agentType} prompt 1`, remainingTimeoutMs(), () =>
        promptTextsForSession(
          observedEnvelopes,
          config.conversationId,
          config.expectedProviderEventName,
        ).includes(config.prompt1),
      );

      process.stdout.write(`running ${config.agentType} turn 2 (resume/continue)\n`);

      await runTurn(
        config.conversationId,
        buildTurnArgs(config.agentType, config.prompt2, 2, {
          codex: options.codexModel,
          claude: options.claudeModel,
          cursor: options.cursorModel,
        }),
      );

      await waitForCondition(`${config.agentType} prompt 2`, remainingTimeoutMs(), () =>
        promptTextsForSession(
          observedEnvelopes,
          config.conversationId,
          config.expectedProviderEventName,
        ).includes(config.prompt2),
      );

      const texts = promptTextsForSession(
        observedEnvelopes,
        config.conversationId,
        config.expectedProviderEventName,
      );

      assert.equal(
        texts.includes(config.prompt1),
        true,
        `${config.agentType} prompt 1 was not captured via ${config.expectedProviderEventName}`,
      );
      assert.equal(
        texts.includes(config.prompt2),
        true,
        `${config.agentType} prompt 2 was not captured via ${config.expectedProviderEventName}`,
      );

      await client.sendCommand({
        type: 'session.remove',
        sessionId: config.conversationId,
      });

      process.stdout.write(
        `${config.agentType} prompt capture verified (${config.expectedProviderEventName}): ${texts.length} events\n`,
      );
    }

    process.stdout.write('live agent prompt parity integration passed\n');
  } catch (error: unknown) {
    process.stderr.write('live agent prompt parity integration failed\n');
    for (const config of runConfigs) {
      const prompts = promptTextsForSession(
        observedEnvelopes,
        config.conversationId,
        config.expectedProviderEventName,
      );
      const outputTail = outputTailForSession(observedEnvelopes, config.conversationId);
      process.stderr.write(
        [
          `agent=${config.agentType}`,
          `expectedEvent=${config.expectedProviderEventName}`,
          `capturedPrompts=${JSON.stringify(prompts)}`,
          `outputTail=${JSON.stringify(outputTail)}`,
        ].join('\n') + '\n',
      );
    }
    throw error;
  } finally {
    unsubscribe();
    client.close();
    await server.close();
    rmSync(stateStoreDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}

export const __integrationAgentPromptParityInternals = {
  isSessionSettledForNextTurn,
};

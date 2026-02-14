import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startCodexLiveSession, type CodexLiveEvent } from '../src/codex/live-session.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';
import {
  createNormalizedEvent,
  type EventScope,
  type NormalizedEventEnvelope
} from '../src/events/normalized-events.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';

function getInitialSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 80, rows: 24 };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeExitCode(exit: PtyExit): number {
  if (exit.code !== null) {
    return exit.code;
  }
  if (exit.signal !== null) {
    return 128;
  }
  return 1;
}

function mapToNormalizedEvent(
  event: CodexLiveEvent,
  scope: EventScope,
  idFactory: () => string
): NormalizedEventEnvelope | null {
  if (event.type === 'terminal-output') {
    return createNormalizedEvent(
      'provider',
      'provider-text-delta',
      scope,
      {
        kind: 'text-delta',
        threadId: scope.conversationId,
        turnId: scope.turnId ?? 'turn-live',
        delta: event.chunk.toString('utf8')
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'turn-completed') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'provider',
      'provider-turn-completed',
      scope,
      {
        kind: 'turn',
        threadId: asString(payloadObject['thread-id'], scope.conversationId),
        turnId: asString(payloadObject['turn-id'], scope.turnId ?? 'turn-live'),
        status: 'completed'
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'attention-required') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'meta',
      'meta-attention-raised',
      scope,
      {
        kind: 'attention',
        threadId: asString(payloadObject['thread-id'], scope.conversationId),
        turnId: asString(payloadObject['turn-id'], scope.turnId ?? 'turn-live'),
        reason: event.reason,
        detail: asString(payloadObject.type, 'notify')
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'notify') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'meta',
      'meta-notify-observed',
      scope,
      {
        kind: 'notify',
        notifyType: asString(payloadObject.type, 'unknown'),
        raw: payloadObject
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'session-exit') {
    return createNormalizedEvent(
      'meta',
      'meta-attention-cleared',
      scope,
      {
        kind: 'attention',
        threadId: scope.conversationId,
        turnId: scope.turnId ?? 'turn-live',
        reason: 'stalled',
        detail: 'session-exit'
      },
      () => new Date(),
      idFactory
    );
  }

  return null;
}

function writeEvent(event: NormalizedEventEnvelope, mirrorToStderr: boolean): void {
  if (!mirrorToStderr) {
    return;
  }
  process.stderr.write(`[event] ${JSON.stringify(event)}\n`);
}

async function main(): Promise<number> {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const extraArgs = process.argv.slice(2);
  const mirrorEventsToStderr = process.env.HARNESS_LIVE_EVENT_STDERR === '1';

  const storePath = process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite';
  const conversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;

  const scope: EventScope = {
    tenantId: process.env.HARNESS_TENANT_ID ?? 'tenant-local',
    userId: process.env.HARNESS_USER_ID ?? 'user-local',
    workspaceId: process.env.HARNESS_WORKSPACE_ID ?? basename(process.cwd()),
    worktreeId: process.env.HARNESS_WORKTREE_ID ?? 'worktree-local',
    conversationId,
    turnId
  };

  const idFactory = (): string => {
    return `event-${randomUUID()}`;
  };

  const liveSession = startCodexLiveSession({
    args: extraArgs,
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color'
    }
  });
  const store = new SqliteEventStore(storePath);

  let exit: PtyExit | null = null;
  const exitPromise = new Promise<PtyExit>((resolve) => {
    liveSession.onEvent((event) => {
      const normalized = mapToNormalizedEvent(event, scope, idFactory);
      if (normalized !== null) {
        store.appendEvents([normalized]);
        writeEvent(normalized, mirrorEventsToStderr);
      }

      if (event.type === 'session-exit') {
        exit = event.exit;
        resolve(event.exit);
      }
    });
  });

  const attachmentId = liveSession.attach({
    onData: (event) => {
      process.stdout.write(event.chunk);
    },
    onExit: () => {
      // handled via event stream
    }
  });

  const onInput = (chunk: Buffer): void => {
    liveSession.write(chunk);
  };
  const onResize = (): void => {
    const size = getInitialSize();
    liveSession.resize(size.cols, size.rows);
  };

  let restored = false;
  const restoreTerminal = (): void => {
    if (restored) {
      return;
    }
    restored = true;

    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    process.stdin.pause();

    if (interactive) {
      process.stdin.setRawMode(false);
    }

    liveSession.detach(attachmentId);
    liveSession.close();
    store.close();
  };

  process.once('SIGTERM', () => {
    liveSession.close();
  });
  process.once('SIGHUP', () => {
    liveSession.close();
  });

  if (interactive) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', onInput);
  process.stdout.on('resize', onResize);
  onResize();

  await exitPromise;
  restoreTerminal();

  if (exit === null) {
    return 1;
  }
  return normalizeExitCode(exit);
}

const code = await main();
process.exitCode = code;

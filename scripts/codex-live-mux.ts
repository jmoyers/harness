import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startCodexLiveSession, type CodexLiveEvent } from '../src/codex/live-session.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';
import { renderSnapshotAnsiRow } from '../src/terminal/snapshot-oracle.ts';
import {
  createNormalizedEvent,
  type EventScope,
  type NormalizedEventEnvelope
} from '../src/events/normalized-events.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import {
  EventPaneViewport,
  computeDualPaneLayout,
  diffRenderedRows,
  padOrTrimDisplay,
  parseMuxInputChunk,
  routeMuxInputTokens
} from '../src/mux/dual-pane-core.ts';

interface MuxOptions {
  codexArgs: string[];
  storePath: string;
  conversationId: string;
  turnId: string;
  scope: EventScope;
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

function summarizeEvent(event: NormalizedEventEnvelope): string {
  const turnId = event.scope.turnId ?? '-';
  const payload = event.payload;

  if (event.type === 'meta-notify-observed' && payload.kind === 'notify') {
    return `${event.ts} notify ${payload.notifyType}`;
  }

  if (event.type === 'meta-attention-raised' && payload.kind === 'attention') {
    return `${event.ts} attention ${payload.reason}`;
  }

  if (event.type === 'provider-turn-completed') {
    return `${event.ts} turn completed (${turnId})`;
  }

  if (event.type === 'meta-attention-cleared') {
    return `${event.ts} session exited`;
  }

  return `${event.ts} ${event.type}`;
}

function terminalSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 120, rows: 40 };
}

function parseArgs(argv: string[]): MuxOptions {
  const conversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;

  return {
    codexArgs: argv,
    storePath: process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite',
    conversationId,
    turnId,
    scope: {
      tenantId: process.env.HARNESS_TENANT_ID ?? 'tenant-local',
      userId: process.env.HARNESS_USER_ID ?? 'user-local',
      workspaceId: process.env.HARNESS_WORKSPACE_ID ?? basename(process.cwd()),
      worktreeId: process.env.HARNESS_WORKTREE_ID ?? 'worktree-local',
      conversationId,
      turnId
    }
  };
}

function buildRenderRows(
  layout: ReturnType<typeof computeDualPaneLayout>,
  liveSession: ReturnType<typeof startCodexLiveSession>,
  events: EventPaneViewport,
  conversationId: string
): string[] {
  const leftFrame = liveSession.snapshot();
  const rightView = events.view(layout.rightCols, layout.paneRows);

  const rows: string[] = [];
  for (let row = 0; row < layout.paneRows; row += 1) {
    const left = renderSnapshotAnsiRow(leftFrame, row, layout.leftCols);
    const right = padOrTrimDisplay(rightView.lines[row] ?? '', layout.rightCols);
    rows.push(`${left}\u001b[0m│${right}`);
  }

  const mode = rightView.followOutput
    ? 'events=live'
    : `events=scroll(${String(rightView.top + 1)}/${String(rightView.totalRows)})`;
  const status = padOrTrimDisplay(
    `[mux] conversation=${conversationId} ${mode} ctrl-] quit`,
    layout.cols
  );
  rows.push(status);

  return rows;
}

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('codex:live:mux requires a TTY stdin/stdout\n');
    return 2;
  }

  const options = parseArgs(process.argv.slice(2));
  const store = new SqliteEventStore(options.storePath);

  const maxEventLines = 1000;
  const events = new EventPaneViewport(maxEventLines);

  let size = terminalSize();
  let layout = computeDualPaneLayout(size.cols, size.rows);

  const liveSession = startCodexLiveSession({
    args: options.codexArgs,
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color'
    }
  });

  const idFactory = (): string => `event-${randomUUID()}`;
  let exit: PtyExit | null = null;
  let dirty = true;
  let stop = false;
  let inputRemainder = '';
  let previousRows: readonly string[] = [];
  let forceFullClear = true;

  const recalcLayout = (): void => {
    size = terminalSize();
    layout = computeDualPaneLayout(size.cols, size.rows);
    liveSession.resize(layout.leftCols, layout.paneRows);
    previousRows = [];
    forceFullClear = true;
    dirty = true;
  };

  const appendEventLine = (line: string): void => {
    events.append(line);
    dirty = true;
  };

  const render = (): void => {
    if (!dirty) {
      return;
    }

    const rows = buildRenderRows(layout, liveSession, events, options.conversationId);
    const diff = diffRenderedRows(rows, previousRows);

    let output = '';
    if (forceFullClear) {
      output += '\u001b[?25l\u001b[H\u001b[2J';
      forceFullClear = false;
    }
    output += diff.output;

    if (output.length > 0) {
      process.stdout.write(output);
    }

    previousRows = diff.nextRows;
    dirty = false;
  };

  liveSession.onEvent((event) => {
    const normalized = mapToNormalizedEvent(event, options.scope, idFactory);
    if (normalized !== null) {
      store.appendEvents([normalized]);
      if (normalized.type !== 'provider-text-delta') {
        appendEventLine(summarizeEvent(normalized));
      }
    }

    if (event.type === 'terminal-output') {
      dirty = true;
    }

    if (event.type === 'session-exit') {
      exit = event.exit;
      stop = true;
      dirty = true;
    }
  });

  const onInput = (chunk: Buffer): void => {
    if (chunk.length === 1 && chunk[0] === 0x1d) {
      stop = true;
      liveSession.close();
      return;
    }

    const parsed = parseMuxInputChunk(inputRemainder, chunk);
    inputRemainder = parsed.remainder;

    const routed = routeMuxInputTokens(parsed.tokens, layout);
    if (routed.rightPaneScrollRows !== 0) {
      events.scrollBy(routed.rightPaneScrollRows, layout.rightCols, layout.paneRows);
      dirty = true;
    }

    for (const forwardChunk of routed.forwardToSession) {
      liveSession.write(forwardChunk);
    }
  };

  const onResize = (): void => {
    recalcLayout();
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onInput);
  process.stdout.on('resize', onResize);

  process.stdout.write('\u001b[?1000h\u001b[?1006h');
  recalcLayout();

  const renderTimer = setInterval(() => {
    render();
  }, 16);

  try {
    while (!stop) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  } finally {
    clearInterval(renderTimer);
    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    process.stdin.pause();
    process.stdin.setRawMode(false);
    liveSession.close();
    store.close();
    process.stdout.write('\u001b[?1000l\u001b[?1006l\u001b[?25h\u001b[0m\n');
  }

  if (exit === null) {
    return 0;
  }
  return normalizeExitCode(exit);
}

const code = await main();
process.exitCode = code;

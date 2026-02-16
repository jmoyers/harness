import { SqliteEventStore } from '../src/store/event-store.ts';
import type { NormalizedEventEnvelope } from '../src/events/normalized-events.ts';
import { TerminalSnapshotOracle, renderSnapshotText } from '../src/terminal/snapshot-oracle.ts';

interface SnapshotOptions {
  conversationId: string;
  tenantId: string;
  userId: string;
  dbPath: string;
  cols: number;
  rows: number;
  pollMs: number;
  follow: boolean;
  fromNow: boolean;
  json: boolean;
  clearBetweenFrames: boolean;
  exitOnSessionEnd: boolean;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseArgs(argv: string[]): SnapshotOptions {
  const envConversationId = process.env.HARNESS_CONVERSATION_ID;
  const envTenantId = process.env.HARNESS_TENANT_ID ?? 'tenant-local';
  const envUserId = process.env.HARNESS_USER_ID ?? 'user-local';
  const envDbPath = process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite';

  let conversationId = envConversationId;
  let tenantId = envTenantId;
  let userId = envUserId;
  let dbPath = envDbPath;
  let cols = parsePositiveInteger(process.env.HARNESS_SNAPSHOT_COLS, 120);
  let rows = parsePositiveInteger(process.env.HARNESS_SNAPSHOT_ROWS, 40);
  let pollMs = parsePositiveInteger(process.env.HARNESS_SNAPSHOT_POLL_MS, 200);
  let follow = false;
  let fromNow = false;
  let json = false;
  let clearBetweenFrames = true;
  let exitOnSessionEnd = true;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === '--conversation-id') {
      conversationId = argv[idx + 1];
      idx += 1;
      continue;
    }
    if (arg === '--tenant-id') {
      tenantId = argv[idx + 1] ?? tenantId;
      idx += 1;
      continue;
    }
    if (arg === '--user-id') {
      userId = argv[idx + 1] ?? userId;
      idx += 1;
      continue;
    }
    if (arg === '--db-path') {
      dbPath = argv[idx + 1] ?? dbPath;
      idx += 1;
      continue;
    }
    if (arg === '--cols') {
      cols = parsePositiveInteger(argv[idx + 1], cols);
      idx += 1;
      continue;
    }
    if (arg === '--rows') {
      rows = parsePositiveInteger(argv[idx + 1], rows);
      idx += 1;
      continue;
    }
    if (arg === '--poll-ms') {
      pollMs = parsePositiveInteger(argv[idx + 1], pollMs);
      idx += 1;
      continue;
    }
    if (arg === '--follow') {
      follow = true;
      continue;
    }
    if (arg === '--from-now') {
      fromNow = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      clearBetweenFrames = false;
      continue;
    }
    if (arg === '--no-clear') {
      clearBetweenFrames = false;
      continue;
    }
    if (arg === '--no-exit-on-session-end') {
      exitOnSessionEnd = false;
      continue;
    }
  }

  if (typeof conversationId !== 'string' || conversationId.length === 0) {
    process.stderr.write(
      'usage: bun run codex:live:snapshot -- --conversation-id <id> [--follow] [--from-now] [--json]\n'
    );
    process.exit(2);
  }

  return {
    conversationId,
    tenantId,
    userId,
    dbPath,
    cols,
    rows,
    pollMs,
    follow,
    fromNow,
    json,
    clearBetweenFrames,
    exitOnSessionEnd
  };
}

function isSessionExitEvent(event: NormalizedEventEnvelope): boolean {
  if (event.type !== 'meta-attention-cleared') {
    return false;
  }
  const payload = event.payload;
  if (payload.kind !== 'attention') {
    return false;
  }
  return payload.detail === 'session-exit';
}

function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const withCode = error as { code?: unknown };
  return withCode.code === 'ERR_SQLITE_BUSY';
}

function printFrame(
  oracle: TerminalSnapshotOracle,
  options: SnapshotOptions,
  lastRowId: number,
  atTs: string
): void {
  const frame = oracle.snapshot();
  const rendered = renderSnapshotText(frame);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        kind: 'snapshot-frame',
        conversationId: options.conversationId,
        rowId: lastRowId,
        ts: atTs,
        frame,
        screen: rendered
      })}\n`
    );
    return;
  }

  if (options.clearBetweenFrames) {
    process.stdout.write('\u001bc');
  }
  process.stdout.write(
    `[snapshot] conversation=${options.conversationId} rowId=${String(lastRowId)} cursor=${String(frame.cursor.row + 1)},${String(frame.cursor.col + 1)} ts=${atTs}\n`
  );
  process.stdout.write(`${rendered}\n`);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const store = new SqliteEventStore(options.dbPath);
  const oracle = new TerminalSnapshotOracle(options.cols, options.rows);
  let lastRowId = 0;
  let sawSessionExit = false;
  let stop = false;

  process.once('SIGINT', () => {
    stop = true;
  });
  process.once('SIGTERM', () => {
    stop = true;
  });

  try {
    if (options.fromNow) {
      const baseline = store.listEvents({
        tenantId: options.tenantId,
        userId: options.userId,
        conversationId: options.conversationId,
        afterRowId: 0,
        limit: 1_000_000
      });
      if (baseline.length > 0) {
        lastRowId = baseline[baseline.length - 1]!.rowId;
      }
    }

    process.stderr.write(
      `[snapshot] conversation=${options.conversationId} tenant=${options.tenantId} user=${options.userId} db=${options.dbPath} follow=${String(options.follow)} fromNow=${String(options.fromNow)}\n`
    );

    while (!stop) {
      let rows: ReturnType<SqliteEventStore['listEvents']>;
      try {
        rows = store.listEvents({
          tenantId: options.tenantId,
          userId: options.userId,
          conversationId: options.conversationId,
          afterRowId: lastRowId,
          limit: 500
        });
      } catch (error) {
        if (isSqliteBusyError(error)) {
          await new Promise((resolve) => {
            setTimeout(resolve, options.pollMs);
          });
          continue;
        }
        throw error;
      }

      let changed = false;
      let frameTs = new Date().toISOString();

      for (const row of rows) {
        lastRowId = row.rowId;
        frameTs = row.event.ts;
        if (row.event.type === 'provider-text-delta' && row.event.payload.kind === 'text-delta') {
          const delta = String(row.event.payload.delta ?? '');
          oracle.ingest(delta);
          changed = true;
        }

        if (isSessionExitEvent(row.event)) {
          sawSessionExit = true;
        }
      }

      if (changed || (!options.follow && rows.length === 0)) {
        printFrame(oracle, options, lastRowId, frameTs);
      }

      if (!options.follow) {
        return 0;
      }

      if (options.exitOnSessionEnd && sawSessionExit) {
        return 0;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, options.pollMs);
      });
    }

    return 0;
  } finally {
    store.close();
  }
}

const exitCode = await main();
process.exitCode = exitCode;

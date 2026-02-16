import { SqliteEventStore } from '../src/store/event-store.ts';
import type { NormalizedEventEnvelope } from '../src/events/normalized-events.ts';

interface TailOptions {
  conversationId: string;
  tenantId: string;
  userId: string;
  dbPath: string;
  pollMs: number;
  json: boolean;
  includeTextDeltas: boolean;
  exitOnSessionEnd: boolean;
  fromNow: boolean;
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

function parseArgs(argv: string[]): TailOptions {
  const envConversationId = process.env.HARNESS_CONVERSATION_ID;
  const envTenantId = process.env.HARNESS_TENANT_ID ?? 'tenant-local';
  const envUserId = process.env.HARNESS_USER_ID ?? 'user-local';
  const envDbPath = process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite';
  const envPollMs = parsePositiveInteger(process.env.HARNESS_LIVE_TAIL_POLL_MS, 150);
  const envExitOnSessionEnd = process.env.HARNESS_LIVE_TAIL_EXIT_ON_END !== '0';

  let conversationId = envConversationId;
  let tenantId = envTenantId;
  let userId = envUserId;
  let dbPath = envDbPath;
  let pollMs = envPollMs;
  let json = false;
  let includeTextDeltas = false;
  let exitOnSessionEnd = envExitOnSessionEnd;
  let fromNow = false;

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
    if (arg === '--poll-ms') {
      pollMs = parsePositiveInteger(argv[idx + 1], pollMs);
      idx += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--include-text-deltas') {
      includeTextDeltas = true;
      continue;
    }
    if (arg === '--no-text-deltas') {
      includeTextDeltas = false;
      continue;
    }
    if (arg === '--from-now') {
      fromNow = true;
      continue;
    }
    if (arg === '--from-start') {
      fromNow = false;
      continue;
    }
    if (arg === '--no-exit-on-session-end') {
      exitOnSessionEnd = false;
      continue;
    }
    if (arg === '--exit-on-session-end') {
      exitOnSessionEnd = true;
      continue;
    }
  }

  if (typeof conversationId !== 'string' || conversationId.length === 0) {
    process.stderr.write(
      'usage: bun run codex:live:tail -- --conversation-id <id> [--json] [--include-text-deltas] [--from-now|--from-start]\n'
    );
    process.exitCode = 2;
    process.exit(2);
  }

  return {
    conversationId,
    tenantId,
    userId,
    dbPath,
    pollMs,
    json,
    includeTextDeltas,
    exitOnSessionEnd,
    fromNow
  };
}

function escapeControls(value: string): string {
  let escaped = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 0x0a) {
      escaped += '\\n';
      continue;
    }
    if (code === 0x09) {
      escaped += '\\t';
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      escaped += char;
      continue;
    }
    escaped += `\\x${code.toString(16).padStart(2, '0')}`;
  }
  return escaped;
}

function summarizeEvent(event: NormalizedEventEnvelope): string {
  const turnId = event.scope.turnId ?? '-';
  const payload = event.payload;

  if (event.type === 'provider-text-delta' && payload.kind === 'text-delta') {
    const delta = String(payload.delta ?? '');
    const preview = escapeControls(delta).slice(0, 80);
    return `${event.ts} ${event.type} turn=${turnId} delta="${preview}"`;
  }

  if (event.type === 'meta-attention-raised' && payload.kind === 'attention') {
    return `${event.ts} ${event.type} turn=${turnId} reason=${String(payload.reason)}`;
  }

  return `${event.ts} ${event.type} turn=${turnId}`;
}

function shouldEmitEvent(event: NormalizedEventEnvelope, options: TailOptions): boolean {
  if (options.includeTextDeltas) {
    return true;
  }
  return event.type !== 'provider-text-delta';
}

function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const withCode = error as { code?: unknown };
  return withCode.code === 'ERR_SQLITE_BUSY';
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

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const store = new SqliteEventStore(options.dbPath);
  let lastRowId = 0;
  let stop = false;

  const requestStop = (): void => {
    stop = true;
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

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
      `[tail] conversation=${options.conversationId} tenant=${options.tenantId} user=${options.userId} db=${options.dbPath} fromNow=${String(options.fromNow)}\n`
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

      for (const row of rows) {
        lastRowId = row.rowId;
        if (!shouldEmitEvent(row.event, options)) {
          continue;
        }
        if (options.json) {
          process.stdout.write(`${JSON.stringify({ rowId: row.rowId, event: row.event })}\n`);
        } else {
          process.stdout.write(`${summarizeEvent(row.event)}\n`);
        }

        if (options.exitOnSessionEnd && isSessionExitEvent(row.event)) {
          return 0;
        }
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

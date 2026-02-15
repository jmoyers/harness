import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PerfAttrValue = boolean | number | string;
type PerfAttrs = Record<string, PerfAttrValue>;

interface PerfEventRecord {
  readonly type: 'event';
  readonly name: string;
  readonly 'ts-ms': number;
  readonly attrs: PerfAttrs;
}

interface PerfSpanRecord {
  readonly type: 'span';
  readonly name: string;
  readonly 'end-ms': number;
  readonly 'duration-ns': string;
  readonly attrs: PerfAttrs;
}

type PerfRecord = PerfEventRecord | PerfSpanRecord;

interface Checkpoint {
  readonly name: string;
  readonly atMs: number;
  readonly detail: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asAttrs(value: unknown): PerfAttrs {
  const record = asRecord(value);
  if (record === null) {
    return {};
  }
  const attrs: PerfAttrs = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      attrs[key] = raw;
    }
  }
  return attrs;
}

function parsePerfRecord(line: string): PerfRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) {
    return null;
  }
  const type = record['type'];
  const name = record['name'];
  if (typeof name !== 'string') {
    return null;
  }
  if (type === 'event') {
    const tsMs = record['ts-ms'];
    if (typeof tsMs !== 'number') {
      return null;
    }
    return {
      type: 'event',
      name,
      'ts-ms': tsMs,
      attrs: asAttrs(record['attrs'])
    };
  }
  if (type === 'span') {
    const endMs = record['end-ms'];
    const durationNs = record['duration-ns'];
    if (typeof endMs !== 'number' || typeof durationNs !== 'string') {
      return null;
    }
    return {
      type: 'span',
      name,
      'end-ms': endMs,
      'duration-ns': durationNs,
      attrs: asAttrs(record['attrs'])
    };
  }
  return null;
}

function parseArgs(argv: readonly string[]): string {
  let filePath = '.harness/perf-startup.jsonl';
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--file') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --file');
      }
      filePath = value;
      idx += 1;
    }
  }
  return resolve(process.cwd(), filePath);
}

function firstEvent(
  records: readonly PerfRecord[],
  name: string,
  predicate?: (record: PerfEventRecord) => boolean
): PerfEventRecord | null {
  for (const record of records) {
    if (record.type !== 'event' || record.name !== name) {
      continue;
    }
    if (predicate !== undefined && !predicate(record)) {
      continue;
    }
    return record;
  }
  return null;
}

function firstSpan(
  records: readonly PerfRecord[],
  name: string,
  predicate?: (record: PerfSpanRecord) => boolean
): PerfSpanRecord | null {
  for (const record of records) {
    if (record.type !== 'span' || record.name !== name) {
      continue;
    }
    if (predicate !== undefined && !predicate(record)) {
      continue;
    }
    return record;
  }
  return null;
}

function eventTimeMs(records: readonly PerfRecord[], name: string): number | null {
  const event = firstEvent(records, name);
  return event?.['ts-ms'] ?? null;
}

function formatDeltaMs(value: number): string {
  return `${value.toFixed(0)}ms`;
}

function formatOffset(baseMs: number, valueMs: number): string {
  const deltaMs = valueMs - baseMs;
  const prefix = deltaMs >= 0 ? '+' : '-';
  return `${prefix}${Math.abs(deltaMs).toFixed(0).padStart(5, ' ')}ms`;
}

function boolAttr(attrs: PerfAttrs, key: string): boolean | null {
  const value = attrs[key];
  return typeof value === 'boolean' ? value : null;
}

function stringAttr(attrs: PerfAttrs, key: string): string | null {
  const value = attrs[key];
  return typeof value === 'string' ? value : null;
}

function numberAttr(attrs: PerfAttrs, key: string): number | null {
  const value = attrs[key];
  return typeof value === 'number' ? value : null;
}

function readPerfRecords(filePath: string): readonly PerfRecord[] {
  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line) => parsePerfRecord(line)).flatMap((record) => (record === null ? [] : [record]));
}

function printTimeline(records: readonly PerfRecord[]): number {
  const checkpoints: Checkpoint[] = [];
  const pushEvent = (name: string, label: string, detail = ''): void => {
    const event = firstEvent(records, name);
    if (event === null) {
      return;
    }
    checkpoints.push({
      name: label,
      atMs: event['ts-ms'],
      detail
    });
  };
  const pushSpan = (
    name: string,
    label: string,
    predicate?: (record: PerfSpanRecord) => boolean,
    detailFactory?: (record: PerfSpanRecord) => string
  ): void => {
    const span = firstSpan(records, name, predicate);
    if (span === null) {
      return;
    }
    checkpoints.push({
      name: label,
      atMs: span['end-ms'],
      detail: detailFactory?.(span) ?? ''
    });
  };

  pushEvent('launch.startup.begin', 'launch.begin');
  pushEvent('launch.startup.port-reserved', 'launch.port-reserved');
  pushEvent('launch.startup.daemon-spawned', 'launch.daemon-spawned');
  pushEvent('daemon.startup.begin', 'daemon.begin');
  pushEvent('daemon.startup.listening', 'daemon.listening');
  pushEvent('launch.startup.daemon-ready', 'launch.daemon-ready');
  pushEvent('launch.startup.mux-spawned', 'launch.mux-spawned');
  pushEvent('mux.startup.begin', 'mux.begin');
  pushEvent('mux.startup.terminal-size', 'mux.terminal-size');
  pushEvent('control-plane.connect.begin', 'protocol.client.connect.begin');
  pushEvent('control-plane.server.connection.open', 'protocol.server.connection.open');
  pushEvent('control-plane.server.auth.ok', 'protocol.server.auth.ok');
  pushEvent('control-plane.connect.ready', 'protocol.client.connect.ready');
  pushSpan(
    'control-plane.command.rtt',
    'protocol.client.command.directory.upsert',
    (record) => stringAttr(record.attrs, 'type') === 'directory.upsert'
  );
  pushSpan(
    'control-plane.command.rtt',
    'protocol.client.command.conversation.list',
    (record) => stringAttr(record.attrs, 'type') === 'conversation.list'
  );
  pushSpan(
    'control-plane.command.rtt',
    'protocol.client.command.session.list',
    (record) => stringAttr(record.attrs, 'type') === 'session.list'
  );
  pushSpan(
    'control-plane.command.rtt',
    'protocol.client.command.pty.start',
    (record) => stringAttr(record.attrs, 'type') === 'pty.start'
  );
  pushSpan(
    'control-plane.command.rtt',
    'protocol.client.command.pty.attach',
    (record) => stringAttr(record.attrs, 'type') === 'pty.attach'
  );
  pushEvent('mux.startup.ready', 'mux.ready');
  pushEvent('mux.startup.active-first-output', 'mux.active.first-output');
  pushEvent('mux.startup.active-first-visible-paint', 'mux.active.first-visible-paint');
  pushEvent('mux.startup.active-header-visible', 'mux.active.header-visible');
  pushEvent('mux.startup.active-settle-gate', 'mux.active.settle-gate');
  pushEvent('mux.startup.active-settled', 'mux.active.settled');
  pushEvent('mux.startup.background-probes.begin', 'mux.background.probes.begin');
  pushEvent('mux.startup.background-probes.skipped', 'mux.background.probes.skipped');
  pushEvent('mux.startup.background-start.begin', 'mux.background.sessions.begin');
  pushEvent('mux.startup.background-start.skipped', 'mux.background.sessions.skipped');

  if (checkpoints.length === 0) {
    process.stderr.write('perf report: no recognized startup checkpoints found\n');
    return 1;
  }
  checkpoints.sort((left, right) => left.atMs - right.atMs);
  const base = checkpoints[0]!;

  process.stdout.write('Startup Timeline (Client/Server + Protocol)\n');
  process.stdout.write('-------------------------------------------\n');
  for (const checkpoint of checkpoints) {
    const detail = checkpoint.detail.length > 0 ? `  ${checkpoint.detail}` : '';
    process.stdout.write(
      ` ${formatOffset(base.atMs, checkpoint.atMs)}  ${checkpoint.name.padEnd(42, ' ')}${detail}\n`
    );
  }
  process.stdout.write('\n');
  return 0;
}

function printPhaseDurations(records: readonly PerfRecord[]): void {
  const deltas: Array<{ label: string; start: string; end: string }> = [
    {
      label: 'launch -> daemon-ready',
      start: 'launch.startup.begin',
      end: 'launch.startup.daemon-ready'
    },
    {
      label: 'launch -> mux-ready',
      start: 'launch.startup.begin',
      end: 'mux.startup.ready'
    },
    {
      label: 'launch -> first-output',
      start: 'launch.startup.begin',
      end: 'mux.startup.active-first-output'
    },
    {
      label: 'launch -> first-visible-paint',
      start: 'launch.startup.begin',
      end: 'mux.startup.active-first-visible-paint'
    },
    {
      label: 'launch -> header-visible',
      start: 'launch.startup.begin',
      end: 'mux.startup.active-header-visible'
    },
    {
      label: 'launch -> settled',
      start: 'launch.startup.begin',
      end: 'mux.startup.active-settled'
    },
    {
      label: 'protocol connect begin -> ready',
      start: 'control-plane.connect.begin',
      end: 'control-plane.connect.ready'
    },
    {
      label: 'first-output -> settled',
      start: 'mux.startup.active-first-output',
      end: 'mux.startup.active-settled'
    }
  ];
  process.stdout.write('Phase Durations\n');
  process.stdout.write('---------------\n');
  for (const delta of deltas) {
    const start = eventTimeMs(records, delta.start);
    const end = eventTimeMs(records, delta.end);
    if (start === null || end === null || end < start) {
      process.stdout.write(` ${delta.label.padEnd(36, ' ')} n/a\n`);
      continue;
    }
    process.stdout.write(` ${delta.label.padEnd(36, ' ')} ${formatDeltaMs(end - start)}\n`);
  }
  process.stdout.write('\n');
}

function printTerminalQuerySummary(records: readonly PerfRecord[]): void {
  const startupBeginMs = eventTimeMs(records, 'mux.startup.begin');
  const settledMs = eventTimeMs(records, 'mux.startup.active-settled');
  if (startupBeginMs === null || settledMs === null || settledMs < startupBeginMs) {
    process.stdout.write('Terminal Query Catalog\n');
    process.stdout.write('----------------------\n');
    process.stdout.write(' startup window unavailable (missing mux.startup.begin or mux.startup.active-settled)\n\n');
    return;
  }

  const queryEvents = records
    .filter((record): record is PerfEventRecord => record.type === 'event' && record.name === 'codex.terminal-query')
    .filter((record) => record['ts-ms'] >= startupBeginMs && record['ts-ms'] <= settledMs);

  const unhandledByPayload = new Map<string, number>();
  let handledCount = 0;
  for (const event of queryEvents) {
    const handled = boolAttr(event.attrs, 'handled') === true;
    const kind = stringAttr(event.attrs, 'kind') ?? 'unknown';
    const payload = stringAttr(event.attrs, 'payload') ?? '';
    if (handled) {
      handledCount += 1;
      continue;
    }
    const key = `${kind}:${payload}`;
    unhandledByPayload.set(key, (unhandledByPayload.get(key) ?? 0) + 1);
  }

  process.stdout.write('Terminal Query Catalog (startup -> settled)\n');
  process.stdout.write('-------------------------------------------\n');
  process.stdout.write(` total=${String(queryEvents.length)} handled=${String(handledCount)} unhandled=${String(queryEvents.length - handledCount)}\n`);
  const entries = [...unhandledByPayload.entries()].sort((left, right) => right[1] - left[1]);
  if (entries.length === 0) {
    process.stdout.write(' unhandled: none\n\n');
    return;
  }
  process.stdout.write(' unhandled:\n');
  for (const [payload, count] of entries) {
    process.stdout.write(`  ${String(count).padStart(3, ' ')}x  ${payload}\n`);
  }
  process.stdout.write('\n');
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index] ?? null;
}

function printRuntimePressureSummary(records: readonly PerfRecord[]): void {
  const outputSamples = records
    .filter((record): record is PerfEventRecord => record.type === 'event' && record.name === 'mux.output-load.sample');
  const opStarts = records
    .filter((record): record is PerfEventRecord => record.type === 'event' && record.name === 'mux.control-plane.op.start');
  const flushSpans = records
    .filter((record): record is PerfSpanRecord => record.type === 'span' && record.name === 'mux.events.flush');

  process.stdout.write('Runtime Pressure (Post-Startup)\n');
  process.stdout.write('-------------------------------\n');

  if (outputSamples.length === 0) {
    process.stdout.write(' output-load samples: none\n');
  } else {
    const maxInactiveBytes = Math.max(
      ...outputSamples.map((event) => numberAttr(event.attrs, 'inactiveBytes') ?? 0)
    );
    const maxInactiveChunks = Math.max(
      ...outputSamples.map((event) => numberAttr(event.attrs, 'inactiveChunks') ?? 0)
    );
    const maxSessionsWithOutput = Math.max(
      ...outputSamples.map((event) => numberAttr(event.attrs, 'sessionsWithOutput') ?? 0)
    );
    process.stdout.write(
      ` output-load samples=${String(outputSamples.length)} maxInactiveBytes=${String(maxInactiveBytes)} maxInactiveChunks=${String(maxInactiveChunks)} maxSessionsWithOutput=${String(maxSessionsWithOutput)}\n`
    );

    const tail = outputSamples.slice(-5);
    process.stdout.write(' recent output-load samples:\n');
    for (const sample of tail) {
      process.stdout.write(
        `  t=${String(sample['ts-ms'])} activeB=${String(numberAttr(sample.attrs, 'activeBytes') ?? 0)} inactiveB=${String(numberAttr(sample.attrs, 'inactiveBytes') ?? 0)} activeC=${String(numberAttr(sample.attrs, 'activeChunks') ?? 0)} inactiveC=${String(numberAttr(sample.attrs, 'inactiveChunks') ?? 0)} render(avg/max)=${(numberAttr(sample.attrs, 'renderAvgMs') ?? 0).toFixed(2)}/${(numberAttr(sample.attrs, 'renderMaxMs') ?? 0).toFixed(2)} outputHandle(avg/max)=${(numberAttr(sample.attrs, 'outputHandleAvgMs') ?? 0).toFixed(2)}/${(numberAttr(sample.attrs, 'outputHandleMaxMs') ?? 0).toFixed(2)} loop(p95/max)=${(numberAttr(sample.attrs, 'eventLoopP95Ms') ?? 0).toFixed(2)}/${(numberAttr(sample.attrs, 'eventLoopMaxMs') ?? 0).toFixed(2)} sessions=${String(numberAttr(sample.attrs, 'sessionsWithOutput') ?? 0)} pendingPersisted=${String(numberAttr(sample.attrs, 'pendingPersistedEvents') ?? 0)} queued(i/b)=${String(numberAttr(sample.attrs, 'interactiveQueued') ?? 0)}/${String(numberAttr(sample.attrs, 'backgroundQueued') ?? 0)}\n`
      );
    }
  }

  if (opStarts.length === 0) {
    process.stdout.write(' control-plane queue starts: none\n');
  } else {
    const waitMsValues = opStarts.flatMap((event) => {
      const waitMs = numberAttr(event.attrs, 'waitMs');
      return waitMs === null ? [] : [waitMs];
    });
    const p95 = percentile(waitMsValues, 0.95);
    const max = waitMsValues.length === 0 ? null : Math.max(...waitMsValues);
    process.stdout.write(
      ` control-plane ops=${String(opStarts.length)} waitMs.p95=${p95 === null ? 'n/a' : p95.toFixed(0)} waitMs.max=${max === null ? 'n/a' : max.toFixed(0)}\n`
    );
  }

  if (flushSpans.length === 0) {
    process.stdout.write(' event flush spans: none\n');
  } else {
    const durationsMs = flushSpans.flatMap((span) => {
      const durationNs = Number(span['duration-ns']);
      if (!Number.isFinite(durationNs) || durationNs < 0) {
        return [];
      }
      return [durationNs / 1_000_000];
    });
    const p95 = percentile(durationsMs, 0.95);
    const max = durationsMs.length === 0 ? null : Math.max(...durationsMs);
    process.stdout.write(
      ` event flushes=${String(flushSpans.length)} durationMs.p95=${p95 === null ? 'n/a' : p95.toFixed(2)} durationMs.max=${max === null ? 'n/a' : max.toFixed(2)}\n`
    );
  }
  process.stdout.write('\n');
}

function printBackgroundProbeSummary(records: readonly PerfRecord[]): void {
  const summarize = (name: string): {
    count: number;
    p95: number | null;
    max: number | null;
  } => {
    const spans = records.filter(
      (record): record is PerfSpanRecord => record.type === 'span' && record.name === name
    );
    const durationsMs = spans.flatMap((span) => {
      const durationNs = Number(span['duration-ns']);
      if (!Number.isFinite(durationNs) || durationNs < 0) {
        return [];
      }
      return [durationNs / 1_000_000];
    });
    return {
      count: spans.length,
      p95: percentile(durationsMs, 0.95),
      max: durationsMs.length === 0 ? null : Math.max(...durationsMs)
    };
  };

  const processUsage = summarize('mux.background.process-usage');
  const gitSummary = summarize('mux.background.git-summary');

  process.stdout.write('Background Probe Spans\n');
  process.stdout.write('----------------------\n');
  process.stdout.write(
    ` process-usage count=${String(processUsage.count)} p95=${processUsage.p95 === null ? 'n/a' : `${processUsage.p95.toFixed(2)}ms`} max=${processUsage.max === null ? 'n/a' : `${processUsage.max.toFixed(2)}ms`}\n`
  );
  process.stdout.write(
    ` git-summary   count=${String(gitSummary.count)} p95=${gitSummary.p95 === null ? 'n/a' : `${gitSummary.p95.toFixed(2)}ms`} max=${gitSummary.max === null ? 'n/a' : `${gitSummary.max.toFixed(2)}ms`}\n`
  );
  process.stdout.write('\n');
}

function printSettleDetails(records: readonly PerfRecord[]): void {
  const settle = firstEvent(records, 'mux.startup.active-settled');
  process.stdout.write('Settled Marker\n');
  process.stdout.write('--------------\n');
  if (settle === null) {
    process.stdout.write(' missing\n');
    return;
  }
  const gate = stringAttr(settle.attrs, 'gate') ?? 'unknown';
  const glyphCells = numberAttr(settle.attrs, 'glyphCells');
  process.stdout.write(` gate=${gate} glyphCells=${glyphCells === null ? 'n/a' : String(glyphCells)}\n`);
}

function main(): number {
  const filePath = parseArgs(process.argv.slice(2));
  if (!existsSync(filePath)) {
    process.stderr.write(`perf report: file not found: ${filePath}\n`);
    return 1;
  }
  const records = readPerfRecords(filePath);
  if (records.length === 0) {
    process.stderr.write('perf report: no records found\n');
    return 1;
  }
  process.stdout.write(`Perf file: ${filePath}\n\n`);
  const timelineExitCode = printTimeline(records);
  if (timelineExitCode !== 0) {
    return timelineExitCode;
  }
  printPhaseDurations(records);
  printTerminalQuerySummary(records);
  printRuntimePressureSummary(records);
  printBackgroundProbeSummary(records);
  printSettleDetails(records);
  return 0;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  process.stderr.write(
    `perf report fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

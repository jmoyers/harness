import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PerfRecordBase {
  type: string;
  name: string;
}

interface PerfEventRecord extends PerfRecordBase {
  type: 'event';
  'ts-ns': string;
}

interface PerfSpanRecord extends PerfRecordBase {
  type: 'span';
  'start-ns': string;
  'duration-ns': string;
  attrs?: Record<string, boolean | number | string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parsePerfRecord(line: string): PerfEventRecord | PerfSpanRecord | null {
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
  if (type !== 'event' && type !== 'span') {
    return null;
  }
  if (typeof name !== 'string') {
    return null;
  }
  if (type === 'event') {
    const ts = record['ts-ns'];
    if (typeof ts !== 'string') {
      return null;
    }
    return {
      type,
      name,
      'ts-ns': ts
    };
  }

  const startNs = record['start-ns'];
  const durationNs = record['duration-ns'];
  if (typeof startNs !== 'string' || typeof durationNs !== 'string') {
    return null;
  }
  const attrs = asRecord(record['attrs']) ?? undefined;
  return {
    type,
    name,
    'start-ns': startNs,
    'duration-ns': durationNs,
    attrs: attrs as Record<string, boolean | number | string> | undefined
  };
}

function formatMs(ns: bigint): string {
  return `${(Number(ns) / 1_000_000).toFixed(2)}ms`;
}

function parseArgs(argv: readonly string[]): string {
  let filePath = process.env.HARNESS_PERF_FILE ?? '.harness/perf.jsonl';
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

function main(): number {
  const filePath = parseArgs(process.argv.slice(2));
  if (!existsSync(filePath)) {
    process.stderr.write(`perf report: file not found: ${filePath}\n`);
    return 1;
  }

  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const records = lines.map((line) => parsePerfRecord(line)).flatMap((record) => (record === null ? [] : [record]));

  let startupBeginNs: bigint | null = null;
  for (const record of records) {
    if (record.type !== 'event' || record.name !== 'mux.startup.begin') {
      continue;
    }
    const tsNs = readBigInt(record['ts-ns']);
    if (tsNs !== null) {
      startupBeginNs = tsNs;
    }
  }
  if (startupBeginNs === null) {
    process.stderr.write('perf report: no mux.startup.begin marker found\n');
    return 1;
  }

  const startupSpans = records
    .filter((record): record is PerfSpanRecord => record.type === 'span')
    .filter((record) => record.name.startsWith('mux.startup.') || record.name.startsWith('mux.conversation.start'))
    .map((record) => {
      const startNs = readBigInt(record['start-ns']);
      const durationNs = readBigInt(record['duration-ns']);
      if (startNs === null || durationNs === null || startNs < startupBeginNs) {
        return null;
      }
      return {
        name: record.name,
        startNs,
        durationNs
      };
    })
    .flatMap((record) => (record === null ? [] : [record]))
    .sort((left, right) => (left.startNs < right.startNs ? -1 : 1));

  if (startupSpans.length === 0) {
    process.stderr.write('perf report: no startup spans found after mux.startup.begin\n');
    return 1;
  }

  process.stdout.write(`Perf file: ${filePath}\n`);
  process.stdout.write('Startup timeline:\n');
  for (const span of startupSpans) {
    const offsetNs = span.startNs - startupBeginNs;
    process.stdout.write(
      `  +${formatMs(offsetNs)}  ${span.name.padEnd(32, ' ')} ${formatMs(span.durationNs)}\n`
    );
  }
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

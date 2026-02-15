import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface SelectorEntry {
  readonly version: number;
  readonly index: number;
  readonly directoryIndex: number;
  readonly sessionId: string;
  readonly directoryId: string;
  readonly title: string;
  readonly agentType: string;
}

function parseArgs(argv: readonly string[]): { filePath: string } {
  let filePath = '.harness/perf-startup.jsonl';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--file requires a path');
      }
      filePath = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return {
    filePath: resolve(process.cwd(), filePath)
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseSelectorEntry(attrs: Record<string, unknown>): SelectorEntry | null {
  const version = readInt(attrs['version']);
  const index = readInt(attrs['index']);
  const directoryIndex = readInt(attrs['directoryIndex']);
  const sessionId = readString(attrs['sessionId']);
  const directoryId = readString(attrs['directoryId']);
  const title = readString(attrs['title']);
  const agentType = readString(attrs['agentType']);
  if (
    version === null ||
    index === null ||
    directoryIndex === null ||
    sessionId === null ||
    directoryId === null ||
    title === null ||
    agentType === null
  ) {
    return null;
  }
  return {
    version,
    index,
    directoryIndex,
    sessionId,
    directoryId,
    title,
    agentType
  };
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  const text = readFileSync(options.filePath, 'utf8');
  const lines = text.split('\n');

  let latestVersion = 0;
  const entries: SelectorEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (record === null || record['type'] !== 'event') {
      continue;
    }
    const name = readString(record['name']);
    const attrs = asRecord(record['attrs']);
    if (name === 'mux.selector.snapshot' && attrs !== null) {
      const version = readInt(attrs['version']);
      if (version !== null && version > latestVersion) {
        latestVersion = version;
      }
      continue;
    }
    if (name !== 'mux.selector.entry' || attrs === null) {
      continue;
    }
    const entry = parseSelectorEntry(attrs);
    if (entry !== null) {
      entries.push(entry);
    }
  }

  if (latestVersion <= 0) {
    process.stdout.write(`Perf file: ${options.filePath}\n\nNo selector snapshots found.\n`);
    return 0;
  }

  const latestEntries = entries
    .filter((entry) => entry.version === latestVersion)
    .sort((left, right) => left.index - right.index || left.sessionId.localeCompare(right.sessionId));

  process.stdout.write(`Perf file: ${options.filePath}\n\n`);
  process.stdout.write(`Selector Snapshot v${String(latestVersion)}\n`);
  process.stdout.write('-------------------------------------------\n');
  if (latestEntries.length === 0) {
    process.stdout.write('no selector entries found for latest snapshot\n');
    return 0;
  }
  for (const entry of latestEntries) {
    process.stdout.write(
      `${String(entry.index).padStart(2, ' ')}. [${entry.agentType}] ${entry.title || '(untitled)'}  ${entry.sessionId}  (${entry.directoryId} #${String(entry.directoryIndex)})\n`
    );
  }
  return 0;
}

try {
  const code = main();
  if (code !== 0) {
    process.exitCode = code;
  }
} catch (error: unknown) {
  process.stderr.write(
    `selector report error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

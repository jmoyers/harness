import { appendFileSync, readFileSync } from 'node:fs';

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parsePayload(input: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input);
    const objectValue = asObject(parsed);
    if (objectValue !== null) {
      return objectValue;
    }
  } catch {
    // Fall through to raw payload envelope.
  }
  return {
    type: 'unknown',
    raw: input
  };
}

function main(): number {
  const outputPath = process.argv[2];
  const payloadFromArg = process.argv[3];
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    process.stderr.write('codex-notify-relay: missing output path\n');
    return 2;
  }
  let payloadRaw = payloadFromArg;
  if (typeof payloadRaw !== 'string' || payloadRaw.length === 0) {
    try {
      payloadRaw = readFileSync(0, 'utf8');
    } catch {
      payloadRaw = '';
    }
  }
  if (typeof payloadRaw !== 'string' || payloadRaw.trim().length === 0) {
    process.stderr.write('codex-notify-relay: missing notify payload\n');
    return 2;
  }
  const record = {
    ts: new Date().toISOString(),
    payload: parsePayload(payloadRaw)
  };
  appendFileSync(outputPath, `${JSON.stringify(record)}\n`, 'utf8');
  return 0;
}

process.exitCode = main();

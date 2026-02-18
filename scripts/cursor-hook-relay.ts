import { appendFileSync, readFileSync } from 'node:fs';
import {
  CURSOR_HOOK_NOTIFY_FILE_ENV,
  CURSOR_HOOK_SESSION_ID_ENV,
} from '../src/cursor/managed-hooks.ts';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parsePayload(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown;
    const record = asRecord(parsed);
    if (record !== null) {
      return record;
    }
  } catch {
    // Fall through to raw payload envelope.
  }
  return {
    type: 'unknown',
    raw: input,
  };
}

function parseManagedHookId(argv: readonly string[]): string | null {
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--managed-hook-id') {
      continue;
    }
    const next = argv[index + 1];
    if (typeof next === 'string' && next.trim().length > 0) {
      return next.trim();
    }
    return null;
  }
  return null;
}

function main(): number {
  const notifyFilePath = process.env[CURSOR_HOOK_NOTIFY_FILE_ENV]?.trim() ?? '';
  if (notifyFilePath.length === 0) {
    return 0;
  }
  let payloadRaw = '';
  try {
    payloadRaw = readFileSync(0, 'utf8');
  } catch {
    payloadRaw = '';
  }
  if (payloadRaw.trim().length === 0) {
    return 0;
  }
  const payload = parsePayload(payloadRaw);
  const managedHookId = parseManagedHookId(process.argv);
  if (managedHookId !== null && typeof payload['managed_hook_id'] !== 'string') {
    payload['managed_hook_id'] = managedHookId;
  }
  const sessionId = process.env[CURSOR_HOOK_SESSION_ID_ENV]?.trim() ?? '';
  if (sessionId.length > 0) {
    if (typeof payload['harness_session_id'] !== 'string') {
      payload['harness_session_id'] = sessionId;
    }
  }
  const record = {
    ts: new Date().toISOString(),
    payload,
  };
  try {
    appendFileSync(notifyFilePath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    return 0;
  }
  return 0;
}

process.exitCode = main();

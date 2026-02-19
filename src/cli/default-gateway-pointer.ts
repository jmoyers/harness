import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveHarnessConfigDirectory } from '../config/config-core.ts';
import type { GatewayRecord } from './gateway-record.ts';

const DEFAULT_GATEWAY_POINTER_VERSION = 1;
const DEFAULT_GATEWAY_RECORD_PATH_PATTERN = /[\\/]gateway\.json$/u;
const NAMED_SESSION_GATEWAY_RECORD_PATH_PATTERN = /[\\/]sessions[\\/][^\\/]+[\\/]gateway\.json$/u;

export const DEFAULT_GATEWAY_POINTER_FILE_NAME = 'default-gateway.json';

export interface DefaultGatewayPointerRecord {
  readonly version: number;
  readonly workspaceRoot: string;
  readonly workspaceRuntimeRoot: string;
  readonly gatewayRecordPath: string;
  readonly gatewayLogPath: string;
  readonly stateDbPath: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly gatewayRunId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value > 0 ? value : null;
}

function isDefaultGatewayRecordPath(recordPath: string): boolean {
  const normalizedPath = resolve(recordPath);
  return (
    DEFAULT_GATEWAY_RECORD_PATH_PATTERN.test(normalizedPath) &&
    !NAMED_SESSION_GATEWAY_RECORD_PATH_PATTERN.test(normalizedPath)
  );
}

export function resolveDefaultGatewayPointerPath(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(
    resolveHarnessConfigDirectory(invocationDirectory, env),
    DEFAULT_GATEWAY_POINTER_FILE_NAME,
  );
}

export function parseDefaultGatewayPointerText(text: string): DefaultGatewayPointerRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) {
    return null;
  }
  if (record['version'] !== DEFAULT_GATEWAY_POINTER_VERSION) {
    return null;
  }
  const workspaceRoot = readNonEmptyString(record['workspaceRoot']);
  const workspaceRuntimeRoot = readNonEmptyString(record['workspaceRuntimeRoot']);
  const gatewayRecordPath = readNonEmptyString(record['gatewayRecordPath']);
  const gatewayLogPath = readNonEmptyString(record['gatewayLogPath']);
  const stateDbPath = readNonEmptyString(record['stateDbPath']);
  const startedAt = readNonEmptyString(record['startedAt']);
  const updatedAt = readNonEmptyString(record['updatedAt']);
  const pid = readPositiveInt(record['pid']);
  const gatewayRunIdRaw = record['gatewayRunId'];
  const gatewayRunId =
    gatewayRunIdRaw === undefined ? undefined : readNonEmptyString(gatewayRunIdRaw);

  if (
    workspaceRoot === null ||
    workspaceRuntimeRoot === null ||
    gatewayRecordPath === null ||
    gatewayLogPath === null ||
    stateDbPath === null ||
    startedAt === null ||
    updatedAt === null ||
    pid === null ||
    (gatewayRunIdRaw !== undefined && gatewayRunId === null)
  ) {
    return null;
  }

  return {
    version: DEFAULT_GATEWAY_POINTER_VERSION,
    workspaceRoot,
    workspaceRuntimeRoot,
    gatewayRecordPath,
    gatewayLogPath,
    stateDbPath,
    pid,
    startedAt,
    updatedAt,
    ...(gatewayRunId === undefined ? {} : { gatewayRunId }),
  };
}

export function readDefaultGatewayPointer(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): DefaultGatewayPointerRecord | null {
  const pointerPath = resolveDefaultGatewayPointerPath(invocationDirectory, env);
  if (!existsSync(pointerPath)) {
    return null;
  }
  try {
    return parseDefaultGatewayPointerText(readFileSync(pointerPath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeDefaultGatewayPointerFromGatewayRecord(
  recordPath: string,
  record: GatewayRecord,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isDefaultGatewayRecordPath(recordPath)) {
    return;
  }
  const normalizedRecordPath = resolve(recordPath);
  const pointerPath = resolveDefaultGatewayPointerPath(record.workspaceRoot, env);
  const payload: DefaultGatewayPointerRecord = {
    version: DEFAULT_GATEWAY_POINTER_VERSION,
    workspaceRoot: record.workspaceRoot,
    workspaceRuntimeRoot: dirname(normalizedRecordPath),
    gatewayRecordPath: normalizedRecordPath,
    gatewayLogPath: resolve(dirname(normalizedRecordPath), 'gateway.log'),
    stateDbPath: record.stateDbPath,
    pid: record.pid,
    startedAt: record.startedAt,
    updatedAt: new Date().toISOString(),
    ...(record.gatewayRunId === undefined ? {} : { gatewayRunId: record.gatewayRunId }),
  };
  mkdirSync(dirname(pointerPath), { recursive: true });
  writeFileSync(pointerPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function clearDefaultGatewayPointerForRecordPath(
  recordPath: string,
  invocationDirectory: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isDefaultGatewayRecordPath(recordPath)) {
    return;
  }
  const pointerPath = resolveDefaultGatewayPointerPath(invocationDirectory, env);
  if (!existsSync(pointerPath)) {
    return;
  }
  let pointer: DefaultGatewayPointerRecord | null = null;
  try {
    pointer = parseDefaultGatewayPointerText(readFileSync(pointerPath, 'utf8'));
  } catch {
    pointer = null;
  }
  if (pointer === null) {
    return;
  }
  if (resolve(pointer.gatewayRecordPath) !== resolve(recordPath)) {
    return;
  }
  try {
    unlinkSync(pointerPath);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

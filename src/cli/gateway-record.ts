import { resolve } from 'node:path';

export const GATEWAY_RECORD_VERSION = 1;
export const DEFAULT_GATEWAY_HOST = '127.0.0.1';
export const DEFAULT_GATEWAY_PORT = 7777;
export const DEFAULT_GATEWAY_DB_PATH = '.harness/control-plane.sqlite';
export const DEFAULT_GATEWAY_RECORD_PATH = '.harness/gateway.json';
export const DEFAULT_GATEWAY_LOG_PATH = '.harness/gateway.log';

export interface GatewayRecord {
  readonly version: number;
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly authToken: string | null;
  readonly stateDbPath: string;
  readonly startedAt: string;
  readonly workspaceRoot: string;
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
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function readPort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    return null;
  }
  return value;
}

function readPid(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export function resolveInvocationDirectory(env: NodeJS.ProcessEnv, cwd: string): string {
  return env.HARNESS_INVOKE_CWD ?? env.INIT_CWD ?? cwd;
}

export function resolveGatewayRecordPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, DEFAULT_GATEWAY_RECORD_PATH);
}

export function resolveGatewayLogPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, DEFAULT_GATEWAY_LOG_PATH);
}

export function normalizeGatewayHost(
  input: string | null | undefined,
  fallback = DEFAULT_GATEWAY_HOST,
): string {
  if (typeof input !== 'string') {
    return fallback;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed;
}

export function normalizeGatewayPort(
  input: number | string | null | undefined,
  fallback = DEFAULT_GATEWAY_PORT,
): number {
  if (typeof input === 'number') {
    return readPort(input) ?? fallback;
  }
  if (typeof input !== 'string') {
    return fallback;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0 || !/^\d+$/u.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return readPort(parsed) ?? fallback;
}

export function normalizeGatewayStateDbPath(
  input: string | null | undefined,
  fallback = DEFAULT_GATEWAY_DB_PATH,
): string {
  if (typeof input !== 'string') {
    return fallback;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

export function parseGatewayRecordText(text: string): GatewayRecord | null {
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

  const version = record['version'];
  if (version !== GATEWAY_RECORD_VERSION) {
    return null;
  }
  const pid = readPid(record['pid']);
  const host = readNonEmptyString(record['host']);
  const port = readPort(record['port']);
  const stateDbPath = readNonEmptyString(record['stateDbPath']);
  const startedAt = readNonEmptyString(record['startedAt']);
  const workspaceRoot = readNonEmptyString(record['workspaceRoot']);
  const authTokenRaw = record['authToken'];
  const authToken = authTokenRaw === null ? null : readNonEmptyString(authTokenRaw);

  if (
    pid === null ||
    host === null ||
    port === null ||
    stateDbPath === null ||
    startedAt === null ||
    workspaceRoot === null ||
    (authToken === null && authTokenRaw !== null)
  ) {
    return null;
  }

  return {
    version,
    pid,
    host,
    port,
    authToken,
    stateDbPath,
    startedAt,
    workspaceRoot,
  };
}

export function serializeGatewayRecord(record: GatewayRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

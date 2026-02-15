import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const HARNESS_CONFIG_FILE_NAME = 'harness.config.jsonc';

interface HarnessMuxConfig {
  readonly keybindings: Readonly<Record<string, readonly string[]>>;
}

interface HarnessPerfConfig {
  readonly enabled: boolean;
  readonly filePath: string;
}

interface HarnessDebugMuxConfig {
  readonly debugPath: string | null;
  readonly validateAnsi: boolean;
  readonly resizeMinIntervalMs: number;
  readonly ptyResizeSettleMs: number;
  readonly startupSettleQuietMs: number;
  readonly serverSnapshotModelEnabled: boolean;
}

interface HarnessDebugConfig {
  readonly enabled: boolean;
  readonly overwriteArtifactsOnStart: boolean;
  readonly perf: HarnessPerfConfig;
  readonly mux: HarnessDebugMuxConfig;
}

interface HarnessConfig {
  readonly mux: HarnessMuxConfig;
  readonly debug: HarnessDebugConfig;
}

interface LoadedHarnessConfig {
  readonly filePath: string;
  readonly config: HarnessConfig;
  readonly fromLastKnownGood: boolean;
  readonly error: string | null;
}

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  mux: {
    keybindings: {}
  },
  debug: {
    enabled: true,
    overwriteArtifactsOnStart: true,
    perf: {
      enabled: true,
      filePath: '.harness/perf-startup.jsonl'
    },
    mux: {
      debugPath: '.harness/mux-debug.jsonl',
      validateAnsi: false,
      resizeMinIntervalMs: 33,
      ptyResizeSettleMs: 75,
      startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
    }
  }
};

function stripJsoncComments(text: string): string {
  let output = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let idx = 0; idx < text.length; idx += 1) {
    const char = text[idx]!;
    const next = text[idx + 1] ?? '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        idx += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      idx += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      idx += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(text: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let idx = 0; idx < text.length; idx += 1) {
    const char = text[idx]!;
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ',') {
      let lookahead = idx + 1;
      while (lookahead < text.length) {
        const next = text[lookahead]!;
        if (next === ' ' || next === '\n' || next === '\r' || next === '\t') {
          lookahead += 1;
          continue;
        }
        break;
      }
      const closing = text[lookahead];
      if (closing === '}' || closing === ']') {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function normalizeKeybindings(input: unknown): Readonly<Record<string, readonly string[]>> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const out: Record<string, readonly string[]> = {};
  for (const [action, raw] of Object.entries(input)) {
    const normalizedAction = action.trim();
    if (normalizedAction.length === 0) {
      continue;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        out[normalizedAction] = [trimmed];
      }
      continue;
    }
    if (!Array.isArray(raw)) {
      continue;
    }
    const keys = raw
      .flatMap((entry) => (typeof entry === 'string' ? [entry.trim()] : []))
      .filter((entry) => entry.length > 0);
    if (keys.length > 0) {
      out[normalizedAction] = keys;
    }
  }

  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizePerfConfig(input: unknown): HarnessPerfConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.debug.perf;
  }
  const enabled =
    typeof record['enabled'] === 'boolean'
      ? record['enabled']
      : DEFAULT_HARNESS_CONFIG.debug.perf.enabled;
  const filePath =
    typeof record['filePath'] === 'string' && record['filePath'].trim().length > 0
      ? record['filePath'].trim()
      : DEFAULT_HARNESS_CONFIG.debug.perf.filePath;
  return {
    enabled,
    filePath
  };
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return fallback;
  }
  return normalized;
}

function normalizeDebugMuxConfig(input: unknown): HarnessDebugMuxConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.debug.mux;
  }
  const debugPathRaw = record['debugPath'];
  const debugPath =
    typeof debugPathRaw === 'string' && debugPathRaw.trim().length > 0
      ? debugPathRaw.trim()
      : DEFAULT_HARNESS_CONFIG.debug.mux.debugPath;
  const validateAnsi =
    typeof record['validateAnsi'] === 'boolean'
      ? record['validateAnsi']
      : DEFAULT_HARNESS_CONFIG.debug.mux.validateAnsi;
  const resizeMinIntervalMs = normalizeNonNegativeInt(
    record['resizeMinIntervalMs'],
    DEFAULT_HARNESS_CONFIG.debug.mux.resizeMinIntervalMs
  );
  const ptyResizeSettleMs = normalizeNonNegativeInt(
    record['ptyResizeSettleMs'],
    DEFAULT_HARNESS_CONFIG.debug.mux.ptyResizeSettleMs
  );
  const startupSettleQuietMs = normalizeNonNegativeInt(
    record['startupSettleQuietMs'],
    DEFAULT_HARNESS_CONFIG.debug.mux.startupSettleQuietMs
  );
  const serverSnapshotModelEnabled =
    typeof record['serverSnapshotModelEnabled'] === 'boolean'
      ? record['serverSnapshotModelEnabled']
      : DEFAULT_HARNESS_CONFIG.debug.mux.serverSnapshotModelEnabled;
  return {
    debugPath,
    validateAnsi,
    resizeMinIntervalMs,
    ptyResizeSettleMs,
    startupSettleQuietMs,
    serverSnapshotModelEnabled
  };
}

function normalizeDebugConfig(input: unknown, legacyPerf: HarnessPerfConfig): HarnessDebugConfig {
  const record = asRecord(input);
  if (record === null) {
    return {
      ...DEFAULT_HARNESS_CONFIG.debug,
      perf: legacyPerf
    };
  }
  const enabled =
    typeof record['enabled'] === 'boolean' ? record['enabled'] : DEFAULT_HARNESS_CONFIG.debug.enabled;
  const overwriteArtifactsOnStart =
    typeof record['overwriteArtifactsOnStart'] === 'boolean'
      ? record['overwriteArtifactsOnStart']
      : DEFAULT_HARNESS_CONFIG.debug.overwriteArtifactsOnStart;
  const perf = normalizePerfConfig(record['perf']);
  const mux = normalizeDebugMuxConfig(record['mux']);
  return {
    enabled,
    overwriteArtifactsOnStart,
    perf,
    mux
  };
}

export function parseHarnessConfigText(text: string): HarnessConfig {
  const stripped = stripTrailingCommas(stripJsoncComments(text));
  const parsed = JSON.parse(stripped) as unknown;
  const root = asRecord(parsed);
  if (root === null) {
    return DEFAULT_HARNESS_CONFIG;
  }

  const mux = asRecord(root['mux']);
  const legacyPerf = normalizePerfConfig(root['perf']);
  const debug = normalizeDebugConfig(root['debug'], legacyPerf);

  return {
    mux: {
      keybindings: mux === null ? {} : normalizeKeybindings(mux['keybindings'])
    },
    debug
  };
}

export function resolveHarnessConfigPath(cwd: string): string {
  return resolve(cwd, HARNESS_CONFIG_FILE_NAME);
}

export function loadHarnessConfig(options?: {
  cwd?: string;
  filePath?: string;
  lastKnownGood?: HarnessConfig;
}): LoadedHarnessConfig {
  const cwd = options?.cwd ?? process.cwd();
  const filePath = options?.filePath ?? resolveHarnessConfigPath(cwd);
  const lastKnownGood = options?.lastKnownGood ?? DEFAULT_HARNESS_CONFIG;

  if (!existsSync(filePath)) {
    return {
      filePath,
      config: lastKnownGood,
      fromLastKnownGood: false,
      error: null
    };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    return {
      filePath,
      config: parseHarnessConfigText(raw),
      fromLastKnownGood: false,
      error: null
    };
  } catch (error: unknown) {
    return {
      filePath,
      config: lastKnownGood,
      fromLastKnownGood: true,
      error: String(error)
    };
  }
}

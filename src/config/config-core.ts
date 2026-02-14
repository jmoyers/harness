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

interface HarnessConfig {
  readonly mux: HarnessMuxConfig;
  readonly perf: HarnessPerfConfig;
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
  perf: {
    enabled: false,
    filePath: '.harness/perf.jsonl'
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
    return DEFAULT_HARNESS_CONFIG.perf;
  }
  const enabled =
    typeof record['enabled'] === 'boolean'
      ? record['enabled']
      : DEFAULT_HARNESS_CONFIG.perf.enabled;
  const filePath =
    typeof record['filePath'] === 'string' && record['filePath'].trim().length > 0
      ? record['filePath'].trim()
      : DEFAULT_HARNESS_CONFIG.perf.filePath;
  return {
    enabled,
    filePath
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
  const perf = normalizePerfConfig(root['perf']);

  return {
    mux: {
      keybindings: mux === null ? {} : normalizeKeybindings(mux['keybindings'])
    },
    perf
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

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export const HARNESS_CONFIG_FILE_NAME = 'harness.config.jsonc';

const HARNESS_LIFECYCLE_EVENT_TYPES = [
  'thread.created',
  'thread.updated',
  'thread.archived',
  'thread.deleted',
  'session.started',
  'session.exited',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'input.required',
  'tool.started',
  'tool.completed',
  'tool.failed',
] as const;

export type HarnessLifecycleEventType = (typeof HARNESS_LIFECYCLE_EVENT_TYPES)[number];

interface HarnessMuxConfig {
  readonly keybindings: Readonly<Record<string, readonly string[]>>;
  readonly ui: HarnessMuxUiConfig;
  readonly git: HarnessMuxGitConfig;
}

interface HarnessMuxUiConfig {
  readonly paneWidthPercent: number | null;
  readonly repositoriesCollapsed: boolean;
  readonly shortcutsCollapsed: boolean;
}

interface HarnessMuxGitConfig {
  readonly enabled: boolean;
  readonly activePollMs: number;
  readonly idlePollMs: number;
  readonly burstPollMs: number;
  readonly burstWindowMs: number;
  readonly triggerDebounceMs: number;
  readonly maxConcurrency: number;
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

interface HarnessDebugInspectConfig {
  readonly enabled: boolean;
  readonly gatewayPort: number;
  readonly clientPort: number;
}

interface HarnessDebugConfig {
  readonly enabled: boolean;
  readonly overwriteArtifactsOnStart: boolean;
  readonly perf: HarnessPerfConfig;
  readonly mux: HarnessDebugMuxConfig;
  readonly inspect: HarnessDebugInspectConfig;
}

interface HarnessCodexTelemetryConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly logUserPrompt: boolean;
  readonly captureLogs: boolean;
  readonly captureMetrics: boolean;
  readonly captureTraces: boolean;
  readonly captureVerboseEvents: boolean;
  readonly ingestMode: 'lifecycle-fast' | 'full';
}

interface HarnessCodexHistoryConfig {
  readonly enabled: boolean;
  readonly filePath: string;
  readonly pollMs: number;
}

type HarnessCodexLaunchMode = 'yolo' | 'standard';

interface HarnessCodexLaunchConfig {
  readonly defaultMode: HarnessCodexLaunchMode;
  readonly directoryModes: Readonly<Record<string, HarnessCodexLaunchMode>>;
}

interface HarnessCodexConfig {
  readonly telemetry: HarnessCodexTelemetryConfig;
  readonly history: HarnessCodexHistoryConfig;
  readonly launch: HarnessCodexLaunchConfig;
}

type HarnessClaudeLaunchMode = 'yolo' | 'standard';

interface HarnessClaudeLaunchConfig {
  readonly defaultMode: HarnessClaudeLaunchMode;
  readonly directoryModes: Readonly<Record<string, HarnessClaudeLaunchMode>>;
}

interface HarnessClaudeConfig {
  readonly launch: HarnessClaudeLaunchConfig;
}

type HarnessCursorLaunchMode = 'yolo' | 'standard';

interface HarnessCursorLaunchConfig {
  readonly defaultMode: HarnessCursorLaunchMode;
  readonly directoryModes: Readonly<Record<string, HarnessCursorLaunchMode>>;
}

interface HarnessCursorConfig {
  readonly launch: HarnessCursorLaunchConfig;
}

interface HarnessCritiqueLaunchConfig {
  readonly defaultArgs: readonly string[];
}

interface HarnessCritiqueInstallConfig {
  readonly autoInstall: boolean;
  readonly package: string;
}

interface HarnessCritiqueConfig {
  readonly launch: HarnessCritiqueLaunchConfig;
  readonly install: HarnessCritiqueInstallConfig;
}

interface HarnessLifecycleProviderConfig {
  readonly codex: boolean;
  readonly claude: boolean;
  readonly cursor: boolean;
  readonly controlPlane: boolean;
}

interface HarnessLifecyclePeonPingConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly eventCategoryMap: Readonly<Partial<Record<HarnessLifecycleEventType, string>>>;
}

export interface HarnessLifecycleWebhookConfig {
  readonly name: string;
  readonly enabled: boolean;
  readonly url: string;
  readonly method: string;
  readonly timeoutMs: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly eventTypes: readonly HarnessLifecycleEventType[];
}

export interface HarnessLifecycleHooksConfig {
  readonly enabled: boolean;
  readonly providers: HarnessLifecycleProviderConfig;
  readonly peonPing: HarnessLifecyclePeonPingConfig;
  readonly webhooks: readonly HarnessLifecycleWebhookConfig[];
}

interface HarnessHooksConfig {
  readonly lifecycle: HarnessLifecycleHooksConfig;
}

interface HarnessConfig {
  readonly mux: HarnessMuxConfig;
  readonly debug: HarnessDebugConfig;
  readonly codex: HarnessCodexConfig;
  readonly claude: HarnessClaudeConfig;
  readonly cursor: HarnessCursorConfig;
  readonly critique: HarnessCritiqueConfig;
  readonly hooks: HarnessHooksConfig;
}

interface LoadedHarnessConfig {
  readonly filePath: string;
  readonly config: HarnessConfig;
  readonly fromLastKnownGood: boolean;
  readonly error: string | null;
}

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  mux: {
    keybindings: {},
    ui: {
      paneWidthPercent: null,
      repositoriesCollapsed: false,
      shortcutsCollapsed: false,
    },
    git: {
      enabled: true,
      activePollMs: 1000,
      idlePollMs: 5000,
      burstPollMs: 400,
      burstWindowMs: 2500,
      triggerDebounceMs: 180,
      maxConcurrency: 1,
    },
  },
  debug: {
    enabled: true,
    overwriteArtifactsOnStart: true,
    perf: {
      enabled: true,
      filePath: '.harness/perf-startup.jsonl',
    },
    mux: {
      debugPath: '.harness/mux-debug.jsonl',
      validateAnsi: false,
      resizeMinIntervalMs: 33,
      ptyResizeSettleMs: 75,
      startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true,
    },
    inspect: {
      enabled: false,
      gatewayPort: 6499,
      clientPort: 6500,
    },
  },
  codex: {
    telemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: false,
      ingestMode: 'lifecycle-fast',
    },
    history: {
      enabled: true,
      filePath: '~/.codex/history.jsonl',
      pollMs: 5000,
    },
    launch: {
      defaultMode: 'yolo',
      directoryModes: {},
    },
  },
  claude: {
    launch: {
      defaultMode: 'yolo',
      directoryModes: {}
    }
  },
  cursor: {
    launch: {
      defaultMode: 'yolo',
      directoryModes: {}
    }
  },
  critique: {
    launch: {
      defaultArgs: ['--watch'],
    },
    install: {
      autoInstall: true,
      package: 'critique@latest',
    },
  },
  hooks: {
    lifecycle: {
      enabled: false,
      providers: {
        codex: true,
        claude: true,
        cursor: true,
        controlPlane: true,
      },
      peonPing: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:19998',
        timeoutMs: 1200,
        eventCategoryMap: {
          'session.started': 'session.start',
          'turn.started': 'task.acknowledge',
          'turn.completed': 'task.complete',
          'turn.failed': 'task.error',
          'input.required': 'input.required',
        },
      },
      webhooks: [],
    },
  },
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

function normalizePaneWidthPercent(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 0 || value >= 100) {
    return fallback;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeMuxUiConfig(input: unknown): HarnessMuxUiConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.mux.ui;
  }
  const paneWidthPercent = normalizePaneWidthPercent(
    record['paneWidthPercent'],
    DEFAULT_HARNESS_CONFIG.mux.ui.paneWidthPercent,
  );
  const shortcutsCollapsed =
    typeof record['shortcutsCollapsed'] === 'boolean'
      ? record['shortcutsCollapsed']
      : DEFAULT_HARNESS_CONFIG.mux.ui.shortcutsCollapsed;
  const repositoriesCollapsed =
    typeof record['repositoriesCollapsed'] === 'boolean'
      ? record['repositoriesCollapsed']
      : DEFAULT_HARNESS_CONFIG.mux.ui.repositoriesCollapsed;
  return {
    paneWidthPercent,
    repositoriesCollapsed,
    shortcutsCollapsed,
  };
}

function normalizeMuxGitConfig(input: unknown): HarnessMuxGitConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.mux.git;
  }
  return {
    enabled:
      typeof record['enabled'] === 'boolean'
        ? record['enabled']
        : DEFAULT_HARNESS_CONFIG.mux.git.enabled,
    activePollMs: normalizeNonNegativeInt(
      record['activePollMs'],
      DEFAULT_HARNESS_CONFIG.mux.git.activePollMs,
    ),
    idlePollMs: normalizeNonNegativeInt(
      record['idlePollMs'],
      DEFAULT_HARNESS_CONFIG.mux.git.idlePollMs,
    ),
    burstPollMs: normalizeNonNegativeInt(
      record['burstPollMs'],
      DEFAULT_HARNESS_CONFIG.mux.git.burstPollMs,
    ),
    burstWindowMs: normalizeNonNegativeInt(
      record['burstWindowMs'],
      DEFAULT_HARNESS_CONFIG.mux.git.burstWindowMs,
    ),
    triggerDebounceMs: normalizeNonNegativeInt(
      record['triggerDebounceMs'],
      DEFAULT_HARNESS_CONFIG.mux.git.triggerDebounceMs,
    ),
    maxConcurrency: Math.max(
      1,
      normalizeNonNegativeInt(
        record['maxConcurrency'],
        DEFAULT_HARNESS_CONFIG.mux.git.maxConcurrency,
      ),
    ),
  };
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
    filePath,
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
    DEFAULT_HARNESS_CONFIG.debug.mux.resizeMinIntervalMs,
  );
  const ptyResizeSettleMs = normalizeNonNegativeInt(
    record['ptyResizeSettleMs'],
    DEFAULT_HARNESS_CONFIG.debug.mux.ptyResizeSettleMs,
  );
  const startupSettleQuietMs = normalizeNonNegativeInt(
    record['startupSettleQuietMs'],
    DEFAULT_HARNESS_CONFIG.debug.mux.startupSettleQuietMs,
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
    serverSnapshotModelEnabled,
  };
}

function normalizeInspectPort(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 1 || normalized > 65535) {
    return fallback;
  }
  return normalized;
}

function normalizeDebugInspectConfig(input: unknown): HarnessDebugInspectConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.debug.inspect;
  }
  const enabled =
    typeof record['enabled'] === 'boolean'
      ? record['enabled']
      : DEFAULT_HARNESS_CONFIG.debug.inspect.enabled;
  const gatewayPort = normalizeInspectPort(
    record['gatewayPort'],
    DEFAULT_HARNESS_CONFIG.debug.inspect.gatewayPort,
  );
  const clientPort = normalizeInspectPort(
    record['clientPort'],
    DEFAULT_HARNESS_CONFIG.debug.inspect.clientPort,
  );
  return {
    enabled,
    gatewayPort,
    clientPort,
  };
}

function normalizeDebugConfig(input: unknown, legacyPerf: HarnessPerfConfig): HarnessDebugConfig {
  const record = asRecord(input);
  if (record === null) {
    return {
      ...DEFAULT_HARNESS_CONFIG.debug,
      perf: legacyPerf,
    };
  }
  const enabled =
    typeof record['enabled'] === 'boolean'
      ? record['enabled']
      : DEFAULT_HARNESS_CONFIG.debug.enabled;
  const overwriteArtifactsOnStart =
    typeof record['overwriteArtifactsOnStart'] === 'boolean'
      ? record['overwriteArtifactsOnStart']
      : DEFAULT_HARNESS_CONFIG.debug.overwriteArtifactsOnStart;
  const perf = normalizePerfConfig(record['perf']);
  const mux = normalizeDebugMuxConfig(record['mux']);
  const inspect = normalizeDebugInspectConfig(record['inspect']);
  return {
    enabled,
    overwriteArtifactsOnStart,
    perf,
    mux,
    inspect,
  };
}

function normalizePort(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded < 0 || rounded > 65535) {
    return fallback;
  }
  return rounded;
}

function normalizeHost(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed;
}

function normalizeCodexTelemetryConfig(input: unknown): HarnessCodexTelemetryConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.codex.telemetry;
  }
  const rawIngestMode = record['ingestMode'];
  const ingestMode =
    rawIngestMode === 'full' || rawIngestMode === 'lifecycle-fast'
      ? rawIngestMode
      : DEFAULT_HARNESS_CONFIG.codex.telemetry.ingestMode;
  return {
    enabled:
      typeof record['enabled'] === 'boolean'
        ? record['enabled']
        : DEFAULT_HARNESS_CONFIG.codex.telemetry.enabled,
    host: normalizeHost(record['host'], DEFAULT_HARNESS_CONFIG.codex.telemetry.host),
    port: normalizePort(record['port'], DEFAULT_HARNESS_CONFIG.codex.telemetry.port),
    logUserPrompt:
      typeof record['logUserPrompt'] === 'boolean'
        ? record['logUserPrompt']
        : DEFAULT_HARNESS_CONFIG.codex.telemetry.logUserPrompt,
    captureLogs:
      typeof record['captureLogs'] === 'boolean'
        ? record['captureLogs']
        : DEFAULT_HARNESS_CONFIG.codex.telemetry.captureLogs,
    captureMetrics:
      typeof record['captureMetrics'] === 'boolean'
        ? record['captureMetrics']
        : DEFAULT_HARNESS_CONFIG.codex.telemetry.captureMetrics,
    captureTraces:
      typeof record['captureTraces'] === 'boolean'
        ? record['captureTraces']
        : DEFAULT_HARNESS_CONFIG.codex.telemetry.captureTraces,
    captureVerboseEvents:
      typeof record['captureVerboseEvents'] === 'boolean'
        ? record['captureVerboseEvents']
        : DEFAULT_HARNESS_CONFIG.codex.telemetry.captureVerboseEvents,
    ingestMode,
  };
}

function normalizeCodexHistoryConfig(input: unknown): HarnessCodexHistoryConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.codex.history;
  }
  const filePath =
    typeof record['filePath'] === 'string' && record['filePath'].trim().length > 0
      ? record['filePath'].trim()
      : DEFAULT_HARNESS_CONFIG.codex.history.filePath;
  return {
    enabled:
      typeof record['enabled'] === 'boolean'
        ? record['enabled']
        : DEFAULT_HARNESS_CONFIG.codex.history.enabled,
    filePath,
    pollMs: normalizeNonNegativeInt(record['pollMs'], DEFAULT_HARNESS_CONFIG.codex.history.pollMs),
  };
}

function readCodexLaunchMode(value: unknown): HarnessCodexLaunchMode | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'yolo' || normalized === 'standard') {
    return normalized;
  }
  return null;
}

function normalizeCodexDirectoryModesConfig(
  input: unknown,
): Readonly<Record<string, HarnessCodexLaunchMode>> {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.codex.launch.directoryModes;
  }
  const out: Record<string, HarnessCodexLaunchMode> = {};
  for (const [rawPath, rawMode] of Object.entries(record)) {
    const path = rawPath.trim();
    if (path.length === 0) {
      continue;
    }
    const mode = readCodexLaunchMode(rawMode);
    if (mode === null) {
      continue;
    }
    out[path] = mode;
  }
  return out;
}

function normalizeCodexLaunchConfig(input: unknown): HarnessCodexLaunchConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.codex.launch;
  }
  const defaultMode =
    readCodexLaunchMode(record['defaultMode']) ?? DEFAULT_HARNESS_CONFIG.codex.launch.defaultMode;
  return {
    defaultMode,
    directoryModes: normalizeCodexDirectoryModesConfig(record['directoryModes']),
  };
}

function normalizeCodexConfig(input: unknown): HarnessCodexConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.codex;
  }
  return {
    telemetry: normalizeCodexTelemetryConfig(record['telemetry']),
    history: normalizeCodexHistoryConfig(record['history']),
    launch: normalizeCodexLaunchConfig(record['launch']),
  };
}

function readClaudeLaunchMode(value: unknown): HarnessClaudeLaunchMode | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'yolo' || normalized === 'standard') {
    return normalized;
  }
  return null;
}

function normalizeClaudeDirectoryModesConfig(
  input: unknown
): Readonly<Record<string, HarnessClaudeLaunchMode>> {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.claude.launch.directoryModes;
  }
  const out: Record<string, HarnessClaudeLaunchMode> = {};
  for (const [rawPath, rawMode] of Object.entries(record)) {
    const path = rawPath.trim();
    if (path.length === 0) {
      continue;
    }
    const mode = readClaudeLaunchMode(rawMode);
    if (mode === null) {
      continue;
    }
    out[path] = mode;
  }
  return out;
}

function normalizeClaudeLaunchConfig(input: unknown): HarnessClaudeLaunchConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.claude.launch;
  }
  const defaultMode =
    readClaudeLaunchMode(record['defaultMode']) ?? DEFAULT_HARNESS_CONFIG.claude.launch.defaultMode;
  return {
    defaultMode,
    directoryModes: normalizeClaudeDirectoryModesConfig(record['directoryModes'])
  };
}

function normalizeClaudeConfig(input: unknown): HarnessClaudeConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.claude;
  }
  return {
    launch: normalizeClaudeLaunchConfig(record['launch'])
  };
}

function readCursorLaunchMode(value: unknown): HarnessCursorLaunchMode | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'yolo' || normalized === 'standard') {
    return normalized;
  }
  return null;
}

function normalizeCursorDirectoryModesConfig(
  input: unknown
): Readonly<Record<string, HarnessCursorLaunchMode>> {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.cursor.launch.directoryModes;
  }
  const out: Record<string, HarnessCursorLaunchMode> = {};
  for (const [rawPath, rawMode] of Object.entries(record)) {
    const path = rawPath.trim();
    if (path.length === 0) {
      continue;
    }
    const mode = readCursorLaunchMode(rawMode);
    if (mode === null) {
      continue;
    }
    out[path] = mode;
  }
  return out;
}

function normalizeCursorLaunchConfig(input: unknown): HarnessCursorLaunchConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.cursor.launch;
  }
  const defaultMode =
    readCursorLaunchMode(record['defaultMode']) ?? DEFAULT_HARNESS_CONFIG.cursor.launch.defaultMode;
  return {
    defaultMode,
    directoryModes: normalizeCursorDirectoryModesConfig(record['directoryModes'])
  };
}

function normalizeCursorConfig(input: unknown): HarnessCursorConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.cursor;
  }
  return {
    launch: normalizeCursorLaunchConfig(record['launch'])
  };
}

function normalizeStringArray(input: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(input)) {
    return fallback;
  }
  const normalized = input
    .flatMap((value) => (typeof value === 'string' ? [value.trim()] : []))
    .filter((value) => value.length > 0);
  return normalized.length === 0 ? fallback : normalized;
}

function normalizeCritiqueLaunchConfig(input: unknown): HarnessCritiqueLaunchConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.critique.launch;
  }
  return {
    defaultArgs: normalizeStringArray(
      record['defaultArgs'],
      DEFAULT_HARNESS_CONFIG.critique.launch.defaultArgs,
    ),
  };
}

function normalizeCritiqueInstallConfig(input: unknown): HarnessCritiqueInstallConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.critique.install;
  }
  const packageName =
    typeof record['package'] === 'string' && record['package'].trim().length > 0
      ? record['package'].trim()
      : DEFAULT_HARNESS_CONFIG.critique.install.package;
  return {
    autoInstall:
      typeof record['autoInstall'] === 'boolean'
        ? record['autoInstall']
        : DEFAULT_HARNESS_CONFIG.critique.install.autoInstall,
    package: packageName,
  };
}

function normalizeCritiqueConfig(input: unknown): HarnessCritiqueConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.critique;
  }
  return {
    launch: normalizeCritiqueLaunchConfig(record['launch']),
    install: normalizeCritiqueInstallConfig(record['install']),
  };
}

function isHarnessLifecycleEventType(value: string): value is HarnessLifecycleEventType {
  return (HARNESS_LIFECYCLE_EVENT_TYPES as readonly string[]).includes(value);
}

function normalizeLifecycleEventCategoryMap(
  input: unknown,
): Readonly<Partial<Record<HarnessLifecycleEventType, string>>> {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing.eventCategoryMap;
  }
  const out: Partial<Record<HarnessLifecycleEventType, string>> = {};
  for (const [rawEventType, rawCategory] of Object.entries(record)) {
    if (!isHarnessLifecycleEventType(rawEventType)) {
      continue;
    }
    if (typeof rawCategory !== 'string') {
      continue;
    }
    const category = rawCategory.trim();
    if (category.length === 0) {
      continue;
    }
    out[rawEventType] = category;
  }
  return out;
}

function normalizeLifecycleProviders(input: unknown): HarnessLifecycleProviderConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.hooks.lifecycle.providers;
  }
  return {
    codex:
      typeof record['codex'] === 'boolean'
        ? record['codex']
        : DEFAULT_HARNESS_CONFIG.hooks.lifecycle.providers.codex,
    claude:
      typeof record['claude'] === 'boolean'
        ? record['claude']
        : DEFAULT_HARNESS_CONFIG.hooks.lifecycle.providers.claude,
    cursor:
      typeof record['cursor'] === 'boolean'
        ? record['cursor']
        : DEFAULT_HARNESS_CONFIG.hooks.lifecycle.providers.cursor,
    controlPlane:
      typeof record['controlPlane'] === 'boolean'
        ? record['controlPlane']
        : DEFAULT_HARNESS_CONFIG.hooks.lifecycle.providers.controlPlane,
  };
}

function normalizeLifecyclePeonPingConfig(input: unknown): HarnessLifecyclePeonPingConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing;
  }
  return {
    enabled:
      typeof record['enabled'] === 'boolean'
        ? record['enabled']
        : DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing.enabled,
    baseUrl:
      typeof record['baseUrl'] === 'string' && record['baseUrl'].trim().length > 0
        ? record['baseUrl'].trim()
        : DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing.baseUrl,
    timeoutMs: normalizeNonNegativeInt(
      record['timeoutMs'],
      DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing.timeoutMs,
    ),
    eventCategoryMap: normalizeLifecycleEventCategoryMap(record['eventCategoryMap']),
  };
}

function normalizeStringMap(input: unknown): Readonly<Record<string, string>> {
  const record = asRecord(input);
  if (record === null) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (normalizedKey.length === 0 || typeof value !== 'string') {
      continue;
    }
    const normalizedValue = value.trim();
    if (normalizedValue.length === 0) {
      continue;
    }
    out[normalizedKey] = normalizedValue;
  }
  return out;
}

function normalizeLifecycleEventTypes(input: unknown): readonly HarnessLifecycleEventType[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: HarnessLifecycleEventType[] = [];
  for (const value of input) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalized = value.trim();
    if (isHarnessLifecycleEventType(normalized) && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

function normalizeLifecycleWebhookConfig(
  input: unknown,
  index: number,
): HarnessLifecycleWebhookConfig | null {
  const record = asRecord(input);
  if (record === null) {
    return null;
  }
  const defaultName = `webhook-${String(index + 1)}`;
  const name =
    typeof record['name'] === 'string' && record['name'].trim().length > 0
      ? record['name'].trim()
      : defaultName;
  const url = typeof record['url'] === 'string' ? record['url'].trim() : '';
  if (url.length === 0) {
    return null;
  }
  const methodRaw =
    typeof record['method'] === 'string' && record['method'].trim().length > 0
      ? record['method'].trim().toUpperCase()
      : 'POST';
  const method = methodRaw;
  return {
    name,
    enabled: typeof record['enabled'] === 'boolean' ? record['enabled'] : true,
    url,
    method,
    timeoutMs: normalizeNonNegativeInt(record['timeoutMs'], 1200),
    headers: normalizeStringMap(record['headers']),
    eventTypes: normalizeLifecycleEventTypes(record['eventTypes']),
  };
}

function normalizeLifecycleHooksConfig(input: unknown): HarnessLifecycleHooksConfig {
  const record = asRecord(input);
  if (record === null) {
    return DEFAULT_HARNESS_CONFIG.hooks.lifecycle;
  }
  const webhooksRaw = Array.isArray(record['webhooks']) ? record['webhooks'] : [];
  const webhooks: HarnessLifecycleWebhookConfig[] = [];
  for (let index = 0; index < webhooksRaw.length; index += 1) {
    const normalized = normalizeLifecycleWebhookConfig(webhooksRaw[index], index);
    if (normalized !== null) {
      webhooks.push(normalized);
    }
  }
  return {
    enabled:
      typeof record['enabled'] === 'boolean'
        ? record['enabled']
        : DEFAULT_HARNESS_CONFIG.hooks.lifecycle.enabled,
    providers: normalizeLifecycleProviders(record['providers']),
    peonPing: normalizeLifecyclePeonPingConfig(record['peonPing']),
    webhooks,
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
  const codex = normalizeCodexConfig(root['codex']);
  const claude = normalizeClaudeConfig(root['claude']);
  const cursor = normalizeCursorConfig(root['cursor']);
  const critique = normalizeCritiqueConfig(root['critique']);
  const hooks = normalizeLifecycleHooksConfig(asRecord(root['hooks'])?.['lifecycle']);

  return {
    mux: {
      keybindings: mux === null ? {} : normalizeKeybindings(mux['keybindings']),
      ui: mux === null ? DEFAULT_HARNESS_CONFIG.mux.ui : normalizeMuxUiConfig(mux['ui']),
      git: mux === null ? DEFAULT_HARNESS_CONFIG.mux.git : normalizeMuxGitConfig(mux['git']),
    },
    debug,
    codex,
    claude,
    cursor,
    critique,
    hooks: {
      lifecycle: hooks,
    },
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
      error: null,
    };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    return {
      filePath,
      config: parseHarnessConfigText(raw),
      fromLastKnownGood: false,
      error: null,
    };
  } catch (error: unknown) {
    return {
      filePath,
      config: lastKnownGood,
      fromLastKnownGood: true,
      error: String(error),
    };
  }
}

function serializeHarnessConfig(config: HarnessConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function readCurrentHarnessConfig(filePath: string): HarnessConfig {
  if (!existsSync(filePath)) {
    return DEFAULT_HARNESS_CONFIG;
  }
  const raw = readFileSync(filePath, 'utf8');
  return parseHarnessConfigText(raw);
}

function roundUiPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function updateHarnessConfig(options: {
  cwd?: string;
  filePath?: string;
  update: (current: HarnessConfig) => HarnessConfig;
}): HarnessConfig {
  const cwd = options.cwd ?? process.cwd();
  const filePath = options.filePath ?? resolveHarnessConfigPath(cwd);
  const current = readCurrentHarnessConfig(filePath);
  const next = options.update(current);
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    writeFileSync(tempPath, serializeHarnessConfig(next), 'utf8');
    renameSync(tempPath, filePath);
  } catch (error: unknown) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
  return next;
}

export function updateHarnessMuxUiConfig(
  update: Partial<{
    paneWidthPercent: number | null;
    repositoriesCollapsed: boolean;
    shortcutsCollapsed: boolean;
  }>,
  options?: {
    cwd?: string;
    filePath?: string;
  },
): HarnessConfig {
  const updateOptions: {
    cwd?: string;
    filePath?: string;
    update: (current: HarnessConfig) => HarnessConfig;
  } = {
    update: (current) => {
      const nextPaneWidthPercent =
        update.paneWidthPercent === undefined
          ? current.mux.ui.paneWidthPercent
          : normalizePaneWidthPercent(update.paneWidthPercent, null);
      const nextShortcutsCollapsed =
        update.shortcutsCollapsed === undefined
          ? current.mux.ui.shortcutsCollapsed
          : update.shortcutsCollapsed;
      const nextRepositoriesCollapsed =
        update.repositoriesCollapsed === undefined
          ? current.mux.ui.repositoriesCollapsed
          : update.repositoriesCollapsed;
      return {
        ...current,
        mux: {
          ...current.mux,
          ui: {
            paneWidthPercent:
              nextPaneWidthPercent === null ? null : roundUiPercent(nextPaneWidthPercent),
            repositoriesCollapsed: nextRepositoriesCollapsed,
            shortcutsCollapsed: nextShortcutsCollapsed,
          },
        },
      };
    },
  };
  if (options?.cwd !== undefined) {
    updateOptions.cwd = options.cwd;
  }
  if (options?.filePath !== undefined) {
    updateOptions.filePath = options.filePath;
  }
  return updateHarnessConfig(updateOptions);
}

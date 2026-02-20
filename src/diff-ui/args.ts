import { resolve } from 'node:path';
import { DEFAULT_DIFF_BUDGET, type DiffMode } from '../diff/types.ts';
import type {
  DiffUiCliOptions,
  DiffUiSyntaxMode,
  DiffUiViewMode,
  DiffUiWordDiffMode,
} from './types.ts';

interface ParseDiffUiArgsOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly isStdoutTty?: boolean;
}

interface MutableDiffUiBudget {
  maxFiles: number;
  maxHunks: number;
  maxLines: number;
  maxBytes: number;
  maxRuntimeMs: number;
}

function parseFiniteInt(value: string, flag: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return Number.parseInt(trimmed, 10);
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = parseFiniteInt(value, flag);
  if (parsed <= 0) {
    throw new Error(`${flag} must be greater than zero`);
  }
  return parsed;
}

function readNextValue(argv: readonly string[], index: number, flag: string): string {
  const next = argv[index + 1];
  if (next === undefined) {
    throw new Error(`missing value for ${flag}`);
  }
  return next;
}

function hasFlagPrefix(value: string): boolean {
  return value.startsWith('--');
}

function parseViewMode(raw: string): DiffUiViewMode {
  if (raw === 'auto' || raw === 'split' || raw === 'unified') {
    return raw;
  }
  throw new Error(`invalid --view value: ${raw}`);
}

function parseSyntaxMode(raw: string): DiffUiSyntaxMode {
  if (raw === 'auto' || raw === 'on' || raw === 'off') {
    return raw;
  }
  throw new Error(`invalid --syntax value: ${raw}`);
}

function parseWordDiffMode(raw: string): DiffUiWordDiffMode {
  if (raw === 'auto' || raw === 'on' || raw === 'off') {
    return raw;
  }
  throw new Error(`invalid --word-diff value: ${raw}`);
}

function cloneBudget(): MutableDiffUiBudget {
  return {
    maxFiles: DEFAULT_DIFF_BUDGET.maxFiles,
    maxHunks: DEFAULT_DIFF_BUDGET.maxHunks,
    maxLines: DEFAULT_DIFF_BUDGET.maxLines,
    maxBytes: DEFAULT_DIFF_BUDGET.maxBytes,
    maxRuntimeMs: DEFAULT_DIFF_BUDGET.maxRuntimeMs,
  };
}

export function parseDiffUiArgs(
  argv: readonly string[],
  options: ParseDiffUiArgsOptions = {},
): DiffUiCliOptions {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const stdoutIsTty = options.isStdoutTty ?? process.stdout.isTTY === true;

  let mode: DiffMode = 'unstaged';
  let baseRef: string | null = null;
  let headRef: string | null = null;

  let includeGenerated = false;
  let includeBinary = false;
  let noRenames = true;
  let renameLimit: number | null = null;

  let viewMode: DiffUiViewMode = 'auto';
  let syntaxMode: DiffUiSyntaxMode = 'auto';
  let wordDiffMode: DiffUiWordDiffMode = 'auto';
  let color = stdoutIsTty && env.NO_COLOR === undefined;
  let watch = false;
  let jsonEvents = false;
  let rpcStdio = false;
  let snapshot = false;
  let width: number | null = null;
  let height: number | null = null;
  let theme: string | null = null;
  let resolvedCwd = cwd;

  const budget = cloneBudget();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (arg === '--help' || arg === '-h') {
      throw new Error('help requested');
    }
    if (arg === '--staged') {
      mode = 'staged';
      continue;
    }
    if (arg === '--base') {
      const next = argv[index + 1];
      if (next !== undefined && !hasFlagPrefix(next)) {
        baseRef = next;
        index += 1;
      } else {
        baseRef = null;
      }
      mode = 'range';
      continue;
    }
    if (arg === '--head') {
      const value = readNextValue(argv, index, '--head');
      headRef = value;
      index += 1;
      continue;
    }
    if (arg === '--view') {
      const value = readNextValue(argv, index, '--view');
      viewMode = parseViewMode(value);
      index += 1;
      continue;
    }
    if (arg === '--syntax') {
      const value = readNextValue(argv, index, '--syntax');
      syntaxMode = parseSyntaxMode(value);
      index += 1;
      continue;
    }
    if (arg === '--word-diff') {
      const value = readNextValue(argv, index, '--word-diff');
      wordDiffMode = parseWordDiffMode(value);
      index += 1;
      continue;
    }
    if (arg === '--no-color') {
      color = false;
      continue;
    }
    if (arg === '--json-events') {
      jsonEvents = true;
      continue;
    }
    if (arg === '--rpc-stdio') {
      rpcStdio = true;
      continue;
    }
    if (arg === '--snapshot') {
      snapshot = true;
      continue;
    }
    if (arg === '--watch') {
      watch = true;
      continue;
    }
    if (arg === '--theme') {
      const value = readNextValue(argv, index, '--theme');
      theme = value;
      index += 1;
      continue;
    }
    if (arg === '--width') {
      const value = readNextValue(argv, index, '--width');
      width = parsePositiveInt(value, '--width');
      index += 1;
      continue;
    }
    if (arg === '--height') {
      const value = readNextValue(argv, index, '--height');
      height = parsePositiveInt(value, '--height');
      index += 1;
      continue;
    }
    if (arg === '--max-files') {
      const value = readNextValue(argv, index, '--max-files');
      budget.maxFiles = parsePositiveInt(value, '--max-files');
      index += 1;
      continue;
    }
    if (arg === '--max-hunks') {
      const value = readNextValue(argv, index, '--max-hunks');
      budget.maxHunks = parsePositiveInt(value, '--max-hunks');
      index += 1;
      continue;
    }
    if (arg === '--max-lines') {
      const value = readNextValue(argv, index, '--max-lines');
      budget.maxLines = parsePositiveInt(value, '--max-lines');
      index += 1;
      continue;
    }
    if (arg === '--max-bytes') {
      const value = readNextValue(argv, index, '--max-bytes');
      budget.maxBytes = parsePositiveInt(value, '--max-bytes');
      index += 1;
      continue;
    }
    if (arg === '--max-runtime-ms') {
      const value = readNextValue(argv, index, '--max-runtime-ms');
      budget.maxRuntimeMs = parsePositiveInt(value, '--max-runtime-ms');
      index += 1;
      continue;
    }
    if (arg === '--include-generated') {
      includeGenerated = true;
      continue;
    }
    if (arg === '--include-binary') {
      includeBinary = true;
      continue;
    }
    if (arg === '--renames') {
      noRenames = false;
      continue;
    }
    if (arg === '--no-renames') {
      noRenames = true;
      continue;
    }
    if (arg === '--rename-limit') {
      const value = readNextValue(argv, index, '--rename-limit');
      renameLimit = parseFiniteInt(value, '--rename-limit');
      noRenames = false;
      index += 1;
      continue;
    }
    if (arg === '--cwd') {
      const value = readNextValue(argv, index, '--cwd');
      resolvedCwd = resolve(cwd, value);
      index += 1;
      continue;
    }

    throw new Error(`unknown option: ${arg}`);
  }

  if (mode === 'range' && headRef === null) {
    headRef = 'HEAD';
  }
  if (mode !== 'range' && (baseRef !== null || headRef !== null)) {
    throw new Error('--base/--head are only valid for range mode');
  }

  return {
    cwd: resolvedCwd,
    mode,
    baseRef,
    headRef,
    includeGenerated,
    includeBinary,
    noRenames,
    renameLimit,
    viewMode,
    syntaxMode,
    wordDiffMode,
    color,
    watch,
    jsonEvents,
    rpcStdio,
    snapshot,
    width,
    height,
    theme,
    budget,
  };
}

export function diffUiUsage(): string {
  return [
    'usage: harness diff [options]',
    '',
    'diff source:',
    '  --staged',
    '  --base [<ref>] [--head <ref>]',
    '',
    'display:',
    '  --view <auto|split|unified>',
    '  --syntax <auto|on|off>',
    '  --word-diff <auto|on|off>',
    '  --theme <name>',
    '  --no-color',
    '  --width <n>',
    '  --height <n>',
    '',
    'runtime:',
    '  --json-events',
    '  --rpc-stdio',
    '  --snapshot',
    '  --watch',
    '',
    'budgets:',
    '  --max-files <n>',
    '  --max-hunks <n>',
    '  --max-lines <n>',
    '  --max-bytes <n>',
    '  --max-runtime-ms <n>',
    '',
    'git:',
    '  --include-generated',
    '  --include-binary',
    '  --renames | --no-renames',
    '  --rename-limit <n>',
    '  --cwd <path>',
  ].join('\n');
}

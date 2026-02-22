import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedCommandMenuOpenInTarget } from './command-menu-open-in.ts';

const TOKEN_REGEX = /\S+/gu;
const LEADING_WRAP_CHARS = new Set(['"', "'", '`', '(', '[', '{', '<']);
const TRAILING_WRAP_CHARS = new Set(['"', "'", '`', ')', ']', '}', '>', ',', '.', ';', '!', '?']);
const EDITOR_LINE_TARGET_IDS = new Set(['zed', 'cursor', 'vscode']);

type TerminalLinkTarget = TerminalUrlLinkTarget | TerminalFileLinkTarget;

interface TerminalUrlLinkTarget {
  readonly kind: 'url';
  readonly url: string;
}

interface TerminalFileLinkTarget {
  readonly kind: 'file';
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}

function trimTokenWrapper(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && LEADING_WRAP_CHARS.has(token[start]!)) {
    start += 1;
  }
  while (end > start && TRAILING_WRAP_CHARS.has(token[end - 1]!)) {
    end -= 1;
  }
  return token.slice(start, end);
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function splitTrailingLineColumn(value: string): {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
} {
  let remainder = value;
  let column: number | null = null;
  let line: number | null = null;

  const trailingColumn = /:(\d+)$/u.exec(remainder);
  if (trailingColumn !== null) {
    const parsed = parsePositiveInteger(trailingColumn[1]!);
    if (parsed !== null) {
      column = parsed;
      remainder = remainder.slice(0, -trailingColumn[0].length);
    }
  }

  const trailingLine = /:(\d+)$/u.exec(remainder);
  if (trailingLine !== null) {
    const parsed = parsePositiveInteger(trailingLine[1]!);
    if (parsed !== null) {
      line = parsed;
      remainder = remainder.slice(0, -trailingLine[0].length);
    }
  } else if (column !== null) {
    line = column;
    column = null;
  }

  return {
    path: remainder,
    line,
    column,
  };
}

function parseUrlTarget(candidate: string): TerminalUrlLinkTarget | null {
  if (!/^https?:\/\//iu.test(candidate)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  return {
    kind: 'url',
    url: parsed.toString(),
  };
}

function looksLikeFilePath(pathLike: string, hasLineOrColumnSuffix: boolean): boolean {
  if (pathLike.length === 0 || /\s/u.test(pathLike) || pathLike.includes('://')) {
    return false;
  }
  if (
    pathLike.startsWith('/') ||
    pathLike.startsWith('./') ||
    pathLike.startsWith('../') ||
    pathLike.startsWith('~/')
  ) {
    return true;
  }
  if (pathLike.includes('/') || pathLike.includes('\\') || /^[A-Za-z]:[\\/]/u.test(pathLike)) {
    return true;
  }
  if (hasLineOrColumnSuffix) {
    return /^[A-Za-z0-9._-]+$/u.test(pathLike);
  }
  return /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/u.test(pathLike);
}

function parseFileTarget(candidate: string): TerminalFileLinkTarget | null {
  if (candidate.startsWith('file://')) {
    try {
      const fileUrl = new URL(candidate);
      return {
        kind: 'file',
        path: fileURLToPath(fileUrl),
        line: null,
        column: null,
      };
    } catch {
      return null;
    }
  }
  const split = splitTrailingLineColumn(candidate);
  const hasLineOrColumnSuffix = split.line !== null || split.column !== null;
  if (!looksLikeFilePath(split.path, hasLineOrColumnSuffix)) {
    return null;
  }
  return {
    kind: 'file',
    path: split.path,
    line: split.line,
    column: split.column,
  };
}

export function resolveTerminalLinkTargetAtCell(options: {
  readonly lines: readonly string[];
  readonly row: number;
  readonly col: number;
}): TerminalLinkTarget | null {
  if (options.row < 1 || options.col < 1) {
    return null;
  }
  const line = options.lines[options.row - 1];
  if (line === undefined || line.length === 0) {
    return null;
  }
  const targetColIndex = options.col - 1;
  for (const match of line.matchAll(TOKEN_REGEX)) {
    const token = match[0];
    const start = match.index ?? -1;
    const end = start + token.length;
    if (start < 0 || targetColIndex < start || targetColIndex >= end) {
      continue;
    }
    const trimmed = trimTokenWrapper(token);
    if (trimmed.length === 0) {
      return null;
    }
    const urlTarget = parseUrlTarget(trimmed);
    if (urlTarget !== null) {
      return urlTarget;
    }
    return parseFileTarget(trimmed);
  }
  return null;
}

export function resolveFileLinkPath(options: {
  readonly path: string;
  readonly directoryPath: string | null;
  readonly homeDirectory: string;
}): string {
  const normalized = options.path.trim();
  if (normalized.startsWith('~/')) {
    return resolve(options.homeDirectory, normalized.slice(2));
  }
  if (isAbsolute(normalized) || /^[A-Za-z]:[\\/]/u.test(normalized)) {
    return normalized;
  }
  if (options.directoryPath !== null && options.directoryPath.trim().length > 0) {
    return resolve(options.directoryPath, normalized);
  }
  return normalized;
}

export function buildFileLinkPathArgumentForTarget(options: {
  readonly targetId: string;
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}): string {
  if (options.line === null || !EDITOR_LINE_TARGET_IDS.has(options.targetId)) {
    return options.path;
  }
  if (options.column === null) {
    return `${options.path}:${String(options.line)}`;
  }
  return `${options.path}:${String(options.line)}:${String(options.column)}`;
}

export function prioritizeOpenInTargetsForFileLinks(
  targets: readonly ResolvedCommandMenuOpenInTarget[],
): readonly ResolvedCommandMenuOpenInTarget[] {
  const preferred = targets.filter((target) => target.id === 'zed');
  const remainder = targets.filter((target) => target.id !== 'zed');
  return [...preferred, ...remainder];
}

function valueForPlaceholder(
  placeholder: string,
  values: {
    readonly path?: string | null;
    readonly url?: string | null;
    readonly line?: number | null;
    readonly column?: number | null;
  },
): string | null {
  if (placeholder === '{path}') {
    const value = values.path;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  if (placeholder === '{url}') {
    const value = values.url;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  if (placeholder === '{line}') {
    return typeof values.line === 'number' && values.line > 0 ? String(values.line) : null;
  }
  if (placeholder === '{column}') {
    return typeof values.column === 'number' && values.column > 0 ? String(values.column) : null;
  }
  return null;
}

export function resolveLinkCommandFromTemplate(options: {
  readonly template: readonly string[] | null;
  readonly values: {
    readonly path?: string | null;
    readonly url?: string | null;
    readonly line?: number | null;
    readonly column?: number | null;
  };
  readonly appendPrimaryPlaceholder: '{path}' | '{url}';
}): { command: string; args: readonly string[] } | null {
  if (options.template === null || options.template.length === 0) {
    return null;
  }
  const command = options.template[0]?.trim() ?? '';
  if (command.length === 0) {
    return null;
  }
  const args: string[] = [];
  let injectedPrimary = false;
  for (const rawPart of options.template.slice(1)) {
    const part = rawPart.trim();
    if (part.length === 0) {
      continue;
    }
    const placeholderValue = valueForPlaceholder(part, options.values);
    if (placeholderValue !== null) {
      args.push(placeholderValue);
      if (part === options.appendPrimaryPlaceholder) {
        injectedPrimary = true;
      }
      continue;
    }
    if (part === '{path}' || part === '{url}' || part === '{line}' || part === '{column}') {
      continue;
    }
    args.push(part);
  }
  if (!injectedPrimary) {
    const fallbackValue = valueForPlaceholder(options.appendPrimaryPlaceholder, options.values);
    if (fallbackValue !== null) {
      args.push(fallbackValue);
    }
  }
  return {
    command,
    args,
  };
}

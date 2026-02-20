import type { FileChangeType } from './types.ts';

function trimToNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeDiffPath(value: string | null): string | null {
  const trimmed = trimToNull(value);
  if (trimmed === null || trimmed === '/dev/null') {
    return null;
  }
  return trimmed;
}

export function inferLanguageFromPath(path: string | null): string | null {
  if (path === null) {
    return null;
  }
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return 'typescript';
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) {
    return 'javascript';
  }
  if (lower.endsWith('.rs')) {
    return 'rust';
  }
  if (lower.endsWith('.go')) {
    return 'go';
  }
  if (lower.endsWith('.py')) {
    return 'python';
  }
  if (lower.endsWith('.java')) {
    return 'java';
  }
  if (lower.endsWith('.kt')) {
    return 'kotlin';
  }
  if (lower.endsWith('.rb')) {
    return 'ruby';
  }
  if (lower.endsWith('.c') || lower.endsWith('.h')) {
    return 'c';
  }
  if (lower.endsWith('.cc') || lower.endsWith('.cpp') || lower.endsWith('.hpp')) {
    return 'cpp';
  }
  if (lower.endsWith('.json')) {
    return 'json';
  }
  if (lower.endsWith('.jsonc')) {
    return 'jsonc';
  }
  if (lower.endsWith('.md')) {
    return 'markdown';
  }
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return 'yaml';
  }
  if (lower.endsWith('.toml')) {
    return 'toml';
  }
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) {
    return 'shell';
  }
  if (lower.endsWith('.sql')) {
    return 'sql';
  }
  return null;
}

function hasGeneratedSegment(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.startsWith('dist/') ||
    lower.startsWith('build/') ||
    lower.startsWith('coverage/') ||
    lower.startsWith('.next/') ||
    lower.startsWith('out/') ||
    lower.startsWith('vendor/') ||
    lower.startsWith('node_modules/') ||
    lower.includes('/dist/') ||
    lower.includes('/build/') ||
    lower.includes('/coverage/') ||
    lower.includes('/.next/') ||
    lower.includes('/out/') ||
    lower.includes('/vendor/') ||
    lower.includes('/node_modules/')
  );
}

export function isGeneratedPath(path: string | null): boolean {
  if (path === null) {
    return false;
  }
  const lower = path.toLowerCase();
  return (
    hasGeneratedSegment(path) ||
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.css') ||
    lower.endsWith('.lock') ||
    lower === 'package-lock.json' ||
    lower === 'bun.lock' ||
    lower.endsWith('.generated.ts') ||
    lower.endsWith('.gen.ts')
  );
}

export function resolveFileChangeType(input: {
  fromHeader: FileChangeType | null;
  oldPath: string | null;
  newPath: string | null;
  isBinary: boolean;
}): FileChangeType {
  if (input.isBinary) {
    return 'binary';
  }
  if (input.fromHeader !== null && input.fromHeader !== 'unknown') {
    return input.fromHeader;
  }
  if (input.oldPath === null && input.newPath !== null) {
    return 'added';
  }
  if (input.oldPath !== null && input.newPath === null) {
    return 'deleted';
  }
  return 'modified';
}

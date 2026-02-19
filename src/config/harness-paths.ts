import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { resolveHarnessConfigDirectory } from './config-core.ts';

const HARNESS_LEGACY_RELATIVE_ROOT = '.harness';
const HARNESS_WORKSPACES_DIRECTORY = 'workspaces';
const HASH_PREFIX_HEX_LENGTH = 12;

function readNonEmptyEnvPath(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function sanitizePathToken(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  if (sanitized.length === 0) {
    return 'workspace';
  }
  return sanitized;
}

function resolveHarnessWorkspaceSlug(invocationDirectory: string): string {
  const normalizedWorkspacePath = resolve(invocationDirectory);
  const workspaceName = sanitizePathToken(basename(normalizedWorkspacePath));
  const hash = createHash('sha256')
    .update(normalizedWorkspacePath)
    .digest('hex')
    .slice(0, HASH_PREFIX_HEX_LENGTH);
  return `${workspaceName}-${hash}`;
}

export function resolveHarnessWorkspaceDirectory(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configDirectory = resolveHarnessConfigDirectory(invocationDirectory, env);
  return resolve(
    configDirectory,
    HARNESS_WORKSPACES_DIRECTORY,
    resolveHarnessWorkspaceSlug(invocationDirectory),
  );
}

export function resolveLegacyHarnessDirectory(invocationDirectory: string): string {
  return resolve(invocationDirectory, HARNESS_LEGACY_RELATIVE_ROOT);
}

function resolveHomePath(pathValue: string, env: NodeJS.ProcessEnv): string | null {
  const homeDirectory = readNonEmptyEnvPath(env.HOME);
  if (homeDirectory === null) {
    return null;
  }
  if (pathValue === '~') {
    return homeDirectory;
  }
  if (pathValue.startsWith('~/')) {
    return resolve(homeDirectory, pathValue.slice(2));
  }
  return null;
}

export function resolveHarnessRuntimePath(
  invocationDirectory: string,
  pathValue: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const workspaceRuntimeDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  const normalizedPath = pathValue.trim();
  if (normalizedPath.length === 0 || normalizedPath === HARNESS_LEGACY_RELATIVE_ROOT) {
    return workspaceRuntimeDirectory;
  }
  if (normalizedPath.startsWith(`${HARNESS_LEGACY_RELATIVE_ROOT}/`)) {
    return resolve(
      workspaceRuntimeDirectory,
      normalizedPath.slice(`${HARNESS_LEGACY_RELATIVE_ROOT}/`.length),
    );
  }
  const expandedHomePath = resolveHomePath(normalizedPath, env);
  if (expandedHomePath !== null) {
    return expandedHomePath;
  }
  return resolve(workspaceRuntimeDirectory, normalizedPath);
}

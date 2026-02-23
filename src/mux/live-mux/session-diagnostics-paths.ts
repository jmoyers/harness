import { resolve } from 'node:path';
import { resolveHarnessWorkspaceDirectory } from '../../config/harness-paths.ts';

export const DEFAULT_SESSION_DIAGNOSTICS_ROOT_PATH = 'session-diagnostics';

export function resolveSessionDiagnosticsDirectory(
  invocationDirectory: string,
  sessionName: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  if (sessionName === null) {
    return resolve(workspaceDirectory, DEFAULT_SESSION_DIAGNOSTICS_ROOT_PATH);
  }
  return resolve(
    workspaceDirectory,
    'sessions',
    sessionName,
    DEFAULT_SESSION_DIAGNOSTICS_ROOT_PATH,
  );
}

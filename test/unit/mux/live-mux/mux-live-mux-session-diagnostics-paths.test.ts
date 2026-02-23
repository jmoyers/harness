import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { resolveHarnessWorkspaceDirectory } from '../../../../src/config/harness-paths.ts';
import {
  DEFAULT_SESSION_DIAGNOSTICS_ROOT_PATH,
  resolveSessionDiagnosticsDirectory,
} from '../../../../src/mux/live-mux/session-diagnostics-paths.ts';

void test('session diagnostics paths resolve for default and named sessions', () => {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: '/tmp/xdg-home',
  };
  const runtimeRoot = resolveHarnessWorkspaceDirectory('/tmp/harness', env);
  assert.equal(
    resolveSessionDiagnosticsDirectory('/tmp/harness', null, env),
    `${runtimeRoot}/${DEFAULT_SESSION_DIAGNOSTICS_ROOT_PATH}`,
  );
  assert.equal(
    resolveSessionDiagnosticsDirectory('/tmp/harness', 'session-a', env),
    `${runtimeRoot}/sessions/session-a/${DEFAULT_SESSION_DIAGNOSTICS_ROOT_PATH}`,
  );
});

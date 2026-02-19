import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { test } from 'bun:test';
import {
  resolveHarnessRuntimePath,
  resolveHarnessWorkspaceDirectory,
} from '../src/config/harness-paths.ts';

void test('harness paths resolve runtime aliases and home expansion', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-paths-test-'));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: join(workspace, '.xdg'),
    HOME: join(workspace, '.home'),
  };
  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspace, env);

  assert.equal(resolveHarnessRuntimePath(workspace, '', env), runtimeRoot);
  assert.equal(resolveHarnessRuntimePath(workspace, '.harness', env), runtimeRoot);
  assert.equal(
    resolveHarnessRuntimePath(workspace, '.harness/logs', env),
    resolve(runtimeRoot, 'logs'),
  );
  assert.equal(resolveHarnessRuntimePath(workspace, '~', env), env.HOME);
  assert.equal(resolveHarnessRuntimePath(workspace, '~/logs', env), resolve(env.HOME!, 'logs'));
});

void test('harness paths fall back when home env is blank and sanitize empty workspace names', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-paths-test-'));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: join(workspace, '.xdg'),
    HOME: '   ',
  };
  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspace, env);

  assert.equal(resolveHarnessRuntimePath(workspace, '~', env), resolve(runtimeRoot, '~'));
  assert.equal(resolveHarnessRuntimePath(workspace, 'relative/debug.log', env), resolve(runtimeRoot, 'relative/debug.log'));

  const rootWorkspaceRuntime = resolveHarnessWorkspaceDirectory('/', env);
  assert.equal(basename(rootWorkspaceRuntime).startsWith('workspace-'), true);
});

void test('harness paths sanitize whitespace-only workspace basename', () => {
  const resolvedPath = resolveHarnessWorkspaceDirectory('/tmp/   ', {
    XDG_CONFIG_HOME: '/tmp/harness-paths-xdg',
  });
  const slug = resolvedPath.split(/[/\\]/u).at(-1) ?? '';
  assert.match(slug, /^workspace-[0-9a-f]{12}$/u);
});

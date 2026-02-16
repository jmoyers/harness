import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  expandHomePath,
  normalizeWorkspacePathInput,
  resolveWorkspacePath
} from '../src/mux/workspace-path.ts';

void test('workspace path input normalization trims optional prefix and wrapping quotes', () => {
  assert.equal(normalizeWorkspacePathInput('  ~/dev/ash-1  '), '~/dev/ash-1');
  assert.equal(normalizeWorkspacePathInput('path: ~/dev/ash-1'), '~/dev/ash-1');
  assert.equal(normalizeWorkspacePathInput('PATH: "~/dev/ash-1"'), '~/dev/ash-1');
  assert.equal(normalizeWorkspacePathInput('path: \'~/dev/ash-1\''), '~/dev/ash-1');
  assert.equal(normalizeWorkspacePathInput('path: "unterminated'), '"unterminated');
});

void test('expandHomePath expands tilde forms and leaves non-home values unchanged', () => {
  assert.equal(expandHomePath('~', '/Users/jmoyers'), '/Users/jmoyers');
  assert.equal(expandHomePath('~/dev/ash-1', '/Users/jmoyers'), '/Users/jmoyers/dev/ash-1');
  assert.equal(expandHomePath('/tmp/project', '/Users/jmoyers'), '/tmp/project');
  assert.equal(expandHomePath('~/dev/ash-1', null), '~/dev/ash-1');
  assert.equal(expandHomePath('~/dev/ash-1', ''), '~/dev/ash-1');
});

void test('resolveWorkspacePath handles relative home and legacy invocation-prefixed tilde paths', () => {
  const invocationDirectory = '/Users/jmoyers/dev/harness';
  const homeDirectory = '/Users/jmoyers';
  assert.equal(
    resolveWorkspacePath(invocationDirectory, '~/dev/ash-1', homeDirectory),
    '/Users/jmoyers/dev/ash-1'
  );
  assert.equal(
    resolveWorkspacePath(
      invocationDirectory,
      '/Users/jmoyers/dev/harness/~/dev/ash-1',
      homeDirectory
    ),
    '/Users/jmoyers/dev/ash-1'
  );
  assert.equal(
    resolveWorkspacePath(invocationDirectory, '/Users/jmoyers/dev/harness/~', homeDirectory),
    '/Users/jmoyers'
  );
});

void test('resolveWorkspacePath falls back to invocation-relative resolution without home', () => {
  const invocationDirectory = '/Users/jmoyers/dev/harness';
  assert.equal(
    resolveWorkspacePath(invocationDirectory, './subdir', null),
    '/Users/jmoyers/dev/harness/subdir'
  );
  assert.equal(
    resolveWorkspacePath(invocationDirectory, 'path: "~/dev/ash-1"', null),
    '/Users/jmoyers/dev/harness/~/dev/ash-1'
  );
});

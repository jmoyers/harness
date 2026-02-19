import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  HARNESS_CONFIG_FILE_NAME,
  resolveHarnessConfigDirectory,
} from '../src/config/config-core.ts';
import { resolveHarnessWorkspaceDirectory } from '../src/config/harness-paths.ts';
import { migrateLegacyHarnessLayout } from '../src/config/harness-runtime-migration.ts';

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'harness-migration-test-'));
}

function envWithXdg(workspace: string): NodeJS.ProcessEnv {
  return {
    XDG_CONFIG_HOME: join(workspace, '.harness-xdg'),
  };
}

void test('legacy local runtime artifacts migrate to workspace-scoped global runtime path on first run', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(join(legacyRoot, 'sessions', 'session-a'), { recursive: true });
  writeFileSync(join(legacyRoot, 'gateway.json'), '{"pid":123}\n', 'utf8');
  writeFileSync(join(legacyRoot, 'sessions', 'session-a', 'gateway.log'), 'legacy-log\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);
  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspace, env);

  assert.equal(result.migrated, true);
  assert.equal(result.skipped, false);
  assert.equal(result.migratedEntries >= 1, true);
  assert.equal(existsSync(join(runtimeRoot, 'gateway.json')), true);
  assert.equal(existsSync(join(runtimeRoot, 'sessions', 'session-a', 'gateway.log')), true);
  assert.equal(existsSync(result.markerPath), true);
});

void test('migration does not overwrite an existing global harness config file', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });

  const configDirectory = resolveHarnessConfigDirectory(workspace, env);
  mkdirSync(configDirectory, { recursive: true });

  const legacyConfigPath = join(legacyRoot, HARNESS_CONFIG_FILE_NAME);
  const globalConfigPath = join(configDirectory, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(legacyConfigPath, '{"configVersion":1,"debug":{"enabled":false}}\n', 'utf8');
  writeFileSync(globalConfigPath, '{"configVersion":1,"debug":{"enabled":true}}\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.configCopied, false);
  assert.equal(
    readFileSync(globalConfigPath, 'utf8'),
    '{"configVersion":1,"debug":{"enabled":true}}\n',
  );
});

void test('migration copies legacy config when global config is missing', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });

  const legacyConfigPath = join(legacyRoot, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(legacyConfigPath, '{"configVersion":1,"github":{"enabled":false}}\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);
  const configDirectory = resolveHarnessConfigDirectory(workspace, env);
  const globalConfigPath = join(configDirectory, HARNESS_CONFIG_FILE_NAME);

  assert.equal(result.configCopied, true);
  assert.equal(
    readFileSync(globalConfigPath, 'utf8'),
    '{"configVersion":1,"github":{"enabled":false}}\n',
  );
});

void test('migration skips workspace entry copy when config directory resolves to legacy root', () => {
  const workspace = createWorkspace();
  const env: NodeJS.ProcessEnv = {
    HOME: workspace,
  };
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(join(legacyRoot, 'gateway.json'), '{"pid":123}\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.skipped, true);
  assert.equal(result.migratedEntries, 0);
  assert.equal(result.migrated, false);
  assert.equal(result.markerPath, join(legacyRoot, '.legacy-layout-migration-v1'));
  assert.equal(existsSync(result.markerPath), false);
});

void test('migration skips when legacy runtime root is missing', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.skipped, true);
  assert.equal(result.migrated, false);
  assert.equal(result.migratedEntries, 0);
});

void test('migration skips when marker already exists', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(join(legacyRoot, 'gateway.json'), '{"pid":321}\n', 'utf8');

  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspace, env);
  mkdirSync(runtimeRoot, { recursive: true });
  const markerPath = join(runtimeRoot, '.legacy-layout-migration-v1');
  writeFileSync(markerPath, 'done\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.skipped, true);
  assert.equal(result.migratedEntries, 0);
  assert.equal(result.markerPath, markerPath);
  assert.equal(existsSync(join(runtimeRoot, 'gateway.json')), false);
});

void test('migration ignores dangling legacy entries and still writes marker', () => {
  if (process.platform === 'win32') {
    return;
  }
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });

  const missingTarget = join(legacyRoot, 'missing-target');
  const danglingEntryPath = join(legacyRoot, 'dangling-entry');
  symlinkSync(missingTarget, danglingEntryPath);

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.skipped, false);
  assert.equal(result.migratedEntries, 0);
  assert.equal(existsSync(result.markerPath), true);
});

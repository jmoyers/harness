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
  loadHarnessConfig,
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
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(existsSync(legacyRoot), false);
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
  writeFileSync(legacyConfigPath, '{"configVersion":1,"debug":{"enabled":true}}\n', 'utf8');
  writeFileSync(globalConfigPath, '{"configVersion":1,"github":{"enabled":false}}\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.configCopied, false);
  assert.equal(result.configReplacedExisting, false);
  assert.equal(result.configBackupPath, null);
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(existsSync(legacyRoot), false);
  assert.equal(
    readFileSync(globalConfigPath, 'utf8'),
    '{"configVersion":1,"github":{"enabled":false}}\n',
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
  assert.equal(result.configReplacedExisting, false);
  assert.equal(result.configBackupPath, null);
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(existsSync(legacyRoot), false);
  assert.equal(
    readFileSync(globalConfigPath, 'utf8'),
    '{"configVersion":1,"github":{"enabled":false}}\n',
  );
});

void test('migration copies legacy secrets when global secrets are missing', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(join(legacyRoot, 'secrets.env'), 'ANTHROPIC_API_KEY=legacy-key\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);
  const configDirectory = resolveHarnessConfigDirectory(workspace, env);
  const globalSecretsPath = join(configDirectory, 'secrets.env');

  assert.equal(result.secretsCopied, true);
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(existsSync(legacyRoot), false);
  assert.equal(readFileSync(globalSecretsPath, 'utf8'), 'ANTHROPIC_API_KEY=legacy-key\n');
});

void test('migration keeps existing invalid global config and does not treat it as uninitialized', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(join(legacyRoot, HARNESS_CONFIG_FILE_NAME), '{"configVersion":1}\n', 'utf8');

  const configDirectory = resolveHarnessConfigDirectory(workspace, env);
  mkdirSync(configDirectory, { recursive: true });
  const globalConfigPath = join(configDirectory, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(globalConfigPath, '{invalid-json', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.configCopied, false);
  assert.equal(result.configReplacedExisting, false);
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(readFileSync(globalConfigPath, 'utf8'), '{invalid-json');
});

void test('migration replaces empty global config with legacy config and writes backup', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });

  const configDirectory = resolveHarnessConfigDirectory(workspace, env);
  mkdirSync(configDirectory, { recursive: true });

  const legacyConfigPath = join(legacyRoot, HARNESS_CONFIG_FILE_NAME);
  const globalConfigPath = join(configDirectory, HARNESS_CONFIG_FILE_NAME);
  const backupConfigPath = join(configDirectory, `${HARNESS_CONFIG_FILE_NAME}.pre-migration.bak`);
  const legacyConfigText = '{"configVersion":1,"github":{"enabled":false}}\n';
  writeFileSync(legacyConfigPath, legacyConfigText, 'utf8');
  writeFileSync(globalConfigPath, '\n \t', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.configCopied, true);
  assert.equal(result.configReplacedExisting, true);
  assert.equal(result.configBackupPath, backupConfigPath);
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(existsSync(legacyRoot), false);
  assert.equal(readFileSync(globalConfigPath, 'utf8'), legacyConfigText);
  assert.equal(readFileSync(backupConfigPath, 'utf8'), '\n \t');
});

void test('migration replaces bootstrapped default global config with legacy config and writes backup', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });

  const configDirectory = resolveHarnessConfigDirectory(workspace, env);
  const globalConfigPath = join(configDirectory, HARNESS_CONFIG_FILE_NAME);
  const backupConfigPath = join(configDirectory, `${HARNESS_CONFIG_FILE_NAME}.pre-migration.bak`);
  const legacyConfigPath = join(legacyRoot, HARNESS_CONFIG_FILE_NAME);
  const legacyConfigText = '{"configVersion":1,"debug":{"enabled":false}}\n';
  writeFileSync(legacyConfigPath, legacyConfigText, 'utf8');

  const bootstrapped = loadHarnessConfig({ cwd: workspace, env });
  assert.equal(bootstrapped.fromLastKnownGood, false);
  assert.equal(existsSync(globalConfigPath), true);

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.configCopied, true);
  assert.equal(result.configReplacedExisting, true);
  assert.equal(result.configBackupPath, backupConfigPath);
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(existsSync(legacyRoot), false);
  assert.equal(readFileSync(globalConfigPath, 'utf8'), legacyConfigText);
  assert.equal(existsSync(backupConfigPath), true);
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
  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspace, env);

  assert.equal(result.skipped, true);
  assert.equal(result.migratedEntries, 0);
  assert.equal(result.migrated, false);
  assert.equal(result.legacyRootRemoved, false);
  assert.equal(result.markerPath, join(runtimeRoot, '.legacy-layout-migration-v1'));
  assert.equal(existsSync(result.markerPath), false);
  assert.equal(existsSync(legacyRoot), true);
});

void test('migration skips when legacy runtime root is missing', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.skipped, true);
  assert.equal(result.migrated, false);
  assert.equal(result.migratedEntries, 0);
  assert.equal(result.legacyRootRemoved, false);
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
  assert.equal(result.legacyRootRemoved, false);
  assert.equal(existsSync(legacyRoot), true);
  assert.equal(existsSync(join(runtimeRoot, 'gateway.json')), false);
});

void test('migration removes stale legacy root when marker exists and runtime targets are present', () => {
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(join(legacyRoot, 'gateway.json'), '{"pid":321}\n', 'utf8');

  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspace, env);
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(join(runtimeRoot, 'gateway.json'), '{"pid":321}\n', 'utf8');
  const markerPath = join(runtimeRoot, '.legacy-layout-migration-v1');
  writeFileSync(markerPath, 'done\n', 'utf8');

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.skipped, true);
  assert.equal(result.legacyRootRemoved, true);
  assert.equal(existsSync(legacyRoot), false);
});

void test('migration cleanup keeps legacy root when dangling legacy config has no global target', () => {
  if (process.platform === 'win32') {
    return;
  }
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  symlinkSync(
    join(legacyRoot, 'missing-config-target'),
    join(legacyRoot, HARNESS_CONFIG_FILE_NAME),
  );

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.configCopied, false);
  assert.equal(result.legacyRootRemoved, false);
  assert.equal(existsSync(legacyRoot), true);
});

void test('migration cleanup keeps legacy root when dangling legacy secrets has no global target', () => {
  if (process.platform === 'win32') {
    return;
  }
  const workspace = createWorkspace();
  const env = envWithXdg(workspace);
  const legacyRoot = join(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  symlinkSync(join(legacyRoot, 'missing-secrets-target'), join(legacyRoot, 'secrets.env'));

  const result = migrateLegacyHarnessLayout(workspace, env);

  assert.equal(result.secretsCopied, false);
  assert.equal(result.legacyRootRemoved, false);
  assert.equal(existsSync(legacyRoot), true);
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
  assert.equal(result.legacyRootRemoved, false);
  assert.equal(existsSync(legacyRoot), true);
  assert.equal(existsSync(result.markerPath), true);
});

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'bun:test';
import {
  loadHarnessSecrets,
  parseHarnessSecretsText,
  resolveHarnessSecretsPath,
  upsertHarnessSecret,
} from '../src/config/secrets-core.ts';

function workspaceEnv(workspace: string): NodeJS.ProcessEnv {
  return {
    XDG_CONFIG_HOME: join(workspace, '.xdg'),
  };
}

void test('parseHarnessSecretsText reads comments, export prefixes, quotes, escapes, and empty values', () => {
  const parsed = parseHarnessSecretsText(`
    # comment
    export ANTHROPIC_API_KEY=from-file
    OPENAI_API_KEY = "line\\\\nwith\\\\ttabs"
    SINGLE_QUOTE = 'literal value'
    TRIMMED = value    # trailing comment
    HASH = value#hash
    UNKNOWN_ESCAPE = "prefix\\q"
    EMPTY=
  `);

  assert.deepEqual(parsed, {
    ANTHROPIC_API_KEY: 'from-file',
    OPENAI_API_KEY: 'line\\nwith\\ttabs',
    SINGLE_QUOTE: 'literal value',
    TRIMMED: 'value',
    HASH: 'value#hash',
    UNKNOWN_ESCAPE: 'prefix\\q',
    EMPTY: '',
  });
});

void test('parseHarnessSecretsText decodes supported double-quote escapes', () => {
  const parsed = parseHarnessSecretsText('ANTHROPIC_API_KEY="line\\nrow\\tcol\\rnext\\\\"');
  assert.equal(parsed.ANTHROPIC_API_KEY, 'line\nrow\tcol\rnext\\');
});

void test('parseHarnessSecretsText rejects malformed lines and invalid keys', () => {
  assert.throws(() => parseHarnessSecretsText('ANTHROPIC_API_KEY'), /expected KEY=VALUE/u);
  assert.throws(() => parseHarnessSecretsText('1BAD_KEY=value'), /invalid secret key/u);
});

void test('parseHarnessSecretsText rejects unterminated and trailing quoted payloads', () => {
  assert.throws(
    () => parseHarnessSecretsText('ANTHROPIC_API_KEY="unterminated'),
    /unterminated double-quoted value/u,
  );
  assert.throws(
    () => parseHarnessSecretsText("ANTHROPIC_API_KEY='unterminated"),
    /unterminated single-quoted value/u,
  );
  assert.throws(
    () => parseHarnessSecretsText('ANTHROPIC_API_KEY="value" trailing'),
    /unexpected trailing content/u,
  );
  assert.throws(
    () => parseHarnessSecretsText("ANTHROPIC_API_KEY='value' trailing"),
    /unexpected trailing content/u,
  );
  assert.throws(
    () => parseHarnessSecretsText('ANTHROPIC_API_KEY="value\\" # comment'),
    /unterminated double-quoted value/u,
  );
});

void test('resolveHarnessSecretsPath defaults to user-global config secrets path and supports explicit override', () => {
  const cwd = '/tmp/harness';
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: '/tmp/xdg-home',
  };
  assert.equal(resolveHarnessSecretsPath(cwd, undefined, env), '/tmp/xdg-home/harness/secrets.env');
  assert.equal(
    resolveHarnessSecretsPath(cwd, '.config/custom.env', env),
    resolve(cwd, '.config/custom.env'),
  );
  assert.equal(resolveHarnessSecretsPath(cwd, '   ', env), '/tmp/xdg-home/harness/secrets.env');
});

void test('loadHarnessSecrets returns unloaded result when file is missing', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-missing-'));
  const env = workspaceEnv(workspace);
  const loaded = loadHarnessSecrets({
    cwd: workspace,
    env,
  });
  assert.equal(loaded.loaded, false);
  assert.equal(loaded.filePath, resolveHarnessSecretsPath(workspace, undefined, env));
  assert.deepEqual(loaded.loadedKeys, []);
  assert.deepEqual(loaded.skippedKeys, []);
  assert.deepEqual(env, workspaceEnv(workspace));
});

void test('loadHarnessSecrets populates env and preserves existing values by default', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-load-'));
  const env: NodeJS.ProcessEnv = {
    ...workspaceEnv(workspace),
    ANTHROPIC_API_KEY: 'from-env',
  };
  const secretsPath = resolveHarnessSecretsPath(workspace, undefined, env);
  mkdirSync(dirname(secretsPath), { recursive: true });
  writeFileSync(
    secretsPath,
    ['ANTHROPIC_API_KEY=from-file', 'EXTRA_TOKEN=extra'].join('\n'),
    'utf8',
  );
  const loaded = loadHarnessSecrets({
    cwd: workspace,
    env,
  });

  assert.equal(loaded.loaded, true);
  assert.deepEqual(loaded.loadedKeys, ['EXTRA_TOKEN']);
  assert.deepEqual(loaded.skippedKeys, ['ANTHROPIC_API_KEY']);
  assert.equal(env.ANTHROPIC_API_KEY, 'from-env');
  assert.equal(env.EXTRA_TOKEN, 'extra');
});

void test('loadHarnessSecrets can override existing env values', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-override-'));
  const filePath = join(workspace, 'secrets.env');
  writeFileSync(filePath, 'ANTHROPIC_API_KEY=from-file', 'utf8');
  const env: NodeJS.ProcessEnv = {
    ANTHROPIC_API_KEY: 'from-env',
  };

  const loaded = loadHarnessSecrets({
    cwd: workspace,
    filePath: 'secrets.env',
    env,
    overrideExisting: true,
  });

  assert.equal(loaded.loaded, true);
  assert.deepEqual(loaded.loadedKeys, ['ANTHROPIC_API_KEY']);
  assert.deepEqual(loaded.skippedKeys, []);
  assert.equal(env.ANTHROPIC_API_KEY, 'from-file');
});

void test('loadHarnessSecrets can target process.env when env option is omitted', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-process-env-'));
  const filePath = join(workspace, 'secrets.env');
  const key = 'HARNESS_TEST_ANTHROPIC_PROCESS_ENV_KEY';
  const previous = process.env[key];
  writeFileSync(filePath, `${key}=loaded-from-file`, 'utf8');
  try {
    delete process.env[key];
    const loaded = loadHarnessSecrets({
      filePath,
    });
    assert.equal(loaded.loaded, true);
    assert.deepEqual(loaded.loadedKeys, [key]);
    assert.equal(process.env[key], 'loaded-from-file');
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

void test('upsertHarnessSecret creates the secrets file when missing', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-upsert-create-'));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspace,
  };
  const result = upsertHarnessSecret({
    cwd: workspace,
    env,
    key: 'OPENAI_API_KEY',
    value: 'openai-key',
  });
  const expectedPath = resolve(workspace, 'harness/secrets.env');
  assert.equal(result.filePath, expectedPath);
  assert.equal(result.createdFile, true);
  assert.equal(result.replacedExisting, false);
  assert.equal(readFileSync(expectedPath, 'utf8'), 'OPENAI_API_KEY=openai-key\n');
});

void test('upsertHarnessSecret replaces existing key entries and preserves unrelated lines', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-upsert-replace-'));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspace,
  };
  const filePath = resolve(workspace, 'harness/secrets.env');
  mkdirSync(resolve(workspace, 'harness'), { recursive: true });
  writeFileSync(
    filePath,
    [
      '# existing comments stay',
      'ANTHROPIC_API_KEY=old-key',
      'OPENAI_API_KEY=stale-key',
      'OPENAI_API_KEY=duplicate-stale-key',
      'EXTRA_TOKEN=keep-me',
      '',
    ].join('\n'),
    'utf8',
  );

  const result = upsertHarnessSecret({
    cwd: workspace,
    env,
    key: 'OPENAI_API_KEY',
    value: 'fresh key value',
  });

  const nextText = readFileSync(filePath, 'utf8');
  assert.equal(result.filePath, filePath);
  assert.equal(result.createdFile, false);
  assert.equal(result.replacedExisting, true);
  assert.equal(nextText.includes('# existing comments stay'), true);
  assert.equal(nextText.includes('EXTRA_TOKEN=keep-me'), true);
  assert.equal((nextText.match(/^OPENAI_API_KEY=/gmu) ?? []).length, 1);
  assert.equal(parseHarnessSecretsText(nextText).OPENAI_API_KEY, 'fresh key value');
});

void test('upsertHarnessSecret preserves malformed lines and encodes empty values', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-upsert-empty-'));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspace,
  };
  const filePath = resolve(workspace, 'harness/secrets.env');
  mkdirSync(resolve(workspace, 'harness'), { recursive: true });
  writeFileSync(filePath, ['INVALID LINE', 'OPENAI_API_KEY=stale', ''].join('\n'), 'utf8');

  const result = upsertHarnessSecret({
    cwd: workspace,
    env,
    key: 'OPENAI_API_KEY',
    value: '',
  });

  assert.equal(result.replacedExisting, true);
  const nextText = readFileSync(filePath, 'utf8');
  assert.equal(nextText.includes('INVALID LINE'), true);
  assert.equal(nextText.includes('OPENAI_API_KEY=""'), true);
});

void test('upsertHarnessSecret rejects invalid keys', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-upsert-invalid-key-'));
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspace,
  };
  assert.throws(
    () =>
      upsertHarnessSecret({
        cwd: workspace,
        env,
        key: '1BAD_KEY',
        value: 'secret',
      }),
    /invalid secret key/u,
  );
});

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import {
  HARNESS_SECRETS_FILE_PATH,
  loadHarnessSecrets,
  parseHarnessSecretsText,
  resolveHarnessSecretsPath,
} from '../src/config/secrets-core.ts';

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

void test('resolveHarnessSecretsPath defaults to .harness/secrets.env and supports explicit override', () => {
  const cwd = '/tmp/harness';
  assert.equal(resolveHarnessSecretsPath(cwd), resolve(cwd, HARNESS_SECRETS_FILE_PATH));
  assert.equal(
    resolveHarnessSecretsPath(cwd, '.config/custom.env'),
    resolve(cwd, '.config/custom.env'),
  );
  assert.equal(resolveHarnessSecretsPath(cwd, '   '), resolve(cwd, HARNESS_SECRETS_FILE_PATH));
});

void test('loadHarnessSecrets returns unloaded result when file is missing', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-missing-'));
  const env: NodeJS.ProcessEnv = {};
  const loaded = loadHarnessSecrets({
    cwd: workspace,
    env,
  });
  assert.equal(loaded.loaded, false);
  assert.equal(loaded.filePath, resolve(workspace, HARNESS_SECRETS_FILE_PATH));
  assert.deepEqual(loaded.loadedKeys, []);
  assert.deepEqual(loaded.skippedKeys, []);
  assert.deepEqual(env, {});
});

void test('loadHarnessSecrets populates env and preserves existing values by default', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-secrets-load-'));
  const secretsDir = join(workspace, '.harness');
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(
    join(secretsDir, 'secrets.env'),
    ['ANTHROPIC_API_KEY=from-file', 'EXTRA_TOKEN=extra'].join('\n'),
    'utf8',
  );
  const env: NodeJS.ProcessEnv = {
    ANTHROPIC_API_KEY: 'from-env',
  };
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

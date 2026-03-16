import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { __integrationNimHaikuInternals } from '../../../scripts/integration-nim-haiku.ts';

void test('nim haiku integration parseArgs keeps explicit model and baseUrl overrides', () => {
  const parsed = __integrationNimHaikuInternals.parseArgs([
    '--secrets-file',
    '/tmp/secrets.env',
    '--model',
    'claude-3-haiku-20240307',
    '--base-url',
    'https://example.test',
  ]);

  assert.deepEqual(parsed, {
    secretsFile: '/tmp/secrets.env',
    models: ['claude-3-haiku-20240307'],
    baseUrl: 'https://example.test',
  });
});

void test('nim haiku integration parseArgs defaults to bundled model candidates', () => {
  const parsed = __integrationNimHaikuInternals.parseArgs([]);

  assert.deepEqual(parsed.models, [
    'claude-3-5-haiku-latest',
    'claude-3-5-haiku-20241022',
    'claude-3-haiku-20240307',
  ]);
  assert.equal(typeof parsed.secretsFile, 'string');
  assert.equal(parsed.secretsFile.length > 0, true);
  assert.equal(parsed.baseUrl, undefined);
});

void test('nim haiku integration readString trims valid fields', () => {
  const value = __integrationNimHaikuInternals.readString({ threadId: '  thread-1  ' }, 'threadId');

  assert.equal(value, 'thread-1');
});

void test('nim haiku integration readString rejects blank and non-record values', () => {
  assert.equal(__integrationNimHaikuInternals.readString({ threadId: '   ' }, 'threadId'), null);
  assert.equal(__integrationNimHaikuInternals.readString(null, 'threadId'), null);
  assert.equal(__integrationNimHaikuInternals.readString(['thread-1'], 'threadId'), null);
});

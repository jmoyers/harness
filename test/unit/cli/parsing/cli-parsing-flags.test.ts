import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parsePortFlag, parsePositiveIntFlag, readCliValue } from '../../../../src/cli/parsing/flags.ts';

test('readCliValue returns next token and throws when missing', () => {
  assert.equal(readCliValue(['--port', '7777'], 0, '--port'), '7777');
  assert.throws(() => readCliValue(['--port'], 0, '--port'), /missing value for --port/u);
});

test('parsePortFlag accepts valid ports and rejects invalid values', () => {
  assert.equal(parsePortFlag('1', '--port'), 1);
  assert.equal(parsePortFlag('65535', '--port'), 65535);
  assert.throws(() => parsePortFlag('0', '--port'), /invalid --port value: 0/u);
  assert.throws(() => parsePortFlag('-1', '--port'), /invalid --port value: -1/u);
  assert.throws(() => parsePortFlag('65536', '--port'), /invalid --port value: 65536/u);
  assert.throws(() => parsePortFlag('abc', '--port'), /invalid --port value: abc/u);
});

test('parsePositiveIntFlag accepts positive integers and rejects non-positive values', () => {
  assert.equal(parsePositiveIntFlag('1', '--timeout-ms'), 1);
  assert.equal(parsePositiveIntFlag('42', '--timeout-ms'), 42);
  assert.throws(() => parsePositiveIntFlag('0', '--timeout-ms'), /invalid --timeout-ms value: 0/u);
  assert.throws(
    () => parsePositiveIntFlag('-2', '--timeout-ms'),
    /invalid --timeout-ms value: -2/u,
  );
  assert.throws(
    () => parsePositiveIntFlag('not-a-number', '--timeout-ms'),
    /invalid --timeout-ms value: not-a-number/u,
  );
});

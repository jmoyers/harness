import assert from 'node:assert/strict';
import { test } from 'bun:test';
import fc from 'fast-check';
import { normalizeGatewayPort } from '../../../src/cli/gateway-record.ts';
import { parseHarnessSecretsText } from '../../../src/config/secrets-core.ts';
import { extractOscColorReplies } from '../../../src/mux/live-mux/palette-parsing.ts';
import { parseMuxArgs } from '../../../src/mux/live-mux/args.ts';
import { parseCommitCount } from '../../../src/mux/live-mux/git-parsing.ts';
import { parsePositiveInt } from '../../../src/mux/live-mux/startup-utils.ts';
import { parseOptionalAnsiPaletteIndexedHex } from '../../../src/recording/terminal-recording.ts';

function encodeDoubleQuoted(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')}"`;
}

const nonNumericSuffixArb = fc
  .string({ minLength: 1, maxLength: 6 })
  .filter((suffix) => suffix.trim().length > 0 && !/^\d+$/u.test(suffix.trim()));

void test('property: parseHarnessSecretsText decodes escaped quotes and slashes in double-quoted values', () => {
  fc.assert(
    fc.property(fc.string(), (raw) => {
      const text = `KEY=${encodeDoubleQuoted(raw)}`;
      const parsed = parseHarnessSecretsText(text);
      assert.equal(parsed.KEY, raw);
    }),
    {
      numRuns: 300,
      seed: 1337,
    },
  );
});

void test('property: normalizeGatewayPort rejects strings that are not strictly decimal integers', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 65535 }), nonNumericSuffixArb, (port, suffix) => {
      const fallback = 4242;
      const parsed = normalizeGatewayPort(`${String(port)}${suffix}`, fallback);
      assert.equal(parsed, fallback);
    }),
    {
      numRuns: 300,
      seed: 1337,
    },
  );
});

void test('property: extractOscColorReplies ignores palette indices with non-digit characters', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 255 }), nonNumericSuffixArb, (index, suffix) => {
      const buffer = `\u001b]4;${String(index)}${suffix};rgb:ff/ff/ff\u0007`;
      const parsed = extractOscColorReplies(buffer);
      assert.deepEqual(parsed.indexedHexByCode, {});
    }),
    {
      numRuns: 300,
      seed: 1337,
    },
  );
});

void test('property: parsePositiveInt rejects strings with trailing non-digit characters', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 10_000 }), nonNumericSuffixArb, (n, suffix) => {
      const fallback = -1;
      const result = parsePositiveInt(`${String(n)}${suffix}`, fallback);
      assert.equal(result, fallback);
    }),
    { numRuns: 300, seed: 1337 },
  );
});

void test('property: parseMuxArgs rejects port strings with trailing non-digit characters', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 65535 }), nonNumericSuffixArb, (port, suffix) => {
      assert.throws(() => {
        parseMuxArgs(
          [
            '--harness-server-host',
            'localhost',
            '--harness-server-port',
            `${String(port)}${suffix}`,
          ],
          { cwd: '/tmp', env: {} },
        );
      });
    }),
    { numRuns: 300, seed: 1337 },
  );
});

void test('property: parseCommitCount rejects strings with trailing non-digit characters', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 100_000 }), nonNumericSuffixArb, (n, suffix) => {
      const result = parseCommitCount(`${String(n)}${suffix}`);
      assert.equal(result, null);
    }),
    { numRuns: 300, seed: 1337 },
  );
});

void test('property: parseOptionalAnsiPaletteIndexedHex rejects keys with trailing non-digit characters', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 255 }), nonNumericSuffixArb, (index, suffix) => {
      const result = parseOptionalAnsiPaletteIndexedHex({
        [`${String(index)}${suffix}`]: '#ff00ff',
      });
      assert.equal(result, undefined);
    }),
    { numRuns: 300, seed: 1337 },
  );
});

import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createPromptRecord,
  findPromptText,
  normalizeEventToken,
  readTrimmedString,
} from '../../../src/control-plane/prompt/agent-prompt-extractor.ts';

void test('prompt extractor helpers normalize tokens and trim strings', () => {
  assert.equal(readTrimmedString('  hello  '), 'hello');
  assert.equal(readTrimmedString('   '), null);
  assert.equal(readTrimmedString(42), null);
  assert.equal(normalizeEventToken('Before Submit Prompt!'), 'beforesubmitprompt');
});

void test('prompt extractor helper findPromptText handles root strings and array traversal', () => {
  assert.equal(
    findPromptText('  root string prompt  ', {
      keys: ['prompt'],
    }),
    'root string prompt',
  );
  assert.equal(
    findPromptText('   ', {
      keys: ['prompt'],
    }),
    null,
  );
  assert.equal(
    findPromptText(
      [
        {
          prompt: 'prompt from array',
        },
      ],
      {
        keys: ['prompt'],
      },
    ),
    'prompt from array',
  );
  assert.equal(
    findPromptText(
      {
        other: {
          key: 'not-used',
        },
      },
      {
        keys: ['prompt'],
      },
    ),
    null,
  );
});

void test('prompt extractor helper createPromptRecord hashes mixed payload shapes deterministically', () => {
  const deepPayload = {
    prompt: null,
    values: [
      1,
      true,
      null,
      { nested: { depth1: { depth2: { depth3: { depth4: { depth5: 5 } } } } } },
    ],
    odd: BigInt(9),
  } as unknown as Record<string, unknown>;
  const first = createPromptRecord({
    text: null,
    confidence: 'low',
    captureSource: 'hook-notify',
    providerEventName: 'cursor.beforesubmitprompt',
    payload: deepPayload,
    observedAt: '2026-02-19T00:00:00.000Z',
  });
  const second = createPromptRecord({
    text: null,
    confidence: 'low',
    captureSource: 'hook-notify',
    providerEventName: 'cursor.beforesubmitprompt',
    payload: deepPayload,
    observedAt: '2026-02-19T00:00:00.000Z',
  });
  assert.equal(first.hash, second.hash);
  assert.equal(first.providerPayloadKeys.includes('odd'), true);
  assert.equal(first.providerPayloadKeys.includes('values'), true);
});

import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { StreamSessionPromptRecord } from '../src/control-plane/stream-protocol.ts';
import {
  appendThreadTitlePromptHistory,
  createAnthropicThreadTitleNamer,
  fallbackThreadTitleFromPromptHistory,
  normalizeThreadTitleCandidate,
  readThreadTitlePromptHistory,
  sanitizePromptForThreadTitle,
} from '../src/control-plane/prompt/thread-title-namer.ts';
import { createAnthropicResponse } from './support/harness-ai.ts';

function textResponse(text: string): Response {
  return createAnthropicResponse([
    {
      type: 'message_start',
      message: {
        id: 'msg-thread-title',
        model: 'claude-3-5-haiku-latest',
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 12, output_tokens: 4 },
    },
    { type: 'message_stop' },
  ]);
}

function notFoundResponse(modelId: string): Response {
  return new Response(
    JSON.stringify({
      type: 'error',
      error: {
        type: 'not_found_error',
        message: `model: ${modelId}`,
      },
    }),
    {
      status: 404,
      headers: {
        'content-type': 'application/json',
      },
    },
  );
}

function promptRecord(
  text: string | null,
  observedAt: string,
  hash: string,
): StreamSessionPromptRecord {
  return {
    text,
    hash,
    confidence: 'high',
    captureSource: 'hook-notify',
    providerEventName: 'claude.userpromptsubmit',
    providerPayloadKeys: ['prompt'],
    observedAt,
  };
}

void test('thread title namer sanitizes image-heavy prompts and normalizes candidate titles', () => {
  const imageBase64 = 'A'.repeat(220);
  const sanitized = sanitizePromptForThreadTitle(
    [
      'Refactor parser lifecycle',
      '![diagram](https://example.com/diagram.png)',
      `<img src="https://example.com/other.png" />`,
      `data:image/png;base64,${imageBase64}`,
      imageBase64,
      'Add an integration test.',
    ].join('\n'),
  );
  assert.notEqual(sanitized, null);
  assert.equal(sanitized?.includes('diagram'), false);
  assert.equal(sanitized?.includes('<img'), false);
  assert.equal(sanitized?.includes('data:image'), false);
  assert.equal(sanitized?.includes('Refactor parser lifecycle'), true);
  assert.equal(sanitized?.includes('Add an integration test.'), true);

  assert.equal(normalizeThreadTitleCandidate('Title: fresh prompt focus'), 'fresh prompt');
  assert.equal(normalizeThreadTitleCandidate('one'), null);
  assert.equal(normalizeThreadTitleCandidate('   '), null);
  assert.equal(normalizeThreadTitleCandidate('title title'), null);
});

void test('thread title prompt history append/read preserves sanitized prompt list', () => {
  const first = appendThreadTitlePromptHistory(
    {},
    promptRecord('Investigate parser drift', '2026-02-19T00:00:00.000Z', 'hash-1'),
  );
  assert.equal(first.added, true);
  assert.equal(first.promptHistory.length, 1);
  assert.equal(first.promptHistory[0]?.text, 'Investigate parser drift');

  const second = appendThreadTitlePromptHistory(
    first.nextAdapterState,
    promptRecord('![image](https://example.com/a.png)', '2026-02-19T00:00:01.000Z', 'hash-2'),
  );
  assert.equal(second.added, false);
  assert.equal(second.promptHistory.length, 1);

  const restored = readThreadTitlePromptHistory(first.nextAdapterState);
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.hash, 'hash-1');

  const malformed = readThreadTitlePromptHistory({
    harnessThreadTitle: {
      prompts: 'invalid',
    },
  });
  assert.equal(malformed.length, 0);

  const malformedEntry = readThreadTitlePromptHistory({
    harnessThreadTitle: {
      prompts: [{ text: 123, observedAt: '2026-02-19T00:00:00.000Z', hash: 'h' }],
    },
  });
  assert.equal(malformedEntry.length, 0);
});

void test('anthropic thread title namer sends full prompt history and parses two-word response', async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const namer = createAnthropicThreadTitleNamer({
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      const body = init?.body;
      const payload =
        typeof body === 'string' ? JSON.parse(body) : JSON.parse(String(body ?? '{}'));
      requestBodies.push(payload as Record<string, unknown>);
      return textResponse('Title: fresh prompt focus');
    },
  });

  const title = await namer.suggest({
    conversationId: 'conversation-thread-name',
    agentType: 'claude',
    currentTitle: 'seed title',
    promptHistory: [
      {
        text: 'Investigate parser regressions',
        observedAt: '2026-02-19T00:00:00.000Z',
        hash: 'h1',
      },
      {
        text: 'Add integration test coverage',
        observedAt: '2026-02-19T00:00:01.000Z',
        hash: 'h2',
      },
    ],
  });
  assert.equal(title, 'fresh prompt');
  assert.equal(requestBodies.length, 1);

  const messages = requestBodies[0]?.['messages'];
  assert.equal(Array.isArray(messages), true);
  const firstMessage = (messages as unknown[])[0] as Record<string, unknown>;
  const content = firstMessage['content'];
  assert.equal(Array.isArray(content), true);
  const firstPart = (content as unknown[])[0] as Record<string, unknown>;
  const promptText = String(firstPart['text'] ?? '');
  assert.equal(promptText.includes('1. Investigate parser regressions'), true);
  assert.equal(promptText.includes('2. Add integration test coverage'), true);
});

void test('thread title fallback derives two words from latest prompts', () => {
  const fallback = fallbackThreadTitleFromPromptHistory([
    {
      text: 'Fix render trace hangs on resize path',
      observedAt: '2026-02-19T00:00:00.000Z',
      hash: 'a',
    },
    {
      text: 'Stabilize startup quiet timer behavior',
      observedAt: '2026-02-19T00:00:01.000Z',
      hash: 'b',
    },
  ]);
  assert.equal(fallback.split(/\s+/u).length, 2);
});

void test('thread title fallback and sanitization cover truncation and fill-word fallback', () => {
  const truncated = sanitizePromptForThreadTitle('word-1 '.repeat(400));
  assert.notEqual(truncated, null);
  assert.equal(truncated?.endsWith('...'), true);

  const fallback = fallbackThreadTitleFromPromptHistory([
    {
      text: 'a an the to',
      observedAt: '2026-02-19T00:00:00.000Z',
      hash: 'no-words',
    },
  ]);
  assert.equal(fallback, 'current thread');
});

void test('anthropic thread title namer returns null for empty prompt history without requesting model', async () => {
  let called = false;
  const namer = createAnthropicThreadTitleNamer({
    apiKey: 'test-key',
    fetch: async () => {
      called = true;
      return textResponse('ignored response');
    },
  });

  const title = await namer.suggest({
    conversationId: 'conversation-empty-history',
    agentType: 'codex',
    currentTitle: 'seed title',
    promptHistory: [],
  });
  assert.equal(title, null);
  assert.equal(called, false);
});

void test('anthropic thread title namer retries with fallback models when preferred model fails', async () => {
  const requestedModels: string[] = [];
  const namer = createAnthropicThreadTitleNamer({
    apiKey: 'test-key',
    modelId: 'claude-3-5-haiku-latest',
    fetch: async (_input, init) => {
      const body = init?.body;
      const payload =
        typeof body === 'string' ? JSON.parse(body) : JSON.parse(String(body ?? '{}'));
      const modelId = String(payload['model'] ?? '');
      requestedModels.push(modelId);
      if (modelId === 'claude-3-5-haiku-latest') {
        return notFoundResponse(modelId);
      }
      return textResponse('fresh prompt focus');
    },
  });

  const title = await namer.suggest({
    conversationId: 'conversation-retry-model',
    agentType: 'codex',
    currentTitle: 'seed title',
    promptHistory: [
      {
        text: 'Investigate parser regressions',
        observedAt: '2026-02-19T00:00:00.000Z',
        hash: 'h1',
      },
      {
        text: 'Add integration test coverage',
        observedAt: '2026-02-19T00:00:01.000Z',
        hash: 'h2',
      },
    ],
  });

  assert.equal(title, 'fresh prompt');
  assert.deepEqual(requestedModels.slice(0, 2), [
    'claude-3-5-haiku-latest',
    'claude-haiku-4-5-20251001',
  ]);
});

void test('anthropic thread title namer falls back when all model attempts finish with errors', async () => {
  const requestedModels: string[] = [];
  const namer = createAnthropicThreadTitleNamer({
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      const body = init?.body;
      const payload =
        typeof body === 'string' ? JSON.parse(body) : JSON.parse(String(body ?? '{}'));
      requestedModels.push(String(payload['model'] ?? ''));
      return createAnthropicResponse([
        {
          type: 'error',
          error: {
            type: 'api_error',
            message: 'temporary',
          },
        },
      ]);
    },
  });

  const title = await namer.suggest({
    conversationId: 'conversation-all-errors',
    agentType: 'claude',
    currentTitle: 'seed title',
    promptHistory: [
      {
        text: 'Investigate parser regressions',
        observedAt: '2026-02-19T00:00:00.000Z',
        hash: 'h1',
      },
    ],
  });

  assert.equal(title, 'investigate parser');
  assert.equal(requestedModels.length >= 2, true);
});

import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  anthropic,
  anthropicTools,
  createAnthropic,
} from '../../../packages/harness-ai/src/anthropic-provider.ts';

void test('createAnthropic returns model factory with normalized base url', () => {
  const provider = createAnthropic({
    apiKey: 'key-1',
    baseUrl: 'https://api.example.com/v1/',
    headers: {
      'x-custom': 'a',
    },
  });

  const model = provider('claude-sonnet');
  assert.equal(model.provider, 'harness.anthropic');
  assert.equal(model.modelId, 'claude-sonnet');
  assert.equal(model.baseUrl, 'https://api.example.com/v1');
  assert.deepEqual(model.headers, {
    'x-custom': 'a',
  });
  assert.equal(model.apiKey, 'key-1');
  assert.equal(typeof model.fetch, 'function');
});

void test('createAnthropic rejects empty model id', () => {
  const provider = createAnthropic({ apiKey: 'x' });
  assert.throws(() => provider('   '), /modelId is required/);
});

void test('tool helpers build provider tool definitions', () => {
  assert.deepEqual(anthropic.tools.webSearch_20250305({ max_uses: 1 }), {
    type: 'provider',
    provider: 'anthropic',
    anthropicType: 'web_search_20250305',
    name: 'web_search',
    settings: { max_uses: 1 },
  });

  assert.deepEqual(anthropicTools.webFetch_20250910(), {
    type: 'provider',
    provider: 'anthropic',
    anthropicType: 'web_fetch_20250910',
    name: 'web_fetch',
  });

  assert.deepEqual(anthropicTools.toolSearchRegex_20251119(), {
    type: 'provider',
    provider: 'anthropic',
    anthropicType: 'tool_search_tool_regex_20251119',
    name: 'tool_search',
  });

  assert.deepEqual(anthropicTools.toolSearchBm25_20251119(), {
    type: 'provider',
    provider: 'anthropic',
    anthropicType: 'tool_search_tool_bm25_20251119',
    name: 'tool_search',
  });
});

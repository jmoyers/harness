import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  mapAnthropicStopReason,
  parseAnthropicStreamChunk,
} from '../packages/harness-ai/src/anthropic-protocol.ts';

void test('parses message_start and message_delta chunks', () => {
  const messageStart = parseAnthropicStreamChunk({
    type: 'message_start',
    message: {
      id: 'm1',
      model: 'claude',
      usage: {
        input_tokens: 1,
        output_tokens: 2,
      },
      stop_reason: 'tool_use',
    },
  });

  assert.deepEqual(messageStart, {
    type: 'message_start',
    message: {
      id: 'm1',
      model: 'claude',
      usage: {
        input_tokens: 1,
        output_tokens: 2,
      },
      stop_reason: 'tool_use',
    },
  });

  const messageDelta = parseAnthropicStreamChunk({
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn',
      stop_sequence: '\n',
    },
    usage: {
      input_tokens: 3,
      output_tokens: 4,
      cache_read_input_tokens: 1,
    },
  });

  assert.deepEqual(messageDelta, {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn',
      stop_sequence: '\n',
    },
    usage: {
      input_tokens: 3,
      output_tokens: 4,
      cache_read_input_tokens: 1,
    },
  });
});

void test('parses content block chunks for text/thinking/tool_use', () => {
  const text = parseAnthropicStreamChunk({
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'text',
      text: 'hello',
    },
  });
  assert.deepEqual(text, {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'text',
      text: 'hello',
    },
  });

  const thinking = parseAnthropicStreamChunk({
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'thinking',
      thinking: 'hmm',
    },
  });
  assert.deepEqual(thinking, {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'thinking',
      thinking: 'hmm',
    },
  });

  const toolUse = parseAnthropicStreamChunk({
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'tool_use',
      id: 'tool-1',
      name: 'lookup',
      input: {
        q: 'a',
      },
    },
  });
  assert.deepEqual(toolUse, {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'tool_use',
      id: 'tool-1',
      name: 'lookup',
      input: {
        q: 'a',
      },
    },
  });
});

void test('parses web_search and web_fetch result blocks', () => {
  const webSearch = parseAnthropicStreamChunk({
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'tool-1',
      content: [
        {
          type: 'web_search_result',
          url: 'https://example.com',
          title: 'Example',
          page_age: 'today',
        },
      ],
    },
  });
  assert.deepEqual(webSearch, {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'tool-1',
      content: [
        {
          type: 'web_search_result',
          url: 'https://example.com',
          title: 'Example',
          page_age: 'today',
        },
      ],
    },
  });

  const webFetch = parseAnthropicStreamChunk({
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_fetch_tool_result',
      tool_use_id: 'tool-2',
      content: {
        type: 'web_fetch_result',
        url: 'https://example.com/doc',
        content: {
          type: 'document',
          title: 'Doc',
          source: {
            type: 'base64',
            media_type: 'text/plain',
            data: 'aGVsbG8=',
          },
        },
      },
    },
  });

  assert.deepEqual(webFetch, {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_fetch_tool_result',
      tool_use_id: 'tool-2',
      content: {
        type: 'web_fetch_result',
        url: 'https://example.com/doc',
        content: {
          type: 'document',
          title: 'Doc',
          source: {
            type: 'base64',
            media_type: 'text/plain',
            data: 'aGVsbG8=',
          },
        },
      },
    },
  });
});

void test('parses content_block_delta variants', () => {
  const text = parseAnthropicStreamChunk({
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'text_delta',
      text: 'a',
    },
  });

  const thinking = parseAnthropicStreamChunk({
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'thinking_delta',
      thinking: 'b',
    },
  });

  const signature = parseAnthropicStreamChunk({
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'signature_delta',
      signature: 'sig',
    },
  });

  const inputDelta = parseAnthropicStreamChunk({
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json: '{"x":',
    },
  });

  assert.equal(text?.type, 'content_block_delta');
  assert.equal(thinking?.type, 'content_block_delta');
  assert.equal(signature?.type, 'content_block_delta');
  assert.equal(inputDelta?.type, 'content_block_delta');
});

void test('parses content_block_stop, message_stop, error, and ping', () => {
  assert.deepEqual(parseAnthropicStreamChunk({ type: 'content_block_stop', index: 5 }), {
    type: 'content_block_stop',
    index: 5,
  });
  assert.deepEqual(parseAnthropicStreamChunk({ type: 'message_stop' }), { type: 'message_stop' });
  assert.deepEqual(parseAnthropicStreamChunk({ type: 'ping' }), { type: 'ping' });
  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'error',
      error: {
        message: 'oops',
      },
    }),
    {
      type: 'error',
      error: {
        message: 'oops',
      },
    },
  );
});

void test('returns null on invalid payload shapes', () => {
  assert.equal(parseAnthropicStreamChunk(null), null);
  assert.equal(parseAnthropicStreamChunk({}), null);
  assert.equal(parseAnthropicStreamChunk({ type: 'content_block_start', index: 'nope' }), null);
});

void test('maps anthropic stop reasons', () => {
  assert.equal(mapAnthropicStopReason('end_turn'), 'stop');
  assert.equal(mapAnthropicStopReason('max_tokens'), 'length');
  assert.equal(mapAnthropicStopReason('tool_use'), 'tool-calls');
  assert.equal(mapAnthropicStopReason('stop_sequence'), 'stop');
  assert.equal(mapAnthropicStopReason('other'), 'other');
  assert.equal(mapAnthropicStopReason(undefined), 'other');
});

void test('returns null for malformed anthropic chunk sub-shapes', () => {
  assert.equal(
    parseAnthropicStreamChunk({
      type: 'message_start',
      message: [],
    }),
    null,
  );

  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'id-only',
      },
    }),
    null,
  );

  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_search_tool_result',
        content: {
          type: 'web_search_error',
        },
      },
    }),
    null,
  );

  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'tool',
        content: {
          error_code: 'bad',
        },
      },
    }),
    null,
  );

  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'tool',
        content: [
          {
            type: 'web',
          },
        ],
      },
    }),
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'tool',
        content: [],
      },
    },
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_fetch_tool_result',
        tool_use_id: 'tool',
        content: {
          type: 'web_fetch_result',
          url: 'https://example.com',
          content: {
            type: 'document',
          },
        },
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'text_delta',
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'thinking_delta',
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'signature_delta',
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'input_json_delta',
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'unknown',
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_stop',
      index: 'bad',
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'error',
      error: 'bad',
    }),
    null,
  );
});

void test('covers anthropic parser edge branches for malformed nested content', () => {
  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'message_delta',
      usage: 'bad',
    }),
    {
      type: 'message_delta',
    },
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {},
    }),
    null,
  );

  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'tool',
        content: ['bad-item'],
      },
    }),
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'tool',
        content: [],
      },
    },
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'tool',
        content: 'bad-content',
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_fetch_tool_result',
        content: {
          type: 'web_fetch_result',
          url: 'https://example.com',
          content: {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'text/plain',
              data: 'aGVsbG8=',
            },
          },
        },
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_fetch_tool_result',
        tool_use_id: 'tool',
        content: {},
      },
    }),
    null,
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_fetch_tool_result',
        tool_use_id: 'tool',
        content: {
          type: 'web_fetch_result',
          url: 'https://example.com',
          content: {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'text/plain',
            },
          },
        },
      },
    }),
    null,
  );

  assert.deepEqual(
    parseAnthropicStreamChunk({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_fetch_tool_result',
        tool_use_id: 'tool',
        content: {
          type: 'web_fetch_error',
          error_code: 'fetch_failed',
        },
      },
    }),
    {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'web_fetch_tool_result',
        tool_use_id: 'tool',
        content: {
          type: 'web_fetch_error',
          error_code: 'fetch_failed',
        },
      },
    },
  );

  assert.equal(
    parseAnthropicStreamChunk({
      type: 'content_block_delta',
      index: null,
      delta: {
        type: 'text_delta',
        text: 'x',
      },
    }),
    null,
  );
});

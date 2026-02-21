import type { FinishReason } from './types.ts';

export interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

interface AnthropicToolUseContentBlock {
  readonly type: 'tool_use' | 'server_tool_use';
  readonly id: string;
  readonly name: string;
  readonly input?: Record<string, unknown>;
}

interface AnthropicTextContentBlock {
  readonly type: 'text';
  readonly text?: string;
}

interface AnthropicThinkingContentBlock {
  readonly type: 'thinking' | 'redacted_thinking';
  readonly thinking?: string;
  readonly data?: string;
}

interface AnthropicWebSearchResultContentBlock {
  readonly type: 'web_search_tool_result';
  readonly tool_use_id: string;
  readonly content:
    | Array<{
        readonly type: string;
        readonly url: string;
        readonly title?: string;
        readonly page_age?: string;
        readonly encrypted_content?: string;
      }>
    | {
        readonly type: string;
        readonly error_code?: string;
      };
}

interface AnthropicWebFetchResultContentBlock {
  readonly type: 'web_fetch_tool_result';
  readonly tool_use_id: string;
  readonly content:
    | {
        readonly type: 'web_fetch_result';
        readonly url: string;
        readonly retrieved_at?: string;
        readonly content: {
          readonly type: string;
          readonly title?: string;
          readonly source: {
            readonly type: string;
            readonly media_type: string;
            readonly data: string;
          };
          readonly citations?: unknown[];
        };
      }
    | {
        readonly type: Exclude<string, 'web_fetch_result'>;
        readonly error_code?: string;
      };
}

export type AnthropicContentBlock =
  | AnthropicToolUseContentBlock
  | AnthropicTextContentBlock
  | AnthropicThinkingContentBlock
  | AnthropicWebSearchResultContentBlock
  | AnthropicWebFetchResultContentBlock;

interface AnthropicMessageStartChunk {
  readonly type: 'message_start';
  readonly message: {
    readonly id?: string;
    readonly model?: string;
    readonly usage?: AnthropicUsage;
    readonly stop_reason?: string | null;
    readonly content?: AnthropicContentBlock[];
  };
}

interface AnthropicMessageDeltaChunk {
  readonly type: 'message_delta';
  readonly usage?: AnthropicUsage;
  readonly delta?: {
    readonly stop_reason?: string | null;
    readonly stop_sequence?: string | null;
  };
}

interface AnthropicMessageStopChunk {
  readonly type: 'message_stop';
}

interface AnthropicContentBlockStartChunk {
  readonly type: 'content_block_start';
  readonly index: number;
  readonly content_block: AnthropicContentBlock;
}

interface AnthropicContentBlockDeltaChunk {
  readonly type: 'content_block_delta';
  readonly index: number;
  readonly delta:
    | {
        readonly type: 'text_delta';
        readonly text: string;
      }
    | {
        readonly type: 'thinking_delta';
        readonly thinking: string;
      }
    | {
        readonly type: 'signature_delta';
        readonly signature: string;
      }
    | {
        readonly type: 'input_json_delta';
        readonly partial_json: string;
      };
}

interface AnthropicContentBlockStopChunk {
  readonly type: 'content_block_stop';
  readonly index: number;
}

interface AnthropicErrorChunk {
  readonly type: 'error';
  readonly error: Record<string, unknown>;
}

interface AnthropicPingChunk {
  readonly type: 'ping';
}

export type AnthropicStreamChunk =
  | AnthropicMessageStartChunk
  | AnthropicMessageDeltaChunk
  | AnthropicMessageStopChunk
  | AnthropicContentBlockStartChunk
  | AnthropicContentBlockDeltaChunk
  | AnthropicContentBlockStopChunk
  | AnthropicErrorChunk
  | AnthropicPingChunk;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStringOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  const parsed = asString(value);
  return parsed === null ? undefined : parsed;
}

function parseUsage(value: unknown): AnthropicUsage | undefined {
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }

  const usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } = {};

  const inputTokens = asNumber(record['input_tokens']);
  if (inputTokens !== null) {
    usage.input_tokens = inputTokens;
  }

  const outputTokens = asNumber(record['output_tokens']);
  if (outputTokens !== null) {
    usage.output_tokens = outputTokens;
  }

  const cacheReadInputTokens = asNumber(record['cache_read_input_tokens']);
  if (cacheReadInputTokens !== null) {
    usage.cache_read_input_tokens = cacheReadInputTokens;
  }

  const cacheCreationInputTokens = asNumber(record['cache_creation_input_tokens']);
  if (cacheCreationInputTokens !== null) {
    usage.cache_creation_input_tokens = cacheCreationInputTokens;
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function parseContentBlock(value: unknown): AnthropicContentBlock | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const type = asString(record['type']);
  if (type === null) {
    return null;
  }

  if (type === 'text') {
    const text = asString(record['text']);
    return text === null ? { type } : { type, text };
  }

  if (type === 'thinking' || type === 'redacted_thinking') {
    const thinking = asString(record['thinking']);
    const data = asString(record['data']);
    return {
      type,
      ...(thinking !== null ? { thinking } : {}),
      ...(data !== null ? { data } : {}),
    };
  }

  if (type === 'tool_use' || type === 'server_tool_use') {
    const id = asString(record['id']);
    const name = asString(record['name']);
    if (id === null || name === null) {
      return null;
    }

    const inputRecord = asRecord(record['input']);
    return inputRecord === null ? { type, id, name } : { type, id, name, input: inputRecord };
  }

  if (type === 'web_search_tool_result') {
    const toolUseId = asString(record['tool_use_id']);
    if (toolUseId === null) {
      return null;
    }

    const content = record['content'];
    if (Array.isArray(content)) {
      const parsedItems = content
        .map((item) => {
          const itemRecord = asRecord(item);
          if (itemRecord === null) {
            return null;
          }

          const itemType = asString(itemRecord['type']);
          const url = asString(itemRecord['url']);
          if (itemType === null || url === null) {
            return null;
          }

          const title = asString(itemRecord['title']);
          const pageAge = asString(itemRecord['page_age']);
          const encryptedContent = asString(itemRecord['encrypted_content']);
          return {
            type: itemType,
            url,
            ...(title !== null ? { title } : {}),
            ...(pageAge !== null ? { page_age: pageAge } : {}),
            ...(encryptedContent !== null ? { encrypted_content: encryptedContent } : {}),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      return {
        type,
        tool_use_id: toolUseId,
        content: parsedItems,
      };
    }

    const contentRecord = asRecord(content);
    if (contentRecord === null) {
      return null;
    }

    const contentType = asString(contentRecord['type']);
    if (contentType === null) {
      return null;
    }

    const errorCode = asString(contentRecord['error_code']);
    return {
      type,
      tool_use_id: toolUseId,
      content: {
        type: contentType,
        ...(errorCode !== null ? { error_code: errorCode } : {}),
      },
    };
  }

  if (type !== 'web_fetch_tool_result') {
    return null;
  }

  const toolUseId = asString(record['tool_use_id']);
  const contentRecord = asRecord(record['content']);
  if (toolUseId === null || contentRecord === null) {
    return null;
  }

  const contentType = asString(contentRecord['type']);
  if (contentType === null) {
    return null;
  }

  if (contentType === 'web_fetch_result') {
    const innerContent = asRecord(contentRecord['content']);
    const source = innerContent === null ? null : asRecord(innerContent['source']);
    if (innerContent === null || source === null) {
      return null;
    }

    const url = asString(contentRecord['url']);
    const sourceType = asString(source['type']);
    const sourceMediaType = asString(source['media_type']);
    const sourceData = asString(source['data']);
    const contentBlockType = asString(innerContent['type']);
    if (
      url === null ||
      sourceType === null ||
      sourceMediaType === null ||
      sourceData === null ||
      contentBlockType === null
    ) {
      return null;
    }

    const retrievedAt = asString(contentRecord['retrieved_at']);
    const title = asString(innerContent['title']);
    const citations = Array.isArray(innerContent['citations'])
      ? (innerContent['citations'] as unknown[])
      : null;

    return {
      type,
      tool_use_id: toolUseId,
      content: {
        type: 'web_fetch_result',
        url,
        ...(retrievedAt !== null ? { retrieved_at: retrievedAt } : {}),
        content: {
          type: contentBlockType,
          ...(title !== null ? { title } : {}),
          source: {
            type: sourceType,
            media_type: sourceMediaType,
            data: sourceData,
          },
          ...(citations !== null ? { citations } : {}),
        },
      },
    };
  }

  const errorCode = asString(contentRecord['error_code']);
  return {
    type,
    tool_use_id: toolUseId,
    content: {
      type: contentType,
      ...(errorCode !== null ? { error_code: errorCode } : {}),
    },
  };
}

export function parseAnthropicStreamChunk(value: unknown): AnthropicStreamChunk | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const type = asString(record['type']);
  if (type === null) {
    return null;
  }

  if (type === 'ping') {
    return { type };
  }

  if (type === 'message_start') {
    const message = asRecord(record['message']);
    if (message === null) {
      return null;
    }

    const content = Array.isArray(message['content'])
      ? message['content']
          .map((part) => parseContentBlock(part))
          .filter((part): part is AnthropicContentBlock => part !== null)
      : undefined;

    const id = asString(message['id']);
    const model = asString(message['model']);
    const usage = parseUsage(message['usage']);
    const stopReason = parseStringOrNull(message['stop_reason']);

    return {
      type,
      message: {
        ...(id !== null ? { id } : {}),
        ...(model !== null ? { model } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
        ...(content !== undefined ? { content } : {}),
      },
    };
  }

  if (type === 'message_delta') {
    const usage = parseUsage(record['usage']);
    const delta = asRecord(record['delta']);

    let parsedDelta: AnthropicMessageDeltaChunk['delta'] | undefined;
    if (delta !== null) {
      const stopReason = parseStringOrNull(delta['stop_reason']);
      const stopSequence = parseStringOrNull(delta['stop_sequence']);
      if (stopReason !== undefined || stopSequence !== undefined) {
        parsedDelta = {
          ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
          ...(stopSequence !== undefined ? { stop_sequence: stopSequence } : {}),
        };
      }
    }

    return {
      type,
      ...(usage !== undefined ? { usage } : {}),
      ...(parsedDelta !== undefined ? { delta: parsedDelta } : {}),
    };
  }

  if (type === 'message_stop') {
    return { type };
  }

  if (type === 'content_block_start') {
    const index = asNumber(record['index']);
    const contentBlock = parseContentBlock(record['content_block']);
    if (index === null || contentBlock === null) {
      return null;
    }

    return {
      type,
      index,
      content_block: contentBlock,
    };
  }

  if (type === 'content_block_delta') {
    const index = asNumber(record['index']);
    const delta = asRecord(record['delta']);
    if (index === null || delta === null) {
      return null;
    }

    const deltaType = asString(delta['type']);
    if (deltaType === 'text_delta') {
      const text = asString(delta['text']);
      if (text === null) {
        return null;
      }
      return {
        type,
        index,
        delta: {
          type: deltaType,
          text,
        },
      };
    }

    if (deltaType === 'thinking_delta') {
      const thinking = asString(delta['thinking']);
      if (thinking === null) {
        return null;
      }
      return {
        type,
        index,
        delta: {
          type: deltaType,
          thinking,
        },
      };
    }

    if (deltaType === 'signature_delta') {
      const signature = asString(delta['signature']);
      if (signature === null) {
        return null;
      }
      return {
        type,
        index,
        delta: {
          type: deltaType,
          signature,
        },
      };
    }

    if (deltaType === 'input_json_delta') {
      const partialJson = asString(delta['partial_json']);
      if (partialJson === null) {
        return null;
      }
      return {
        type,
        index,
        delta: {
          type: deltaType,
          partial_json: partialJson,
        },
      };
    }

    return null;
  }

  if (type === 'content_block_stop') {
    const index = asNumber(record['index']);
    if (index === null) {
      return null;
    }
    return {
      type,
      index,
    };
  }

  if (type !== 'error') {
    return null;
  }

  const errorRecord = asRecord(record['error']);
  if (errorRecord === null) {
    return null;
  }
  return {
    type,
    error: errorRecord,
  };
}

export function mapAnthropicStopReason(reason: string | null | undefined): FinishReason {
  if (reason === 'end_turn') {
    return 'stop';
  }
  if (reason === 'max_tokens') {
    return 'length';
  }
  if (reason === 'tool_use') {
    return 'tool-calls';
  }
  if (reason === 'stop_sequence') {
    return 'stop';
  }
  return 'other';
}

import {
  collectReadableStream,
  consumeReadableStream,
  toAsyncIterableStream,
} from './async-iterable-stream.ts';
import {
  postAnthropicMessagesStream,
  type AnthropicMessagesRequestBody,
} from './anthropic-client.ts';
import {
  mapAnthropicStopReason,
  type AnthropicContentBlock,
  type AnthropicUsage,
} from './anthropic-protocol.ts';
import { safeJsonParse } from './json-parse.ts';
import { createUIMessageStream, createUIMessageStreamResponse } from './ui-stream.ts';
import type {
  AssistantToolCallPart,
  FinishReason,
  GenerateTextResult,
  HarnessAnthropicModel,
  LanguageModelRequestMetadata,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  ModelMessage,
  ProviderMetadata,
  StreamTextOptions,
  StreamTextPart,
  StreamTextResult,
  TextContentPart,
  ToolDefinition,
  ToolModelMessage,
  ToolResultContentPart,
  ToolSet,
  TypedToolCall,
  TypedToolError,
  TypedToolResult,
} from './types.ts';

interface ContentBlockTextState {
  readonly kind: 'text' | 'reasoning';
  readonly id: string;
}

interface ContentBlockToolState {
  readonly kind: 'tool';
  readonly id: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly providerExecuted: boolean;
  inputText: string;
  readonly providerMetadata?: ProviderMetadata;
}

type ContentBlockState = ContentBlockTextState | ContentBlockToolState;

interface ToolNameMap {
  readonly providerToCustom: Map<string, string>;
  readonly customToProvider: Map<string, string>;
}

function addUsage(left: LanguageModelUsage, right: LanguageModelUsage): LanguageModelUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0),
    cachedInputTokens: (left.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0),
  };
}

function usageFromAnthropic(usage: AnthropicUsage | undefined): LanguageModelUsage {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens:
      (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
  };
}

function normalizeMessages(
  prompt: string | undefined,
  messages: ModelMessage[] | undefined,
  system: string | undefined,
): { readonly system: string | undefined; readonly messages: ModelMessage[] } {
  if (prompt !== undefined && messages !== undefined) {
    throw new Error('provide either prompt or messages, not both');
  }

  if (prompt !== undefined) {
    return {
      system,
      messages: [{ role: 'user', content: prompt }],
    };
  }

  if (messages === undefined || messages.length === 0) {
    throw new Error('messages or prompt is required');
  }

  const copied = [...messages];
  if (system === undefined) {
    const first = copied[0];
    if (first?.role === 'system') {
      return {
        system: first.content,
        messages: copied.slice(1),
      };
    }
  }

  return {
    system,
    messages: copied,
  };
}

function toAnthropicMessageContent(message: ModelMessage): Array<Record<string, unknown>> {
  if (typeof message.content === 'string') {
    return [{ type: 'text', text: message.content }];
  }

  if (message.role === 'tool') {
    return message.content.map((part) => ({
      type: 'tool_result',
      tool_use_id: part.toolCallId,
      content:
        typeof part.output === 'string'
          ? [{ type: 'text', text: part.output }]
          : [{ type: 'text', text: JSON.stringify(part.output) }],
      is_error: part.isError === true,
    }));
  }

  return message.content.map((part) => {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: part.text,
      };
    }

    return {
      type: 'tool_use',
      id: part.toolCallId,
      name: part.toolName,
      input: part.input,
    };
  });
}

function toAnthropicMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    const role = message.role === 'tool' ? 'user' : message.role;
    output.push({
      role,
      content: toAnthropicMessageContent(message),
    });
  }
  return output;
}

function normalizeToolDefinition(
  name: string,
  definition: ToolDefinition<unknown, unknown>,
): {
  readonly requestTool: Record<string, unknown>;
  readonly providerName: string;
  readonly dynamic?: boolean;
  readonly title?: string;
} {
  if (definition.type === 'provider') {
    const metadata: {
      dynamic?: boolean;
      title?: string;
    } = {};
    if (definition.dynamic !== undefined) {
      metadata.dynamic = definition.dynamic;
    }
    if (definition.title !== undefined) {
      metadata.title = definition.title;
    }

    return {
      requestTool: {
        type: definition.anthropicType,
        name: definition.name,
        ...(definition.description !== undefined ? { description: definition.description } : {}),
        ...(definition.inputSchema !== undefined ? { input_schema: definition.inputSchema } : {}),
        ...(definition.settings !== undefined ? definition.settings : {}),
      },
      providerName: definition.name,
      ...metadata,
    };
  }

  const metadata: {
    dynamic?: boolean;
    title?: string;
  } = {};
  if (definition.dynamic !== undefined) {
    metadata.dynamic = definition.dynamic;
  }
  if (definition.title !== undefined) {
    metadata.title = definition.title;
  }

  return {
    requestTool: {
      name,
      description: definition.description ?? name,
      input_schema: definition.inputSchema ?? { type: 'object', properties: {} },
    },
    providerName: name,
    ...metadata,
  };
}

function buildTools<TOOLS extends ToolSet>(
  tools: TOOLS | undefined,
): {
  readonly requestTools: Array<Record<string, unknown>> | undefined;
  readonly nameMap: ToolNameMap;
  readonly toolMeta: Map<string, { readonly dynamic?: boolean; readonly title?: string }>;
} {
  if (tools === undefined) {
    return {
      requestTools: undefined,
      nameMap: {
        providerToCustom: new Map<string, string>(),
        customToProvider: new Map<string, string>(),
      },
      toolMeta: new Map<string, { readonly dynamic?: boolean; readonly title?: string }>(),
    };
  }

  const requestTools: Array<Record<string, unknown>> = [];
  const providerToCustom = new Map<string, string>();
  const customToProvider = new Map<string, string>();
  const toolMeta = new Map<string, { readonly dynamic?: boolean; readonly title?: string }>();

  for (const [customName, definition] of Object.entries(tools)) {
    const normalized = normalizeToolDefinition(customName, definition);
    requestTools.push(normalized.requestTool);
    providerToCustom.set(normalized.providerName, customName);
    customToProvider.set(customName, normalized.providerName);
    const metadata: {
      dynamic?: boolean;
      title?: string;
    } = {};
    if (normalized.dynamic !== undefined) {
      metadata.dynamic = normalized.dynamic;
    }
    if (normalized.title !== undefined) {
      metadata.title = normalized.title;
    }
    toolMeta.set(customName, metadata);
  }

  return {
    requestTools,
    nameMap: {
      providerToCustom,
      customToProvider,
    },
    toolMeta,
  };
}

function resolveToolName(rawName: string, nameMap: ToolNameMap): string {
  return nameMap.providerToCustom.get(rawName) ?? rawName;
}

interface StepRunResult<TOOLS extends ToolSet> {
  readonly finishReason: FinishReason;
  readonly rawFinishReason?: string;
  readonly usage: LanguageModelUsage;
  readonly response: LanguageModelResponseMetadata;
  readonly providerMetadata?: ProviderMetadata;
  readonly toolCalls: TypedToolCall<TOOLS>[];
  readonly providerResults: Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>>;
  readonly assistantText: string;
}

function mapWebSearchResult(
  result: Extract<AnthropicContentBlock, { type: 'web_search_tool_result' }>,
):
  | {
      readonly ok: true;
      readonly output: unknown[];
      readonly sources: Array<{ url: string; title?: string; pageAge?: string }>;
    }
  | { readonly ok: false; readonly error: unknown } {
  if (Array.isArray(result.content)) {
    const mapped = result.content.map((entry) => ({
      type: entry.type,
      url: entry.url,
      ...(entry.title !== undefined ? { title: entry.title } : {}),
      ...(entry.page_age !== undefined ? { pageAge: entry.page_age } : {}),
      ...(entry.encrypted_content !== undefined
        ? { encryptedContent: entry.encrypted_content }
        : {}),
    }));
    return {
      ok: true,
      output: mapped,
      sources: result.content.map((entry) => ({
        url: entry.url,
        ...(entry.title !== undefined ? { title: entry.title } : {}),
        ...(entry.page_age !== undefined ? { pageAge: entry.page_age } : {}),
      })),
    };
  }

  return {
    ok: false,
    error: {
      type: result.content.type,
      errorCode: result.content.error_code,
    },
  };
}

function mapWebFetchResult(
  result: Extract<AnthropicContentBlock, { type: 'web_fetch_tool_result' }>,
):
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly error: unknown } {
  if ('url' in result.content && 'content' in result.content) {
    const content = result.content.content;
    return {
      ok: true,
      output: {
        type: 'web_fetch_result',
        url: result.content.url,
        ...(result.content.retrieved_at !== undefined
          ? { retrievedAt: result.content.retrieved_at }
          : {}),
        content: {
          type: content.type,
          ...(content.title !== undefined ? { title: content.title } : {}),
          source: {
            type: content.source.type,
            mediaType: content.source.media_type,
            data: content.source.data,
          },
          ...(content.citations !== undefined ? { citations: content.citations } : {}),
        },
      },
    };
  }

  return {
    ok: false,
    error: {
      type: result.content.type,
      errorCode: 'error_code' in result.content ? result.content.error_code : undefined,
    },
  };
}

function parseToolInput(inputText: string): {
  readonly input: unknown;
  readonly invalid: boolean;
  readonly error?: string;
} {
  const parsed = safeJsonParse(inputText);
  if (parsed !== undefined) {
    return { input: parsed, invalid: false };
  }

  return {
    input: inputText,
    invalid: true,
    error: 'Invalid JSON tool input',
  };
}

async function runSingleStep<TOOLS extends ToolSet>(
  model: HarnessAnthropicModel,
  requestBody: AnthropicMessagesRequestBody,
  options: {
    readonly includeRawChunks: boolean;
    readonly abortSignal?: AbortSignal;
    readonly nameMap: ToolNameMap;
    readonly toolMeta: Map<string, { readonly dynamic?: boolean; readonly title?: string }>;
    readonly emit: (part: StreamTextPart<TOOLS>) => void;
  },
): Promise<StepRunResult<TOOLS>> {
  const streamResponse = await postAnthropicMessagesStream(model, requestBody, options.abortSignal);

  const blockStates = new Map<number, ContentBlockState>();
  const toolCalls: TypedToolCall<TOOLS>[] = [];
  const providerResults: Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>> = [];
  let finishReason: FinishReason = 'other';
  let rawFinishReason: string | undefined;
  let usage = usageFromAnthropic(undefined);
  let response: LanguageModelResponseMetadata = {
    timestamp: new Date(),
    headers: streamResponse.responseHeaders,
  };
  let assistantText = '';

  const emitToolCallFromState = (state: ContentBlockToolState): TypedToolCall<TOOLS> => {
    const finalInputText = state.inputText.length === 0 ? '{}' : state.inputText;
    const parsed = parseToolInput(finalInputText);
    const meta = options.toolMeta.get(state.toolName);

    const call: TypedToolCall<TOOLS> = {
      toolCallId: state.toolCallId,
      toolName: state.toolName,
      input: parsed.input,
      providerExecuted: state.providerExecuted,
      ...(meta?.dynamic !== undefined ? { dynamic: meta.dynamic } : {}),
      ...(meta?.title !== undefined ? { title: meta.title } : {}),
      ...(state.providerMetadata !== undefined ? { providerMetadata: state.providerMetadata } : {}),
      ...(parsed.invalid ? { invalid: true, error: parsed.error } : {}),
    };

    options.emit({ type: 'tool-call', ...call });
    toolCalls.push(call);
    return call;
  };

  const reader = streamResponse.stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      if (value === undefined) {
        continue;
      }

      if (options.includeRawChunks) {
        options.emit({ type: 'raw', rawValue: value.rawValue });
      }

      if (value.parseError !== undefined) {
        options.emit({
          type: 'error',
          error: new Error(`failed to parse anthropic event: ${value.parseError}`),
        });
        continue;
      }

      const chunk = value.chunk;
      if (chunk === null) {
        continue;
      }

      if (chunk.type === 'ping') {
        continue;
      }

      if (chunk.type === 'message_start') {
        usage = usageFromAnthropic(chunk.message.usage);
        response = {
          timestamp: new Date(),
          headers: streamResponse.responseHeaders,
          ...(chunk.message.id !== undefined ? { id: chunk.message.id } : {}),
          ...(chunk.message.model !== undefined ? { modelId: chunk.message.model } : {}),
        };

        if (chunk.message.stop_reason !== undefined) {
          rawFinishReason = chunk.message.stop_reason ?? undefined;
          finishReason = mapAnthropicStopReason(chunk.message.stop_reason);
        }

        if (chunk.message.content !== undefined) {
          for (const part of chunk.message.content) {
            if (part.type !== 'tool_use' && part.type !== 'server_tool_use') {
              continue;
            }

            const toolName = resolveToolName(part.name, options.nameMap);
            const meta = options.toolMeta.get(toolName);
            const inputText = JSON.stringify(part.input ?? {});

            options.emit({
              type: 'tool-input-start',
              id: part.id,
              toolName,
              providerExecuted: part.type === 'server_tool_use',
              ...(meta?.dynamic !== undefined ? { dynamic: meta.dynamic } : {}),
              ...(meta?.title !== undefined ? { title: meta.title } : {}),
            });
            options.emit({
              type: 'tool-input-delta',
              id: part.id,
              delta: inputText,
            });
            options.emit({
              type: 'tool-input-end',
              id: part.id,
            });

            const state: ContentBlockToolState = {
              kind: 'tool',
              id: String(part.id),
              toolCallId: part.id,
              toolName,
              providerExecuted: part.type === 'server_tool_use',
              inputText,
            };
            emitToolCallFromState(state);
          }
        }

        continue;
      }

      if (chunk.type === 'message_delta') {
        usage = usageFromAnthropic(chunk.usage);
        if (chunk.delta?.stop_reason !== undefined) {
          rawFinishReason = chunk.delta.stop_reason ?? undefined;
          finishReason = mapAnthropicStopReason(chunk.delta.stop_reason);
        }
        continue;
      }

      if (chunk.type === 'content_block_start') {
        const block = chunk.content_block;

        if (block.type === 'text') {
          const state: ContentBlockTextState = {
            kind: 'text',
            id: String(chunk.index),
          };
          blockStates.set(chunk.index, state);
          options.emit({ type: 'text-start', id: state.id });
          if (block.text !== undefined && block.text.length > 0) {
            assistantText += block.text;
            options.emit({ type: 'text-delta', id: state.id, text: block.text });
          }
          continue;
        }

        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          const state: ContentBlockTextState = {
            kind: 'reasoning',
            id: String(chunk.index),
          };
          blockStates.set(chunk.index, state);
          options.emit({
            type: 'reasoning-start',
            id: state.id,
            ...(block.type === 'redacted_thinking' && block.data !== undefined
              ? {
                  providerMetadata: {
                    anthropic: {
                      redactedData: block.data,
                    },
                  },
                }
              : {}),
          });
          if (block.thinking !== undefined && block.thinking.length > 0) {
            options.emit({ type: 'reasoning-delta', id: state.id, text: block.thinking });
          }
          continue;
        }

        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
          const toolName = resolveToolName(block.name, options.nameMap);
          const meta = options.toolMeta.get(toolName);
          const state: ContentBlockToolState = {
            kind: 'tool',
            id: String(chunk.index),
            toolCallId: block.id,
            toolName,
            providerExecuted: block.type === 'server_tool_use',
            inputText: '',
          };

          blockStates.set(chunk.index, state);

          options.emit({
            type: 'tool-input-start',
            id: state.toolCallId,
            toolName,
            providerExecuted: state.providerExecuted,
            ...(meta?.dynamic !== undefined ? { dynamic: meta.dynamic } : {}),
            ...(meta?.title !== undefined ? { title: meta.title } : {}),
          });

          const hasStartInput = block.input !== undefined && Object.keys(block.input).length > 0;
          if (hasStartInput) {
            const delta = JSON.stringify(block.input);
            state.inputText += delta;
            options.emit({ type: 'tool-input-delta', id: state.toolCallId, delta });
          }

          continue;
        }

        if (block.type === 'web_search_tool_result') {
          const toolName = resolveToolName('web_search', options.nameMap);
          const mapped = mapWebSearchResult(block);
          if (mapped.ok) {
            const result: TypedToolResult<TOOLS> = {
              toolCallId: block.tool_use_id,
              toolName,
              output: mapped.output,
              providerExecuted: true,
            };
            providerResults.push(result);
            options.emit({ type: 'tool-result', ...result });

            for (const source of mapped.sources) {
              options.emit({
                type: 'source',
                id: `${block.tool_use_id}:${source.url}`,
                sourceType: 'url',
                url: source.url,
                ...(source.title !== undefined ? { title: source.title } : {}),
                ...(source.pageAge !== undefined
                  ? {
                      providerMetadata: {
                        anthropic: {
                          pageAge: source.pageAge,
                        },
                      },
                    }
                  : {}),
              });
            }
          } else {
            const error: TypedToolError<TOOLS> = {
              toolCallId: block.tool_use_id,
              toolName,
              error: mapped.error,
              providerExecuted: true,
            };
            providerResults.push(error);
            options.emit({ type: 'tool-error', ...error });
          }
          continue;
        }

        if (block.type === 'web_fetch_tool_result') {
          const toolName = resolveToolName('web_fetch', options.nameMap);
          const mapped = mapWebFetchResult(block);
          if (mapped.ok) {
            const result: TypedToolResult<TOOLS> = {
              toolCallId: block.tool_use_id,
              toolName,
              output: mapped.output,
              providerExecuted: true,
            };
            providerResults.push(result);
            options.emit({ type: 'tool-result', ...result });
          } else {
            const error: TypedToolError<TOOLS> = {
              toolCallId: block.tool_use_id,
              toolName,
              error: mapped.error,
              providerExecuted: true,
            };
            providerResults.push(error);
            options.emit({ type: 'tool-error', ...error });
          }
        }
      }

      if (chunk.type === 'content_block_delta') {
        const state = blockStates.get(chunk.index);
        if (state === undefined) {
          continue;
        }

        if (chunk.delta.type === 'text_delta' && state.kind === 'text') {
          assistantText += chunk.delta.text;
          options.emit({ type: 'text-delta', id: state.id, text: chunk.delta.text });
          continue;
        }

        if (chunk.delta.type === 'thinking_delta' && state.kind === 'reasoning') {
          options.emit({ type: 'reasoning-delta', id: state.id, text: chunk.delta.thinking });
          continue;
        }

        if (chunk.delta.type === 'signature_delta' && state.kind === 'reasoning') {
          options.emit({
            type: 'reasoning-delta',
            id: state.id,
            text: '',
            providerMetadata: {
              anthropic: {
                signature: chunk.delta.signature,
              },
            },
          });
          continue;
        }

        if (chunk.delta.type === 'input_json_delta' && state.kind === 'tool') {
          if (chunk.delta.partial_json.length === 0) {
            continue;
          }
          state.inputText += chunk.delta.partial_json;
          options.emit({
            type: 'tool-input-delta',
            id: state.toolCallId,
            delta: chunk.delta.partial_json,
          });
          continue;
        }

        continue;
      }

      if (chunk.type === 'content_block_stop') {
        const state = blockStates.get(chunk.index);
        if (state === undefined) {
          continue;
        }

        if (state.kind === 'text') {
          options.emit({ type: 'text-end', id: state.id });
          blockStates.delete(chunk.index);
          continue;
        }

        if (state.kind === 'reasoning') {
          options.emit({ type: 'reasoning-end', id: state.id });
          blockStates.delete(chunk.index);
          continue;
        }

        if (state.kind === 'tool') {
          options.emit({ type: 'tool-input-end', id: state.toolCallId });
          emitToolCallFromState(state);
          blockStates.delete(chunk.index);
        }
        continue;
      }

      if (chunk.type === 'error') {
        const message = chunk.error['message'];
        options.emit({
          type: 'error',
          error:
            typeof message === 'string' ? new Error(message) : new Error('anthropic stream error'),
        });
        finishReason = 'error';
        continue;
      }

      if (chunk.type === 'message_stop') break;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    finishReason,
    ...(rawFinishReason !== undefined ? { rawFinishReason } : {}),
    usage,
    response,
    ...(rawFinishReason !== undefined
      ? {
          providerMetadata: {
            anthropic: {
              rawFinishReason,
            },
          },
        }
      : {}),
    toolCalls,
    providerResults,
    assistantText,
  };
}

function ensureAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error('operation aborted');
  }
}

function callRequestBody(
  model: HarnessAnthropicModel,
  stepMessages: ModelMessage[],
  system: string | undefined,
  tools: Array<Record<string, unknown>> | undefined,
  options: {
    readonly maxOutputTokens?: number;
    readonly temperature?: number;
    readonly topP?: number;
    readonly stopSequences?: string[];
  },
): AnthropicMessagesRequestBody {
  const body: AnthropicMessagesRequestBody = {
    model: model.modelId,
    stream: true,
    messages: toAnthropicMessages(stepMessages),
    ...(system !== undefined ? { system } : {}),
    ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.stopSequences !== undefined ? { stop_sequences: options.stopSequences } : {}),
    ...(tools !== undefined ? { tools } : {}),
  };

  return body;
}

interface ExecutionResult<TOOLS extends ToolSet> {
  readonly emittedResults: Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>>;
  readonly toolResultMessageParts: ToolResultContentPart[];
  readonly assistantToolCallParts: AssistantToolCallPart[];
}

async function executeToolCalls<TOOLS extends ToolSet>(
  calls: TypedToolCall<TOOLS>[],
  tools: TOOLS | undefined,
  emit: (part: StreamTextPart<TOOLS>) => void,
): Promise<ExecutionResult<TOOLS>> {
  const emittedResults: Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>> = [];
  const toolResultMessageParts: ToolResultContentPart[] = [];
  const assistantToolCallParts: AssistantToolCallPart[] = [];

  for (const call of calls) {
    if (call.providerExecuted === true) {
      continue;
    }

    assistantToolCallParts.push({
      type: 'tool-call',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    });

    const definition = tools?.[call.toolName as keyof TOOLS];
    if (definition === undefined || definition.type === 'provider') {
      const error: TypedToolError<TOOLS> = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        error: `No executable tool found for ${call.toolName}`,
      };
      emittedResults.push(error);
      toolResultMessageParts.push({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { error: String(error.error) },
        isError: true,
      });
      emit({ type: 'tool-error', ...error });
      continue;
    }

    if (call.invalid) {
      const error: TypedToolError<TOOLS> = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        error: call.error ?? 'Invalid tool call',
      };
      emittedResults.push(error);
      toolResultMessageParts.push({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { error: String(error.error) },
        isError: true,
      });
      emit({ type: 'tool-error', ...error });
      continue;
    }

    if (definition.execute === undefined) {
      const error: TypedToolError<TOOLS> = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        error: `Tool ${call.toolName} is missing execute()`,
      };
      emittedResults.push(error);
      toolResultMessageParts.push({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { error: String(error.error) },
        isError: true,
      });
      emit({ type: 'tool-error', ...error });
      continue;
    }

    try {
      const output = await definition.execute(call.input);
      const result: TypedToolResult<TOOLS> = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        output,
      };
      emittedResults.push(result);
      toolResultMessageParts.push({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output,
      });
      emit({ type: 'tool-result', ...result });
    } catch (error) {
      const toolError: TypedToolError<TOOLS> = {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        error,
      };
      emittedResults.push(toolError);
      toolResultMessageParts.push({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          error: error instanceof Error ? error.message : String(error),
        },
        isError: true,
      });
      emit({ type: 'tool-error', ...toolError });
    }
  }

  return {
    emittedResults,
    toolResultMessageParts,
    assistantToolCallParts,
  };
}

interface CollectedStreamResult<TOOLS extends ToolSet> {
  readonly text: string;
  readonly toolCalls: TypedToolCall<TOOLS>[];
  readonly toolResults: Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>>;
  readonly finishReason: FinishReason;
  readonly usage: LanguageModelUsage;
  readonly response: LanguageModelResponseMetadata;
}

async function collectResultFromStream<TOOLS extends ToolSet>(
  stream: ReadableStream<StreamTextPart<TOOLS>>,
): Promise<CollectedStreamResult<TOOLS>> {
  const reader = stream.getReader();
  const toolCalls: TypedToolCall<TOOLS>[] = [];
  const toolResults: Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>> = [];
  let text = '';
  let finishReason: FinishReason = 'other';
  let usage: LanguageModelUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let response: LanguageModelResponseMetadata = {
    timestamp: new Date(),
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }

      if (value.type === 'text-delta') {
        text += value.text;
      } else if (value.type === 'tool-call') {
        toolCalls.push(value);
      } else if (value.type === 'tool-result' || value.type === 'tool-error') {
        toolResults.push(value);
      } else if (value.type === 'finish-step') {
        response = value.response;
        usage = value.usage;
      } else if (value.type === 'finish') {
        finishReason = value.finishReason;
        usage = value.totalUsage;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text,
    toolCalls,
    toolResults,
    finishReason,
    usage,
    response,
  };
}

export function streamText<TOOLS extends ToolSet>(
  options: StreamTextOptions<TOOLS>,
): StreamTextResult<TOOLS> {
  const normalized = normalizeMessages(options.prompt, options.messages, options.system);
  const maxToolRoundtrips = options.maxToolRoundtrips ?? 10;
  const builtTools = buildTools(options.tools);

  const baseStream = new ReadableStream<StreamTextPart<TOOLS>>({
    async start(controller) {
      const emit = (part: StreamTextPart<TOOLS>) => {
        controller.enqueue(part);
      };

      const requestWarnings: string[] = [];
      let conversationMessages = [...normalized.messages];
      let stepCount = 0;
      let totalUsage: LanguageModelUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };

      emit({ type: 'start' });

      try {
        while (true) {
          ensureAbort(options.abortSignal);
          if (stepCount >= maxToolRoundtrips) {
            emit({
              type: 'error',
              error: new Error(`maxToolRoundtrips (${maxToolRoundtrips}) exceeded`),
            });
            emit({
              type: 'finish',
              finishReason: 'error',
              rawFinishReason: 'max_tool_roundtrips',
              totalUsage,
            });
            break;
          }

          stepCount += 1;
          const requestOptions: {
            maxOutputTokens?: number;
            temperature?: number;
            topP?: number;
            stopSequences?: string[];
          } = {};
          if (options.maxOutputTokens !== undefined) {
            requestOptions.maxOutputTokens = options.maxOutputTokens;
          }
          if (options.temperature !== undefined) {
            requestOptions.temperature = options.temperature;
          }
          if (options.topP !== undefined) {
            requestOptions.topP = options.topP;
          }
          if (options.stopSequences !== undefined) {
            requestOptions.stopSequences = options.stopSequences;
          }

          const requestBody = callRequestBody(
            options.model,
            conversationMessages,
            normalized.system,
            builtTools.requestTools,
            requestOptions,
          );

          const requestMeta: LanguageModelRequestMetadata = {
            body: requestBody as unknown as Record<string, unknown>,
          };

          emit({
            type: 'start-step',
            request: requestMeta,
            warnings: requestWarnings,
          });

          const stepRunOptions: {
            includeRawChunks: boolean;
            abortSignal?: AbortSignal;
            nameMap: ToolNameMap;
            toolMeta: Map<string, { readonly dynamic?: boolean; readonly title?: string }>;
            emit: (part: StreamTextPart<TOOLS>) => void;
          } = {
            includeRawChunks: options.includeRawChunks === true,
            nameMap: builtTools.nameMap,
            toolMeta: builtTools.toolMeta,
            emit,
          };
          if (options.abortSignal !== undefined) {
            stepRunOptions.abortSignal = options.abortSignal;
          }

          const stepResult = await runSingleStep(options.model, requestBody, stepRunOptions);

          const localToolExecution = await executeToolCalls(
            stepResult.toolCalls,
            options.tools,
            emit,
          );

          const stepUsage = stepResult.usage;
          totalUsage = addUsage(totalUsage, stepUsage);

          emit({
            type: 'finish-step',
            response: stepResult.response,
            usage: stepUsage,
            finishReason: stepResult.finishReason,
            ...(stepResult.rawFinishReason !== undefined
              ? { rawFinishReason: stepResult.rawFinishReason }
              : {}),
            ...(stepResult.providerMetadata !== undefined
              ? { providerMetadata: stepResult.providerMetadata }
              : {}),
          });

          const nonProviderCalls = stepResult.toolCalls.filter(
            (call) => call.providerExecuted !== true,
          );
          if (
            stepResult.finishReason === 'tool-calls' &&
            nonProviderCalls.length > 0 &&
            localToolExecution.toolResultMessageParts.length > 0
          ) {
            const assistantParts: Array<TextContentPart | AssistantToolCallPart> = [];
            if (stepResult.assistantText.length > 0) {
              assistantParts.push({
                type: 'text',
                text: stepResult.assistantText,
              });
            }
            assistantParts.push(...localToolExecution.assistantToolCallParts);

            conversationMessages = [
              ...conversationMessages,
              {
                role: 'assistant',
                content: assistantParts,
              },
              {
                role: 'tool',
                content: localToolExecution.toolResultMessageParts,
              } satisfies ToolModelMessage,
            ];

            continue;
          }

          emit({
            type: 'finish',
            finishReason: stepResult.finishReason,
            ...(stepResult.rawFinishReason !== undefined
              ? { rawFinishReason: stepResult.rawFinishReason }
              : {}),
            totalUsage,
          });
          break;
        }

        controller.close();
      } catch (error) {
        if (options.abortSignal?.aborted === true) {
          emit({ type: 'abort', reason: 'aborted' });
          emit({ type: 'finish', finishReason: 'error', rawFinishReason: 'aborted', totalUsage });
          controller.close();
          return;
        }

        emit({ type: 'error', error });
        emit({ type: 'finish', finishReason: 'error', rawFinishReason: 'exception', totalUsage });
        controller.close();
      }
    },
  });

  const [collectorBranch, branchForConsumers] = baseStream.tee();
  const [fullBranch, remainingBranch] = branchForConsumers.tee();
  const [textBranchSource, uiBranchSource] = remainingBranch.tee();
  const [uiBranchA, uiBranchB] = uiBranchSource.tee();

  const fullStream = toAsyncIterableStream(fullBranch);
  const textStream = toAsyncIterableStream(
    textBranchSource.pipeThrough(
      new TransformStream<StreamTextPart<TOOLS>, string>({
        transform(part, controller) {
          if (part.type === 'text-delta' && part.text.length > 0) {
            controller.enqueue(part.text);
          }
        },
      }),
    ),
  );

  const uiMessageStream = createUIMessageStream(uiBranchA);
  const uiResponseStream = createUIMessageStream(uiBranchB);

  const collectedPromise = collectResultFromStream(collectorBranch);

  return {
    fullStream,
    textStream,
    text: collectedPromise.then((collected) => collected.text),
    toolCalls: collectedPromise.then((collected) => collected.toolCalls),
    toolResults: collectedPromise.then((collected) => collected.toolResults),
    finishReason: collectedPromise.then((collected) => collected.finishReason),
    usage: collectedPromise.then((collected) => collected.usage),
    response: collectedPromise.then((collected) => collected.response),
    toUIMessageStream() {
      return uiMessageStream;
    },
    toUIMessageStreamResponse(init?: ResponseInit): Response {
      return createUIMessageStreamResponse(uiResponseStream, init);
    },
    async consumeStream(): Promise<void> {
      await consumeReadableStream(fullStream);
    },
  };
}

export async function generateText<TOOLS extends ToolSet>(
  options: StreamTextOptions<TOOLS>,
): Promise<GenerateTextResult<TOOLS>> {
  const result = streamText(options);
  const [text, finishReason, usage, response, toolCalls, toolResults] = await Promise.all([
    result.text,
    result.finishReason,
    result.usage,
    result.response,
    result.toolCalls,
    result.toolResults,
  ]);

  return {
    text,
    finishReason,
    usage,
    response,
    toolCalls,
    toolResults,
  };
}

export async function collectFullStream<TOOLS extends ToolSet>(
  options: StreamTextOptions<TOOLS>,
): Promise<StreamTextPart<TOOLS>[]> {
  const result = streamText(options);
  return collectReadableStream(result.fullStream);
}

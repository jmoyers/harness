import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  JsonToSseTransformStream,
  UI_MESSAGE_STREAM_HEADERS,
  anthropic,
  anthropicTools,
  collectFullStream,
  createAnthropic,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  streamObject,
  streamText,
} from '../../../packages/harness-ai/src/index.ts';
import type {
  AnthropicModelFactory,
  AnthropicProviderToolDefinition,
  AssistantModelMessage,
  AsyncIterableStream,
  CreateAnthropicOptions,
  FinishReason,
  FunctionToolDefinition,
  GenerateTextOptions,
  GenerateTextResult,
  HarnessAnthropicModel,
  JsonSchema,
  JsonValue,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  ModelMessage,
  StreamObjectOptions,
  StreamObjectResult,
  StreamTextOptions,
  StreamTextPart,
  StreamTextResult,
  ToolDefinition,
  ToolSet,
  TypedToolCall,
  TypedToolError,
  TypedToolResult,
  UIMessageChunk,
} from '../../../packages/harness-ai/src/index.ts';

void test('harness-ai public exports stay importable and typed', () => {
  const provider = createAnthropic({ apiKey: 'k' });
  const model = provider('claude-sonnet');

  assert.equal(typeof streamText, 'function');
  assert.equal(typeof generateText, 'function');
  assert.equal(typeof collectFullStream, 'function');
  assert.equal(typeof streamObject, 'function');
  assert.equal(typeof createUIMessageStream, 'function');
  assert.equal(typeof createUIMessageStreamResponse, 'function');
  assert.equal(typeof JsonToSseTransformStream, 'function');
  assert.equal(typeof anthropic.tools.webSearch_20250305, 'function');
  assert.equal(typeof anthropicTools.webFetch_20250910, 'function');
  assert.equal(UI_MESSAGE_STREAM_HEADERS['x-vercel-ai-ui-message-stream'], 'v1');

  const typeFixture = {
    model,
  } as {
    model: HarnessAnthropicModel;
    providerFactory: AnthropicModelFactory;
    providerOptions: CreateAnthropicOptions;
    toolDef: AnthropicProviderToolDefinition;
    fnTool: FunctionToolDefinition;
    toolDefUnion: ToolDefinition;
    toolSet: ToolSet;
    finishReason: FinishReason;
    jsonSchema: JsonSchema;
    jsonValue: JsonValue;
    message: ModelMessage;
    assistantMessage: AssistantModelMessage;
    usage: LanguageModelUsage;
    response: LanguageModelResponseMetadata;
    typedCall: TypedToolCall<ToolSet>;
    typedResult: TypedToolResult<ToolSet>;
    typedError: TypedToolError<ToolSet>;
    streamPart: StreamTextPart<ToolSet>;
    streamResult: StreamTextResult<ToolSet>;
    generateOptions: GenerateTextOptions<ToolSet>;
    generateResult: GenerateTextResult<ToolSet>;
    streamOptions: StreamTextOptions<ToolSet>;
    objectOptions: StreamObjectOptions<{ ok: boolean }, ToolSet>;
    objectResult: StreamObjectResult<{ ok: boolean }>;
    asyncTextStream: AsyncIterableStream<string>;
    uiChunk: UIMessageChunk;
  };

  assert.equal(typeFixture.model.provider, 'harness.anthropic');
});

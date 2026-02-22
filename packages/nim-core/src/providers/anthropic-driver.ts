import { createAnthropic, streamText } from '../../../harness-ai/src/index.ts';
import type {
  AnthropicModelFactory,
  CreateAnthropicOptions,
  StreamTextPart,
  StreamTextResult,
  ToolSet,
  TypedToolError,
  TypedToolResult,
} from '../../../harness-ai/src/index.ts';
import type {
  NimProviderDriver,
  NimProviderTurnEvent,
  NimProviderTurnInput,
} from '../provider-router.ts';

type StreamTextFn = typeof streamText;
type CreateAnthropicFn = typeof createAnthropic;

export type AnthropicNimProviderDriverOptions = CreateAnthropicOptions & {
  readonly providerId?: string;
  readonly streamTextFn?: StreamTextFn;
  readonly createAnthropicFn?: CreateAnthropicFn;
  readonly executeTool?: (input: {
    readonly toolName: string;
    readonly toolInput: unknown;
  }) => Promise<unknown> | unknown;
};

function toToolSet(
  input: NimProviderTurnInput,
  executeTool?: (input: {
    readonly toolName: string;
    readonly toolInput: unknown;
  }) => Promise<unknown> | unknown,
): ToolSet {
  const tools: ToolSet = {};
  for (const tool of input.tools) {
    tools[tool.name] = {
      description: tool.description,
      inputSchema: {
        type: 'object',
        additionalProperties: true,
      },
      execute:
        executeTool === undefined
          ? (toolInput: unknown) => {
              return {
                ok: true,
                toolName: tool.name,
                input: toolInput,
              };
            }
          : async (toolInput: unknown) =>
              await executeTool({
                toolName: tool.name,
                toolInput,
              }),
    };
  }
  return tools;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function extractToolName(value: TypedToolResult<ToolSet> | TypedToolError<ToolSet>): string {
  return typeof value.toolName === 'string' ? value.toolName : String(value.toolName);
}

export function createAnthropicNimProviderDriver(
  options: AnthropicNimProviderDriverOptions,
): NimProviderDriver {
  const streamTextFn = options.streamTextFn ?? streamText;
  const createAnthropicFn = options.createAnthropicFn ?? createAnthropic;
  const providerId = options.providerId ?? 'anthropic';

  const anthropicFactory: AnthropicModelFactory = createAnthropicFn({
    apiKey: options.apiKey,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });

  return {
    providerId,
    async *runTurn(input: NimProviderTurnInput): AsyncIterable<NimProviderTurnEvent> {
      const model = anthropicFactory(input.providerModelId);
      const toolSet = toToolSet(input, options.executeTool);
      const result: StreamTextResult<ToolSet> = streamTextFn({
        model,
        prompt: input.input,
        ...(Object.keys(toolSet).length > 0 ? { tools: toolSet } : {}),
        temperature: 0,
        maxOutputTokens: 512,
        ...(input.abortSignal !== undefined ? { abortSignal: input.abortSignal } : {}),
      });

      const seenToolStarts = new Set<string>();
      const toolNamesById = new Map<string, string>();
      let sawThinkingStart = false;
      let sawThinkingComplete = false;

      for await (const part of result.fullStream as AsyncIterable<StreamTextPart<ToolSet>>) {
        if (part.type === 'reasoning-start') {
          if (!sawThinkingStart) {
            sawThinkingStart = true;
            yield { type: 'provider.thinking.started' };
          }
          continue;
        }

        if (part.type === 'reasoning-delta') {
          yield {
            type: 'provider.thinking.delta',
            text: part.text,
          };
          continue;
        }

        if (part.type === 'reasoning-end') {
          if (!sawThinkingComplete) {
            sawThinkingComplete = true;
            yield { type: 'provider.thinking.completed' };
          }
          continue;
        }

        if (part.type === 'tool-input-start') {
          if (!sawThinkingStart) {
            sawThinkingStart = true;
            yield { type: 'provider.thinking.started' };
          }
          if (!sawThinkingComplete) {
            sawThinkingComplete = true;
            yield { type: 'provider.thinking.completed' };
          }

          toolNamesById.set(part.id, String(part.toolName));
          if (!seenToolStarts.has(part.id)) {
            seenToolStarts.add(part.id);
            yield {
              type: 'tool.call.started',
              toolCallId: part.id,
              toolName: String(part.toolName),
            };
          }
          continue;
        }

        if (part.type === 'tool-input-delta') {
          const toolName = toolNamesById.get(part.id);
          if (toolName !== undefined) {
            yield {
              type: 'tool.call.arguments.delta',
              toolCallId: part.id,
              delta: part.delta,
            };
          }
          continue;
        }

        if (part.type === 'tool-call') {
          if (!sawThinkingStart) {
            sawThinkingStart = true;
            yield { type: 'provider.thinking.started' };
          }
          if (!sawThinkingComplete) {
            sawThinkingComplete = true;
            yield { type: 'provider.thinking.completed' };
          }

          const toolCallId = part.toolCallId;
          const toolName = String(part.toolName);
          toolNamesById.set(toolCallId, toolName);
          if (!seenToolStarts.has(toolCallId)) {
            seenToolStarts.add(toolCallId);
            yield {
              type: 'tool.call.started',
              toolCallId,
              toolName,
            };
          }
          continue;
        }

        if (part.type === 'tool-result') {
          if (!sawThinkingStart) {
            sawThinkingStart = true;
            yield { type: 'provider.thinking.started' };
          }
          if (!sawThinkingComplete) {
            sawThinkingComplete = true;
            yield { type: 'provider.thinking.completed' };
          }

          const toolCallId = part.toolCallId;
          const toolName = extractToolName(part);
          if (!seenToolStarts.has(toolCallId)) {
            seenToolStarts.add(toolCallId);
            yield {
              type: 'tool.call.started',
              toolCallId,
              toolName,
            };
          }
          yield {
            type: 'tool.call.completed',
            toolCallId,
            toolName,
          };
          yield {
            type: 'tool.result.emitted',
            toolCallId,
            toolName,
            output: part.output,
          };
          continue;
        }

        if (part.type === 'tool-error') {
          if (!sawThinkingStart) {
            sawThinkingStart = true;
            yield { type: 'provider.thinking.started' };
          }
          if (!sawThinkingComplete) {
            sawThinkingComplete = true;
            yield { type: 'provider.thinking.completed' };
          }

          const toolCallId = part.toolCallId;
          const toolName = extractToolName(part);
          yield {
            type: 'tool.call.failed',
            toolCallId,
            toolName,
            error: toMessage(part.error),
          };
          continue;
        }

        if (part.type === 'text-delta') {
          if (!sawThinkingStart) {
            sawThinkingStart = true;
            yield { type: 'provider.thinking.started' };
          }
          if (!sawThinkingComplete) {
            sawThinkingComplete = true;
            yield { type: 'provider.thinking.completed' };
          }

          if (part.text.length > 0) {
            yield {
              type: 'assistant.output.delta',
              text: part.text,
            };
          }
          continue;
        }

        if (part.type === 'text-end') {
          yield {
            type: 'assistant.output.completed',
          };
          continue;
        }

        if (part.type === 'error') {
          yield {
            type: 'provider.turn.error',
            message: toMessage(part.error),
          };
        }
      }

      if (sawThinkingStart && !sawThinkingComplete) {
        yield { type: 'provider.thinking.completed' };
      }

      const finishReason = await result.finishReason;
      yield {
        type: 'provider.turn.finished',
        finishReason,
      };
    },
  };
}

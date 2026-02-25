import { createAnthropic, streamText } from '../../../harness-ai/src/index.ts';
import type {
  AnthropicModelFactory,
  CreateAnthropicOptions,
  FinishReason,
  ModelMessage,
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
  readonly systemPrompt?: string;
  readonly maxToolRoundtrips?: number;
  readonly executeTool?: (input: {
    readonly toolName: string;
    readonly toolInput: unknown;
  }) => Promise<unknown> | unknown;
};

interface AnthropicToolNameAliases {
  readonly originalToAnthropic: Map<string, string>;
  readonly anthropicToOriginal: Map<string, string>;
}

function isAnthropicToolNameChar(char: string): boolean {
  const code = char.charCodeAt(0);
  const isUpper = code >= 65 && code <= 90;
  const isLower = code >= 97 && code <= 122;
  const isDigit = code >= 48 && code <= 57;
  return isUpper || isLower || isDigit || code === 95 || code === 45;
}

function sanitizeAnthropicToolName(name: string): string {
  let sanitized = '';
  for (const char of name.trim()) {
    sanitized += isAnthropicToolNameChar(char) ? char : '_';
  }
  if (sanitized.length === 0) {
    sanitized = 'tool';
  }
  if (sanitized.length > 128) {
    sanitized = sanitized.slice(0, 128);
  }
  return sanitized;
}

function withAnthropicToolNameSuffix(base: string, suffix: string): string {
  const baseLimit = Math.max(1, 128 - suffix.length);
  return `${base.slice(0, baseLimit)}${suffix}`;
}

function createAnthropicToolNameAliases(
  tools: NimProviderTurnInput['tools'],
): AnthropicToolNameAliases {
  const originalToAnthropic = new Map<string, string>();
  const anthropicToOriginal = new Map<string, string>();
  for (const tool of tools) {
    if (originalToAnthropic.has(tool.name)) {
      continue;
    }
    const base = sanitizeAnthropicToolName(tool.name);
    let candidate = base;
    let suffix = 2;
    while (anthropicToOriginal.has(candidate)) {
      candidate = withAnthropicToolNameSuffix(base, `_${suffix}`);
      suffix += 1;
    }
    originalToAnthropic.set(tool.name, candidate);
    anthropicToOriginal.set(candidate, tool.name);
  }
  return { originalToAnthropic, anthropicToOriginal };
}

function toToolSet(
  input: NimProviderTurnInput,
  aliases: AnthropicToolNameAliases,
  executeTool?: (input: {
    readonly toolName: string;
    readonly toolInput: unknown;
  }) => Promise<unknown> | unknown,
): ToolSet {
  const tools: ToolSet = {};
  for (const tool of input.tools) {
    const anthropicToolName = aliases.originalToAnthropic.get(tool.name) ?? tool.name;
    tools[anthropicToolName] = {
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

function toModelMessages(input: NimProviderTurnInput): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of input.messages) {
    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: message.text,
      });
      continue;
    }
    messages.push({
      role: 'user',
      content: message.text,
    });
  }
  return messages;
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

const DEFAULT_NIM_SYSTEM_PROMPT = [
  'You are Nim, the Harness coordination agent.',
  'Harness is a local control-plane for coordinating coding agents across projects and repositories.',
  'Use available tools to inspect directories, repositories, tasks, threads, and sessions instead of guessing.',
  'When starting or restarting a thread runtime, prefer the project directory as cwd so the agent runs in the intended repository root.',
  'Keep responses concise, operational, and explicit about ids/status/results and next action.',
].join('\n');

const DEFAULT_MAX_TOOL_ROUNDTRIPS = 1000;

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
      const toolNameAliases = createAnthropicToolNameAliases(input.tools);
      const resolveOriginalToolName = (toolName: string): string => {
        return toolNameAliases.anthropicToOriginal.get(toolName) ?? toolName;
      };
      const toolSet = toToolSet(input, toolNameAliases, options.executeTool);
      const messages = toModelMessages(input);
      const result: StreamTextResult<ToolSet> = streamTextFn({
        model,
        ...(messages.length > 0 ? { messages } : { prompt: input.input }),
        system: options.systemPrompt ?? DEFAULT_NIM_SYSTEM_PROMPT,
        ...(Object.keys(toolSet).length > 0 ? { tools: toolSet } : {}),
        temperature: 0,
        maxOutputTokens: 512,
        maxToolRoundtrips: options.maxToolRoundtrips ?? DEFAULT_MAX_TOOL_ROUNDTRIPS,
        ...(input.abortSignal !== undefined ? { abortSignal: input.abortSignal } : {}),
      });

      const seenToolStarts = new Set<string>();
      const toolNamesById = new Map<string, string>();
      let sawThinkingStart = false;
      let sawThinkingComplete = false;
      let sawAssistantOutputDelta = false;
      let sawFinishPart = false;
      let finishReasonFromStream: FinishReason | null = null;

      for await (const part of result.fullStream as AsyncIterable<StreamTextPart<ToolSet>>) {
        if (sawFinishPart) {
          yield {
            type: 'provider.turn.error',
            message: 'provider stream contract violation: emitted events after finish',
          };
          break;
        }

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

          const toolName = resolveOriginalToolName(String(part.toolName));
          toolNamesById.set(part.id, toolName);
          if (!seenToolStarts.has(part.id)) {
            seenToolStarts.add(part.id);
            yield {
              type: 'tool.call.started',
              toolCallId: part.id,
              toolName,
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
          const toolName = resolveOriginalToolName(String(part.toolName));
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
          const toolName = resolveOriginalToolName(extractToolName(part));
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
          const toolName = resolveOriginalToolName(extractToolName(part));
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
            sawAssistantOutputDelta = true;
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

        if (part.type === 'finish') {
          sawFinishPart = true;
          finishReasonFromStream = part.finishReason;
          continue;
        }

        if (part.type === 'abort') {
          const reason =
            typeof part.reason === 'string' && part.reason.trim().length > 0
              ? `: ${part.reason}`
              : '';
          yield {
            type: 'provider.turn.error',
            message: `provider stream aborted${reason}`,
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

      if (!sawFinishPart) {
        yield {
          type: 'provider.turn.error',
          message: 'provider stream contract violation: missing finish event',
        };
        yield {
          type: 'provider.turn.finished',
          finishReason: 'error',
        };
        return;
      }

      const finishReason = finishReasonFromStream as FinishReason;
      if (finishReason !== 'error' && finishReason !== 'tool-calls' && !sawAssistantOutputDelta) {
        yield {
          type: 'provider.turn.error',
          message: 'provider stream contract violation: missing assistant text-delta emission',
        };
        yield {
          type: 'provider.turn.finished',
          finishReason: 'error',
        };
        return;
      }

      yield {
        type: 'provider.turn.finished',
        finishReason,
      };
    },
  };
}

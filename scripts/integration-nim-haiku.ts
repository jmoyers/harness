import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import { createAnthropic, streamText } from '../packages/harness-ai/src/index.ts';

interface ParsedArgs {
  readonly secretsFile: string;
  readonly models: readonly string[];
  readonly baseUrl?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: {
    secretsFile?: string;
    model?: string;
    baseUrl?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--secrets-file') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --secrets-file');
      }
      parsed.secretsFile = value;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --model');
      }
      parsed.model = value;
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --base-url');
      }
      parsed.baseUrl = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    secretsFile:
      parsed.secretsFile ??
      resolve(process.env.HOME ?? process.cwd(), 'dev/harness/.harness/secrets.env'),
    models:
      parsed.model === undefined
        ? ([
            'claude-3-5-haiku-latest',
            'claude-3-5-haiku-20241022',
            'claude-3-haiku-20240307',
          ] as const)
        : [parsed.model],
    ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
  };
}

async function collectAsync<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of stream) {
    output.push(value);
  }
  return output;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadHarnessSecrets({
    cwd: process.cwd(),
    filePath: args.secretsFile,
    overrideExisting: false,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('ANTHROPIC_API_KEY was not found after loading secrets');
  }

  const anthropic = createAnthropic({
    apiKey,
    ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
  });

  const failures: string[] = [];
  for (const modelId of args.models) {
    try {
      const model = anthropic(modelId);
      const result = streamText({
        model,
        prompt: [
          'Call the `ping` tool exactly once with {"value":"nim-haiku"}.',
          'After the tool returns, respond exactly with NIM_HAIKU_OK.',
          'Do not output any extra text.',
        ].join(' '),
        temperature: 0,
        maxOutputTokens: 128,
        tools: {
          ping: {
            description: 'Echo a string',
            inputSchema: {
              type: 'object',
              properties: {
                value: {
                  type: 'string',
                },
              },
              required: ['value'],
            },
            execute: (input: unknown) => {
              if (typeof input !== 'object' || input === null) {
                return {
                  ok: false,
                  echoed: '',
                };
              }
              const value = (input as { value?: unknown }).value;
              return {
                ok: typeof value === 'string',
                echoed: typeof value === 'string' ? value : '',
              };
            },
          },
        },
      });

      const [parts, text, toolCalls, toolResults, finishReason] = await Promise.all([
        collectAsync(result.fullStream),
        result.text,
        result.toolCalls,
        result.toolResults,
        result.finishReason,
      ]);

      const sawToolCall = parts.some((part) => part.type === 'tool-call');
      const sawToolResult = parts.some((part) => part.type === 'tool-result');
      const sawTextDelta = parts.some((part) => part.type === 'text-delta');
      const sawReasoningSignal = parts.some(
        (part) => part.type === 'reasoning-start' || part.type === 'reasoning-delta',
      );

      assert.equal(finishReason, 'stop');
      assert.equal(sawToolCall, true);
      assert.equal(sawToolResult, true);
      assert.equal(sawTextDelta, true);
      assert.equal(toolCalls.length >= 1, true);
      assert.equal(toolResults.length >= 1, true);
      assert.match(text, /NIM_HAIKU_OK/u);

      process.stdout.write('nim haiku integration passed\n');
      process.stdout.write(`model=${modelId}\n`);
      process.stdout.write(`stream_parts=${String(parts.length)}\n`);
      process.stdout.write(`tool_calls=${String(toolCalls.length)}\n`);
      process.stdout.write(`tool_results=${String(toolResults.length)}\n`);
      process.stdout.write(`reasoning_signals=${String(sawReasoningSignal)}\n`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${modelId}: ${message}`);
    }
  }

  throw new Error(`nim haiku integration failed for all candidates\n${failures.join('\n')}`);
}

await main();

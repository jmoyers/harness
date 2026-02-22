import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'bun:test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createAnthropic, streamText } from '../../../packages/harness-ai/src/index.ts';
import { collectStream } from '../../support/harness-ai.ts';

interface QueuedResponse {
  readonly events: unknown[];
}

function writeSse(res: ServerResponse<IncomingMessage>, events: unknown[]): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

let server: Server | null = null;
let baseUrl = '';
const requests: Array<Record<string, unknown>> = [];
const queue: QueuedResponse[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    requests.push(await readJsonBody(req));
    const next = queue.shift();
    if (next === undefined) {
      res.statusCode = 500;
      res.end('no queued response');
      return;
    }

    writeSse(res, next.events);
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to bind test server');
  }
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  requests.length = 0;
  queue.length = 0;
});

void test('runs tool roundtrip against local anthropic-compatible server', async () => {
  requests.length = 0;
  queue.length = 0;

  queue.push(
    {
      events: [
        {
          type: 'message_start',
          message: {
            id: 'step-1',
            model: 'claude-sonnet',
            usage: { input_tokens: 2, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'call-1',
            name: 'sum',
            input: { a: 2, b: 3 },
          },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { input_tokens: 2, output_tokens: 1 },
        },
        { type: 'message_stop' },
      ],
    },
    {
      events: [
        {
          type: 'message_start',
          message: {
            id: 'step-2',
            model: 'claude-sonnet',
            usage: { input_tokens: 2, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '5' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 2, output_tokens: 1 },
        },
        { type: 'message_stop' },
      ],
    },
  );

  const anthropic = createAnthropic({
    apiKey: 'integration-key',
    baseUrl,
  });

  const result = streamText({
    model: anthropic('claude-sonnet'),
    prompt: 'sum 2 and 3',
    tools: {
      sum: {
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
        },
        execute: (input: unknown) => {
          const values = input as { a: number; b: number };
          return values.a + values.b;
        },
      },
    },
  });

  const parts = await collectStream(result.fullStream);
  const finalText = await result.text;

  assert.equal(finalText, '5');
  assert.equal(
    parts.some((part) => part.type === 'tool-result'),
    true,
  );
  assert.equal(requests.length, 2);

  const secondRequest = requests[1];
  const secondMessages = secondRequest?.['messages'];
  assert.equal(Array.isArray(secondMessages), true);
  assert.match(JSON.stringify(secondMessages), /tool_result/);
});

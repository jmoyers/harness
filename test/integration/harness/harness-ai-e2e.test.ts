import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'bun:test';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createAnthropic, streamText } from '../../../packages/harness-ai/src/index.ts';
import { collectTextStream } from '../../support/harness-ai.ts';

function buildServerResponse(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

let server: Server | null = null;
let baseUrl = '';
const capturedBodies: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    capturedBodies.push(await readJsonBody(req));
    const body = buildServerResponse([
      {
        type: 'message_start',
        message: {
          id: 'e2e-msg-1',
          model: 'claude-sonnet',
          usage: {
            input_tokens: 1,
            output_tokens: 0,
          },
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
        delta: { type: 'text_delta', text: 'e2e' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: {
          input_tokens: 1,
          output_tokens: 1,
        },
      },
      { type: 'message_stop' },
    ]);

    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    res.end(body);
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('server bind failed');
  }
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  capturedBodies.length = 0;
});

void test('emits Vercel-style UI SSE stream chunks', async () => {
  capturedBodies.length = 0;

  const anthropic = createAnthropic({
    apiKey: 'e2e-key',
    baseUrl,
  });

  const result = streamText({
    model: anthropic('claude-sonnet'),
    prompt: 'Say e2e',
  });

  const response = result.toUIMessageStreamResponse();
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');

  const chunks = await collectTextStream(response.body as ReadableStream<Uint8Array>);
  const payload = chunks.join('');

  assert.match(payload, /data: \{"type":"start"\}/);
  assert.match(payload, /data: \{"type":"start-step"\}/);
  assert.match(payload, /"type":"text-delta"/);
  assert.match(payload, /"delta":"e2e"/);
  assert.match(payload, /data: \{"type":"finish","finishReason":"stop"\}/);
  assert.match(payload, /data: \[DONE\]/);

  assert.equal(capturedBodies.length, 1);
  assert.equal(capturedBodies[0]?.['model'], 'claude-sonnet');
});

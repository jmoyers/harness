import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ControlPlaneStreamServer,
  startControlPlaneStreamServer,
} from '../src/control-plane/stream-server.ts';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import {
  CURSOR_HOOK_NOTIFY_FILE_ENV,
  CURSOR_HOOK_SESSION_ID_ENV,
} from '../src/cursor/managed-hooks.ts';
import {
  FakeLiveSession,
  collectEnvelopes,
  postJson,
  postRaw,
} from './control-plane-stream-server-test-helpers.ts';
import { createAnthropicResponse } from './support/harness-ai.ts';

function createThreadTitleResponse(text: string): Response {
  return createAnthropicResponse([
    {
      type: 'message_start',
      message: {
        id: 'msg-thread-title',
        model: 'claude-3-5-haiku-latest',
        usage: { input_tokens: 9, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 9, output_tokens: 3 },
    },
    { type: 'message_stop' },
  ]);
}

function extractPromptTextFromAnthropicRequest(body: Record<string, unknown>): string {
  const messages = body['messages'];
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  const firstMessage = messages[0];
  if (typeof firstMessage !== 'object' || firstMessage === null || Array.isArray(firstMessage)) {
    return '';
  }
  const content = (firstMessage as Record<string, unknown>)['content'];
  if (!Array.isArray(content) || content.length === 0) {
    return '';
  }
  const firstPart = content[0];
  if (typeof firstPart !== 'object' || firstPart === null || Array.isArray(firstPart)) {
    return '';
  }
  const text = (firstPart as Record<string, unknown>)['text'];
  return typeof text === 'string' ? text : '';
}

async function waitForConversationTitle(
  client: Awaited<ReturnType<typeof connectControlPlaneStreamClient>>,
  directoryId: string,
  conversationId: string,
  expectedTitle: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const listed = await client.sendCommand({
      type: 'conversation.list',
      directoryId,
      includeArchived: true,
    });
    const rows = Array.isArray(listed['conversations']) ? listed['conversations'] : [];
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        continue;
      }
      const record = row as Record<string, unknown>;
      if (record['conversationId'] !== conversationId) {
        continue;
      }
      if (record['title'] === expectedTitle) {
        return;
      }
    }
    await delay(10);
  }
  throw new Error(`timed out waiting for conversation title: ${expectedTitle}`);
}

void test('stream server injects codex telemetry args, ingests otlp payloads, and updates runtime state', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const telemetryAddress = server.telemetryAddressInfo();
  assert.notEqual(telemetryAddress, null);
  const telemetryTarget = {
    host: '127.0.0.1',
    port: telemetryAddress!.port,
  };
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observedTelemetry = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-otel',
      tenantId: 'tenant-otel',
      userId: 'user-otel',
      workspaceId: 'workspace-otel',
      path: '/tmp/workspace-otel',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-otel',
      directoryId: 'directory-otel',
      title: 'otlp status',
      agentType: 'codex',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-otel',
      args: ['--model', 'test-model'],
      initialCols: 80,
      initialRows: 24,
    });
    const subscribed = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-otel',
      userId: 'user-otel',
      workspaceId: 'workspace-otel',
      conversationId: 'conversation-otel',
      includeOutput: false,
    });
    const telemetrySubscriptionId = subscribed['subscriptionId'];
    assert.equal(typeof telemetrySubscriptionId, 'string');

    assert.equal(created.length, 1);
    const launchedArgs = created[0]!.input.args;
    assert.equal(launchedArgs.includes('--model'), true);
    assert.equal(launchedArgs.includes('test-model'), true);
    assert.equal(launchedArgs.includes('otel.log_user_prompt=true'), true);

    const exporterArg = launchedArgs.find((arg) => arg.includes('otel.exporter='));
    assert.notEqual(exporterArg, undefined);
    const tokenMatch = /\/v1\/logs\/([^"]+)/u.exec(exporterArg!);
    assert.notEqual(tokenMatch, null);
    const token = decodeURIComponent(tokenMatch?.[1] ?? '');
    assert.notEqual(token.length, 0);

    const unknownTokenResponse = await postJson(telemetryTarget, '/v1/logs/not-found', {});
    assert.equal(unknownTokenResponse.statusCode, 404);
    const malformedTokenResponse = await postJson(telemetryTarget, '/v1/logs/%E0', {});
    assert.equal(malformedTokenResponse.statusCode, 404);
    const invalidEndpointResponse = await postJson(telemetryTarget, '/unknown/path', {});
    assert.equal(invalidEndpointResponse.statusCode, 404);
    const wrongMethodResponse = await postRaw(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      'GET',
      '',
    );
    assert.equal(wrongMethodResponse.statusCode, 405);
    const invalidJsonResponse = await postRaw(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      'POST',
      '{',
    );
    assert.equal(invalidJsonResponse.statusCode, 400);

    const batchResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {},
    );
    assert.equal(batchResponse.statusCode, 200);

    const runningResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1700000000000000000',
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.user_prompt',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'prompt accepted',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(runningResponse.statusCode, 200);
    const runningDuplicateResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1700000000000000000',
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.user_prompt',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'prompt accepted',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(runningDuplicateResponse.statusCode, 200);

    await delay(20);
    const runningStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(runningStatus['status'], 'running');

    client.sendInput('conversation-otel', Buffer.from('\n', 'utf8'));
    await delay(10);
    const stillRunning = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(stillRunning['status'], 'running');

    const completedResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.sse_event',
                        },
                      },
                      {
                        key: 'kind',
                        value: {
                          stringValue: 'response.completed',
                        },
                      },
                      {
                        key: 'thread_id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'response.completed',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(completedResponse.statusCode, 200);
    const needsInputResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'needs-input',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'needs-input',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(needsInputResponse.statusCode, 200);

    const metricsResponse = await postJson(
      telemetryTarget,
      `/v1/metrics/${encodeURIComponent(token)}`,
      {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'codex.turn.e2e_duration_ms',
                    sum: {
                      dataPoints: [{}],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(metricsResponse.statusCode, 200);

    const tracesResponse = await postJson(
      telemetryTarget,
      `/v1/traces/${encodeURIComponent(token)}`,
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: 'codex.websocket_event',
                    attributes: [
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(tracesResponse.statusCode, 200);

    await delay(20);
    const completedStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(completedStatus['status'], 'completed');
    assert.equal((completedStatus['telemetry'] as Record<string, unknown>)['source'], 'otlp-trace');
    const observedKeyEvents = observedTelemetry.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.subscriptionId === telemetrySubscriptionId &&
        envelope.event.type === 'session-key-event',
    );
    assert.equal(observedKeyEvents.length > 0, true);
    const observedStatusEvents = observedTelemetry.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.subscriptionId === telemetrySubscriptionId &&
        envelope.event.type === 'session-status',
    );
    assert.equal(observedStatusEvents.length > 0, true);
    const latestStatus = observedStatusEvents[observedStatusEvents.length - 1];
    assert.notEqual(latestStatus, undefined);
    if (
      latestStatus !== undefined &&
      latestStatus.kind === 'stream.event' &&
      latestStatus.event.type === 'session-status'
    ) {
      assert.equal(latestStatus.event.telemetry?.source, 'otlp-trace');
    }

    client.sendInput('conversation-otel', Buffer.from('\n', 'utf8'));
    await delay(10);
    const completedAfterInput = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(completedAfterInput['status'], 'completed');

    const listedConversations = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-otel',
      includeArchived: true,
    });
    const conversationRow = (
      listedConversations['conversations'] as Array<Record<string, unknown>>
    )[0]!;
    const adapterState = conversationRow['adapterState'] as Record<string, unknown>;
    const codexState = adapterState['codex'] as Record<string, unknown>;
    assert.equal(codexState['resumeSessionId'], 'thread-otel');
    assert.equal(typeof codexState['lastObservedAt'], 'string');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server lifecycle telemetry mode drops verbose codex events while retaining high-signal events', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const telemetryAddress = server.telemetryAddressInfo();
  assert.notEqual(telemetryAddress, null);
  const telemetryTarget = {
    host: '127.0.0.1',
    port: telemetryAddress!.port,
  };
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observedTelemetry = collectEnvelopes(client);
  const internals = server as unknown as {
    ingestParsedTelemetryEvent: (
      fallbackSessionId: string | null,
      event: {
        source: 'otlp-log' | 'otlp-metric' | 'otlp-trace' | 'history';
        observedAt: string;
        eventName: string | null;
        severity: string | null;
        summary: string | null;
        providerThreadId: string | null;
        statusHint: 'running' | 'completed' | 'needs-input' | null;
        payload: Record<string, unknown>;
      },
    ) => void;
  };

  try {
    internals.ingestParsedTelemetryEvent('conversation-missing-lifecycle', {
      source: 'otlp-log',
      observedAt: '2026-02-16T00:00:00.000Z',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.in_progress',
      providerThreadId: 'thread-missing-lifecycle',
      statusHint: 'running',
      payload: {},
    });

    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-otel-lifecycle',
      tenantId: 'tenant-otel-lifecycle',
      userId: 'user-otel-lifecycle',
      workspaceId: 'workspace-otel-lifecycle',
      path: '/tmp/workspace-otel-lifecycle',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-otel-lifecycle',
      directoryId: 'directory-otel-lifecycle',
      title: 'otlp lifecycle',
      agentType: 'codex',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-otel-lifecycle',
      args: ['--model', 'test-model'],
      initialCols: 80,
      initialRows: 24,
    });
    const subscribed = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-otel-lifecycle',
      userId: 'user-otel-lifecycle',
      workspaceId: 'workspace-otel-lifecycle',
      conversationId: 'conversation-otel-lifecycle',
      includeOutput: false,
    });
    const telemetrySubscriptionId = subscribed['subscriptionId'];
    assert.equal(typeof telemetrySubscriptionId, 'string');

    assert.equal(created.length, 1);
    const launchedArgs = created[0]!.input.args;
    const exporterArg = launchedArgs.find((arg) => arg.includes('otel.exporter='));
    assert.notEqual(exporterArg, undefined);
    const tokenMatch = /\/v1\/logs\/([^"]+)/u.exec(exporterArg!);
    assert.notEqual(tokenMatch, null);
    const token = decodeURIComponent(tokenMatch?.[1] ?? '');
    assert.notEqual(token.length, 0);

    const emptyBatchResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {},
    );
    assert.equal(emptyBatchResponse.statusCode, 200);

    const promptResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.user_prompt',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel-lifecycle',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'prompt accepted',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(promptResponse.statusCode, 200);

    const verboseLogResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.sse_event',
                        },
                      },
                      {
                        key: 'kind',
                        value: {
                          stringValue: 'response.in_progress',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel-lifecycle',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'response.in_progress',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(verboseLogResponse.statusCode, 200);

    const needsInputResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'needs-input',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'needs-input',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(needsInputResponse.statusCode, 200);

    const metricResponse = await postJson(
      telemetryTarget,
      `/v1/metrics/${encodeURIComponent(token)}`,
      {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'codex.turn.e2e_duration_ms',
                    sum: {
                      dataPoints: [{}],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(metricResponse.statusCode, 200);

    const traceResponse = await postJson(
      telemetryTarget,
      `/v1/traces/${encodeURIComponent(token)}`,
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: 'codex.websocket_event',
                    attributes: [
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel-lifecycle',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(traceResponse.statusCode, 200);

    await delay(20);
    const status = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel-lifecycle',
    });
    assert.equal(status['status'], 'completed');
    const telemetry = status['telemetry'] as Record<string, unknown> | null;
    assert.notEqual(telemetry, null);
    assert.equal(telemetry?.['eventName'], 'codex.turn.e2e_duration_ms');
    assert.equal(telemetry?.['source'], 'otlp-metric');
    const diagnostics = status['diagnostics'] as Record<string, unknown>;
    assert.equal(diagnostics['telemetryIngestedTotal'], 6);
    assert.equal(diagnostics['telemetryRetainedTotal'], 3);
    assert.equal(diagnostics['telemetryDroppedTotal'], 3);
    assert.equal(diagnostics['fanoutBackpressureSignalsTotal'], 0);
    assert.equal(diagnostics['fanoutBackpressureDisconnectsTotal'], 0);
    assert.equal(
      typeof diagnostics['fanoutEventsEnqueuedTotal'] === 'number' &&
        (diagnostics['fanoutEventsEnqueuedTotal'] as number) > 0,
      true,
    );

    const observedKeyEvents = observedTelemetry.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.subscriptionId === telemetrySubscriptionId &&
        envelope.event.type === 'session-key-event',
    );
    const observedEventNames = observedKeyEvents
      .map((envelope) =>
        envelope.kind === 'stream.event' && envelope.event.type === 'session-key-event'
          ? envelope.event.keyEvent.eventName
          : null,
      )
      .filter((value): value is string => typeof value === 'string');
    assert.deepEqual(observedEventNames, [
      'codex.user_prompt',
      'needs-input',
      'codex.turn.e2e_duration_ms',
    ]);
    const observedPromptEvents = observedTelemetry.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.subscriptionId === telemetrySubscriptionId &&
        envelope.event.type === 'session-prompt-event',
    );
    assert.equal(observedPromptEvents.length, 1);
    const observedPrompt =
      observedPromptEvents[0]?.kind === 'stream.event' &&
      observedPromptEvents[0].event.type === 'session-prompt-event'
        ? observedPromptEvents[0].event.prompt
        : null;
    assert.notEqual(observedPrompt, null);
    assert.equal(observedPrompt?.providerEventName, 'codex.user_prompt');
    assert.equal(observedPrompt?.text, 'prompt accepted');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server ingests codex history lines and supports reset when file shrinks', async () => {
  const historyDir = mkdtempSync(join(tmpdir(), 'harness-history-'));
  const historyPath = join(historyDir, 'history.jsonl');
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: historyPath,
      pollMs: 25,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const internals = server as unknown as {
    pollHistoryFileUnsafe: () => Promise<boolean>;
  };

  try {
    await delay(30);
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-history',
      tenantId: 'tenant-history',
      userId: 'user-history',
      workspaceId: 'workspace-history',
      path: '/tmp/workspace-history',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-history',
      directoryId: 'directory-history',
      title: 'history status',
      agentType: 'codex',
      adapterState: {
        codex: {
          resumeSessionId: 'thread-history',
        },
      },
    });
    writeFileSync(
      historyPath,
      `\nnot-json\n${JSON.stringify({
        timestamp: '2026-02-15T11:59:59.000Z',
        type: 'response.completed',
        message: 'seed',
        session_id: 'thread-history',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-history',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    const seededStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-history',
    });
    assert.equal((seededStatus['telemetry'] as Record<string, unknown>)['source'], 'history');
    assert.equal(
      (seededStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'response.completed',
    );

    writeFileSync(
      historyPath,
      `${JSON.stringify({
        timestamp: '2026-02-15T12:00:00.000Z',
        type: 'user_prompt',
        message: 'first',
        session_id: 'thread-history',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    const firstStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-history',
    });
    assert.equal(firstStatus['status'], 'running');
    assert.equal((firstStatus['telemetry'] as Record<string, unknown>)['source'], 'history');

    writeFileSync(
      historyPath,
      `${JSON.stringify({
        timestamp: '2026-02-15T12:00:00.500Z',
        type: 'heartbeat',
        message: 'no-thread-id',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    const rewrittenMessage = 'done '.repeat(80).trim();
    writeFileSync(historyPath, '', 'utf8');
    writeFileSync(
      historyPath,
      `${JSON.stringify({
        timestamp: '2026-02-15T12:00:01.000Z',
        type: 'response.completed',
        message: rewrittenMessage,
        session_id: 'thread-history',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    const secondStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-history',
    });
    assert.equal(secondStatus['status'], 'running');
    assert.equal(
      (secondStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'response.completed',
    );
  } finally {
    client.close();
    await server.close();
    rmSync(historyDir, { recursive: true, force: true });
  }
});

void test('stream server history poll applies jittered scheduling and idle backoff', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~/missing-history-jitter.jsonl',
      pollMs: 1000,
    },
  });
  const internals = server as unknown as {
    pollHistoryFile: () => Promise<void>;
    pollHistoryFileUnsafe: () => Promise<boolean>;
    historyNextAllowedPollAtMs: number;
    historyIdleStreak: number;
  };
  let pollCalls = 0;
  internals.pollHistoryFileUnsafe = () => {
    pollCalls += 1;
    return Promise.resolve(pollCalls === 1);
  };

  try {
    internals.historyNextAllowedPollAtMs = 0;
    const beforeSuccessPoll = Date.now();
    await internals.pollHistoryFile();
    const successDelayMs = internals.historyNextAllowedPollAtMs - beforeSuccessPoll;
    assert.equal(pollCalls, 1);
    assert.ok(successDelayMs >= 550, `expected >= 550ms; got ${String(successDelayMs)}ms`);
    assert.ok(successDelayMs <= 1500, `expected <= 1500ms; got ${String(successDelayMs)}ms`);

    await internals.pollHistoryFile();
    assert.equal(pollCalls, 1);

    internals.historyNextAllowedPollAtMs = 0;
    const beforeIdlePoll = Date.now();
    await internals.pollHistoryFile();
    const idleDelayMs = internals.historyNextAllowedPollAtMs - beforeIdlePoll;
    assert.equal(internals.historyIdleStreak, 1);
    assert.ok(idleDelayMs >= 1200, `expected >= 1200ms; got ${String(idleDelayMs)}ms`);
    assert.ok(idleDelayMs <= 2800, `expected <= 2800ms; got ${String(idleDelayMs)}ms`);
  } finally {
    await server.close();
  }
});

void test('stream server history polling helpers start once and stop cleanly', async () => {
  const server = new ControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~/missing-history-jitter.jsonl',
      pollMs: 1000,
    },
  });
  const internals = server as unknown as {
    historyPollTimer: NodeJS.Timeout | null;
    startHistoryPollingIfEnabled: () => void;
    stopHistoryPolling: () => void;
    pollHistoryTimerTick: () => void;
  };
  try {
    assert.equal(internals.historyPollTimer, null);
    internals.startHistoryPollingIfEnabled();
    assert.notEqual(internals.historyPollTimer, null);
    internals.pollHistoryTimerTick();
    const firstTimer = internals.historyPollTimer;
    internals.startHistoryPollingIfEnabled();
    assert.equal(internals.historyPollTimer, firstTimer);
    internals.stopHistoryPolling();
    assert.equal(internals.historyPollTimer, null);
  } finally {
    await server.close();
  }
});

void test('stream server launches claude sessions with hook settings and no codex telemetry args', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-non-codex',
      tenantId: 'tenant-non-codex',
      userId: 'user-non-codex',
      workspaceId: 'workspace-non-codex',
      path: '/tmp/non-codex',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-non-codex',
      directoryId: 'directory-non-codex',
      title: 'non-codex',
      agentType: 'claude',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-non-codex',
      args: ['--foo', 'bar'],
      initialCols: 80,
      initialRows: 24,
    });
    const launchedInput = created[0]!.input;
    const launchedArgs = launchedInput.args;
    assert.equal(launchedInput.command, 'claude');
    assert.deepEqual(launchedInput.baseArgs, []);
    assert.equal(launchedInput.useNotifyHook, true);
    assert.equal(launchedInput.notifyMode, 'external');
    assert.equal(typeof launchedInput.notifyFilePath, 'string');
    assert.equal(launchedArgs[0], '--settings');
    assert.equal(launchedArgs[2], '--foo');
    assert.equal(launchedArgs[3], 'bar');
    assert.equal(
      launchedArgs.some((arg) => arg.includes('otel.exporter=')),
      false,
    );
    const settingsArg = launchedArgs[1];
    assert.equal(typeof settingsArg, 'string');
    const parsedSettings = JSON.parse(settingsArg as string) as Record<string, unknown>;
    const hooks = parsedSettings['hooks'] as Record<string, unknown>;
    assert.notEqual(hooks, null);
    assert.equal(Array.isArray(hooks['UserPromptSubmit']), true);
    assert.equal(Array.isArray(hooks['PreToolUse']), true);
    assert.equal(Array.isArray(hooks['Stop']), true);
    assert.equal(Array.isArray(hooks['Notification']), true);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server launches cursor sessions with external notify file env and cursor command', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    cursorHooks: {
      managed: false,
    },
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-cursor',
      tenantId: 'tenant-cursor',
      userId: 'user-cursor',
      workspaceId: 'workspace-cursor',
      path: '/tmp/cursor',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-cursor',
      directoryId: 'directory-cursor',
      title: 'cursor',
      agentType: 'cursor',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-cursor',
      args: ['--foo', 'bar'],
      initialCols: 80,
      initialRows: 24,
    });
    const launchedInput = created[0]!.input;
    assert.equal(launchedInput.command, 'cursor-agent');
    assert.deepEqual(launchedInput.baseArgs, []);
    assert.equal(launchedInput.useNotifyHook, true);
    assert.equal(launchedInput.notifyMode, 'external');
    assert.equal(typeof launchedInput.notifyFilePath, 'string');
    assert.deepEqual(launchedInput.args, ['--foo', 'bar']);
    const env = launchedInput.env ?? {};
    assert.equal(env[CURSOR_HOOK_NOTIFY_FILE_ENV], launchedInput.notifyFilePath);
    assert.equal(env[CURSOR_HOOK_SESSION_ID_ENV], 'conversation-cursor');
    assert.equal(typeof env['PATH'], 'string');
    assert.equal((env['PATH'] as string).length > 0, true);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server launches terminal agents with shell command and no codex base args', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const comSpec = process.env.ComSpec?.trim();
  const shell = process.env.SHELL?.trim();
  const expectedTerminalCommand =
    process.platform === 'win32'
      ? comSpec !== undefined && comSpec.length > 0
        ? comSpec
        : 'cmd.exe'
      : shell !== undefined && shell.length > 0
        ? shell
        : 'sh';

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-terminal',
      tenantId: 'tenant-terminal',
      userId: 'user-terminal',
      workspaceId: 'workspace-terminal',
      path: '/tmp/terminal',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-terminal',
      directoryId: 'directory-terminal',
      title: 'terminal',
      agentType: 'terminal',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-terminal',
      args: ['-lc', 'echo hello'],
      initialCols: 80,
      initialRows: 24,
    });
    const started = created[0]?.input;
    assert.notEqual(started, undefined);
    assert.equal(started?.command, expectedTerminalCommand);
    assert.deepEqual(started?.baseArgs, []);
    assert.deepEqual(started?.args, ['-lc', 'echo hello']);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server maps claude hook notify events into status/key events and adapter state', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-claude-status',
      tenantId: 'tenant-claude-status',
      userId: 'user-claude-status',
      workspaceId: 'workspace-claude-status',
      path: '/tmp/claude-status',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-claude-status',
      directoryId: 'directory-claude-status',
      title: 'claude status',
      agentType: 'claude',
    });
    await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-claude-status',
      includeOutput: false,
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-claude-status',
      args: ['--foo', 'bar'],
      initialCols: 80,
      initialRows: 24,
    });
    await delay(10);
    assert.equal(created.length, 1);

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:00.000Z',
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: 'improve prompt capture parity',
          session_id: 'claude-session-123',
        },
      },
    });
    await delay(10);
    const runningStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-claude-status',
    });
    assert.equal(runningStatus['status'], 'running');
    assert.equal(
      (runningStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'claude.userpromptsubmit',
    );

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:00.500Z',
        payload: {
          hook_event_name: 'PreToolUse',
          session_id: 'claude-session-123',
        },
      },
    });
    await delay(10);
    const preToolStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-claude-status',
    });
    assert.equal(preToolStatus['status'], 'running');
    assert.equal(
      (preToolStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'claude.pretooluse',
    );

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:01.000Z',
        payload: {
          hook_event_name: 'Stop',
          session_id: 'claude-session-123',
        },
      },
    });
    await delay(10);
    const completedStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-claude-status',
    });
    assert.equal(completedStatus['status'], 'completed');
    assert.equal(
      (completedStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'claude.stop',
    );

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:02.000Z',
        payload: {
          hook_event_name: 'Notification',
          notification_type: 'permission_request',
          message: 'approval required',
          session_id: 'claude-session-123',
        },
      },
    });
    await delay(10);
    const needsInputStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-claude-status',
    });
    assert.equal(needsInputStatus['status'], 'needs-input');
    assert.equal(needsInputStatus['attentionReason'], 'approval required');
    assert.equal(
      (needsInputStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'claude.notification',
    );

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:03.000Z',
        payload: {
          hook_event_name: 'Notification',
          notification_type: 'permission_approved',
          message: 'approval granted',
          session_id: 'claude-session-123',
        },
      },
    });
    await delay(10);
    const resumedStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-claude-status',
    });
    assert.equal(resumedStatus['status'], 'running');
    assert.equal(resumedStatus['attentionReason'], null);
    assert.equal(
      (resumedStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'claude.notification',
    );

    const listed = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-claude-status',
      includeArchived: true,
    });
    const conversationRow = (listed['conversations'] as Array<Record<string, unknown>>)[0]!;
    const adapterState = conversationRow['adapterState'] as Record<string, unknown>;
    const claudeState = adapterState['claude'] as Record<string, unknown>;
    assert.equal(claudeState['resumeSessionId'], 'claude-session-123');
    assert.equal(typeof claudeState['lastObservedAt'], 'string');

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.event.type === 'session-prompt-event' &&
          envelope.event.prompt.providerEventName === 'claude.userpromptsubmit' &&
          envelope.event.prompt.text === 'improve prompt capture parity',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.event.type === 'session-key-event' &&
          envelope.event.keyEvent.eventName === 'claude.userpromptsubmit',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.event.type === 'session-key-event' &&
          envelope.event.keyEvent.eventName === 'claude.pretooluse',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.event.type === 'session-key-event' &&
          envelope.event.keyEvent.eventName === 'claude.stop',
      ),
      true,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server records prompt history and renames conversation titles from haiku output', async () => {
  const created: FakeLiveSession[] = [];
  const titleRequestBodies: Record<string, unknown>[] = [];
  const generatedTitles = ['prompt capture', 'prompt history'];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    threadTitle: {
      enabled: true,
      apiKey: 'test-anthropic-key',
      fetch: async (_input, init) => {
        const body =
          typeof init?.body === 'string'
            ? init.body
            : init?.body === undefined
              ? '{}'
              : String(init.body);
        titleRequestBodies.push(JSON.parse(body) as Record<string, unknown>);
        const nextTitle =
          generatedTitles[Math.min(titleRequestBodies.length - 1, generatedTitles.length - 1)] ??
          'current thread';
        return createThreadTitleResponse(nextTitle);
      },
    },
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-thread-title',
      tenantId: 'tenant-thread-title',
      userId: 'user-thread-title',
      workspaceId: 'workspace-thread-title',
      path: '/tmp/thread-title',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-thread-title',
      directoryId: 'directory-thread-title',
      title: 'seed',
      agentType: 'claude',
    });
    await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-thread-title',
      includeOutput: false,
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-thread-title',
      args: ['--foo', 'bar'],
      initialCols: 80,
      initialRows: 24,
    });
    await delay(10);
    assert.equal(created.length, 1);

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:00.000Z',
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: 'Improve prompt extraction parity for thread naming',
          session_id: 'claude-title-session',
        },
      },
    });
    await waitForConversationTitle(
      client,
      'directory-thread-title',
      'conversation-thread-title',
      'prompt capture',
    );

    const secondPrompt = [
      'Follow up with screenshot context ![img](https://example.com/screen.png)',
      `data:image/png;base64,${'A'.repeat(220)}`,
      'Refine integration test behavior',
    ].join('\n');
    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:01.000Z',
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: secondPrompt,
          session_id: 'claude-title-session',
        },
      },
    });
    await waitForConversationTitle(
      client,
      'directory-thread-title',
      'conversation-thread-title',
      'prompt history',
    );

    assert.equal(titleRequestBodies.length >= 2, true);
    const firstPromptText = extractPromptTextFromAnthropicRequest(titleRequestBodies[0]!);
    assert.equal(
      firstPromptText.includes('1. Improve prompt extraction parity for thread naming'),
      true,
    );

    const secondPromptText = extractPromptTextFromAnthropicRequest(titleRequestBodies[1]!);
    assert.equal(
      secondPromptText.includes('1. Improve prompt extraction parity for thread naming'),
      true,
    );
    assert.equal(secondPromptText.includes('2. Follow up with screenshot context'), true);
    assert.equal(secondPromptText.includes('Refine integration test behavior'), true);
    assert.equal(secondPromptText.includes('data:image'), false);
    assert.equal(secondPromptText.includes('![img]'), false);

    const observedTitles: string[] = [];
    for (const envelope of observed) {
      if (envelope.kind !== 'stream.event' || envelope.event.type !== 'conversation-updated') {
        continue;
      }
      const title = (envelope.event.conversation as Record<string, unknown>)['title'];
      if (typeof title === 'string') {
        observedTitles.push(title);
      }
    }
    assert.equal(observedTitles.includes('prompt capture'), true);
    assert.equal(observedTitles.includes('prompt history'), true);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server maps cursor hook notify events and treats aborted stop as completed', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    cursorHooks: {
      managed: false,
    },
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-cursor-status',
      tenantId: 'tenant-cursor-status',
      userId: 'user-cursor-status',
      workspaceId: 'workspace-cursor-status',
      path: '/tmp/cursor-status',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-cursor-status',
      directoryId: 'directory-cursor-status',
      title: 'cursor status',
      agentType: 'cursor',
    });
    await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-cursor-status',
      includeOutput: false,
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-cursor-status',
      args: ['--foo', 'bar'],
      initialCols: 80,
      initialRows: 24,
    });
    await delay(10);
    assert.equal(created.length, 1);

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:00.000Z',
        payload: {
          event: 'beforeSubmitPrompt',
          prompt: 'build cursor prompt parity',
          conversation_id: 'cursor-session-123',
        },
      },
    });
    await delay(10);
    const runningStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-cursor-status',
    });
    assert.equal(runningStatus['status'], 'running');
    assert.equal(
      (runningStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'cursor.beforesubmitprompt',
    );

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:00.500Z',
        payload: {
          event: 'beforeSubmitPrompt',
          prompt: 'build cursor prompt parity follow-up',
          conversation_id: 'cursor-session-123',
        },
      },
    });
    await delay(10);
    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:00.700Z',
        payload: {
          event: 'beforeSubmitPrompt',
          prompt: 'build cursor prompt parity follow-up',
          conversation_id: 'cursor-session-123',
        },
      },
    });
    await delay(10);

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-02-16T00:00:01.000Z',
        payload: {
          event: 'stop',
          final_status: 'aborted',
          reason: 'aborted by user',
          conversation_id: 'cursor-session-123',
        },
      },
    });
    await delay(10);
    const completedStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-cursor-status',
    });
    assert.equal(completedStatus['status'], 'completed');
    assert.equal(
      (completedStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'cursor.stop',
    );

    const listed = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-cursor-status',
      includeArchived: true,
    });
    const conversationRow = (listed['conversations'] as Array<Record<string, unknown>>)[0]!;
    const adapterState = conversationRow['adapterState'] as Record<string, unknown>;
    const cursorState = adapterState['cursor'] as Record<string, unknown>;
    assert.equal(cursorState['resumeSessionId'], 'cursor-session-123');
    assert.equal(typeof cursorState['lastObservedAt'], 'string');

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.event.type === 'session-prompt-event' &&
          envelope.event.prompt.providerEventName === 'cursor.beforesubmitprompt' &&
          envelope.event.prompt.text === 'build cursor prompt parity',
      ),
      true,
    );
    const cursorPromptEvents = observed.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.event.type === 'session-prompt-event' &&
        envelope.event.sessionId === 'conversation-cursor-status',
    );
    const cursorPromptTexts = cursorPromptEvents
      .map((envelope) =>
        envelope.kind === 'stream.event' && envelope.event.type === 'session-prompt-event'
          ? envelope.event.prompt.text
          : null,
      )
      .filter((value): value is string => typeof value === 'string');
    assert.deepEqual(cursorPromptTexts, [
      'build cursor prompt parity',
      'build cursor prompt parity follow-up',
    ]);
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.event.type === 'session-key-event' &&
          envelope.event.keyEvent.eventName === 'cursor.beforesubmitprompt',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.event.type === 'session-key-event' &&
          envelope.event.keyEvent.eventName === 'cursor.stop',
      ),
      true,
    );
  } finally {
    client.close();
    await server.close();
  }
});

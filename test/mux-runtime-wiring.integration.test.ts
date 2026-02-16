import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput
} from '../src/control-plane/stream-server.ts';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { subscribeControlPlaneKeyEvents } from '../src/control-plane/codex-session-stream.ts';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import { buildWorkspaceRailViewRows } from '../src/mux/workspace-rail-model.ts';
import {
  applyMuxControlPlaneKeyEvent,
  type MuxRuntimeConversationState
} from '../src/mux/runtime-wiring.ts';
import type { CodexLiveEvent } from '../src/codex/live-session.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

class FakeLiveSession {
  readonly input: StartControlPlaneSessionInput;

  private readonly snapshotOracle: TerminalSnapshotOracle;
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();

  constructor(input: StartControlPlaneSessionInput) {
    this.input = input;
    this.snapshotOracle = new TerminalSnapshotOracle(input.initialCols, input.initialRows);
  }

  attach(handlers: SessionAttachHandlers): string {
    void handlers;
    return 'attachment-1';
  }

  detach(attachmentId: string): void {
    void attachmentId;
  }

  latestCursorValue(): number {
    return 0;
  }

  processId(): number | null {
    return 43210;
  }

  write(data: string | Uint8Array): void {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.snapshotOracle.ingest(chunk);
  }

  resize(cols: number, rows: number): void {
    this.snapshotOracle.resize(cols, rows);
  }

  snapshot() {
    return this.snapshotOracle.snapshot();
  }

  close(): void {}

  onEvent(listener: (event: CodexLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

interface TestConversationState extends MuxRuntimeConversationState {
  readonly sessionId: string;
}

function createConversationState(sessionId: string): TestConversationState {
  return {
    sessionId,
    directoryId: null,
    status: 'running',
    attentionReason: null,
    live: true,
    controller: null,
    lastEventAt: null,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    lastTelemetrySource: null
  };
}

async function postJson(
  address: { host: string; port: number },
  path: string,
  payload: unknown
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = httpRequest(
      {
        host: address.host,
        port: address.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.once('error', reject);
    req.write(body);
    req.end();
  });
}

void test('mux runtime wiring integration updates rail status line and icon from telemetry stream events', async () => {
  const launchedSessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50
    },
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      launchedSessions.push(session);
      return session;
    }
  });

  const address = server.address();
  const telemetryAddress = server.telemetryAddressInfo();
  assert.notEqual(telemetryAddress, null);

  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  const conversations = new Map<string, TestConversationState>();
  let dirtyMarks = 0;

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-runtime',
      path: '/tmp/runtime'
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-runtime',
      directoryId: 'directory-runtime',
      title: 'runtime thread',
      agentType: 'codex'
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-runtime',
      args: [],
      initialCols: 80,
      initialRows: 24
    });

    const launched = launchedSessions[0];
    assert.notEqual(launched, undefined);
    const exporterArg = launched?.input.args.find((entry) => entry.includes('/v1/logs/'));
    assert.notEqual(exporterArg, undefined);
    const tokenMatch = /\/v1\/logs\/([^"]+)/u.exec(exporterArg!);
    assert.notEqual(tokenMatch, null);
    const token = decodeURIComponent(tokenMatch?.[1] ?? '');
    assert.notEqual(token.length, 0);

    const subscription = await subscribeControlPlaneKeyEvents(client, {
      onEvent: (event) => {
        const updated = applyMuxControlPlaneKeyEvent(event, {
          removedConversationIds: new Set<string>(),
          ensureConversation: (sessionId, seed) => {
            const existing = conversations.get(sessionId);
            if (existing !== undefined) {
              if (seed?.directoryId !== undefined) {
                existing.directoryId = seed.directoryId;
              }
              return existing;
            }
            const created = createConversationState(sessionId);
            if (seed?.directoryId !== undefined) {
              created.directoryId = seed.directoryId;
            }
            conversations.set(sessionId, created);
            return created;
          }
        });
        if (updated !== null) {
          dirtyMarks += 1;
        }
      }
    });

    try {
      const telemetryBaseMs = Date.now() - 1_000;
      const unixNanoAtOffset = (offsetMs: number): string =>
        `${BigInt(telemetryBaseMs + offsetMs) * 1_000_000n}`;
      const runningResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/logs/${encodeURIComponent(token)}`,
        {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: unixNanoAtOffset(100),
                      attributes: [
                        {
                          key: 'event.name',
                          value: {
                            stringValue: 'codex.user_prompt'
                          }
                        }
                      ],
                      body: {
                        stringValue: 'prompt submitted'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(runningResponse.statusCode, 200);
      await delay(25);

      const runningConversation = conversations.get('conversation-runtime');
      assert.notEqual(runningConversation, undefined);
      assert.equal(runningConversation?.status, 'running');
      assert.equal(runningConversation?.lastKnownWork, 'active');

      const noisyTraceResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/traces/${encodeURIComponent(token)}`,
        {
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      name: 'handle_responses',
                      endTimeUnixNano: unixNanoAtOffset(300),
                      attributes: [
                        {
                          key: 'kind',
                          value: {
                            stringValue: 'response.output_text.delta'
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(noisyTraceResponse.statusCode, 200);
      await delay(25);
      const noisyConversation = conversations.get('conversation-runtime');
      assert.notEqual(noisyConversation, undefined);
      assert.equal(noisyConversation?.status, 'running');
      assert.equal(noisyConversation?.lastKnownWork, 'active');

      const runningRows = buildWorkspaceRailViewRows(
        {
          directories: [
            {
              key: 'directory-runtime',
              workspaceId: 'runtime',
              worktreeId: 'runtime',
              git: {
                branch: 'main',
                changedFiles: 0,
                additions: 0,
                deletions: 0
              }
            }
          ],
          conversations: [
            {
              sessionId: 'conversation-runtime',
              directoryKey: 'directory-runtime',
              title: 'runtime thread',
              agentLabel: 'codex',
              cpuPercent: null,
              memoryMb: null,
              lastKnownWork: runningConversation?.lastKnownWork ?? null,
              lastKnownWorkAt: runningConversation?.lastKnownWorkAt ?? null,
              status: runningConversation?.status ?? 'running',
              attentionReason: runningConversation?.attentionReason ?? null,
              startedAt: '2026-02-15T00:00:00.000Z',
              lastEventAt: runningConversation?.lastEventAt ?? null,
              controller: null
            }
          ],
          processes: [],
          activeProjectId: null,
          activeConversationId: 'conversation-runtime',
          nowMs: 0
        },
        30
      );
      const runningTitleRow = runningRows.find((row) => row.kind === 'conversation-title');
      const runningBodyRow = runningRows.find((row) => row.kind === 'conversation-body');
      assert.notEqual(runningTitleRow, undefined);
      assert.equal(runningTitleRow?.text.includes('◆'), true);
      assert.equal(runningBodyRow?.text.includes('active'), true);

      const completedResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/logs/${encodeURIComponent(token)}`,
        {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: unixNanoAtOffset(400),
                      attributes: [
                        {
                          key: 'event.name',
                          value: {
                            stringValue: 'codex.sse_event'
                          }
                        }
                      ],
                      body: {
                        stringValue: 'stream response.completed'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(completedResponse.statusCode, 200);
      await delay(25);

      const completedConversation = conversations.get('conversation-runtime');
      assert.notEqual(completedConversation, undefined);
      assert.equal(completedConversation?.status, 'running');
      assert.equal(completedConversation?.lastKnownWork, 'active');

      const delayedMetricResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
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
                        dataPoints: [
                          {
                            timeUnixNano: unixNanoAtOffset(1_400),
                            asDouble: 611
                          }
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(delayedMetricResponse.statusCode, 200);
      await delay(25);

      const delayedMetricConversation = conversations.get('conversation-runtime');
      assert.notEqual(delayedMetricConversation, undefined);
      assert.equal(delayedMetricConversation?.status, 'completed');
      assert.equal(delayedMetricConversation?.lastKnownWork, 'inactive');

      const postCompleteTraceResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/traces/${encodeURIComponent(token)}`,
        {
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      name: 'receiving',
                      endTimeUnixNano: unixNanoAtOffset(500)
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(postCompleteTraceResponse.statusCode, 200);
      await delay(25);
      const postCompleteConversation = conversations.get('conversation-runtime');
      assert.notEqual(postCompleteConversation, undefined);
      assert.equal(postCompleteConversation?.status, 'completed');
      assert.equal(postCompleteConversation?.lastKnownWork, 'inactive');

      const resumedResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/logs/${encodeURIComponent(token)}`,
        {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: unixNanoAtOffset(1_600),
                      attributes: [
                        {
                          key: 'event.name',
                          value: {
                            stringValue: 'codex.user_prompt'
                          }
                        }
                      ],
                      body: {
                        stringValue: 'next prompt'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(resumedResponse.statusCode, 200);
      await delay(25);

      const resumedConversation = conversations.get('conversation-runtime');
      assert.notEqual(resumedConversation, undefined);
      assert.equal(resumedConversation?.status, 'running');
      assert.equal(resumedConversation?.lastKnownWork, 'active');
      assert.equal(dirtyMarks > 0, true);
    } finally {
      await subscription.close();
    }
  } finally {
    client.close();
    await server.close();
  }
});

void test('mux runtime wiring integration applies completion projection regardless of controller ownership', async () => {
  const launchedSessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50
    },
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      launchedSessions.push(session);
      return session;
    }
  });

  const address = server.address();
  const telemetryAddress = server.telemetryAddressInfo();
  assert.notEqual(telemetryAddress, null);

  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  const conversations = new Map<string, TestConversationState>();

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-runtime-agent',
      path: '/tmp/runtime-agent'
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-runtime-agent',
      directoryId: 'directory-runtime-agent',
      title: 'runtime agent thread',
      agentType: 'codex'
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-runtime-agent',
      args: [],
      initialCols: 80,
      initialRows: 24
    });

    const launched = launchedSessions[0];
    assert.notEqual(launched, undefined);
    const exporterArg = launched?.input.args.find((entry) => entry.includes('/v1/logs/'));
    assert.notEqual(exporterArg, undefined);
    const tokenMatch = /\/v1\/logs\/([^"]+)/u.exec(exporterArg!);
    assert.notEqual(tokenMatch, null);
    const token = decodeURIComponent(tokenMatch?.[1] ?? '');
    assert.notEqual(token.length, 0);

    const subscription = await subscribeControlPlaneKeyEvents(client, {
      onEvent: (event) => {
        applyMuxControlPlaneKeyEvent(event, {
          removedConversationIds: new Set<string>(),
          ensureConversation: (sessionId, seed) => {
            const existing = conversations.get(sessionId);
            if (existing !== undefined) {
              if (seed?.directoryId !== undefined) {
                existing.directoryId = seed.directoryId;
              }
              return existing;
            }
            const created = createConversationState(sessionId);
            if (seed?.directoryId !== undefined) {
              created.directoryId = seed.directoryId;
            }
            conversations.set(sessionId, created);
            return created;
          }
        });
      }
    });

    try {
      const telemetryBaseMs = Date.now() - 1_000;
      const unixNanoAtOffset = (offsetMs: number): string =>
        `${BigInt(telemetryBaseMs + offsetMs) * 1_000_000n}`;

      await client.sendCommand({
        type: 'session.claim',
        sessionId: 'conversation-runtime-agent',
        controllerId: 'agent-1',
        controllerType: 'agent',
        controllerLabel: 'agent-1'
      });
      await delay(25);

      const promptResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/logs/${encodeURIComponent(token)}`,
        {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: unixNanoAtOffset(100),
                      attributes: [
                        {
                          key: 'event.name',
                          value: {
                            stringValue: 'codex.user_prompt'
                          }
                        }
                      ],
                      body: {
                        stringValue: 'prompt submitted'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(promptResponse.statusCode, 200);
      await delay(25);

      const runningConversation = conversations.get('conversation-runtime-agent');
      assert.notEqual(runningConversation, undefined);
      assert.equal(runningConversation?.status, 'running');
      assert.equal(runningConversation?.controller?.controllerType, 'agent');
      assert.equal(runningConversation?.lastKnownWork, 'active');

      const completedTurnResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/logs/${encodeURIComponent(token)}`,
        {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: unixNanoAtOffset(400),
                      attributes: [
                        {
                          key: 'event.name',
                          value: {
                            stringValue: 'codex.sse_event'
                          }
                        }
                      ],
                      body: {
                        stringValue: 'stream response.completed'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(completedTurnResponse.statusCode, 200);
      await delay(25);

      const completedMetricResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
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
                        dataPoints: [
                          {
                            timeUnixNano: unixNanoAtOffset(700),
                            asDouble: 611
                          }
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(completedMetricResponse.statusCode, 200);
      await delay(25);

      const afterTurnCompletion = conversations.get('conversation-runtime-agent');
      assert.notEqual(afterTurnCompletion, undefined);
      assert.equal(afterTurnCompletion?.lastKnownWork, 'inactive');

      const rowsWhileAgentActive = buildWorkspaceRailViewRows(
        {
          directories: [
            {
              key: 'directory-runtime-agent',
              workspaceId: 'runtime',
              worktreeId: 'runtime',
              git: {
                branch: 'main',
                changedFiles: 0,
                additions: 0,
                deletions: 0
              }
            }
          ],
          conversations: [
            {
              sessionId: 'conversation-runtime-agent',
              directoryKey: 'directory-runtime-agent',
              title: 'runtime agent thread',
              agentLabel: 'codex',
              cpuPercent: null,
              memoryMb: null,
              lastKnownWork: afterTurnCompletion?.lastKnownWork ?? null,
              lastKnownWorkAt: afterTurnCompletion?.lastKnownWorkAt ?? null,
              status: afterTurnCompletion?.status ?? 'running',
              attentionReason: afterTurnCompletion?.attentionReason ?? null,
              startedAt: '2026-02-15T00:00:00.000Z',
              lastEventAt: afterTurnCompletion?.lastEventAt ?? null,
              controller: afterTurnCompletion?.controller ?? null
            }
          ],
          processes: [],
          activeProjectId: null,
          activeConversationId: 'conversation-runtime-agent',
          nowMs: 0
        },
        30
      );
      const titleRowWhileAgentActive = rowsWhileAgentActive.find((row) => row.kind === 'conversation-title');
      const bodyRowWhileAgentActive = rowsWhileAgentActive.find((row) => row.kind === 'conversation-body');
      assert.notEqual(titleRowWhileAgentActive, undefined);
      assert.equal(titleRowWhileAgentActive?.text.includes('○'), true);
      assert.equal(bodyRowWhileAgentActive?.text.includes('inactive'), true);

      const taskTerminalResponse = await postJson(
        {
          host: telemetryAddress?.address ?? '127.0.0.1',
          port: telemetryAddress?.port ?? 0
        },
        `/v1/logs/${encodeURIComponent(token)}`,
        {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: unixNanoAtOffset(900),
                      attributes: [
                        {
                          key: 'event.name',
                          value: {
                            stringValue: 'codex.task.completed'
                          }
                        }
                      ],
                      body: {
                        stringValue: 'task completed'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      );
      assert.equal(taskTerminalResponse.statusCode, 200);
      await delay(25);

      const afterTaskTerminal = conversations.get('conversation-runtime-agent');
      assert.notEqual(afterTaskTerminal, undefined);
      assert.equal(afterTaskTerminal?.lastKnownWork, 'inactive');

      const rowsAfterTaskTerminal = buildWorkspaceRailViewRows(
        {
          directories: [
            {
              key: 'directory-runtime-agent',
              workspaceId: 'runtime',
              worktreeId: 'runtime',
              git: {
                branch: 'main',
                changedFiles: 0,
                additions: 0,
                deletions: 0
              }
            }
          ],
          conversations: [
            {
              sessionId: 'conversation-runtime-agent',
              directoryKey: 'directory-runtime-agent',
              title: 'runtime agent thread',
              agentLabel: 'codex',
              cpuPercent: null,
              memoryMb: null,
              lastKnownWork: afterTaskTerminal?.lastKnownWork ?? null,
              lastKnownWorkAt: afterTaskTerminal?.lastKnownWorkAt ?? null,
              status: afterTaskTerminal?.status ?? 'running',
              attentionReason: afterTaskTerminal?.attentionReason ?? null,
              startedAt: '2026-02-15T00:00:00.000Z',
              lastEventAt: afterTaskTerminal?.lastEventAt ?? null,
              controller: afterTaskTerminal?.controller ?? null
            }
          ],
          processes: [],
          activeProjectId: null,
          activeConversationId: 'conversation-runtime-agent',
          nowMs: 0
        },
        30
      );
      const titleRowAfterTaskTerminal = rowsAfterTaskTerminal.find((row) => row.kind === 'conversation-title');
      const bodyRowAfterTaskTerminal = rowsAfterTaskTerminal.find((row) => row.kind === 'conversation-body');
      assert.notEqual(titleRowAfterTaskTerminal, undefined);
      assert.equal(titleRowAfterTaskTerminal?.text.includes('○'), true);
      assert.equal(bodyRowAfterTaskTerminal?.text.includes('inactive'), true);
    } finally {
      await subscription.close();
    }
  } finally {
    client.close();
    await server.close();
  }
});

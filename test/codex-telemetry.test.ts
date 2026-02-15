import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCodexTelemetryConfigArgs,
  extractCodexThreadId,
  parseCodexHistoryLine,
  parseOtlpLogEvents,
  parseOtlpMetricEvents,
  parseOtlpTraceEvents,
  telemetryFingerprint
} from '../src/control-plane/codex-telemetry.ts';

void test('buildCodexTelemetryConfigArgs emits codex -c overrides for logs/metrics/traces/history', () => {
  const args = buildCodexTelemetryConfigArgs({
    endpointBaseUrl: 'http://127.0.0.1:4318/',
    token: 'token with space',
    logUserPrompt: true,
    captureLogs: true,
    captureMetrics: true,
    captureTraces: true,
    historyPersistence: 'save-all'
  });

  assert.deepEqual(args, [
    '-c',
    'otel.log_user_prompt=true',
    '-c',
    'otel.exporter={otlp-http={endpoint="http://127.0.0.1:4318/v1/logs/token%20with%20space",protocol="json"}}',
    '-c',
    'otel.metrics_exporter={otlp-http={endpoint="http://127.0.0.1:4318/v1/metrics/token%20with%20space",protocol="json"}}',
    '-c',
    'otel.trace_exporter={otlp-http={endpoint="http://127.0.0.1:4318/v1/traces/token%20with%20space",protocol="json"}}',
    '-c',
    'history.persistence="save-all"'
  ]);
});

void test('buildCodexTelemetryConfigArgs supports selective capture and disabled prompt logging', () => {
  const args = buildCodexTelemetryConfigArgs({
    endpointBaseUrl: 'http://localhost:4000',
    token: 'abc',
    logUserPrompt: false,
    captureLogs: false,
    captureMetrics: false,
    captureTraces: true,
    historyPersistence: 'none'
  });
  assert.deepEqual(args, [
    '-c',
    'otel.log_user_prompt=false',
    '-c',
    'otel.trace_exporter={otlp-http={endpoint="http://localhost:4000/v1/traces/abc",protocol="json"}}',
    '-c',
    'history.persistence="none"'
  ]);
});

void test('parseOtlpLogEvents parses records, thread ids, summaries, and status hints', () => {
  const events = parseOtlpLogEvents(
    {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'codex' } },
              { key: 'build', value: { intValue: '7' } }
            ]
          },
          scopeLogs: [
            {
              scope: {
                attributes: [{ key: 'scope.bool', value: { boolValue: true } }]
              },
              logRecords: [
                {
                  timeUnixNano: '1700000000000000000',
                  severityText: 'INFO',
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.user_prompt' } },
                    { key: 'status', value: { stringValue: 'ok' } },
                    { key: 'thread-id', value: { stringValue: 'thread-1' } },
                    {
                      key: 'kv',
                      value: {
                        kvlistValue: {
                          values: [{ key: 'inner', value: { doubleValue: 1.2 } }]
                        }
                      }
                    },
                    {
                      key: 'arr',
                      value: {
                        arrayValue: {
                          values: [{ stringValue: 'a' }, { intValue: '2' }, { boolValue: false }]
                        }
                      }
                    },
                    { key: 'bytes', value: { bytesValue: 'Ymlu' } }
                  ],
                  body: {
                    stringValue: 'prompt accepted'
                  }
                },
                {
                  observedTimeUnixNano: '1700000001000000000',
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.sse_event' } },
                    { key: 'kind', value: { stringValue: 'response.completed' } },
                    { key: 'session_id', value: { stringValue: 'thread-1' } }
                  ],
                  body: {
                    kvlistValue: {
                      values: [{ key: 'event', value: { stringValue: 'response.completed' } }]
                    }
                  }
                },
                {
                  // malformed attributes/body still result in payload retention
                  attributes: 'bad-shape',
                  body: {
                    unknown: true
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );

  assert.equal(events.length, 3);
  assert.equal(events[0]?.source, 'otlp-log');
  assert.equal(events[0]?.eventName, 'codex.user_prompt');
  assert.equal(events[0]?.severity, 'INFO');
  assert.equal(events[0]?.providerThreadId, 'thread-1');
  assert.equal(events[0]?.statusHint, 'running');
  assert.equal(events[0]?.summary, 'prompt: prompt accepted');
  assert.equal(events[1]?.statusHint, 'completed');
  assert.equal(events[2]?.eventName, null);
  assert.equal(events[2]?.summary, null);
  assert.equal(events[2]?.statusHint, null);
});

void test('parseOtlpLogEvents maps codex event families to concise summaries', () => {
  const events = parseOtlpLogEvents(
    {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.conversation_starts' } },
                    { key: 'model_name', value: { stringValue: 'gpt-5' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.api_request' } },
                    { key: 'status', value: { stringValue: 'ok' } },
                    { key: 'duration_ms', value: { stringValue: '123' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.api_request' } },
                    { key: 'status', value: { stringValue: 'ok' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.api_request' } },
                    { key: 'duration_ms', value: { stringValue: '9' } }
                  ]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.api_request' } }]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_decision' } },
                    { key: 'decision', value: { stringValue: 'approved' } },
                    { key: 'tool_name', value: { stringValue: 'shell' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_decision' } },
                    { key: 'decision', value: { stringValue: 'approved' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_decision' } },
                    { key: 'tool_name', value: { stringValue: 'grep' } }
                  ]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.tool_decision' } }]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_result' } },
                    { key: 'tool_name', value: { stringValue: 'ls' } },
                    { key: 'result', value: { stringValue: 'ok' } },
                    { key: 'duration_ms', value: { intValue: '5' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_result' } },
                    { key: 'tool_name', value: { stringValue: 'ls' } },
                    { key: 'result', value: { stringValue: 'ok' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_result' } },
                    { key: 'tool_name', value: { stringValue: 'ls' } },
                    { key: 'duration_ms', value: { intValue: '7' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_result' } },
                    { key: 'tool_name', value: { stringValue: 'ls' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.tool_result' } },
                    { key: 'result', value: { stringValue: 'failed' } }
                  ]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.tool_result' } }]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.websocket_request' } },
                    { key: 'duration_ms', value: { intValue: '22' } }
                  ]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.websocket_request' } }]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.websocket_event' } },
                    { key: 'kind', value: { stringValue: 'connected' } },
                    { key: 'status', value: { stringValue: 'ok' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.websocket_event' } },
                    { key: 'kind', value: { stringValue: 'connected' } }
                  ]
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.websocket_event' } },
                    { key: 'status', value: { stringValue: 'ok' } }
                  ]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.websocket_event' } }]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.user_prompt' } }]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.conversation_starts' } }]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.sse_event' } }],
                  body: { stringValue: 'response.output_text.delta' }
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.sse_event' } }]
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );

  assert.equal(events.length, 25);
  assert.equal(events[0]?.summary, 'conversation started (gpt-5)');
  assert.equal(events[1]?.summary, 'model request ok (123ms)');
  assert.equal(events[2]?.summary, 'model request ok');
  assert.equal(events[3]?.summary, 'model request (9ms)');
  assert.equal(events[4]?.summary, 'model request');
  assert.equal(events[5]?.summary, 'approval approved (shell)');
  assert.equal(events[6]?.summary, 'approval approved');
  assert.equal(events[7]?.summary, 'approval (grep)');
  assert.equal(events[8]?.summary, 'approval decision');
  assert.equal(events[9]?.summary, 'tool ls ok (5ms)');
  assert.equal(events[10]?.summary, 'tool ls ok');
  assert.equal(events[11]?.summary, 'tool ls (7ms)');
  assert.equal(events[12]?.summary, 'tool ls');
  assert.equal(events[13]?.summary, 'tool result failed');
  assert.equal(events[14]?.summary, 'tool result');
  assert.equal(events[15]?.summary, 'realtime request (22ms)');
  assert.equal(events[16]?.summary, 'realtime request');
  assert.equal(events[17]?.summary, 'realtime connected (ok)');
  assert.equal(events[18]?.summary, 'realtime connected');
  assert.equal(events[19]?.summary, 'realtime event (ok)');
  assert.equal(events[20]?.summary, 'realtime event');
  assert.equal(events[21]?.summary, 'prompt submitted');
  assert.equal(events[22]?.summary, 'conversation started');
  assert.equal(events[23]?.summary, 'stream response.output_text.delta');
  assert.equal(events[24]?.summary, 'stream event');
});

void test('parseOtlpLogEvents derives status hints through nested payload and fallback paths', () => {
  const events = parseOtlpLogEvents(
    {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'custom.running' } },
                    { key: 'status', value: { stringValue: 'in progress' } }
                  ],
                  body: { stringValue: 'x' }
                },
                {
                  severityText: 'ERROR',
                  attributes: [{ key: 'event.name', value: { stringValue: 'custom.error' } }],
                  body: { stringValue: 'custom body' }
                },
                {
                  attributes: [],
                  body: { stringValue: 'turn completed' }
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.sse_event' } }],
                  body: {
                    wrapper: {
                      kind: 'response.completed'
                    }
                  }
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.sse_event' } }],
                  body: [
                    {
                      nested: {
                        kind: 'needs-input'
                      }
                    }
                  ]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.user_prompt' } }],
                  body: { stringValue: `${'x'.repeat(80)}` }
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'codex.api_request' } }],
                  body: {
                    deeply: {
                      nested: {
                        levels: {
                          beyond: {
                            maxDepth: {
                              status: 'ok'
                            }
                          }
                        }
                      }
                    }
                  }
                },
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.api_request' } },
                    { key: 'duration_ms', value: { stringValue: 'not-a-number' } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );

  assert.equal(events.length, 8);
  assert.equal(events[0]?.statusHint, 'running');
  assert.equal(events[1]?.statusHint, 'needs-input');
  assert.equal(events[2]?.statusHint, 'completed');
  assert.equal(events[3]?.summary, 'stream response.completed');
  assert.equal(events[3]?.statusHint, 'completed');
  assert.equal(events[4]?.statusHint, 'needs-input');
  assert.equal(events[5]?.summary?.endsWith('…'), true);
  assert.equal(events[6]?.summary, 'model request');
  assert.equal(events[7]?.summary, 'model request');
});

void test('parseOtlpLogEvents covers statusHint fallback branches for needs-input summary text and api status fields', () => {
  const events = parseOtlpLogEvents(
    {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    { key: 'event.name', value: { stringValue: 'codex.api_request' } },
                    { key: 'kind', value: { stringValue: 'noop' } },
                    { key: 'status', value: { stringValue: 'failed' } }
                  ]
                },
                {
                  attributes: [{ key: 'event.name', value: { stringValue: 'custom.event' } }],
                  body: { stringValue: 'needs-input from summary fallback' }
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );

  assert.equal(events.length, 2);
  assert.equal(events[0]?.statusHint, 'needs-input');
  assert.equal(events[1]?.statusHint, 'needs-input');
});

void test('parseOtlpLogEvents returns empty on invalid root shape', () => {
  assert.deepEqual(parseOtlpLogEvents({}, '2026-01-01T00:00:00.000Z'), []);
  assert.deepEqual(parseOtlpLogEvents(null, '2026-01-01T00:00:00.000Z'), []);
});

void test('parseOtlpMetricEvents parses metrics and status hints', () => {
  const events = parseOtlpMetricEvents(
    {
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: 'thread_id', value: { stringValue: 'thread-m' } }]
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'codex.turn.e2e_duration_ms',
                  sum: {
                    dataPoints: [{}, {}]
                  }
                },
                {
                  gauge: {
                    dataPoints: [{}]
                  }
                },
                {
                  histogram: {
                    dataPoints: [{}, {}, {}]
                  }
                },
                {
                  exponentialHistogram: {
                    dataPoints: [{}]
                  }
                },
                {
                  summary: {
                    dataPoints: [{}, {}]
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(events.length, 5);
  assert.equal(events[0]?.eventName, 'codex.turn.e2e_duration_ms');
  assert.equal(events[0]?.summary, 'codex.turn.e2e_duration_ms points=2');
  assert.equal(events[0]?.providerThreadId, 'thread-m');
  assert.equal(events[1]?.eventName, null);
  assert.equal(events[1]?.summary, 'metric points=1');
  assert.equal(events[2]?.summary, 'metric points=3');
  assert.equal(events[3]?.summary, 'metric points=1');
  assert.equal(events[4]?.summary, 'metric points=2');
});

void test('parseOtlpMetricEvents maps codex turn latency metrics to completed status hints', () => {
  const events = parseOtlpMetricEvents(
    {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'codex.turn.e2e_duration_ms',
                  gauge: {
                    dataPoints: [{ asDouble: 812.4 }]
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.summary, 'turn complete (812ms)');
  assert.equal(events[0]?.statusHint, 'completed');
});

void test('parseOtlpMetricEvents maps turn count summary and reads sum-valued points', () => {
  const events = parseOtlpMetricEvents(
    {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'codex.conversation.turn.count',
                  summary: {
                    dataPoints: [null, { sum: 4.8 }]
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.summary, 'turn count 5');
  assert.equal(events[0]?.statusHint, 'completed');
});

void test('parseOtlpMetricEvents returns empty on invalid root shape', () => {
  assert.deepEqual(parseOtlpMetricEvents({}, '2026-02-15T00:00:00.000Z'), []);
});

void test('parseOtlpTraceEvents parses spans and thread ids', () => {
  const events = parseOtlpTraceEvents(
    {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'codex' } }]
          },
          scopeSpans: [
            {
              spans: [
                {
                  name: 'codex.websocket_event',
                  endTimeUnixNano: '1700000005000000000',
                  attributes: [{ key: 'thread-id', value: { stringValue: 'thread-t' } }]
                },
                {
                  attributes: [{ key: 'x', value: { boolValue: true } }]
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(events.length, 2);
  assert.equal(events[0]?.eventName, 'codex.websocket_event');
  assert.equal(events[0]?.providerThreadId, 'thread-t');
  assert.equal(events[1]?.eventName, null);
});

void test('parseOtlpTraceEvents covers summary variants for span name, kind, and status fields', () => {
  const events = parseOtlpTraceEvents(
    {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  name: 'trace.one',
                  attributes: [{ key: 'status', value: { stringValue: 'ok' } }]
                },
                {
                  name: 'trace.two',
                  attributes: [{ key: 'kind', value: { stringValue: 'response.output_text.delta' } }]
                },
                {
                  attributes: [{ key: 'kind', value: { stringValue: 'response.started' } }]
                },
                {
                  attributes: [{ key: 'status', value: { stringValue: 'error' } }]
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(events.length, 4);
  assert.equal(events[0]?.summary, 'trace.one (ok)');
  assert.equal(events[1]?.summary, 'trace.two: response.output_text.delta');
  assert.equal(events[2]?.summary, 'response.started');
  assert.equal(events[3]?.summary, 'error');
  assert.equal(events[3]?.statusHint, 'needs-input');
});

void test('parseOtlpTraceEvents returns empty on invalid root shape', () => {
  assert.deepEqual(parseOtlpTraceEvents({ resourceSpans: null }, '2026-02-15T00:00:00.000Z'), []);
});

void test('parseCodexHistoryLine parses history entries and rejects invalid lines', () => {
  const parsed = parseCodexHistoryLine(
    JSON.stringify({
      timestamp: '2026-02-15T10:00:00.000Z',
      type: 'user_prompt',
      message: 'hello',
      session_id: 'thread-h'
    }),
    '2026-02-15T00:00:00.000Z'
  );
  assert.notEqual(parsed, null);
  assert.equal(parsed?.source, 'history');
  assert.equal(parsed?.eventName, 'user_prompt');
  assert.equal(parsed?.summary, 'hello');
  assert.equal(parsed?.providerThreadId, 'thread-h');
  assert.equal(parsed?.statusHint, 'running');

  const fallback = parseCodexHistoryLine(
    JSON.stringify({
      entry: {
        text: 'no timestamp'
      }
    }),
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(fallback?.eventName, 'history.entry');
  assert.equal(fallback?.observedAt, '2026-02-15T00:00:00.000Z');

  assert.equal(parseCodexHistoryLine('{', '2026-02-15T00:00:00.000Z'), null);
  assert.equal(parseCodexHistoryLine('[]', '2026-02-15T00:00:00.000Z'), null);
});

void test('parseCodexHistoryLine derives completed status from summary text fallback', () => {
  const parsed = parseCodexHistoryLine(
    JSON.stringify({
      type: 'custom.event',
      summary: 'turn completed'
    }),
    '2026-02-15T00:00:00.000Z'
  );
  assert.notEqual(parsed, null);
  assert.equal(parsed?.statusHint, 'completed');
});

void test('extractCodexThreadId scans nested records and arrays', () => {
  assert.equal(
    extractCodexThreadId({
      payload: {
        metadata: {
          session_id: 'thread-nested'
        }
      }
    }),
    'thread-nested'
  );
  assert.equal(extractCodexThreadId({}), null);
  assert.equal(extractCodexThreadId(['x']), null);
  assert.equal(
    extractCodexThreadId({
      payload: {
        metadata: {
          context: {
            data: {
              entry: {
                thread_id: 'too-deep-to-collect'
              }
            }
          }
        }
      }
    }),
    null
  );
});

void test('telemetryFingerprint is deterministic and sensitive to key fields', () => {
  const base = telemetryFingerprint({
    source: 'otlp-log',
    sessionId: 'session-1',
    providerThreadId: 'thread-1',
    eventName: 'codex.user_prompt',
    observedAt: '2026-02-15T10:00:00.000Z',
    payload: {
      hello: 'world'
    }
  });
  const same = telemetryFingerprint({
    source: 'otlp-log',
    sessionId: 'session-1',
    providerThreadId: 'thread-1',
    eventName: 'codex.user_prompt',
    observedAt: '2026-02-15T10:00:00.000Z',
    payload: {
      hello: 'world'
    }
  });
  const different = telemetryFingerprint({
    source: 'otlp-log',
    sessionId: 'session-2',
    providerThreadId: 'thread-1',
    eventName: 'codex.user_prompt',
    observedAt: '2026-02-15T10:00:00.000Z',
    payload: {
      hello: 'world'
    }
  });
  assert.equal(base, same);
  assert.notEqual(base, different);

  const nullable = telemetryFingerprint({
    source: 'history',
    sessionId: null,
    providerThreadId: null,
    eventName: null,
    observedAt: '2026-02-15T10:00:00.000Z',
    payload: {}
  });
  assert.equal(typeof nullable, 'string');
  assert.equal(nullable.length, 40);
});

void test('codex telemetry parsers tolerate malformed nested payload shapes and branch fallbacks', () => {
  const malformedLogs = parseOtlpLogEvents(
    {
      resourceLogs: [
        null,
        {
          scopeLogs: 'bad'
        },
        {
          scopeLogs: [
            null,
            {
              logRecords: 'bad'
            },
            {
              logRecords: [
                null,
                {
                  timeUnixNano: 1700000000000000000,
                  severityText: '   ',
                  attributes: [
                    null,
                    {
                      key: 5
                    },
                    {
                      key: 'raw',
                      value: 7
                    },
                    {
                      key: 'int-num',
                      value: {
                        intValue: 9
                      }
                    },
                    {
                      key: 'int-string-invalid',
                      value: {
                        intValue: 'nan'
                      }
                    },
                    {
                      key: 'kv-weird',
                      value: {
                        kvlistValue: {
                          values: [null, { key: 5, value: { stringValue: 'x' } }]
                        }
                      }
                    },
                    {
                      key: 'event.name',
                      value: {
                        stringValue: ''
                      }
                    },
                    {
                      key: 'kind',
                      value: {
                        stringValue: 'needs-input'
                      }
                    }
                  ],
                  body: true
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(malformedLogs.length, 1);
  assert.equal(malformedLogs[0]?.severity, null);
  assert.equal(malformedLogs[0]?.statusHint, 'needs-input');
  assert.equal(typeof malformedLogs[0]?.payload['attributes'], 'object');
  assert.equal(
    (
      (malformedLogs[0]?.payload['attributes'] as Record<string, unknown>)[
        'int-string-invalid'
      ] as string
    ).toLowerCase(),
    'nan'
  );

  const malformedMetrics = parseOtlpMetricEvents(
    {
      resourceMetrics: [
        null,
        {
          scopeMetrics: 'bad'
        },
        {
          scopeMetrics: [
            null,
            {
              metrics: 'bad'
            },
            {
              metrics: [null, {}]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(malformedMetrics.length, 1);
  assert.equal(malformedMetrics[0]?.summary, 'metric points=0');

  const malformedTraces = parseOtlpTraceEvents(
    {
      resourceSpans: [
        null,
        {
          scopeSpans: 'bad'
        },
        {
          scopeSpans: [
            null,
            {
              spans: 'bad'
            },
            {
              spans: [null, { endTimeUnixNano: 1700000000000000000 }]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(malformedTraces.length, 1);
  assert.equal(malformedTraces[0]?.eventName, null);

  assert.equal(
    extractCodexThreadId({
      thread_id: Array.from({ length: 20 }, (_, idx) => `thread-${String(idx)}`),
      data: 5
    }),
    'thread-0'
  );
});

void test('codex telemetry log summaries and status hints can derive from summary text', () => {
  const events = parseOtlpLogEvents(
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
                      value: { stringValue: 'custom.event' }
                    },
                    {
                      key: 'status',
                      value: { stringValue: 'response.completed' }
                    }
                  ],
                  body: { stringValue: 'custom body' }
                },
                {
                  attributes: [
                    {
                      key: 'event.name',
                      value: { stringValue: 'custom.event.with.body' }
                    }
                  ],
                  body: { stringValue: 'detail body' }
                }
              ]
            }
          ]
        }
      ]
    },
    '2026-02-15T00:00:00.000Z'
  );

  assert.equal(events.length, 2);
  assert.equal(events[0]?.summary, 'custom.event (response.completed)');
  assert.equal(events[0]?.statusHint, 'completed');
  assert.equal(events[1]?.summary, 'custom.event.with.body: detail body');
});

void test('codex history parsing handles numeric timestamps, fallback timestamps, and null summaries', () => {
  const numericTs = parseCodexHistoryLine(
    JSON.stringify({
      timestamp: 1700000000000,
      kind: 'event-kind',
      summary: 7,
      session_id: 'thread-num'
    }),
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(numericTs?.observedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(numericTs?.summary, '7');
  assert.equal(numericTs?.eventName, 'event-kind');

  const invalidTs = parseCodexHistoryLine(
    JSON.stringify({
      timestamp: 'not-a-date',
      type: '',
      entry: {
        text: null
      }
    }),
    '2026-02-15T00:00:00.000Z'
  );
  assert.equal(invalidTs?.observedAt, '2026-02-15T00:00:00.000Z');
  assert.equal(invalidTs?.eventName, 'history.entry');
  assert.equal(invalidTs?.summary, null);
});

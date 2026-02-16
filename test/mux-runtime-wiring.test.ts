import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMuxControlPlaneKeyEvent,
  applyTelemetrySummaryToConversation,
  telemetrySummaryText,
  type MuxRuntimeConversationState
} from '../src/mux/runtime-wiring.ts';
import { projectWorkspaceRailConversation } from '../src/mux/workspace-rail-model.ts';

interface TestConversationState extends MuxRuntimeConversationState {
  readonly sessionId: string;
}

function createConversationState(
  sessionId: string,
  overrides: Partial<TestConversationState> = {}
): TestConversationState {
  return {
    sessionId,
    directoryId: null,
    status: 'completed',
    attentionReason: null,
    live: true,
    controller: null,
    lastEventAt: null,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    lastTelemetrySource: null,
    ...overrides
  };
}

function projectedPhase(
  conversation: TestConversationState,
  nowIso: string
): {
  status: string;
  detail: string;
} {
  const projected = projectWorkspaceRailConversation(
    {
      sessionId: conversation.sessionId,
      directoryKey: conversation.directoryId ?? 'directory-test',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: conversation.lastKnownWork,
      lastKnownWorkAt: conversation.lastKnownWorkAt,
      status: conversation.status,
      attentionReason: conversation.attentionReason,
      startedAt: '2026-02-15T00:00:00.000Z',
      lastEventAt: conversation.lastEventAt,
      controller: null
    },
    {
      nowMs: Date.parse(nowIso)
    }
  );
  return {
    status: projected.status,
    detail: projected.detailText
  };
}

void test('runtime wiring summarizes telemetry text deterministically', () => {
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: 'prompt submitted'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: 'codex.user_prompt: prompt submitted'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: null
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-trace',
      eventName: null,
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: '   ',
      eventName: null,
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: null,
      summary: `x${'y'.repeat(140)}`
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream response.output_text.delta'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream response.completed'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream response.error'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream response.reasoning_summary_part.added'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream response.created'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream response.in_progress'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream response.output_item.added'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: 'stream noop'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: 'write me a very long poem'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.api_request',
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: 'prompt: already prefixed'
    }),
    'active'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.websocket_request',
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.conversation_starts',
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.conversation_starts',
      summary: 'conversation started (gpt-5)'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.websocket_event',
      summary: 'realtime response.delta'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.websocket_event',
      summary: 'realtime error connection dropped'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.tool_decision',
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.tool_result',
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.custom_event',
      summary: 'custom event summary'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'history.entry',
      summary: ''
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'history',
      eventName: 'history.entry',
      summary: 'hello world'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-metric',
      eventName: 'codex.api_request',
      summary: 'codex.api_request points=1'
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-metric',
      eventName: 'codex.turn.e2e_duration_ms',
      summary: null
    }),
    'inactive'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.task.completed',
      summary: null
    }),
    null
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.api_request',
      summary: 'x'.repeat(150)
    }),
    null
  );
});

void test('runtime wiring applies telemetry summary to conversation state', () => {
  const conversation = createConversationState('conversation-a');
  applyTelemetrySummaryToConversation(conversation, null);
  assert.equal(conversation.lastKnownWork, null);
  assert.equal(conversation.lastKnownWorkAt, null);
  assert.equal(conversation.lastTelemetrySource, null);

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-log',
    eventName: 'codex.user_prompt',
    summary: 'prompt submitted',
    observedAt: '2026-02-15T00:00:00.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'active');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:00.000Z');
  assert.equal(conversation.lastTelemetrySource, 'otlp-log');
});

void test('runtime wiring uses codex sse progress events for startup/working text and keeps prompt semantics', () => {
  const conversation = createConversationState('conversation-startup-noise', {
    status: 'running',
    lastKnownWork: 'starting',
    lastKnownWorkAt: '2026-02-16T00:00:00.000Z',
    lastTelemetrySource: 'control-plane'
  });

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-log',
    eventName: 'codex.sse_event',
    summary: 'stream response.in_progress',
    observedAt: '2026-02-16T00:00:00.100Z'
  });
  assert.equal(conversation.lastKnownWork, 'active');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-16T00:00:00.100Z');

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-log',
    eventName: 'codex.user_prompt',
    summary: 'prompt submitted',
    observedAt: '2026-02-16T00:00:01.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'active');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-16T00:00:01.000Z');

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-log',
    eventName: 'codex.sse_event',
    summary: 'stream response.output_text.delta',
    observedAt: '2026-02-16T00:00:01.100Z'
  });
  assert.equal(conversation.lastKnownWork, 'active');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-16T00:00:01.100Z');
});

void test('runtime wiring ignores stale telemetry summaries that arrive out of order', () => {
  const conversation = createConversationState('conversation-stale', {
    lastKnownWork: 'turn complete (611ms)',
    lastKnownWorkAt: '2026-02-15T00:00:03.000Z',
    lastTelemetrySource: 'otlp-metric'
  });

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-log',
    eventName: 'codex.sse_event',
    summary: 'stream response.output_text.delta',
    observedAt: '2026-02-15T00:00:02.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'turn complete (611ms)');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:03.000Z');
  assert.equal(conversation.lastTelemetrySource, 'otlp-metric');
});

void test('runtime wiring ignores low-signal trace summaries and keeps existing work timestamp', () => {
  const conversation = createConversationState('conversation-noise', {
    status: 'running',
    lastKnownWork: 'working: writing',
    lastKnownWorkAt: '2026-02-15T00:00:00.000Z',
    lastTelemetrySource: 'otlp-log'
  });
  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-trace',
    eventName: 'receiving',
    summary: 'receiving: 1',
    observedAt: '2026-02-15T00:00:01.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'working: writing');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:00.000Z');
  assert.equal(conversation.lastTelemetrySource, 'otlp-log');

  conversation.lastKnownWork = 'idle';
  conversation.lastKnownWorkAt = '2026-02-15T00:00:02.000Z';
  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-trace',
    eventName: 'receiving',
    summary: 'receiving: 1',
    observedAt: '2026-02-15T00:00:03.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'idle');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:02.000Z');

  conversation.lastKnownWork = null;
  conversation.lastKnownWorkAt = null;
  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-trace',
    eventName: 'receiving',
    summary: 'receiving: 1',
    observedAt: '2026-02-15T00:00:03.500Z'
  });
  assert.equal(conversation.lastKnownWork, null);
  assert.equal(conversation.lastKnownWorkAt, null);

  conversation.lastKnownWork = 'needs-input: approval denied';
  conversation.lastKnownWorkAt = '2026-02-15T00:00:04.000Z';
  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-trace',
    eventName: 'receiving',
    summary: 'receiving: 1',
    observedAt: '2026-02-15T00:00:04.500Z'
  });
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:04.000Z');

  conversation.lastKnownWork = 'noop';
  conversation.lastKnownWorkAt = '2026-02-15T00:00:04.000Z';
  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-trace',
    eventName: 'receiving',
    summary: 'receiving: 1',
    observedAt: '2026-02-15T00:00:05.000Z'
  });
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:04.000Z');
});

void test('runtime wiring ignores key events for removed sessions', () => {
  const conversations = new Map<string, TestConversationState>();
  let ensureCalls = 0;
  const updated = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-status',
      sessionId: 'conversation-removed',
      status: 'running',
      attentionReason: null,
      live: true,
      ts: '2026-02-15T00:00:00.000Z',
      directoryId: 'directory-a',
      conversationId: 'conversation-removed',
      telemetry: null,
      controller: null,
      cursor: 1
    },
    {
      removedConversationIds: new Set(['conversation-removed']),
      ensureConversation: (sessionId) => {
        ensureCalls += 1;
        const existing = conversations.get(sessionId);
        if (existing !== undefined) {
          return existing;
        }
        const created = createConversationState(sessionId);
        conversations.set(sessionId, created);
        return created;
      }
    }
  );
  assert.equal(updated, null);
  assert.equal(ensureCalls, 0);
  assert.equal(conversations.size, 0);
});

void test('runtime wiring updates session-status and session-control events', () => {
  const conversations = new Map<string, TestConversationState>();
  const ensureConversation = (sessionId: string, seed?: { directoryId?: string | null }): TestConversationState => {
    const existing = conversations.get(sessionId);
    if (existing !== undefined) {
      if (seed?.directoryId !== undefined) {
        existing.directoryId = seed.directoryId;
      }
      return existing;
    }
    const created = createConversationState(sessionId, {
      directoryId: seed?.directoryId ?? null
    });
    conversations.set(sessionId, created);
    return created;
  };

  const statusConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-status',
      sessionId: 'conversation-status',
      status: 'running',
      attentionReason: 'telemetry',
      live: true,
      ts: '2026-02-15T00:00:01.000Z',
      directoryId: 'directory-a',
      conversationId: 'conversation-status',
      telemetry: {
        source: 'otlp-log',
        eventName: 'codex.user_prompt',
        severity: null,
        summary: 'prompt submitted',
        observedAt: '2026-02-15T00:00:01.000Z'
      },
      controller: null,
      cursor: 2
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(statusConversation, null);
  assert.equal(statusConversation?.status, 'running');
  assert.equal(statusConversation?.directoryId, 'directory-a');
  assert.equal(statusConversation?.lastEventAt, '2026-02-15T00:00:01.000Z');
  assert.equal(statusConversation?.lastKnownWork, 'active');

  const controlConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-control',
      sessionId: 'conversation-status',
      action: 'taken-over',
      controller: {
        controllerId: 'human-a',
        controllerType: 'human',
        controllerLabel: 'Jamie',
        claimedAt: '2026-02-15T00:00:02.000Z'
      },
      previousController: null,
      reason: 'manual',
      ts: '2026-02-15T00:00:02.000Z',
      directoryId: null,
      conversationId: 'conversation-status',
      cursor: 3
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(controlConversation, null);
  assert.equal(controlConversation?.directoryId, null);
  assert.equal(controlConversation?.controller?.controllerId, 'human-a');
  assert.equal(controlConversation?.lastEventAt, '2026-02-15T00:00:02.000Z');
});

void test('runtime wiring handles telemetry status hints and preserves exited status', () => {
  const conversations = new Map<string, TestConversationState>([
    [
      'conversation-telemetry',
      createConversationState('conversation-telemetry', {
        directoryId: 'directory-z',
        status: 'completed'
      })
    ],
    [
      'conversation-exited',
      createConversationState('conversation-exited', {
        status: 'exited'
      })
    ]
  ]);
  const ensureConversation = (sessionId: string, seed?: { directoryId?: string | null }): TestConversationState => {
    const existing = conversations.get(sessionId);
    if (existing !== undefined) {
      if (seed?.directoryId !== undefined) {
        existing.directoryId = seed.directoryId;
      }
      return existing;
    }
    const created = createConversationState(sessionId, {
      directoryId: seed?.directoryId ?? null
    });
    conversations.set(sessionId, created);
    return created;
  };

  const needsInputConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-telemetry',
      sessionId: 'conversation-telemetry',
      keyEvent: {
        source: 'otlp-log',
        eventName: 'codex.tool_decision',
        severity: null,
        summary: 'approval denied',
        observedAt: '2026-02-15T00:00:03.000Z',
        statusHint: 'needs-input'
      },
      ts: '2026-02-15T00:00:03.000Z',
      directoryId: null,
      conversationId: 'conversation-telemetry',
      cursor: 4
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(needsInputConversation, null);
  assert.equal(needsInputConversation?.status, 'completed');
  assert.equal(needsInputConversation?.attentionReason, null);

  const runningConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-telemetry',
      sessionId: 'conversation-telemetry',
      keyEvent: {
        source: 'otlp-log',
        eventName: 'codex.user_prompt',
        severity: null,
        summary: 'prompt submitted',
        observedAt: '2026-02-15T00:00:04.000Z',
        statusHint: 'running'
      },
      ts: '2026-02-15T00:00:04.000Z',
      directoryId: 'directory-y',
      conversationId: 'conversation-telemetry',
      cursor: 5
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(runningConversation, null);
  assert.equal(runningConversation?.status, 'running');
  assert.equal(runningConversation?.attentionReason, null);
  assert.equal(runningConversation?.directoryId, 'directory-y');

  const completedConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-telemetry',
      sessionId: 'conversation-telemetry',
      keyEvent: {
        source: 'otlp-metric',
        eventName: 'codex.turn.e2e_duration_ms',
        severity: null,
        summary: 'turn complete (611ms)',
        observedAt: '2026-02-15T00:00:05.000Z',
        statusHint: 'completed'
      },
      ts: '2026-02-15T00:00:05.000Z',
      directoryId: null,
      conversationId: 'conversation-telemetry',
      cursor: 6
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(completedConversation, null);
  assert.equal(completedConversation?.status, 'running');
  assert.equal(completedConversation?.attentionReason, null);

  const exitedRunningConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-telemetry',
      sessionId: 'conversation-exited',
      keyEvent: {
        source: 'otlp-log',
        eventName: 'codex.user_prompt',
        severity: null,
        summary: 'prompt submitted',
        observedAt: '2026-02-15T00:00:06.000Z',
        statusHint: 'running'
      },
      ts: '2026-02-15T00:00:06.000Z',
      directoryId: null,
      conversationId: 'conversation-exited',
      cursor: 7
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(exitedRunningConversation, null);
  assert.equal(exitedRunningConversation?.status, 'exited');

  const exitedCompletedConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-telemetry',
      sessionId: 'conversation-exited',
      keyEvent: {
        source: 'otlp-metric',
        eventName: 'codex.turn.e2e_duration_ms',
        severity: null,
        summary: 'turn complete (800ms)',
        observedAt: '2026-02-15T00:00:07.000Z',
        statusHint: 'completed'
      },
      ts: '2026-02-15T00:00:07.000Z',
      directoryId: null,
      conversationId: 'conversation-exited',
      cursor: 8
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(exitedCompletedConversation, null);
  assert.equal(exitedCompletedConversation?.status, 'exited');

  const noHintConversation = applyMuxControlPlaneKeyEvent(
    {
      type: 'session-telemetry',
      sessionId: 'conversation-telemetry',
      keyEvent: {
        source: 'otlp-trace',
        eventName: 'codex.websocket_event',
        severity: null,
        summary: 'realtime request',
        observedAt: '2026-02-15T00:00:08.000Z',
        statusHint: null
      },
      ts: '2026-02-15T00:00:08.000Z',
      directoryId: null,
      conversationId: 'conversation-telemetry',
      cursor: 9
    },
    {
      removedConversationIds: new Set(),
      ensureConversation
    }
  );
  assert.notEqual(noHintConversation, null);
  assert.equal(noHintConversation?.status, 'running');
  assert.equal(noHintConversation?.lastTelemetrySource, 'otlp-metric');
});

void test('runtime wiring sqlite-derived sequence stays prompt-driven with explicit turn completion only', () => {
  const conversation = createConversationState('conversation-sqlite-sequence', {
    status: 'running'
  });
  const ensureConversation = (): TestConversationState => conversation;
  const apply = (event: Parameters<typeof applyMuxControlPlaneKeyEvent<TestConversationState>>[0]): void => {
    const updated = applyMuxControlPlaneKeyEvent(event, {
      removedConversationIds: new Set(),
      ensureConversation
    });
    assert.notEqual(updated, null);
  };

  // Real sequence basis from sqlite conversation-b6ba... telemetry_ids:
  // 19229 conversation_starts, 19234 user_prompt, 19235 api_request,
  // 19237 response.in_progress, 19340 response.output_text.delta, 19510 response.completed.
  apply({
    type: 'session-status',
    sessionId: 'conversation-sqlite-sequence',
    status: 'running',
    attentionReason: null,
    live: true,
    ts: '2026-02-15T21:42:10.291Z',
    directoryId: 'directory-sqlite',
    conversationId: 'conversation-sqlite-sequence',
    telemetry: {
      source: 'otlp-log',
      eventName: 'codex.conversation_starts',
      severity: null,
      summary: 'conversation started (gpt-5.3-codex)',
      observedAt: '2026-02-15T21:42:10.291Z'
    },
    controller: null,
    cursor: 1
  });

  const transitions: string[] = [];
  const pushTransition = (nowIso: string): void => {
    const phase = projectedPhase(conversation, nowIso);
    const detail = phase.status === 'working' ? phase.detail : phase.status;
    if (transitions[transitions.length - 1] !== detail) {
      transitions.push(detail);
    }
  };

  pushTransition('2026-02-15T21:42:10.291Z');
  pushTransition('2026-02-15T21:42:12.500Z');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-sqlite-sequence',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      severity: null,
      summary: 'prompt submitted',
      observedAt: '2026-02-15T21:42:21.349Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T21:42:21.349Z',
    directoryId: 'directory-sqlite',
    conversationId: 'conversation-sqlite-sequence',
    cursor: 2
  });
  pushTransition('2026-02-15T21:42:21.349Z');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-sqlite-sequence',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.api_request',
      severity: null,
      summary: 'model request (1054ms)',
      observedAt: '2026-02-15T21:42:22.446Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T21:42:22.446Z',
    directoryId: 'directory-sqlite',
    conversationId: 'conversation-sqlite-sequence',
    cursor: 3
  });
  pushTransition('2026-02-15T21:42:22.446Z');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-sqlite-sequence',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.in_progress',
      observedAt: '2026-02-15T21:42:22.826Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T21:42:22.826Z',
    directoryId: 'directory-sqlite',
    conversationId: 'conversation-sqlite-sequence',
    cursor: 4
  });
  pushTransition('2026-02-15T21:42:22.826Z');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-sqlite-sequence',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.output_text.delta',
      observedAt: '2026-02-15T21:42:24.975Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T21:42:24.975Z',
    directoryId: 'directory-sqlite',
    conversationId: 'conversation-sqlite-sequence',
    cursor: 5
  });
  pushTransition('2026-02-15T21:42:24.975Z');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-sqlite-sequence',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.completed',
      observedAt: '2026-02-15T21:42:29.259Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T21:42:29.259Z',
    directoryId: 'directory-sqlite',
    conversationId: 'conversation-sqlite-sequence',
    cursor: 6
  });
  pushTransition('2026-02-15T21:42:29.259Z');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-sqlite-sequence',
    keyEvent: {
      source: 'otlp-metric',
      eventName: 'codex.turn.e2e_duration_ms',
      severity: null,
      summary: 'turn complete (611ms)',
      observedAt: '2026-02-15T21:42:29.900Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T21:42:29.900Z',
    directoryId: 'directory-sqlite',
    conversationId: 'conversation-sqlite-sequence',
    cursor: 7
  });
  pushTransition('2026-02-15T21:42:29.900Z');

  assert.deepEqual(transitions, ['starting', 'active', 'idle']);
});

void test('runtime wiring poem-like sequence keeps status high-signal and status line readable', () => {
  const conversation = createConversationState('conversation-poem', {
    status: 'completed'
  });
  const ensureConversation = (): TestConversationState => conversation;
  const apply = (event: Parameters<typeof applyMuxControlPlaneKeyEvent<TestConversationState>>[0]): void => {
    const updated = applyMuxControlPlaneKeyEvent(event, {
      removedConversationIds: new Set(),
      ensureConversation
    });
    assert.notEqual(updated, null);
  };

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-poem',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      severity: null,
      summary: 'prompt submitted',
      observedAt: '2026-02-15T00:00:01.000Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T00:00:01.000Z',
    directoryId: 'directory-poem',
    conversationId: 'conversation-poem',
    cursor: 10
  });
  assert.equal(conversation.status, 'running');
  assert.equal(conversation.lastKnownWork, 'active');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-poem',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.output_text.delta',
      observedAt: '2026-02-15T00:00:02.000Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T00:00:02.000Z',
    directoryId: 'directory-poem',
    conversationId: 'conversation-poem',
    cursor: 11
  });
  assert.equal(conversation.status, 'running');
  assert.equal(conversation.lastKnownWork, 'active');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-poem',
    keyEvent: {
      source: 'otlp-trace',
      eventName: 'handle_responses',
      severity: null,
      summary: 'handle_responses: 1',
      observedAt: '2026-02-15T00:00:03.000Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T00:00:03.000Z',
    directoryId: 'directory-poem',
    conversationId: 'conversation-poem',
    cursor: 12
  });
  assert.equal(conversation.status, 'running');
  assert.equal(conversation.lastKnownWork, 'active');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-poem',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.completed',
      observedAt: '2026-02-15T00:00:04.000Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T00:00:04.000Z',
    directoryId: 'directory-poem',
    conversationId: 'conversation-poem',
    cursor: 13
  });
  assert.equal(conversation.status, 'running');
  assert.equal(conversation.lastKnownWork, 'active');

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-poem',
    keyEvent: {
      source: 'otlp-metric',
      eventName: 'codex.turn.e2e_duration_ms',
      severity: null,
      summary: 'turn complete (18260ms)',
      observedAt: '2026-02-15T00:00:05.000Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T00:00:05.000Z',
    directoryId: 'directory-poem',
    conversationId: 'conversation-poem',
    cursor: 14
  });
  assert.equal(conversation.status, 'running');
  assert.equal(conversation.lastKnownWork, 'inactive');
});

void test('runtime wiring applies delayed turn metric text as inactive', () => {
  const conversation = createConversationState('conversation-delayed-metric', {
    status: 'running',
    lastKnownWork: 'inactive',
    lastKnownWorkAt: '2026-02-15T00:00:04.000Z',
    lastTelemetrySource: 'otlp-log'
  });

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-metric',
    eventName: 'codex.turn.e2e_duration_ms',
    summary: 'turn complete (31644ms)',
    observedAt: '2026-02-15T00:00:24.000Z'
  });

  assert.equal(conversation.lastKnownWork, 'inactive');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:24.000Z');
  assert.equal(conversation.lastTelemetrySource, 'otlp-metric');
});

void test('runtime wiring applies turn metric completion summaries regardless of active controller', () => {
  const conversation = createConversationState('conversation-active-agent-idle-guard', {
    status: 'running',
    controller: {
      controllerId: 'agent-1',
      controllerType: 'agent',
      controllerLabel: 'agent-1',
      claimedAt: '2026-02-15T00:00:00.000Z'
    },
    lastKnownWork: 'working: writing',
    lastKnownWorkAt: '2026-02-15T00:00:01.000Z',
    lastTelemetrySource: 'otlp-log'
  });

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-log',
    eventName: 'codex.sse_event',
    summary: 'stream response.completed',
    observedAt: '2026-02-15T00:00:02.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'working: writing');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:01.000Z');

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-metric',
    eventName: 'codex.turn.e2e_duration_ms',
    summary: 'turn complete (611ms)',
    observedAt: '2026-02-15T00:00:03.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'inactive');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:03.000Z');

  applyTelemetrySummaryToConversation(conversation, {
    source: 'otlp-log',
    eventName: 'codex.task.completed',
    summary: 'task completed',
    observedAt: '2026-02-15T00:00:04.000Z'
  });
  assert.equal(conversation.lastKnownWork, 'inactive');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:03.000Z');
  assert.equal(conversation.lastTelemetrySource, 'otlp-metric');
});

void test('runtime wiring applies only eligible status hints for telemetry events', () => {
  const conversation = createConversationState('conversation-status-hints', {
    status: 'running'
  });
  const ensureConversation = (): TestConversationState => conversation;
  const apply = (event: Parameters<typeof applyMuxControlPlaneKeyEvent<TestConversationState>>[0]): void => {
    const updated = applyMuxControlPlaneKeyEvent(event, {
      removedConversationIds: new Set(),
      ensureConversation
    });
    assert.notEqual(updated, null);
  };

  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-status-hints',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: 'still running',
      observedAt: '2026-02-15T01:00:00.000Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T01:00:00.000Z',
    directoryId: null,
    conversationId: 'conversation-status-hints',
    cursor: 20
  });
  assert.equal(conversation.status, 'running');

  conversation.status = 'running';
  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-status-hints',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: '',
      observedAt: '2026-02-15T01:00:01.000Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T01:00:01.000Z',
    directoryId: null,
    conversationId: 'conversation-status-hints',
    cursor: 21
  });
  assert.equal(conversation.status, 'running');

  conversation.status = 'running';
  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-status-hints',
    keyEvent: {
      source: 'history',
      eventName: 'history.entry',
      severity: null,
      summary: 'prompt: historical',
      observedAt: '2026-02-15T01:00:01.500Z',
      statusHint: 'running'
    },
    ts: '2026-02-15T01:00:01.500Z',
    directoryId: null,
    conversationId: 'conversation-status-hints',
    cursor: 21
  });
  assert.equal(conversation.status, 'running');

  conversation.status = 'running';
  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-status-hints',
    keyEvent: {
      source: 'otlp-metric',
      eventName: 'codex.api_request',
      severity: null,
      summary: 'codex.api_request points=1',
      observedAt: '2026-02-15T01:00:02.000Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T01:00:02.000Z',
    directoryId: null,
    conversationId: 'conversation-status-hints',
    cursor: 22
  });
  assert.equal(conversation.status, 'running');

  conversation.status = 'running';
  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-status-hints',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.in_progress',
      observedAt: '2026-02-15T01:00:02.500Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T01:00:02.500Z',
    directoryId: null,
    conversationId: 'conversation-status-hints',
    cursor: 22
  });
  assert.equal(conversation.status, 'running');

  conversation.status = 'running';
  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-status-hints',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: 'turn complete now',
      observedAt: '2026-02-15T01:00:03.000Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T01:00:03.000Z',
    directoryId: null,
    conversationId: 'conversation-status-hints',
    cursor: 23
  });
  assert.equal(conversation.status, 'running');

  conversation.status = 'running';
  apply({
    type: 'session-telemetry',
    sessionId: 'conversation-status-hints',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: 'still working',
      observedAt: '2026-02-15T01:00:03.500Z',
      statusHint: 'completed'
    },
    ts: '2026-02-15T01:00:03.500Z',
    directoryId: null,
    conversationId: 'conversation-status-hints',
    cursor: 24
  });
  assert.equal(conversation.status, 'running');
});

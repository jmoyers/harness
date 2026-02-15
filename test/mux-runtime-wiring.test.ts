import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMuxControlPlaneKeyEvent,
  applyTelemetrySummaryToConversation,
  telemetrySummaryText,
  type MuxRuntimeConversationState
} from '../src/mux/runtime-wiring.ts';

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

void test('runtime wiring summarizes telemetry text deterministically', () => {
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: 'prompt submitted'
    }),
    'codex.user_prompt: prompt submitted'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: 'codex.user_prompt: prompt submitted'
    }),
    'codex.user_prompt: prompt submitted'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      summary: null
    }),
    'codex.user_prompt'
  );
  assert.equal(
    telemetrySummaryText({
      source: 'otlp-trace',
      eventName: null,
      summary: null
    }),
    'otlp-trace'
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
    })?.endsWith('…'),
    true
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
  assert.equal(conversation.lastKnownWork, 'codex.user_prompt: prompt submitted');
  assert.equal(conversation.lastKnownWorkAt, '2026-02-15T00:00:00.000Z');
  assert.equal(conversation.lastTelemetrySource, 'otlp-log');
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
      attentionReason: null,
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
  assert.equal(statusConversation?.lastKnownWork, 'codex.user_prompt: prompt submitted');

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
  assert.equal(needsInputConversation?.status, 'needs-input');
  assert.equal(needsInputConversation?.attentionReason, 'telemetry');

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
  assert.equal(completedConversation?.status, 'completed');
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
  assert.equal(noHintConversation?.status, 'completed');
  assert.equal(noHintConversation?.lastTelemetrySource, 'otlp-trace');
});

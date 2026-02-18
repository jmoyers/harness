import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  applySummaryToConversation,
  compactDebugText,
  conversationSummary,
  createConversationState,
  debugFooterForConversation,
  formatCommandForDebugBar,
  launchCommandForAgent,
  type ConversationState,
} from '../src/mux/live-mux/conversation-state.ts';
import type { EventScope } from '../src/events/normalized-events.ts';

void test('conversation-state create/apply/summary helpers preserve session projections', () => {
  const scope: EventScope = {
    tenantId: 'tenant-a',
    userId: 'user-a',
    workspaceId: 'workspace-a',
    worktreeId: 'worktree-a',
    conversationId: 'seed-conversation',
    turnId: 'seed-turn',
  };
  const state = createConversationState(
    'session-a',
    'dir-a',
    'Title',
    'codex',
    { initial: true },
    'turn-a',
    scope,
    80,
    24,
  );
  assert.equal(state.sessionId, 'session-a');
  assert.equal(state.scope.conversationId, 'session-a');
  assert.equal(state.scope.turnId, 'turn-a');
  assert.equal(state.scope.tenantId, 'tenant-a');
  assert.equal(state.status, 'running');
  assert.equal(state.live, true);
  assert.equal(state.lastEventAt, null);
  assert.equal(state.controller, null);

  const untouchedLastEventAt = state.lastEventAt;
  applySummaryToConversation(state, null);
  assert.equal(state.lastEventAt, untouchedLastEventAt);

  applySummaryToConversation(state, {
    sessionId: 'session-a',
    tenantId: 'tenant-b',
    userId: 'user-b',
    workspaceId: 'workspace-b',
    worktreeId: 'worktree-b',
    directoryId: 'dir-b',
    status: 'needs-input',
    attentionReason: 'needs-input',
    latestCursor: 42,
    attachedClients: 1,
    eventSubscribers: 2,
    startedAt: '2026-02-18T00:00:00.000Z',
    lastEventAt: '2026-02-18T00:01:00.000Z',
    exitedAt: null,
    lastExit: {
      code: 0,
      signal: null,
    },
    processId: 1234,
    live: false,
    launchCommand: 'codex',
    controller: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      severity: 'info',
      summary: 'user prompt submitted',
      observedAt: '2026-02-18T00:01:00.000Z',
    },
  });
  assert.equal(state.scope.tenantId, 'tenant-b');
  assert.equal(state.scope.userId, 'user-b');
  assert.equal(state.scope.workspaceId, 'workspace-b');
  assert.equal(state.scope.worktreeId, 'worktree-b');
  assert.equal(state.directoryId, 'dir-b');
  assert.equal(state.status, 'needs-input');
  assert.equal(state.attentionReason, 'needs-input');
  assert.equal(state.startedAt, '2026-02-18T00:00:00.000Z');
  assert.equal(state.lastEventAt, '2026-02-18T00:01:00.000Z');
  assert.equal(state.live, false);
  assert.equal(state.lastKnownWork, 'active');
  assert.equal(state.lastTelemetrySource, 'otlp-log');

  assert.deepEqual(conversationSummary(state), {
    sessionId: 'session-a',
    status: 'needs-input',
    attentionReason: 'needs-input',
    live: false,
    startedAt: '2026-02-18T00:00:00.000Z',
    lastEventAt: '2026-02-18T00:01:00.000Z',
  });
});

void test('conversation-state launchCommand, debug footer, and compaction helpers cover all branches', () => {
  assert.equal(compactDebugText(null), '');
  assert.equal(compactDebugText('already compact'), 'already compact');
  const longText = `  ${'x'.repeat(200)}   `;
  assert.equal(compactDebugText(longText).endsWith('…'), true);
  assert.equal(compactDebugText(longText).length, 160);

  assert.equal(launchCommandForAgent('critique'), 'critique');
  assert.equal(launchCommandForAgent('claude'), 'claude');
  assert.equal(launchCommandForAgent('terminal').length > 0, true);
  assert.equal(launchCommandForAgent('unknown'), 'codex');

  const formatted = formatCommandForDebugBar('bunx', ['critique@latest', '--watch', '', 'hello world', "it's"]);
  assert.equal(
    formatted,
    "bunx critique@latest --watch '' 'hello world' 'it'\"'\"'s'",
  );

  const conversation = {
    launchCommand: formatted,
  } as ConversationState;
  assert.equal(
    debugFooterForConversation(conversation),
    "[dbg] bunx critique@latest --watch '' 'hello world' 'it'\"'\"'s'",
  );
  assert.equal(
    debugFooterForConversation({
      launchCommand: null,
    } as ConversationState),
    '[dbg] (launch command unavailable)',
  );
});

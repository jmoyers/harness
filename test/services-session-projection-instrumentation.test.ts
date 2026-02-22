import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { ControlPlaneKeyEvent } from '../src/control-plane/codex-session-stream.ts';
import {
  createConversationState,
  type ConversationState,
} from '../src/mux/live-mux/conversation-state.ts';
import { SessionProjectionInstrumentation } from '../src/services/session-projection-instrumentation.ts';
import { statusModelFor } from './support/status-model.ts';

function createConversation(sessionId: string, title = 'Session'): ConversationState {
  return createConversationState(
    sessionId,
    'directory-a',
    title,
    'codex',
    {},
    'turn-1',
    {
      tenantId: 'tenant',
      userId: 'user',
      workspaceId: 'workspace',
      worktreeId: 'worktree',
      conversationId: sessionId,
    },
    80,
    24,
  );
}

void test('session projection instrumentation snapshots selector state only when changed', () => {
  const events: string[] = [];
  const service = new SessionProjectionInstrumentation({
    getProcessUsageSample: () => undefined,
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
    nowMs: () => Date.parse('2026-02-18T00:00:00.000Z'),
  });
  const conversation = createConversation('session-a', 'Alpha');
  const directories = new Map<string, { directoryId: string }>([
    ['directory-a', { directoryId: 'directory-a' }],
  ]);
  const conversations = new Map<string, ConversationState>([['session-a', conversation]]);

  service.refreshSelectorSnapshot('startup', directories, conversations, ['session-a']);
  service.refreshSelectorSnapshot('render', directories, conversations, ['session-a']);
  conversation.title = 'Beta';
  service.refreshSelectorSnapshot('render', directories, conversations, ['session-a']);

  const snapshotEvents = events.filter((entry) => entry.startsWith('mux.selector.snapshot:'));
  const entryEvents = events.filter((entry) => entry.startsWith('mux.selector.entry:'));
  assert.equal(snapshotEvents.length, 2);
  assert.equal(entryEvents.length, 2);
});

void test('session projection instrumentation records transition metadata for telemetry events', () => {
  const events: string[] = [];
  const transitions: string[] = [];
  const service = new SessionProjectionInstrumentation({
    getProcessUsageSample: () => ({ cpuPercent: 15.5, memoryMb: 128 }),
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
    onTransition: (transition) => {
      transitions.push(JSON.stringify(transition));
    },
    nowMs: () => Date.parse('2026-02-18T00:00:00.000Z'),
  });
  const conversation = createConversation('session-a', 'Alpha');
  const directories = new Map<string, { directoryId: string }>([
    ['directory-a', { directoryId: 'directory-a' }],
  ]);
  const conversations = new Map<string, ConversationState>([['session-a', conversation]]);
  service.refreshSelectorSnapshot('startup', directories, conversations, ['session-a']);

  const before = service.snapshotForConversation(conversation);
  conversation.statusModel = statusModelFor('running', {
    phase: 'working',
    detailText: 'working on changes',
    lastKnownWork: 'working on changes',
    lastKnownWorkAt: '2026-02-18T00:00:00.000Z',
    activityHint: 'working',
    observedAt: '2026-02-18T00:00:00.000Z',
  });
  conversation.lastKnownWork = 'working on changes';
  conversation.lastKnownWorkAt = '2026-02-18T00:00:00.000Z';
  const event = {
    type: 'session-telemetry',
    sessionId: 'session-a',
    keyEvent: {
      source: 'otlp-log',
      eventName: 'turn.completed',
      summary: 'done',
    },
    cursor: 7,
  } as unknown as ControlPlaneKeyEvent;
  service.recordTransition(event, before, conversation);

  const transition = events.find((entry) => entry.startsWith('mux.session-projection.transition:'));
  assert.equal(transition !== undefined, true);
  assert.equal(transition?.includes('"source":"otlp-log"'), true);
  assert.equal(transition?.includes('"eventName":"turn.completed"'), true);
  assert.equal(transition?.includes('"selectorIndex":1'), true);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]?.includes('"summary":"done"'), true);
});

void test('session projection instrumentation skips unchanged transitions and handles non-telemetry branch', () => {
  const events: string[] = [];
  const service = new SessionProjectionInstrumentation({
    getProcessUsageSample: () => undefined,
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });
  const conversation = createConversation('session-a');
  const before = service.snapshotForConversation(conversation);
  const unchangedEvent = {
    type: 'session-status',
    sessionId: 'session-a',
    cursor: 1,
    telemetry: null,
  } as unknown as ControlPlaneKeyEvent;
  service.recordTransition(unchangedEvent, before, conversation);

  const controlEvent = {
    type: 'session-control',
    sessionId: 'session-a',
    cursor: 2,
  } as unknown as ControlPlaneKeyEvent;
  service.recordTransition(controlEvent, null, conversation);

  const transitionEvents = events.filter((entry) =>
    entry.startsWith('mux.session-projection.transition:'),
  );
  assert.equal(transitionEvents.length, 1);
  assert.equal(transitionEvents[0]?.includes('"source":""'), true);
});

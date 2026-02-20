import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { NimEventEnvelope } from '../packages/nim-core/src/events.ts';
import { projectEventToUiEvents } from '../packages/nim-ui-core/src/projection.ts';

function makeEvent(overrides: Partial<NimEventEnvelope>): NimEventEnvelope {
  return {
    event_id: 'evt-1',
    event_seq: 1,
    ts: '2026-02-20T00:00:00.000Z',
    tenant_id: 'tenant-a',
    user_id: 'user-a',
    workspace_id: 'workspace-a',
    session_id: 'session-a',
    run_id: 'run-a',
    turn_id: 'turn-a',
    step_id: 'step-a',
    source: 'provider',
    type: 'assistant.output.delta',
    payload_hash: 'sha256:abc',
    idempotency_key: 'idem-a',
    lane: 'session:session-a',
    policy_hash: 'policy-a',
    trace_id: 'trace-a',
    span_id: 'span-a',
    data: {
      text: 'hi',
    },
    ...overrides,
  };
}

test('nim-ui-core projection projects assistant output deltas in both modes', () => {
  const raw = makeEvent({ type: 'assistant.output.delta', data: { text: 'hello' } });
  const debug = projectEventToUiEvents(raw, 'debug');
  const seamless = projectEventToUiEvents(raw, 'seamless');
  assert.deepEqual(debug, [{ type: 'assistant.text.delta', text: 'hello' }]);
  assert.deepEqual(seamless, [{ type: 'assistant.text.delta', text: 'hello' }]);
});

test('nim-ui-core projection maps tool start differently for debug and seamless', () => {
  const raw = makeEvent({
    source: 'tool',
    type: 'tool.call.started',
    tool_call_id: 'tool-1',
    data: { toolName: 'read' },
  });
  const debug = projectEventToUiEvents(raw, 'debug');
  const seamless = projectEventToUiEvents(raw, 'seamless');
  assert.deepEqual(debug, [
    { type: 'tool.activity', toolCallId: 'tool-1', toolName: 'read', phase: 'start' },
  ]);
  assert.deepEqual(seamless, [{ type: 'assistant.state', state: 'tool-calling' }]);
});

test('nim-ui-core projection ignores unknown events', () => {
  const raw = makeEvent({
    type: 'unknown.event',
  });
  assert.deepEqual(projectEventToUiEvents(raw, 'debug'), []);
});

test('nim-ui-core projection ignores empty output deltas', () => {
  const raw = makeEvent({
    type: 'assistant.output.delta',
    data: {
      text: '',
    },
  });
  assert.deepEqual(projectEventToUiEvents(raw, 'debug'), []);
});

test('nim-ui-core projection maps tool failures with fallback ids and names', () => {
  const raw = makeEvent({
    source: 'tool',
    type: 'tool.call.failed',
    tool_call_id: undefined,
    data: {},
  });
  assert.deepEqual(projectEventToUiEvents(raw, 'debug'), [
    {
      type: 'tool.activity',
      toolCallId: 'step-a:unknown',
      toolName: 'tool',
      phase: 'error',
    },
  ]);
});

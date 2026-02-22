import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { nimEventEnvelopeSchema, parseNimEventEnvelope } from '../../../packages/nim-core/src/events.ts';

function buildValidEvent() {
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
    type: 'assistant.state.changed',
    payload_hash: 'sha256:abc',
    idempotency_key: 'idem-a',
    lane: 'session:session-a',
    provider_event_index: 0,
    state: 'thinking',
    policy_hash: 'policy-a',
    trace_id: 'trace-a',
    span_id: 'span-a',
  } as const;
}

test('nim-core event schema accepts a valid envelope', () => {
  const parsed = parseNimEventEnvelope(buildValidEvent());
  assert.equal(parsed.type, 'assistant.state.changed');
  assert.equal(parsed.state, 'thinking');
});

test('nim-core event schema rejects missing required tenancy fields', () => {
  const candidate = { ...buildValidEvent() } as Record<string, unknown>;
  delete candidate.tenant_id;
  const result = nimEventEnvelopeSchema.safeParse(candidate);
  assert.equal(result.success, false);
});

test('nim-core event schema rejects invalid state values', () => {
  const candidate = {
    ...buildValidEvent(),
    state: 'sleeping',
  };
  const result = nimEventEnvelopeSchema.safeParse(candidate);
  assert.equal(result.success, false);
});

test('nim-core event schema accepts session-scoped envelopes with empty run and turn ids', () => {
  const candidate = {
    ...buildValidEvent(),
    run_id: '',
    turn_id: '',
    type: 'session.started',
  };
  const result = nimEventEnvelopeSchema.safeParse(candidate);
  assert.equal(result.success, true);
});

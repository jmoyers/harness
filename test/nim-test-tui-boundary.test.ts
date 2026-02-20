import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { NimTestTuiController } from '../packages/nim-test-tui/src/index.ts';
import type { NimEventEnvelope } from '../packages/nim-core/src/events.ts';

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
      text: 'hello',
    },
    ...overrides,
  };
}

test('nim-test-tui does not import harness runtime internals', () => {
  const file = readFileSync('packages/nim-test-tui/src/index.ts', 'utf8');
  assert.equal(file.includes('src/mux'), false);
  assert.equal(file.includes('scripts/codex-live-mux-runtime.ts'), false);
  assert.equal(file.includes('src/services'), false);
});

test('nim-test-tui builds a snapshot from canonical events', () => {
  const controller = new NimTestTuiController({
    mode: 'seamless',
    runId: 'run-a',
  });
  controller.consume(makeEvent({ type: 'provider.thinking.started', data: {} }));
  controller.consume(makeEvent({ type: 'assistant.output.delta', data: { text: 'hello' } }));
  controller.consume(
    makeEvent({
      source: 'tool',
      type: 'tool.call.started',
      tool_call_id: 'tool-1',
      data: { toolName: 'read' },
    }),
  );
  const snapshot = controller.snapshot();
  assert.equal(snapshot.runId, 'run-a');
  assert.equal(snapshot.state, 'tool-calling');
  assert.deepEqual(snapshot.lines, ['hello']);
});

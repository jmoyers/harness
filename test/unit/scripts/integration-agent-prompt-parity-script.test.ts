import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { __integrationAgentPromptParityInternals } from '../../../scripts/integration-agent-prompt-parity.ts';

void test('agent prompt parity settle check does not treat completed live session as settled', () => {
  const settled = __integrationAgentPromptParityInternals.isSessionSettledForNextTurn({
    status: 'completed',
    live: true,
  });
  assert.equal(settled, false);
});

void test('agent prompt parity settle check treats completed non-live session as settled', () => {
  const settled = __integrationAgentPromptParityInternals.isSessionSettledForNextTurn({
    status: 'completed',
    live: false,
  });
  assert.equal(settled, true);
});

void test('agent prompt parity settle check treats exited session as settled', () => {
  const settled = __integrationAgentPromptParityInternals.isSessionSettledForNextTurn({
    status: 'exited',
    live: true,
  });
  assert.equal(settled, true);
});

void test('agent prompt parity settle check keeps running sessions unsettled', () => {
  const settled = __integrationAgentPromptParityInternals.isSessionSettledForNextTurn({
    status: 'running',
    live: true,
  });
  assert.equal(settled, false);
});

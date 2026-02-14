import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentStartArgs,
  codexResumeSessionIdFromAdapterState,
  mergeAdapterStateFromSessionEvent,
  normalizeAdapterState
} from '../src/adapters/agent-session-state.ts';

void test('normalizeAdapterState accepts object records and falls back to empty object', () => {
  assert.deepEqual(normalizeAdapterState(null), {});
  assert.deepEqual(normalizeAdapterState([]), {});
  assert.deepEqual(normalizeAdapterState('x'), {});
  assert.deepEqual(normalizeAdapterState({ codex: { resumeSessionId: 'thread-1' } }), {
    codex: {
      resumeSessionId: 'thread-1'
    }
  });
});

void test('codexResumeSessionIdFromAdapterState reads canonical and legacy keys', () => {
  assert.equal(codexResumeSessionIdFromAdapterState({}), null);
  assert.equal(
    codexResumeSessionIdFromAdapterState({
      codex: {}
    }),
    null
  );
  assert.equal(
    codexResumeSessionIdFromAdapterState({
      codex: {
        resumeSessionId: 'thread-canonical'
      }
    }),
    'thread-canonical'
  );
  assert.equal(
    codexResumeSessionIdFromAdapterState({
      codex: {
        threadId: 'thread-legacy'
      }
    }),
    'thread-legacy'
  );
});

void test('mergeAdapterStateFromSessionEvent stores codex thread id from notify payload', () => {
  const merged = mergeAdapterStateFromSessionEvent(
    'codex',
    {},
    {
      type: 'notify',
      record: {
        ts: '2026-02-14T00:00:00.000Z',
        payload: {
          'thread-id': 'thread-42'
        }
      }
    },
    '2026-02-14T00:00:00.000Z'
  );
  assert.deepEqual(merged, {
    codex: {
      resumeSessionId: 'thread-42',
      lastObservedAt: '2026-02-14T00:00:00.000Z'
    }
  });

  const unchanged = mergeAdapterStateFromSessionEvent(
    'codex',
    merged as Record<string, unknown>,
    {
      type: 'turn-completed',
      record: {
        ts: '2026-02-14T00:01:00.000Z',
        payload: {
          thread_id: 'thread-42'
        }
      }
    },
    '2026-02-14T00:01:00.000Z'
  );
  assert.equal(unchanged, null);
});

void test('mergeAdapterStateFromSessionEvent ignores unsupported agents and events without thread ids', () => {
  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'claude',
      {},
      {
        type: 'notify',
        record: {
          ts: '2026-02-14T00:00:00.000Z',
          payload: {
            'thread-id': 'thread-claude'
          }
        }
      },
      '2026-02-14T00:00:00.000Z'
    ),
    null
  );

  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'codex',
      {},
      {
        type: 'session-exit',
        exit: {
          code: 0,
          signal: null
        }
      },
      '2026-02-14T00:00:00.000Z'
    ),
    null
  );
});

void test('buildAgentStartArgs injects codex resume and preserves explicit subcommands', () => {
  assert.deepEqual(
    buildAgentStartArgs(
      'codex',
      ['--model', 'gpt-5.3-codex-high'],
      {
        codex: {
          resumeSessionId: 'thread-123'
        }
      }
    ),
    ['resume', 'thread-123', '--model', 'gpt-5.3-codex-high']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'codex',
      ['--', 'prompt text'],
      {
        codex: {
          resumeSessionId: 'thread-123'
        }
      }
    ),
    ['resume', 'thread-123', '--', 'prompt text']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'codex',
      [],
      {
        codex: {}
      }
    ),
    []
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'codex',
      ['resume', '--last'],
      {
        codex: {
          resumeSessionId: 'thread-123'
        }
      }
    ),
    ['resume', '--last']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--print'],
      {
        codex: {
          resumeSessionId: 'thread-123'
        }
      }
    ),
    ['--print']
  );
});

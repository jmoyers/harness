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

void test('mergeAdapterStateFromSessionEvent returns null for codex session events', () => {
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

void test('mergeAdapterStateFromSessionEvent ignores unsupported agents', () => {
  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'claude',
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

void test('buildAgentStartArgs applies configurable codex yolo launch mode for interactive starts', () => {
  assert.deepEqual(
    buildAgentStartArgs(
      'codex',
      ['--model', 'gpt-5.3-codex-high'],
      {
        codex: {}
      },
      {
        codexLaunchMode: 'yolo'
      }
    ),
    ['--model', 'gpt-5.3-codex-high', '--yolo']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'codex',
      ['--model', 'gpt-5.3-codex-high', '--yolo'],
      {
        codex: {
          resumeSessionId: 'thread-123'
        }
      },
      {
        codexLaunchMode: 'yolo'
      }
    ),
    ['resume', 'thread-123', '--model', 'gpt-5.3-codex-high', '--yolo']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'codex',
      ['exec', '--json'],
      {
        codex: {}
      },
      {
        codexLaunchMode: 'yolo'
      }
    ),
    ['exec', '--json']
  );
});

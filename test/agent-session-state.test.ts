import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  buildAgentSessionStartArgs,
  buildAgentStartArgs,
  claudeResumeSessionIdFromAdapterState,
  codexResumeSessionIdFromAdapterState,
  cursorResumeSessionIdFromAdapterState,
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

void test('claudeResumeSessionIdFromAdapterState reads canonical and legacy keys', () => {
  assert.equal(claudeResumeSessionIdFromAdapterState({}), null);
  assert.equal(
    claudeResumeSessionIdFromAdapterState({
      claude: {}
    }),
    null
  );
  assert.equal(
    claudeResumeSessionIdFromAdapterState({
      claude: {
        resumeSessionId: 'session-canonical'
      }
    }),
    'session-canonical'
  );
  assert.equal(
    claudeResumeSessionIdFromAdapterState({
      claude: {
        sessionId: 'session-legacy'
      }
    }),
    'session-legacy'
  );
});

void test('cursorResumeSessionIdFromAdapterState reads canonical and legacy keys', () => {
  assert.equal(cursorResumeSessionIdFromAdapterState({}), null);
  assert.equal(
    cursorResumeSessionIdFromAdapterState({
      cursor: {}
    }),
    null
  );
  assert.equal(
    cursorResumeSessionIdFromAdapterState({
      cursor: {
        resumeSessionId: 'cursor-canonical'
      }
    }),
    'cursor-canonical'
  );
  assert.equal(
    cursorResumeSessionIdFromAdapterState({
      cursor: {
        conversationId: 'cursor-conversation'
      }
    }),
    'cursor-conversation'
  );
  assert.equal(
    cursorResumeSessionIdFromAdapterState({
      cursor: {
        sessionId: 'cursor-session'
      }
    }),
    'cursor-session'
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

void test('mergeAdapterStateFromSessionEvent updates claude session resume id from notify hooks', () => {
  assert.deepEqual(
    mergeAdapterStateFromSessionEvent(
      'claude',
      {},
      {
        type: 'notify',
        record: {
          ts: '2026-02-14T00:00:00.000Z',
          payload: {
            hook_event_name: 'UserPromptSubmit',
            session_id: 'session-claude-1'
          }
        }
      },
      '2026-02-14T00:00:01.000Z'
    ),
    {
      claude: {
        resumeSessionId: 'session-claude-1',
        lastObservedAt: '2026-02-14T00:00:01.000Z'
      }
    }
  );
  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'claude',
      {
        claude: {
          resumeSessionId: 'session-claude-1',
          lastObservedAt: '2026-02-14T00:00:01.000Z'
        }
      },
      {
        type: 'notify',
        record: {
          ts: '2026-02-14T00:00:02.000Z',
          payload: {
            hook_event_name: 'UserPromptSubmit',
            session_id: 'session-claude-1'
          }
        }
      }
    ),
    null
  );
});

void test('mergeAdapterStateFromSessionEvent updates cursor session resume id from notify hooks', () => {
  assert.deepEqual(
    mergeAdapterStateFromSessionEvent(
      'cursor',
      {},
      {
        type: 'notify',
        record: {
          ts: '2026-02-14T00:00:00.000Z',
          payload: {
            event: 'beforeSubmitPrompt',
            conversation_id: 'cursor-conversation-1'
          }
        }
      },
      '2026-02-14T00:00:01.000Z'
    ),
    {
      cursor: {
        resumeSessionId: 'cursor-conversation-1',
        lastObservedAt: '2026-02-14T00:00:01.000Z'
      }
    }
  );
  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'cursor',
      {
        cursor: {
          resumeSessionId: 'cursor-conversation-1',
          lastObservedAt: '2026-02-14T00:00:01.000Z'
        }
      },
      {
        type: 'notify',
        record: {
          ts: '2026-02-14T00:00:02.000Z',
          payload: {
            event: 'beforeSubmitPrompt',
            conversation_id: 'cursor-conversation-1'
          }
        }
      }
    ),
    null
  );
});

void test('mergeAdapterStateFromSessionEvent ignores unsupported agents and malformed claude payloads', () => {
  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'terminal',
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
  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'claude',
      {},
      {
        type: 'notify',
        record: {
          ts: '2026-02-14T00:00:00.000Z',
          payload: {
            hook_event_name: 'UserPromptSubmit'
          }
        }
      },
      '2026-02-14T00:00:00.000Z'
    ),
    null
  );
  assert.equal(
    mergeAdapterStateFromSessionEvent(
      'cursor',
      {},
      {
        type: 'notify',
        record: {
          ts: '2026-02-14T00:00:00.000Z',
          payload: {
            event: 'beforeSubmitPrompt'
          }
        }
      },
      '2026-02-14T00:00:01.000Z'
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
        claude: {
          resumeSessionId: 'session-123'
        }
      }
    ),
    ['--resume', 'session-123', '--print']
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

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--model', 'haiku'],
      {
        claude: {}
      }
    ),
    ['--model', 'haiku']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--model', 'sonnet'],
      {
        claude: {
          resumeSessionId: 'session-456'
        }
      }
    ),
    ['--resume', 'session-456', '--model', 'sonnet']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--resume', 'explicit-session'],
      {
        claude: {
          resumeSessionId: 'session-456'
        }
      }
    ),
    ['--resume', 'explicit-session']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['mcp', 'list'],
      {
        claude: {
          resumeSessionId: 'session-456'
        }
      }
    ),
    ['mcp', 'list']
  );
});

void test('buildAgentSessionStartArgs applies codex launch defaults and directory overrides via one abstraction', () => {
  const directoryModes = {
    '/tmp/standard-mode': 'standard' as const
  };

  assert.deepEqual(
    buildAgentSessionStartArgs(
      'codex',
      ['--model', 'gpt-5.3-codex-high'],
      {
        codex: {
          resumeSessionId: 'thread-123'
        }
      },
      {
        directoryPath: '/tmp/yolo-mode',
        codexLaunchDefaultMode: 'yolo',
        codexLaunchModeByDirectoryPath: directoryModes
      }
    ),
    ['resume', 'thread-123', '--model', 'gpt-5.3-codex-high', '--yolo']
  );

  assert.deepEqual(
    buildAgentSessionStartArgs(
      'codex',
      ['--model', 'gpt-5.3-codex-high'],
      {
        codex: {
          resumeSessionId: 'thread-123'
        }
      },
      {
        directoryPath: '/tmp/standard-mode',
        codexLaunchDefaultMode: 'yolo',
        codexLaunchModeByDirectoryPath: directoryModes
      }
    ),
    ['resume', 'thread-123', '--model', 'gpt-5.3-codex-high']
  );

  assert.deepEqual(
    buildAgentSessionStartArgs(
      'terminal',
      ['-lc', 'ls'],
      {},
      {
        directoryPath: '/tmp/yolo-mode',
        codexLaunchDefaultMode: 'yolo',
        codexLaunchModeByDirectoryPath: directoryModes
      }
    ),
    ['-lc', 'ls']
  );
});

void test('buildAgentSessionStartArgs applies claude launch defaults and directory overrides', () => {
  const directoryModes = {
    '/tmp/claude-standard': 'standard' as const
  };

  assert.deepEqual(
    buildAgentSessionStartArgs(
      'claude',
      ['--model', 'opus'],
      {},
      {
        directoryPath: '/tmp/claude-yolo',
        claudeLaunchDefaultMode: 'yolo',
        claudeLaunchModeByDirectoryPath: directoryModes
      }
    ),
    ['--model', 'opus', '--dangerously-skip-permissions']
  );

  assert.deepEqual(
    buildAgentSessionStartArgs(
      'claude',
      ['--model', 'opus'],
      {},
      {
        directoryPath: '  /tmp/claude-standard  ',
        claudeLaunchDefaultMode: 'yolo',
        claudeLaunchModeByDirectoryPath: directoryModes
      }
    ),
    ['--model', 'opus']
  );
});

void test('buildAgentStartArgs applies configurable claude yolo launch mode', () => {
  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--model', 'opus'],
      {},
      {
        claudeLaunchMode: 'yolo'
      }
    ),
    ['--model', 'opus', '--dangerously-skip-permissions']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--model', 'opus'],
      {},
      {
        claudeLaunchMode: 'standard'
      }
    ),
    ['--model', 'opus']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--dangerously-skip-permissions', '--model', 'opus'],
      {},
      {
        claudeLaunchMode: 'yolo'
      }
    ),
    ['--dangerously-skip-permissions', '--model', 'opus']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'claude',
      ['--print'],
      {},
      {}
    ),
    ['--print']
  );
});

void test('buildAgentStartArgs applies cursor yolo launch mode with conditional trust and resume', () => {
  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      [],
      {
        cursor: {
          resumeSessionId: 'cursor-session-1'
        }
      },
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--resume', 'cursor-session-1', '--yolo']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--resume', 'explicit'],
      {
        cursor: {
          resumeSessionId: 'cursor-session-1'
        }
      },
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--resume', 'explicit', '--yolo']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--print'],
      {
        cursor: {
          resumeSessionId: 'cursor-session-1'
        }
      },
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--resume', 'cursor-session-1', '--print', '--yolo', '--trust']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--mode', 'headless'],
      {},
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--mode', 'headless', '--yolo', '--trust']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--mode', 'ask'],
      {},
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--mode', 'ask', '--yolo']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--mode=headless'],
      {},
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--mode=headless', '--yolo', '--trust']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--mode=ask'],
      {},
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--mode=ask', '--yolo']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--trust'],
      {},
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--trust', '--yolo']
  );

  assert.deepEqual(
    buildAgentStartArgs(
      'cursor',
      ['--force', '--trust'],
      {},
      {
        cursorLaunchMode: 'yolo'
      }
    ),
    ['--force', '--trust']
  );
});

void test('buildAgentSessionStartArgs applies cursor launch defaults and directory overrides', () => {
  const directoryModes = {
    '/tmp/cursor-standard': 'standard' as const
  };

  assert.deepEqual(
    buildAgentSessionStartArgs(
      'cursor',
      [],
      {
        cursor: {
          resumeSessionId: 'cursor-session-2'
        }
      },
      {
        directoryPath: '/tmp/cursor-yolo',
        cursorLaunchDefaultMode: 'yolo',
        cursorLaunchModeByDirectoryPath: directoryModes
      }
    ),
    ['--resume', 'cursor-session-2', '--yolo']
  );

  assert.deepEqual(
    buildAgentSessionStartArgs(
      'cursor',
      [],
      {},
      {
        directoryPath: '/tmp/cursor-standard',
        cursorLaunchDefaultMode: 'yolo',
        cursorLaunchModeByDirectoryPath: directoryModes
      }
    ),
    []
  );
});

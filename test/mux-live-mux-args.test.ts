import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseMuxArgs } from '../src/mux/live-mux/args.ts';

const baseEnv: NodeJS.ProcessEnv = {
  HARNESS_INVOKE_CWD: '/tmp/work',
  HARNESS_TENANT_ID: 'tenant-1',
  HARNESS_USER_ID: 'user-1',
  HARNESS_WORKSPACE_ID: 'workspace-1',
  HARNESS_WORKTREE_ID: 'worktree-1'
};

void test('parseMuxArgs resolves defaults and positional codex args', () => {
  const parsed = parseMuxArgs(['--ask', 'something'], {
    env: baseEnv,
    cwd: '/tmp/cwd',
    randomId: () => 'id-1'
  });

  assert.deepEqual(parsed.codexArgs, ['--ask', 'something']);
  assert.equal(parsed.storePath, '.harness/events.sqlite');
  assert.equal(parsed.initialConversationId, 'conversation-id-1');
  assert.equal(parsed.scope.turnId, 'turn-id-1');
  assert.equal(parsed.scope.workspaceId, 'workspace-1');
  assert.equal(parsed.controlPlaneHost, null);
  assert.equal(parsed.controlPlanePort, null);
  assert.equal(parsed.recordingPath, null);
  assert.equal(parsed.recordingGifOutputPath, null);
  assert.equal(parsed.recordingFps, 15);
});

void test('parseMuxArgs reads control-plane and recording flags', () => {
  const parsed = parseMuxArgs(
    [
      '--harness-server-host',
      '127.0.0.1',
      '--harness-server-port',
      '7777',
      '--harness-server-token',
      'secret',
      '--record-fps',
      '30',
      '--record-output',
      './captures/session.gif'
    ],
    {
      env: {
        ...baseEnv,
        HARNESS_RECORDING_PATH: './ignored.jsonl',
        HARNESS_EVENTS_DB_PATH: 'custom-events.sqlite',
        HARNESS_CONVERSATION_ID: 'conversation-fixed',
        HARNESS_TURN_ID: 'turn-fixed'
      },
      cwd: '/tmp/cwd',
      randomId: () => 'unused'
    }
  );

  assert.equal(parsed.controlPlaneHost, '127.0.0.1');
  assert.equal(parsed.controlPlanePort, 7777);
  assert.equal(parsed.controlPlaneAuthToken, 'secret');
  assert.equal(parsed.storePath, 'custom-events.sqlite');
  assert.equal(parsed.initialConversationId, 'conversation-fixed');
  assert.equal(parsed.scope.turnId, 'turn-fixed');
  assert.equal(parsed.recordingGifOutputPath, resolve('/tmp/work', './captures/session.gif'));
  assert.equal(parsed.recordingPath, resolve('/tmp/work', './captures/session.jsonl'));
  assert.equal(parsed.recordingFps, 30);
});

void test('parseMuxArgs supports non-gif record output path passthrough', () => {
  const parsed = parseMuxArgs(['--record-output', './captures/session.jsonl'], {
    env: baseEnv,
    cwd: '/tmp/cwd',
    randomId: () => 'id-2'
  });

  assert.equal(parsed.recordingGifOutputPath, null);
  assert.equal(parsed.recordingPath, resolve('/tmp/work', './captures/session.jsonl'));
});

void test('parseMuxArgs supports explicit record-path flag without record-output rewrite', () => {
  const parsed = parseMuxArgs(['--record-path', './captures/raw.jsonl'], {
    env: baseEnv,
    randomId: () => 'id-2b'
  });
  assert.equal(parsed.recordingGifOutputPath, null);
  assert.equal(parsed.recordingPath, resolve('/tmp/work', './captures/raw.jsonl'));
});

void test('parseMuxArgs validates host/port requirements and invalid port values', () => {
  assert.throws(
    () => {
      void parseMuxArgs([], {
        env: {
          ...baseEnv,
          HARNESS_CONTROL_PLANE_HOST: '127.0.0.1'
        }
      });
    },
    /both control-plane host and port must be set together/
  );

  assert.throws(
    () => {
      void parseMuxArgs([], {
        env: {
          ...baseEnv,
          HARNESS_CONTROL_PLANE_PORT: 'abc'
        }
      });
    },
    /invalid --harness-server-port value/
  );
});

void test('parseMuxArgs enforces required values for each flag', () => {
  assert.throws(() => {
    void parseMuxArgs(['--harness-server-host'], { env: baseEnv });
  }, /missing value for --harness-server-host/);

  assert.throws(() => {
    void parseMuxArgs(['--harness-server-port'], { env: baseEnv });
  }, /missing value for --harness-server-port/);

  assert.throws(() => {
    void parseMuxArgs(['--harness-server-token'], { env: baseEnv });
  }, /missing value for --harness-server-token/);

  assert.throws(() => {
    void parseMuxArgs(['--record-path'], { env: baseEnv });
  }, /missing value for --record-path/);

  assert.throws(() => {
    void parseMuxArgs(['--record-output'], { env: baseEnv });
  }, /missing value for --record-output/);

  assert.throws(() => {
    void parseMuxArgs(['--record-fps'], { env: baseEnv });
  }, /missing value for --record-fps/);
});

void test('parseMuxArgs keeps minimum recording fps at 1', () => {
  const parsed = parseMuxArgs(['--record-fps', '0'], {
    env: baseEnv,
    randomId: () => 'id-3'
  });
  assert.equal(parsed.recordingFps, 1);
});

void test('parseMuxArgs falls back through INIT_CWD and cwd defaults when invoke cwd is absent', () => {
  const fromInitCwd = parseMuxArgs([], {
    env: {
      INIT_CWD: '/tmp/init-cwd'
    },
    cwd: '/tmp/fallback-cwd',
    randomId: () => 'id-4'
  });
  assert.equal(fromInitCwd.invocationDirectory, '/tmp/init-cwd');
  assert.equal(fromInitCwd.scope.workspaceId, 'fallback-cwd');

  const fromCwd = parseMuxArgs([], {
    env: {},
    cwd: '/tmp/from-cwd',
    randomId: () => 'id-5'
  });
  assert.equal(fromCwd.invocationDirectory, '/tmp/from-cwd');
  assert.equal(fromCwd.scope.workspaceId, 'from-cwd');
});

void test('parseMuxArgs ignores empty recording env paths', () => {
  const parsed = parseMuxArgs([], {
    env: {
      ...baseEnv,
      HARNESS_RECORDING_PATH: '',
      HARNESS_RECORD_OUTPUT: ''
    },
    randomId: () => 'id-6'
  });
  assert.equal(parsed.recordingPath, '');
  assert.equal(parsed.recordingGifOutputPath, null);
});

void test('parseMuxArgs uses default random id factory when randomId is omitted', () => {
  const parsed = parseMuxArgs([], {
    env: {
      HARNESS_INVOKE_CWD: '/tmp/work'
    },
    cwd: '/tmp/work'
  });
  assert.match(parsed.initialConversationId, /^conversation-/);
  assert.match(parsed.scope.turnId ?? '', /^turn-/);
});

void test('parseMuxArgs falls back to process.env when env option is omitted', () => {
  const parsed = parseMuxArgs([], {
    cwd: '/tmp/work',
    randomId: () => 'id-7'
  });
  assert.equal(parsed.initialConversationId, process.env.HARNESS_CONVERSATION_ID ?? 'conversation-id-7');
});

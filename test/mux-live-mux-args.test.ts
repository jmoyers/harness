import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHarnessRuntimePath } from '../src/config/harness-paths.ts';
import { parseMuxArgs } from '../src/mux/live-mux/args.ts';

const baseEnv: NodeJS.ProcessEnv = {
  HARNESS_INVOKE_CWD: '/tmp/work',
  XDG_CONFIG_HOME: '/tmp/xdg-home',
  HARNESS_TENANT_ID: 'tenant-1',
  HARNESS_USER_ID: 'user-1',
  HARNESS_WORKSPACE_ID: 'workspace-1',
  HARNESS_WORKTREE_ID: 'worktree-1',
};

void test('parseMuxArgs resolves defaults and positional codex args', () => {
  const parsed = parseMuxArgs(['--ask', 'something'], {
    env: baseEnv,
    cwd: '/tmp/cwd',
    randomId: () => 'id-1',
  });

  assert.deepEqual(parsed.codexArgs, ['--ask', 'something']);
  assert.equal(
    parsed.storePath,
    resolveHarnessRuntimePath('/tmp/work', '.harness/events.sqlite', baseEnv),
  );
  assert.equal(parsed.initialConversationId, 'conversation-id-1');
  assert.equal(parsed.scope.turnId, 'turn-id-1');
  assert.equal(parsed.scope.workspaceId, 'workspace-1');
  assert.equal(parsed.controlPlaneHost, null);
  assert.equal(parsed.controlPlanePort, null);
  assert.equal(parsed.recordingPath, null);
  assert.equal(parsed.recordingGifOutputPath, null);
  assert.equal(parsed.recordingFps, 30);
});

void test('parseMuxArgs reads control-plane flags and maps --record to .harness/recordings', () => {
  const parsed = parseMuxArgs(
    [
      '--harness-server-host',
      '127.0.0.1',
      '--harness-server-port',
      '7777',
      '--harness-server-token',
      'secret',
      '--record',
    ],
    {
      env: {
        ...baseEnv,
        HARNESS_EVENTS_DB_PATH: 'custom-events.sqlite',
        HARNESS_CONVERSATION_ID: 'conversation-fixed',
        HARNESS_TURN_ID: 'turn-fixed',
      },
      cwd: '/tmp/cwd',
      randomId: () => 'record-id',
      nowIso: () => '2026-02-18T12:34:56.789Z',
    },
  );

  assert.equal(parsed.controlPlaneHost, '127.0.0.1');
  assert.equal(parsed.controlPlanePort, 7777);
  assert.equal(parsed.controlPlaneAuthToken, 'secret');
  assert.equal(
    parsed.storePath,
    resolveHarnessRuntimePath('/tmp/work', 'custom-events.sqlite', baseEnv),
  );
  assert.equal(parsed.initialConversationId, 'conversation-fixed');
  assert.equal(parsed.scope.turnId, 'turn-fixed');
  assert.equal(
    parsed.recordingGifOutputPath,
    resolveHarnessRuntimePath(
      '/tmp/work',
      '.harness/recordings/2026-02-18T12-34-56-789Z-record-id.gif',
      baseEnv,
    ),
  );
  assert.equal(
    parsed.recordingPath,
    resolveHarnessRuntimePath(
      '/tmp/work',
      '.harness/recordings/2026-02-18T12-34-56-789Z-record-id.jsonl',
      baseEnv,
    ),
  );
  assert.equal(parsed.recordingFps, 30);
});

void test('parseMuxArgs sanitizes unsafe record tokens and keeps fps capped to 30', () => {
  const parsed = parseMuxArgs(['--record'], {
    env: baseEnv,
    cwd: '/tmp/cwd',
    randomId: () => '  ',
    nowIso: () => '::',
  });

  assert.equal(
    parsed.recordingGifOutputPath,
    resolveHarnessRuntimePath('/tmp/work', '.harness/recordings/---recording.gif', baseEnv),
  );
  assert.equal(
    parsed.recordingPath,
    resolveHarnessRuntimePath('/tmp/work', '.harness/recordings/---recording.jsonl', baseEnv),
  );
  assert.equal(parsed.recordingFps, 30);
});

void test('parseMuxArgs uses default nowIso clock when --record is enabled without override', () => {
  const parsed = parseMuxArgs(['--record'], {
    env: baseEnv,
    randomId: () => 'id-8',
  });
  const recordingRoot = resolveHarnessRuntimePath('/tmp/work', '.harness/recordings', baseEnv);
  assert.match(parsed.recordingPath ?? '', new RegExp(`^${recordingRoot}/.+-id-8\\.jsonl$`));
  assert.match(parsed.recordingGifOutputPath ?? '', new RegExp(`^${recordingRoot}/.+-id-8\\.gif$`));
});

void test('parseMuxArgs rejects deprecated recording flags', () => {
  assert.throws(() => {
    void parseMuxArgs(['--record-path', './captures/raw.jsonl'], { env: baseEnv });
  }, /no longer supported; use --record/);

  assert.throws(() => {
    void parseMuxArgs(['--record-output', './captures/session.gif'], { env: baseEnv });
  }, /no longer supported; use --record/);

  assert.throws(() => {
    void parseMuxArgs(['--record-fps', '120'], { env: baseEnv });
  }, /no longer supported; use --record/);
});

void test('parseMuxArgs validates host/port requirements and invalid port values', () => {
  assert.throws(() => {
    void parseMuxArgs([], {
      env: {
        ...baseEnv,
        HARNESS_CONTROL_PLANE_HOST: '127.0.0.1',
      },
    });
  }, /both control-plane host and port must be set together/);

  assert.throws(() => {
    void parseMuxArgs([], {
      env: {
        ...baseEnv,
        HARNESS_CONTROL_PLANE_PORT: 'abc',
      },
    });
  }, /invalid --harness-server-port value/);

  assert.throws(() => {
    void parseMuxArgs([], {
      env: {
        ...baseEnv,
        HARNESS_CONTROL_PLANE_PORT: '70000',
      },
    });
  }, /invalid --harness-server-port value/);
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
});

void test('parseMuxArgs falls back through INIT_CWD and cwd defaults when invoke cwd is absent', () => {
  const fromInitCwd = parseMuxArgs([], {
    env: {
      INIT_CWD: '/tmp/init-cwd',
    },
    cwd: '/tmp/fallback-cwd',
    randomId: () => 'id-4',
  });
  assert.equal(fromInitCwd.invocationDirectory, '/tmp/init-cwd');
  assert.equal(fromInitCwd.scope.workspaceId, 'fallback-cwd');

  const fromCwd = parseMuxArgs([], {
    env: {},
    cwd: '/tmp/from-cwd',
    randomId: () => 'id-5',
  });
  assert.equal(fromCwd.invocationDirectory, '/tmp/from-cwd');
  assert.equal(fromCwd.scope.workspaceId, 'from-cwd');
});

void test('parseMuxArgs uses default random id factory when randomId is omitted', () => {
  const parsed = parseMuxArgs([], {
    env: {
      HARNESS_INVOKE_CWD: '/tmp/work',
    },
    cwd: '/tmp/work',
  });
  assert.match(parsed.initialConversationId, /^conversation-/);
  assert.match(parsed.scope.turnId ?? '', /^turn-/);
});

void test('parseMuxArgs falls back to process.env when env option is omitted', () => {
  const parsed = parseMuxArgs([], {
    cwd: '/tmp/work',
    randomId: () => 'id-7',
  });
  assert.equal(
    parsed.initialConversationId,
    process.env.HARNESS_CONVERSATION_ID ?? 'conversation-id-7',
  );
});

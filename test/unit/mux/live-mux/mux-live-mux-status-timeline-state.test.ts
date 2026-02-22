import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  DEFAULT_STATUS_TIMELINE_ROOT_PATH,
  parseActiveStatusTimelineState,
  resolveDefaultStatusTimelineOutputPath,
  resolveStatusTimelineStatePath,
  STATUS_TIMELINE_FILE_NAME,
  STATUS_TIMELINE_MODE,
  STATUS_TIMELINE_STATE_VERSION,
} from '../../../../src/mux/live-mux/status-timeline-state.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../../src/config/harness-paths.ts';

void test('status timeline state path and output path resolution are stable', () => {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: '/tmp/xdg-home',
  };
  const runtimeRoot = resolveHarnessWorkspaceDirectory('/tmp/harness', env);
  assert.equal(
    resolveStatusTimelineStatePath('/tmp/harness', null, env),
    `${runtimeRoot}/active-status-timeline.json`,
  );
  assert.equal(
    resolveStatusTimelineStatePath('/tmp/harness', 'session-a', env),
    `${runtimeRoot}/sessions/session-a/active-status-timeline.json`,
  );
  assert.equal(
    resolveDefaultStatusTimelineOutputPath('/tmp/harness', null, env),
    `${runtimeRoot}/${DEFAULT_STATUS_TIMELINE_ROOT_PATH}/${STATUS_TIMELINE_FILE_NAME}`,
  );
  assert.equal(
    resolveDefaultStatusTimelineOutputPath('/tmp/harness', 'session-a', env),
    `${runtimeRoot}/${DEFAULT_STATUS_TIMELINE_ROOT_PATH}/session-a/${STATUS_TIMELINE_FILE_NAME}`,
  );
});

void test('status timeline state parser accepts valid payloads and rejects invalid shapes', () => {
  const validNullSession = parseActiveStatusTimelineState({
    version: STATUS_TIMELINE_STATE_VERSION,
    mode: STATUS_TIMELINE_MODE,
    outputPath: '/tmp/harness/status-timeline.log',
    sessionName: null,
    startedAt: '2026-02-18T00:00:00.000Z',
  });
  assert.deepEqual(validNullSession, {
    version: STATUS_TIMELINE_STATE_VERSION,
    mode: STATUS_TIMELINE_MODE,
    outputPath: '/tmp/harness/status-timeline.log',
    sessionName: null,
    startedAt: '2026-02-18T00:00:00.000Z',
  });

  const validNamedSession = parseActiveStatusTimelineState({
    version: STATUS_TIMELINE_STATE_VERSION,
    mode: STATUS_TIMELINE_MODE,
    outputPath: '/tmp/harness/status-timeline.log',
    sessionName: 'session-a',
    startedAt: '2026-02-18T00:00:00.000Z',
  });
  assert.equal(validNamedSession?.sessionName, 'session-a');

  assert.equal(parseActiveStatusTimelineState(null), null);
  assert.equal(parseActiveStatusTimelineState('invalid'), null);
  assert.equal(
    parseActiveStatusTimelineState({
      version: 0,
      mode: STATUS_TIMELINE_MODE,
      outputPath: '/tmp/harness/status-timeline.log',
      sessionName: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveStatusTimelineState({
      version: STATUS_TIMELINE_STATE_VERSION,
      mode: 'invalid',
      outputPath: '/tmp/harness/status-timeline.log',
      sessionName: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveStatusTimelineState({
      version: STATUS_TIMELINE_STATE_VERSION,
      mode: STATUS_TIMELINE_MODE,
      outputPath: '',
      sessionName: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveStatusTimelineState({
      version: STATUS_TIMELINE_STATE_VERSION,
      mode: STATUS_TIMELINE_MODE,
      outputPath: '/tmp/harness/status-timeline.log',
      sessionName: 1,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveStatusTimelineState({
      version: STATUS_TIMELINE_STATE_VERSION,
      mode: STATUS_TIMELINE_MODE,
      outputPath: '/tmp/harness/status-timeline.log',
      sessionName: null,
      startedAt: '',
    }),
    null,
  );
});

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import {
  resolveHarnessStatusTimelineCommandArgs,
  toggleGatewayStatusTimeline,
} from '../../../../src/mux/live-mux/gateway-status-timeline.ts';
import { resolveStatusTimelineStatePath } from '../../../../src/mux/live-mux/status-timeline-state.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../../src/config/harness-paths.ts';

void test('gateway status timeline resolves state paths for default and named sessions', () => {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: '/tmp/xdg-home',
  };
  const runtimeRoot = resolveHarnessWorkspaceDirectory('/tmp/harness', env);
  assert.equal(
    resolveStatusTimelineStatePath('/tmp/harness', null, env),
    `${runtimeRoot}/active-status-timeline.json`,
  );
  assert.equal(
    resolveStatusTimelineStatePath('/tmp/harness', 'perf-a', env),
    `${runtimeRoot}/sessions/perf-a/active-status-timeline.json`,
  );
});

void test('gateway status timeline resolves harness command args with optional session scope', () => {
  assert.deepEqual(resolveHarnessStatusTimelineCommandArgs('start', null), [
    'status-timeline',
    'start',
  ]);
  assert.deepEqual(resolveHarnessStatusTimelineCommandArgs('stop', 'perf-a'), [
    '--session',
    'perf-a',
    'status-timeline',
    'stop',
  ]);
});

void test('gateway status timeline toggles start when no active state file exists', async () => {
  const calls: Array<{
    action: 'start' | 'stop';
    sessionName: string | null;
    harnessScriptPath: string;
  }> = [];
  const result = await toggleGatewayStatusTimeline({
    invocationDirectory: '/tmp/harness',
    sessionName: 'perf-a',
    harnessScriptPath: '/tmp/harness/scripts/harness.ts',
    statusTimelineStateExists: () => false,
    runHarnessStatusTimelineCommand: async (input) => {
      calls.push({
        action: input.action,
        sessionName: input.sessionName,
        harnessScriptPath: input.harnessScriptPath,
      });
      return {
        stdout:
          'status timeline started\nstatus-timeline-target: /tmp/harness/.harness-xdg/harness/workspaces/harness-e64e8bc467cc/status-timelines/perf-a/status-timeline.log\n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'start');
  assert.equal(
    result.message,
    'status: timeline=/tmp/harness/.harness-xdg/harness/workspaces/harness-e64e8bc467cc/status-timelines/perf-a/status-timeline.log',
  );
  assert.deepEqual(calls, [
    {
      action: 'start',
      sessionName: 'perf-a',
      harnessScriptPath: '/tmp/harness/scripts/harness.ts',
    },
  ]);
});

void test('gateway status timeline toggles stop when active state file exists', async () => {
  const calls: Array<{ action: 'start' | 'stop' }> = [];
  const result = await toggleGatewayStatusTimeline({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    statusTimelineStateExists: () => true,
    runHarnessStatusTimelineCommand: async (input) => {
      calls.push({ action: input.action });
      return {
        stdout:
          'status timeline stopped: /tmp/harness/.harness-xdg/harness/workspaces/harness-e64e8bc467cc/status-timelines/status-timeline.log\n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'stop');
  assert.equal(
    result.message,
    'status timeline stopped: /tmp/harness/.harness-xdg/harness/workspaces/harness-e64e8bc467cc/status-timelines/status-timeline.log',
  );
  assert.deepEqual(calls, [{ action: 'stop' }]);
});

void test('gateway status timeline surfaces harness command failures', async () => {
  await assert.rejects(
    toggleGatewayStatusTimeline({
      invocationDirectory: '/tmp/harness',
      sessionName: null,
      statusTimelineStateExists: () => false,
      runHarnessStatusTimelineCommand: async () => {
        throw new Error('status timeline start failed: permission denied');
      },
    }),
    /permission denied/u,
  );
});

void test('gateway status timeline default runner executes harness script and reads stdout', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-gateway-status-timeline-success-'));
  const scriptPath = join(workspace, 'harness-stub.js');
  writeFileSync(
    scriptPath,
    "process.stdout.write('status timeline started\\nstatus-timeline-target: /tmp/status-timeline.log\\n');\n",
    'utf8',
  );

  const result = await toggleGatewayStatusTimeline({
    invocationDirectory: workspace,
    sessionName: null,
    harnessScriptPath: scriptPath,
    statusTimelineStateExists: () => false,
  });
  assert.equal(result.action, 'start');
  assert.equal(result.message, 'status: timeline=/tmp/status-timeline.log');
});

void test('gateway status timeline default runner propagates non-zero exits and stderr', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-gateway-status-timeline-failure-'));
  const scriptPath = join(workspace, 'harness-stub.js');
  writeFileSync(
    scriptPath,
    "process.stderr.write('simulated status timeline stop failure\\\\n');\nprocess.exit(1);\n",
    'utf8',
  );

  await assert.rejects(
    toggleGatewayStatusTimeline({
      invocationDirectory: workspace,
      sessionName: null,
      harnessScriptPath: scriptPath,
      statusTimelineStateExists: () => true,
    }),
    /status timeline stop failed: simulated status timeline stop failure/u,
  );
});

void test('gateway status timeline uses fallback status text when command stdout is empty', async () => {
  const startResult = await toggleGatewayStatusTimeline({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    statusTimelineStateExists: () => false,
    runHarnessStatusTimelineCommand: async () => {
      return {
        stdout: '',
        stderr: '',
      };
    },
  });
  assert.equal(startResult.message, 'status timeline started');

  const stopResult = await toggleGatewayStatusTimeline({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    statusTimelineStateExists: () => true,
    runHarnessStatusTimelineCommand: async () => {
      return {
        stdout: '',
        stderr: '',
      };
    },
  });
  assert.equal(stopResult.action, 'stop');
  assert.equal(stopResult.message, 'status timeline stopped');
});

void test('gateway status timeline start falls back when status target line is empty', async () => {
  const result = await toggleGatewayStatusTimeline({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    statusTimelineStateExists: () => false,
    runHarnessStatusTimelineCommand: async () => {
      return {
        stdout: 'status timeline started\nstatus-timeline-target:\n',
        stderr: '',
      };
    },
  });
  assert.equal(result.action, 'start');
  assert.equal(result.message, 'status timeline started');
});

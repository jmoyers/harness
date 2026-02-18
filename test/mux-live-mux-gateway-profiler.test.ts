import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import {
  resolveHarnessProfileCommandArgs,
  resolveProfileStatePath,
  toggleGatewayProfiler,
} from '../src/mux/live-mux/gateway-profiler.ts';

void test('gateway profiler resolves profile-state paths for default and named sessions', () => {
  assert.equal(
    resolveProfileStatePath('/tmp/harness', null),
    '/tmp/harness/.harness/active-profile.json',
  );
  assert.equal(
    resolveProfileStatePath('/tmp/harness', 'perf-a'),
    '/tmp/harness/.harness/sessions/perf-a/active-profile.json',
  );
});

void test('gateway profiler resolves harness command args with optional session scope', () => {
  assert.deepEqual(resolveHarnessProfileCommandArgs('start', null), ['profile', 'start']);
  assert.deepEqual(resolveHarnessProfileCommandArgs('stop', 'perf-a'), [
    '--session',
    'perf-a',
    'profile',
    'stop',
  ]);
});

void test('gateway profiler toggles start when no active profile-state file exists', async () => {
  const calls: Array<{ action: 'start' | 'stop'; sessionName: string | null; harnessScriptPath: string }> = [];
  const result = await toggleGatewayProfiler({
    invocationDirectory: '/tmp/harness',
    sessionName: 'perf-a',
    harnessScriptPath: '/tmp/harness/scripts/harness.ts',
    profileStateExists: () => false,
    runHarnessProfileCommand: async (input) => {
      calls.push({
        action: input.action,
        sessionName: input.sessionName,
        harnessScriptPath: input.harnessScriptPath,
      });
      return {
        stdout: 'profile started pid=123\nprofile-target: /tmp/harness/.harness/profiles/perf-a/gateway.cpuprofile\n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'start');
  assert.equal(result.message, 'profile started pid=123');
  assert.deepEqual(calls, [
    {
      action: 'start',
      sessionName: 'perf-a',
      harnessScriptPath: '/tmp/harness/scripts/harness.ts',
    },
  ]);
});

void test('gateway profiler toggles stop when active profile-state file exists', async () => {
  const calls: Array<{ action: 'start' | 'stop' }> = [];
  const result = await toggleGatewayProfiler({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    profileStateExists: () => true,
    runHarnessProfileCommand: async (input) => {
      calls.push({ action: input.action });
      return {
        stdout: 'profile: gateway=/tmp/harness/.harness/profiles/gateway.cpuprofile\n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'stop');
  assert.equal(result.message, 'profile: gateway=/tmp/harness/.harness/profiles/gateway.cpuprofile');
  assert.deepEqual(calls, [{ action: 'stop' }]);
});

void test('gateway profiler surfaces harness command failures', async () => {
  await assert.rejects(
    toggleGatewayProfiler({
      invocationDirectory: '/tmp/harness',
      sessionName: null,
      profileStateExists: () => false,
      runHarnessProfileCommand: async () => {
        throw new Error('profile start failed: gateway inspector endpoint unavailable');
      },
    }),
    /gateway inspector endpoint unavailable/u,
  );
});

void test('gateway profiler default runner executes harness script and reads stdout', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-gateway-profiler-success-'));
  const scriptPath = join(workspace, 'harness-stub.js');
  writeFileSync(
    scriptPath,
    "process.stdout.write('profile started pid=999\\nprofile-target: /tmp/profile.cpuprofile\\n');\n",
    'utf8',
  );

  const result = await toggleGatewayProfiler({
    invocationDirectory: workspace,
    sessionName: null,
    harnessScriptPath: scriptPath,
    profileStateExists: () => false,
  });
  assert.equal(result.action, 'start');
  assert.equal(result.message, 'profile started pid=999');
});

void test('gateway profiler default runner propagates non-zero exits and stderr', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-gateway-profiler-failure-'));
  const scriptPath = join(workspace, 'harness-stub.js');
  writeFileSync(
    scriptPath,
    "process.stderr.write('simulated profile stop failure\\\\n');\nprocess.exit(1);\n",
    'utf8',
  );

  await assert.rejects(
    toggleGatewayProfiler({
      invocationDirectory: workspace,
      sessionName: null,
      harnessScriptPath: scriptPath,
      profileStateExists: () => true,
    }),
    /profile stop failed: simulated profile stop failure/u,
  );
});

void test('gateway profiler returns fallback status text when command stdout is empty', async () => {
  const result = await toggleGatewayProfiler({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    profileStateExists: () => false,
    runHarnessProfileCommand: async () => {
      return {
        stdout: '',
        stderr: '',
      };
    },
  });
  assert.equal(result.message, 'profile started');
});

void test('gateway profiler uses stop fallback text when stdout is empty during stop', async () => {
  const result = await toggleGatewayProfiler({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    profileStateExists: () => true,
    runHarnessProfileCommand: async () => {
      return {
        stdout: '',
        stderr: '',
      };
    },
  });
  assert.equal(result.action, 'stop');
  assert.equal(result.message, 'profile stopped');
});

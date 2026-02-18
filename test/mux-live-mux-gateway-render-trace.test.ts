import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import {
  resolveHarnessRenderTraceCommandArgs,
  toggleGatewayRenderTrace,
} from '../src/mux/live-mux/gateway-render-trace.ts';
import { resolveRenderTraceStatePath } from '../src/mux/live-mux/render-trace-state.ts';

void test('gateway render trace resolves state paths for default and named sessions', () => {
  assert.equal(
    resolveRenderTraceStatePath('/tmp/harness', null),
    '/tmp/harness/.harness/active-render-trace.json',
  );
  assert.equal(
    resolveRenderTraceStatePath('/tmp/harness', 'perf-a'),
    '/tmp/harness/.harness/sessions/perf-a/active-render-trace.json',
  );
});

void test('gateway render trace resolves harness command args with optional session and conversation scope', () => {
  assert.deepEqual(resolveHarnessRenderTraceCommandArgs('start', null, null), ['render-trace', 'start']);
  assert.deepEqual(resolveHarnessRenderTraceCommandArgs('start', null, 'session-1'), [
    'render-trace',
    'start',
    '--conversation-id',
    'session-1',
  ]);
  assert.deepEqual(resolveHarnessRenderTraceCommandArgs('stop', 'perf-a', 'session-1'), [
    '--session',
    'perf-a',
    'render-trace',
    'stop',
  ]);
});

void test('gateway render trace toggles start and forwards conversation filter', async () => {
  const calls: Array<{
    action: 'start' | 'stop';
    sessionName: string | null;
    conversationId: string | null;
  }> = [];
  const result = await toggleGatewayRenderTrace({
    invocationDirectory: '/tmp/harness',
    sessionName: 'perf-a',
    conversationId: 'session-1',
    harnessScriptPath: '/tmp/harness/scripts/harness.ts',
    renderTraceStateExists: () => false,
    runHarnessRenderTraceCommand: async (input) => {
      calls.push({
        action: input.action,
        sessionName: input.sessionName,
        conversationId: input.conversationId,
      });
      return {
        stdout:
          'render trace started\nrender-trace-target: /tmp/harness/.harness/render-traces/perf-a/render-trace.log\nrender-trace-conversation-id: session-1\n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'start');
  assert.equal(
    result.message,
    'render: trace=/tmp/harness/.harness/render-traces/perf-a/render-trace.log conversation=session-1',
  );
  assert.deepEqual(calls, [
    {
      action: 'start',
      sessionName: 'perf-a',
      conversationId: 'session-1',
    },
  ]);
});

void test('gateway render trace toggles stop when active state file exists', async () => {
  const result = await toggleGatewayRenderTrace({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    conversationId: 'session-1',
    renderTraceStateExists: () => true,
    runHarnessRenderTraceCommand: async (input) => {
      assert.equal(input.action, 'stop');
      assert.equal(input.conversationId, 'session-1');
      return {
        stdout: 'render trace stopped: /tmp/harness/.harness/render-traces/render-trace.log\n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'stop');
  assert.equal(result.message, 'render trace stopped: /tmp/harness/.harness/render-traces/render-trace.log');
});

void test('gateway render trace start fallback message is used when stdout has no usable lines', async () => {
  const result = await toggleGatewayRenderTrace({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    conversationId: null,
    renderTraceStateExists: () => false,
    runHarnessRenderTraceCommand: async (input) => {
      assert.equal(input.action, 'start');
      return {
        stdout: '\n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'start');
  assert.equal(result.message, 'render trace started');
});

void test('gateway render trace ignores empty prefixed values before falling back to first line', async () => {
  const result = await toggleGatewayRenderTrace({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    conversationId: null,
    renderTraceStateExists: () => false,
    runHarnessRenderTraceCommand: async () => ({
      stdout: 'render-trace-target:\nrender trace started from gateway\n',
      stderr: '',
    }),
  });

  assert.equal(result.action, 'start');
  assert.equal(result.message, 'render-trace-target:');
});

void test('gateway render trace stop fallback message is used when stdout is blank', async () => {
  const result = await toggleGatewayRenderTrace({
    invocationDirectory: '/tmp/harness',
    sessionName: null,
    conversationId: null,
    renderTraceStateExists: () => true,
    runHarnessRenderTraceCommand: async (input) => {
      assert.equal(input.action, 'stop');
      return {
        stdout: '   \n',
        stderr: '',
      };
    },
  });

  assert.equal(result.action, 'stop');
  assert.equal(result.message, 'render trace stopped');
});

void test('gateway render trace default runner executes harness script and reads stdout', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-gateway-render-trace-success-'));
  const scriptPath = join(workspace, 'harness-stub.js');
  writeFileSync(
    scriptPath,
    "process.stdout.write('render trace started\\nrender-trace-target: /tmp/render-trace.log\\n');\n",
    'utf8',
  );

  const result = await toggleGatewayRenderTrace({
    invocationDirectory: workspace,
    sessionName: null,
    conversationId: null,
    harnessScriptPath: scriptPath,
    renderTraceStateExists: () => false,
  });
  assert.equal(result.action, 'start');
  assert.equal(result.message, 'render: trace=/tmp/render-trace.log');
});

void test('gateway render trace default runner propagates non-zero exits and stderr', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-gateway-render-trace-failure-'));
  const scriptPath = join(workspace, 'harness-stub.js');
  writeFileSync(
    scriptPath,
    "process.stderr.write('simulated render trace stop failure\\\\n');\nprocess.exit(1);\n",
    'utf8',
  );

  await assert.rejects(
    toggleGatewayRenderTrace({
      invocationDirectory: workspace,
      sessionName: null,
      conversationId: null,
      harnessScriptPath: scriptPath,
      renderTraceStateExists: () => true,
    }),
    /render trace stop failed: simulated render trace stop failure/u,
  );
});

import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseGatewayRecordText } from '../../../../src/cli/gateway-record.ts';
import {
  createSerialCliTest,
  createWorkspace,
  reservePort,
  runHarness,
  waitForGatewayStatusRunning,
  workspaceRuntimeRoot,
} from '../../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createSerialCliTest();

void serialCliTest('harness gateway lifecycle and github.pr-create validation stay healthy', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const recordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
  };
  try {
    const startResult = await runHarness(
      workspace,
      ['gateway', 'start', '--port', String(port)],
      env,
    );
    assert.equal(startResult.code, 0);
    assert.equal(
      startResult.stdout.includes('gateway started') || startResult.stdout.includes('gateway already running'),
      true,
    );
    await waitForGatewayStatusRunning(workspace, ['gateway', 'status'], env);

    const recordRaw = readFileSync(recordPath, 'utf8');
    const record = parseGatewayRecordText(recordRaw);
    assert.notEqual(record, null);
    assert.equal(record?.port, port);
    assert.equal(typeof record?.pid, 'number');

    const statusResult = await runHarness(workspace, ['gateway', 'status'], env);
    assert.equal(statusResult.code, 0);
    assert.equal(statusResult.stdout.includes('gateway status: running'), true);
    assert.equal(statusResult.stdout.includes(`port: ${String(port)}`), true);

    const callResult = await runHarness(
      workspace,
      ['gateway', 'call', '--json', '{"type":"session.list","limit":1}'],
      env,
    );
    assert.equal(callResult.code, 0);
    assert.equal(callResult.stdout.includes('"sessions"'), true);

    const missingDirectoryCall = await runHarness(
      workspace,
      ['gateway', 'call', '--json', '{"type":"github.pr-create","directoryId":"directory-missing"}'],
      env,
    );
    assert.equal(missingDirectoryCall.code, 1);
    assert.equal(
      missingDirectoryCall.stderr.includes('directory not found: directory-missing'),
      true,
    );
    assert.equal(missingDirectoryCall.stderr.includes('github integration is disabled'), false);

    const stopResult = await runHarness(workspace, ['gateway', 'stop'], env);
    assert.equal(stopResult.code, 0);
    assert.equal(
      stopResult.stdout.includes('gateway stopped') ||
        stopResult.stdout.includes('removed stale gateway record'),
      true,
    );

    const finalStatus = await runHarness(workspace, ['gateway', 'status'], env);
    assert.equal(finalStatus.code, 0);
    assert.equal(finalStatus.stdout.includes('gateway status: stopped'), true);
    assert.equal(existsSync(recordPath), false);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

/* oxlint-disable no-unused-vars */
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseGatewayRecordText } from '../../../../src/cli/gateway-record.ts';
import { connectControlPlaneStreamClient } from '../../../../src/control-plane/stream-client.ts';
import {
  resolveHarnessConfigPath,
  resolveHarnessConfigDirectory,
} from '../../../../src/config/config-core.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../../src/config/harness-paths.ts';

import {
  createSerialCliTest,
  createStubCommand,
  createWorkspace,
  isPidRunning,
  readParentPid,
  reserveDistinctPorts,
  reservePort,
  runHarness,
  setTreeMtime,
  spawnOrphanDetachedProcess,
  spawnOrphanGatewayDaemonProcess,
  spawnOrphanSqliteProcess,
  waitForCondition,
  waitForGatewayStatusRunning,
  waitForParentPid,
  waitForPidExit,
  workspaceConfigRoot,
  workspaceRuntimeRoot,
  workspaceXdgConfigHome,
  writeWorkspaceHarnessConfig,
} from '../../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createSerialCliTest();

void serialCliTest('harness profile writes client and gateway CPU profiles in isolated session paths', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-session-a';
  const [gatewayPort, gatewayInspectPort, clientInspectPort] = await reserveDistinctPorts(3);
  const muxStubPath = join(workspace, 'mux-profile-stub.js');
  const defaultRecordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  const sessionRecordPath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/gateway.json`,
  );
  const profileDir = join(workspaceRuntimeRoot(workspace), `profiles/${sessionName}`);
  const clientProfilePath = join(profileDir, 'client.cpuprofile');
  const gatewayProfilePath = join(profileDir, 'gateway.cpuprofile');
  writeFileSync(muxStubPath, ["const noop = '';", 'void noop;'].join('\n'), 'utf8');
  writeWorkspaceHarnessConfig(workspace, {
    debug: {
      inspect: {
        enabled: true,
        gatewayPort: gatewayInspectPort,
        clientPort: clientInspectPort,
      },
    },
  });
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(gatewayPort),
    HARNESS_MUX_SCRIPT_PATH: muxStubPath,
  };

  try {
    const profileResult = await runHarness(workspace, ['--session', sessionName, 'profile'], env);
    assert.equal(profileResult.code, 0);
    assert.equal(profileResult.stdout.includes('profiles: client='), true);
    assert.equal(existsSync(clientProfilePath), true);
    assert.equal(existsSync(gatewayProfilePath), true);
    assert.equal(existsSync(sessionRecordPath), false);
    assert.equal(existsSync(defaultRecordPath), false);

    const statusResult = await runHarness(
      workspace,
      ['--session', sessionName, 'gateway', 'status'],
      env,
    );
    assert.equal(statusResult.code, 0);
    assert.equal(statusResult.stdout.includes('gateway status: stopped'), true);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'gateway', 'stop', '--force'], env).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness profile start/stop writes gateway CPU profile to global profiles path for the target session', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-start-stop-a';
  const sessionRecordPath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/gateway.json`,
  );
  const profileStatePath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/active-profile.json`,
  );
  const gatewayProfilePath = join(
    workspaceRuntimeRoot(workspace),
    `profiles/${sessionName}/gateway.cpuprofile`,
  );
  const [gatewayPort, gatewayInspectPort, clientInspectPort] = await reserveDistinctPorts(3);
  writeWorkspaceHarnessConfig(workspace, {
    debug: {
      inspect: {
        enabled: true,
        gatewayPort: gatewayInspectPort,
        clientPort: clientInspectPort,
      },
    },
  });
  try {
    const gatewayStart = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'start',
      '--port',
      String(gatewayPort),
    ]);
    assert.equal(gatewayStart.code, 0);
    await waitForGatewayStatusRunning(
      workspace,
      ['--session', sessionName, 'gateway', 'status'],
      {},
      15_000,
    );
    const recordBefore = parseGatewayRecordText(readFileSync(sessionRecordPath, 'utf8'));
    if (recordBefore === null) {
      throw new Error('expected gateway record before profile stop');
    }

    const startResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'start']);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes('profile started pid='), true);
    assert.equal(startResult.stdout.includes(`profile-target: ${gatewayProfilePath}`), true);
    assert.equal(existsSync(sessionRecordPath), true);
    assert.equal(existsSync(profileStatePath), true);

    const statusRunning = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'status',
    ]);
    assert.equal(statusRunning.code, 0);
    assert.equal(statusRunning.stdout.includes('gateway status: running'), true);

    const stopResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'stop']);
    assert.equal(stopResult.code, 0);
    assert.equal(stopResult.stdout.includes('profile: gateway='), true);
    assert.equal(existsSync(gatewayProfilePath), true);
    assert.equal(existsSync(profileStatePath), false);

    const statusRunningAfterStop = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'status',
    ]);
    assert.equal(statusRunningAfterStop.code, 0);
    assert.equal(statusRunningAfterStop.stdout.includes('gateway status: running'), true);

    const recordAfter = parseGatewayRecordText(readFileSync(sessionRecordPath, 'utf8'));
    if (recordAfter === null) {
      throw new Error('expected gateway record after profile stop');
    }
    assert.equal(recordAfter.pid, recordBefore.pid);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'gateway', 'stop', '--force']).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

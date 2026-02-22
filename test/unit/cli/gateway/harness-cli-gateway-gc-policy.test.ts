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
  createConcurrentCliTest,
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

const serialCliTest = createConcurrentCliTest();

void serialCliTest('harness gateway gc removes named sessions older than one week and keeps recent sessions', async () => {
  const workspace = createWorkspace();
  const runtimeRoot = workspaceRuntimeRoot(workspace);
  const sessionsRoot = join(runtimeRoot, 'sessions');
  const oldSessionRoot = join(sessionsRoot, 'old-session-a');
  const recentSessionRoot = join(sessionsRoot, 'recent-session-a');
  mkdirSync(oldSessionRoot, { recursive: true });
  mkdirSync(recentSessionRoot, { recursive: true });
  writeFileSync(join(oldSessionRoot, 'control-plane.sqlite'), '', 'utf8');
  writeFileSync(join(recentSessionRoot, 'control-plane.sqlite'), '', 'utf8');
  setTreeMtime(oldSessionRoot, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
  setTreeMtime(recentSessionRoot, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

  try {
    const gcResult = await runHarness(workspace, ['gateway', 'gc']);
    assert.equal(gcResult.code, 0, gcResult.stderr);
    assert.equal(gcResult.stdout.includes('gateway gc:'), true);
    assert.equal(existsSync(oldSessionRoot), false);
    assert.equal(existsSync(recentSessionRoot), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway gc skips live named sessions even when their artifacts look stale', async () => {
  const workspace = createWorkspace();
  const sessionName = 'live-session-a';
  const port = await reservePort();
  const sessionRoot = join(workspaceRuntimeRoot(workspace), `sessions/${sessionName}`);
  const sessionRecordPath = join(sessionRoot, 'gateway.json');
  let gatewayPid: number | null = null;
  try {
    const startResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'start',
      '--port',
      String(port),
    ]);
    assert.equal(startResult.code, 0, startResult.stderr);
    const record = parseGatewayRecordText(readFileSync(sessionRecordPath, 'utf8'));
    if (record === null) {
      throw new Error('expected live named session gateway record');
    }
    gatewayPid = record.pid;
    assert.equal(isPidRunning(gatewayPid), true);

    setTreeMtime(sessionRoot, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    const gcResult = await runHarness(workspace, ['gateway', 'gc']);
    assert.equal(gcResult.code, 0, gcResult.stderr);
    assert.equal(gcResult.stdout.includes('skippedLive=1'), true);
    assert.equal(existsSync(sessionRoot), true);
    assert.equal(isPidRunning(gatewayPid), true);
  } finally {
    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'stop',
      '--force',
    ]);
    assert.equal(stopResult.code, 0, stopResult.stderr);
    if (gatewayPid !== null) {
      assert.equal(await waitForPidExit(gatewayPid, 5000), true);
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway gc rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['gateway', 'gc', '--bad-option']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown gateway option: --bad-option'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

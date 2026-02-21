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
import { parseGatewayRecordText } from '../../../src/cli/gateway-record.ts';
import { connectControlPlaneStreamClient } from '../../../src/control-plane/stream-client.ts';
import {
  resolveHarnessConfigPath,
  resolveHarnessConfigDirectory,
} from '../../../src/config/config-core.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../src/config/harness-paths.ts';

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
} from '../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createSerialCliTest();

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

void serialCliTest('harness gateway stop cleans up orphan sqlite processes for the workspace db', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const dbPath = join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite');
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
  };
  let orphanPid: number | null = null;
  try {
    const startResult = await runHarness(
      workspace,
      ['gateway', 'start', '--port', String(port)],
      env,
    );
    assert.equal(startResult.code, 0);

    orphanPid = await spawnOrphanSqliteProcess(dbPath);
    assert.equal(await waitForParentPid(orphanPid, 1, 2000), true);
    assert.equal(isPidRunning(orphanPid), true);

    const stopResult = await runHarness(workspace, ['gateway', 'stop'], env);
    assert.equal(stopResult.code, 0);
    assert.equal(stopResult.stdout.includes('gateway stopped'), true);
    assert.equal(stopResult.stdout.includes('orphan sqlite cleanup:'), true);

    assert.equal(await waitForPidExit(orphanPid, 4000), true);
    assert.equal(isPidRunning(orphanPid), false);
  } finally {
    if (orphanPid !== null && isPidRunning(orphanPid)) {
      process.kill(orphanPid, 'SIGKILL');
    }
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway stop --force cleans up orphan gateway daemon processes for the workspace db', async () => {
  const workspace = createWorkspace();
  const dbPath = join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite');
  const daemonScriptPath = join(workspace, 'control-plane-daemon.js');
  writeFileSync(
    daemonScriptPath,
    ['process.on("SIGTERM", () => process.exit(0));', 'setInterval(() => {}, 1000);'].join('\n'),
    'utf8',
  );

  let orphanPid: number | null = null;
  try {
    orphanPid = await spawnOrphanGatewayDaemonProcess(daemonScriptPath, dbPath);
    assert.equal(await waitForParentPid(orphanPid, 1, 2000), true);
    assert.equal(isPidRunning(orphanPid), true);

    const stopResult = await runHarness(workspace, ['gateway', 'stop', '--force']);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stdout.includes('gateway not running (no record)'), true);
    assert.equal(stopResult.stdout.includes('orphan gateway daemon cleanup:'), true);

    assert.equal(await waitForPidExit(orphanPid, 4000), true);
    assert.equal(isPidRunning(orphanPid), false);
  } finally {
    if (orphanPid !== null && isPidRunning(orphanPid)) {
      process.kill(orphanPid, 'SIGKILL');
    }
    void runHarness(workspace, ['gateway', 'stop', '--force']).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway stop --force cleans up orphan gateway daemon processes by workspace script path', async () => {
  const workspace = createWorkspace();
  const daemonScriptPath = join(workspace, 'control-plane-daemon.js');
  const nonDefaultDbPath = join(workspaceRuntimeRoot(workspace), 'custom-gateway.sqlite');
  writeFileSync(
    daemonScriptPath,
    ['process.on("SIGTERM", () => process.exit(0));', 'setInterval(() => {}, 1000);'].join('\n'),
    'utf8',
  );

  let orphanPid: number | null = null;
  try {
    orphanPid = await spawnOrphanGatewayDaemonProcess(daemonScriptPath, nonDefaultDbPath);
    assert.equal(await waitForParentPid(orphanPid, 1, 2000), true);
    assert.equal(isPidRunning(orphanPid), true);

    const stopResult = await runHarness(workspace, ['gateway', 'stop', '--force'], {
      HARNESS_DAEMON_SCRIPT_PATH: daemonScriptPath,
    });
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stdout.includes('gateway not running (no record)'), true);
    assert.equal(stopResult.stdout.includes('orphan gateway daemon cleanup:'), true);

    assert.equal(await waitForPidExit(orphanPid, 4000), true);
    assert.equal(isPidRunning(orphanPid), false);
  } finally {
    if (orphanPid !== null && isPidRunning(orphanPid)) {
      process.kill(orphanPid, 'SIGKILL');
    }
    void runHarness(workspace, ['gateway', 'stop', '--force']).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway stop --force cleans up orphan workspace pty helper processes', async () => {
  const workspace = createWorkspace();
  const ptyPath = join(workspace, 'bin/ptyd');
  mkdirSync(join(workspace, 'bin'), { recursive: true });
  writeFileSync(
    ptyPath,
    ['#!/bin/sh', 'trap "exit 0" TERM INT', 'while true; do sleep 1; done'].join('\n'),
    'utf8',
  );
  chmodSync(ptyPath, 0o755);

  let orphanPid: number | null = null;
  try {
    orphanPid = await spawnOrphanDetachedProcess(ptyPath);
    assert.equal(await waitForParentPid(orphanPid, 1, 2000), true);
    assert.equal(isPidRunning(orphanPid), true);

    const stopResult = await runHarness(workspace, ['gateway', 'stop', '--force']);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stdout.includes('gateway not running (no record)'), true);
    assert.equal(stopResult.stdout.includes('orphan pty helper cleanup:'), true);

    assert.equal(await waitForPidExit(orphanPid, 4000), true);
    assert.equal(isPidRunning(orphanPid), false);
  } finally {
    if (orphanPid !== null && isPidRunning(orphanPid)) {
      process.kill(orphanPid, 'SIGKILL');
    }
    void runHarness(workspace, ['gateway', 'stop', '--force']).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

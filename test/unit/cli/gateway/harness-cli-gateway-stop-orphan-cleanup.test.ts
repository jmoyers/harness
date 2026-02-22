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

void serialCliTest(
  'harness gateway stop cleans up orphan sqlite processes for the workspace db',
  async () => {
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
  },
);

void serialCliTest(
  'harness gateway stop --force cleans up orphan gateway daemon processes for the workspace db',
  async () => {
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
  },
);

void serialCliTest(
  'harness gateway stop --force cleans up orphan gateway daemon processes by workspace script path',
  async () => {
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
  },
);

void serialCliTest(
  'harness gateway stop --force cleans up orphan workspace pty helper processes',
  async () => {
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
  },
);

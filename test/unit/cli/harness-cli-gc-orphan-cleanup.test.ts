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

interface RunHarnessResult {
  code: number;
  stdout: string;
  stderr: string;
}

const HARNESS_SCRIPT_PATH = resolve(process.cwd(), 'scripts/harness.ts');

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'harness-cli-test-'));
}

function createStubCommand(dirPath: string, name: string, scriptBody: string): void {
  const commandPath = join(dirPath, name);
  writeFileSync(commandPath, ['#!/bin/sh', scriptBody].join('\n'), 'utf8');
  chmodSync(commandPath, 0o755);
}

function workspaceXdgConfigHome(workspace: string): string {
  return join(workspace, '.harness-xdg');
}

function workspaceRuntimeRoot(workspace: string): string {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  };
  return resolveHarnessWorkspaceDirectory(workspace, env);
}

function workspaceConfigRoot(workspace: string): string {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  };
  return resolveHarnessConfigDirectory(workspace, env);
}

function writeWorkspaceHarnessConfig(workspace: string, config: unknown): string {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  };
  const filePath = resolveHarnessConfigPath(workspace, env);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(config), 'utf8');
  return filePath;
}

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => {
          reject(new Error('failed to resolve reserved port'));
        });
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function reserveDistinctPorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  while (ports.length < count) {
    const candidate = await reservePort();
    if (!ports.includes(candidate)) {
      ports.push(candidate);
    }
  }
  return ports;
}

async function runHarness(
  cwd: string,
  args: readonly string[],
  extraEnv: Record<string, string | undefined> = {},
): Promise<RunHarnessResult> {
  return await new Promise<RunHarnessResult>((resolveRun, rejectRun) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HARNESS_INVOKE_CWD: cwd,
      XDG_CONFIG_HOME: workspaceXdgConfigHome(cwd),
      ...extraEnv,
    };
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) {
        delete env[key];
      }
    }
    const child = spawn(process.execPath, tsRuntimeArgs(HARNESS_SCRIPT_PATH, args), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        rejectRun(new Error(`harness exited via signal ${signal}`));
        return;
      }
      resolveRun({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

async function waitForCondition(
  check: () => boolean,
  timeoutMs: number,
  failureMessage: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await delay(25);
  }
  if (!check()) {
    throw new Error(failureMessage);
  }
}

async function waitForGatewayStatusRunning(
  workspace: string,
  statusArgs: readonly string[],
  env: Record<string, string | undefined> = {},
  timeoutMs = 12_000,
): Promise<void> {
  const startedAt = Date.now();
  let lastCode = -1;
  let lastStdout = '';
  let lastStderr = '';
  while (Date.now() - startedAt < timeoutMs) {
    const status = await runHarness(workspace, statusArgs, env);
    lastCode = status.code;
    lastStdout = status.stdout;
    lastStderr = status.stderr;
    if (status.code === 0 && status.stdout.includes('gateway status: running')) {
      return;
    }
    await delay(50);
  }
  throw new Error(
    `timed out waiting for running gateway status (code=${String(lastCode)} stdout=${JSON.stringify(lastStdout)} stderr=${JSON.stringify(lastStderr)})`,
  );
}

interface HarnessCliTestOptions {
  timeout?: number;
  retry?: number;
  repeats?: number;
}

type HarnessCliTestCallback = () => void | Promise<unknown>;

let harnessCliTestLock: Promise<void> = Promise.resolve();

async function withHarnessCliTestLock<T>(run: () => Promise<T>): Promise<T> {
  let releaseLock: () => void = () => {};
  const nextLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const previousLock = harnessCliTestLock;
  harnessCliTestLock = previousLock.then(() => nextLock);
  await previousLock;
  try {
    return await run();
  } finally {
    releaseLock();
  }
}

function normalizeHarnessCliTestOptions(
  options: number | HarnessCliTestOptions | undefined,
): HarnessCliTestOptions {
  const minTimeoutMs = 180_000;
  if (typeof options === 'number') {
    return {
      timeout: Math.max(options, minTimeoutMs),
    };
  }
  return {
    ...(options ?? {}),
    timeout: Math.max(options?.timeout ?? 0, minTimeoutMs),
  };
}

function serialCliTest(
  name: string,
  fn: HarnessCliTestCallback,
  options?: number | HarnessCliTestOptions,
): void {
  test(name, normalizeHarnessCliTestOptions(options), async () => {
    await withHarnessCliTestLock(async () => {
      await fn();
    });
  });
}

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

function readParentPid(pid: number): number | null {
  try {
    const output = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    if (output.length === 0) {
      return null;
    }
    const parsed = Number.parseInt(output, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function waitForParentPid(
  pid: number,
  targetParentPid: number,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidRunning(pid)) {
      return false;
    }
    if (readParentPid(pid) === targetParentPid) {
      return true;
    }
    await delay(25);
  }
  return readParentPid(pid) === targetParentPid;
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(25);
  }
  return !isPidRunning(pid);
}

function setTreeMtime(rootPath: string, mtime: Date): void {
  const stack: string[] = [rootPath];
  while (stack.length > 0) {
    const currentPath = stack.pop()!;
    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      for (const child of readdirSync(currentPath, { withFileTypes: true })) {
        stack.push(join(currentPath, child.name));
      }
    }
    utimesSync(currentPath, mtime, mtime);
  }
}

async function spawnOrphanSqliteProcess(dbPath: string): Promise<number> {
  return await new Promise<number>((resolveSpawn, rejectSpawn) => {
    const longRunningSql =
      'WITH RECURSIVE c(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM c WHERE x < 1000) SELECT count(*) FROM c a, c b, c d, c e;';
    const launcherScript = [
      "const { spawn } = require('node:child_process');",
      'const dbPath = process.argv[1];',
      'const sql = process.argv[2];',
      "const child = spawn('sqlite3', [dbPath, sql], { detached: true, stdio: 'ignore' });",
      "if (typeof child.pid !== 'number') { process.exit(2); }",
      'process.stdout.write(String(child.pid));',
      'child.unref();',
    ].join('\n');

    const launcher = spawn(process.execPath, ['-e', launcherScript, dbPath, longRunningSql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    launcher.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    launcher.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    launcher.once('error', rejectSpawn);
    launcher.once('exit', (code, signal) => {
      if (signal !== null) {
        rejectSpawn(new Error(`orphan sqlite launcher exited via signal ${signal}`));
        return;
      }
      if (code !== 0) {
        rejectSpawn(
          new Error(
            `orphan sqlite launcher failed (code=${String(code)}): ${Buffer.concat(stderrChunks).toString('utf8')}`,
          ),
        );
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const pid = Number.parseInt(stdout, 10);
      if (!Number.isInteger(pid) || pid <= 0) {
        rejectSpawn(new Error(`orphan sqlite launcher produced invalid pid output: ${stdout}`));
        return;
      }
      resolveSpawn(pid);
    });
  });
}

async function spawnOrphanGatewayDaemonProcess(
  daemonScriptPath: string,
  dbPath: string,
): Promise<number> {
  return await new Promise<number>((resolveSpawn, rejectSpawn) => {
    const launcherScript = [
      "const { spawn } = require('node:child_process');",
      'const daemonScriptPath = process.argv[1];',
      'const dbPath = process.argv[2];',
      "const child = spawn(process.execPath, [daemonScriptPath, '--state-db-path', dbPath], { detached: true, stdio: 'ignore' });",
      "if (typeof child.pid !== 'number') { process.exit(2); }",
      'process.stdout.write(String(child.pid));',
      'child.unref();',
    ].join('\n');

    const launcher = spawn(process.execPath, ['-e', launcherScript, daemonScriptPath, dbPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    launcher.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    launcher.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    launcher.once('error', rejectSpawn);
    launcher.once('exit', (code, signal) => {
      if (signal !== null) {
        rejectSpawn(new Error(`orphan gateway launcher exited via signal ${signal}`));
        return;
      }
      if (code !== 0) {
        rejectSpawn(
          new Error(
            `orphan gateway launcher failed (code=${String(code)}): ${Buffer.concat(stderrChunks).toString('utf8')}`,
          ),
        );
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const pid = Number.parseInt(stdout, 10);
      if (!Number.isInteger(pid) || pid <= 0) {
        rejectSpawn(new Error(`orphan gateway launcher produced invalid pid output: ${stdout}`));
        return;
      }
      resolveSpawn(pid);
    });
  });
}

async function spawnOrphanDetachedProcess(
  command: string,
  args: readonly string[] = [],
): Promise<number> {
  return await new Promise<number>((resolveSpawn, rejectSpawn) => {
    const launcherScript = [
      "const { spawn } = require('node:child_process');",
      'const command = process.argv[1];',
      'const args = JSON.parse(process.argv[2]);',
      "const child = spawn(command, args, { detached: true, stdio: 'ignore' });",
      "if (typeof child.pid !== 'number') { process.exit(2); }",
      'process.stdout.write(String(child.pid));',
      'child.unref();',
    ].join('\n');

    const launcher = spawn(
      process.execPath,
      ['-e', launcherScript, command, JSON.stringify(args)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    launcher.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    launcher.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    launcher.once('error', rejectSpawn);
    launcher.once('exit', (code, signal) => {
      if (signal !== null) {
        rejectSpawn(new Error(`orphan process launcher exited via signal ${signal}`));
        return;
      }
      if (code !== 0) {
        rejectSpawn(
          new Error(
            `orphan process launcher failed (code=${String(code)}): ${Buffer.concat(stderrChunks).toString('utf8')}`,
          ),
        );
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const pid = Number.parseInt(stdout, 10);
      if (!Number.isInteger(pid) || pid <= 0) {
        rejectSpawn(new Error(`orphan process launcher produced invalid pid output: ${stdout}`));
        return;
      }
      resolveSpawn(pid);
    });
  });
}

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

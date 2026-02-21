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

void serialCliTest('harness profile start fails when target session gateway is not running', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-start-missing-gateway';
  try {
    const startResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'start']);
    assert.equal(startResult.code, 1);
    assert.equal(
      startResult.stderr.includes(
        'profile start requires the target session gateway to be running',
      ),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness profile start fails when gateway inspector endpoint is unavailable', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-start-no-inspect';
  const gatewayPort = await reservePort();
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
    const startResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'start']);
    assert.equal(startResult.code, 1);
    assert.equal(startResult.stderr.includes('gateway inspector endpoint unavailable'), true);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'gateway', 'stop', '--force']).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness profile stop fails when there is no active profile state', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-stop-missing';
  try {
    const stopResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'stop']);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stderr.includes('no active profile run for this session'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline start/stop writes and clears active state for the target session', async () => {
  const workspace = createWorkspace();
  const sessionName = 'status-timeline-start-stop-a';
  const statusTimelineStatePath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/active-status-timeline.json`,
  );
  const statusTimelineOutputPath = join(
    workspaceRuntimeRoot(workspace),
    `status-timelines/${sessionName}/status-timeline.log`,
  );
  try {
    const startResult = await runHarness(workspace, ['--session', sessionName, 'status-timeline']);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes('status timeline started'), true);
    assert.equal(
      startResult.stdout.includes(`status-timeline-target: ${statusTimelineOutputPath}`),
      true,
    );
    assert.equal(existsSync(statusTimelineStatePath), true);
    assert.equal(existsSync(statusTimelineOutputPath), true);
    assert.equal(readFileSync(statusTimelineOutputPath, 'utf8'), '');

    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'stop',
    ]);
    assert.equal(stopResult.code, 0);
    assert.equal(
      stopResult.stdout.includes(`status timeline stopped: ${statusTimelineOutputPath}`),
      true,
    );
    assert.equal(existsSync(statusTimelineStatePath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline start supports custom output path and rejects duplicate active runs', async () => {
  const workspace = createWorkspace();
  const sessionName = 'status-timeline-custom-output-a';
  const customOutputPath = join(workspace, 'custom', 'status.log');
  try {
    const startResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'start',
      '--output-path',
      './custom/status.log',
    ]);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes(`status-timeline-target: ${customOutputPath}`), true);
    assert.equal(existsSync(customOutputPath), true);

    const duplicateStartResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'start',
    ]);
    assert.equal(duplicateStartResult.code, 1);
    assert.equal(
      duplicateStartResult.stderr.includes('status timeline already running; stop it first'),
      true,
    );
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'status-timeline', 'stop']).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline stop fails when there is no active status timeline state', async () => {
  const workspace = createWorkspace();
  const sessionName = 'status-timeline-stop-missing';
  try {
    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'stop',
    ]);
    assert.equal(stopResult.code, 1);
    assert.equal(
      stopResult.stderr.includes('no active status timeline run for this session'),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline rejects unknown subcommands', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'bogus']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline subcommand: bogus'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline stop rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'stop', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline option: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline start rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'start', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline option: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness render-trace start/stop writes and clears active state for the target session', async () => {
  const workspace = createWorkspace();
  const sessionName = 'render-trace-start-stop-a';
  const renderTraceStatePath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/active-render-trace.json`,
  );
  const renderTraceOutputPath = join(
    workspaceRuntimeRoot(workspace),
    `render-traces/${sessionName}/render-trace.log`,
  );
  try {
    const startResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      '--conversation-id',
      'session-1',
    ]);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes('render trace started'), true);
    assert.equal(
      startResult.stdout.includes(`render-trace-target: ${renderTraceOutputPath}`),
      true,
    );
    assert.equal(startResult.stdout.includes('render-trace-conversation-id: session-1'), true);
    assert.equal(existsSync(renderTraceStatePath), true);
    assert.equal(existsSync(renderTraceOutputPath), true);
    assert.equal(readFileSync(renderTraceOutputPath, 'utf8'), '');

    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'stop',
    ]);
    assert.equal(stopResult.code, 0);
    assert.equal(
      stopResult.stdout.includes(`render trace stopped: ${renderTraceOutputPath}`),
      true,
    );
    assert.equal(existsSync(renderTraceStatePath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness render-trace rejects duplicate start and validates stop/options', async () => {
  const workspace = createWorkspace();
  const sessionName = 'render-trace-validation-a';
  try {
    const startResult = await runHarness(workspace, ['--session', sessionName, 'render-trace']);
    assert.equal(startResult.code, 0);

    const duplicateStartResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'start',
    ]);
    assert.equal(duplicateStartResult.code, 1);
    assert.equal(
      duplicateStartResult.stderr.includes('render trace already running; stop it first'),
      true,
    );

    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'stop',
      '--bad',
    ]);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stderr.includes('unknown render-trace option: --bad'), true);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'render-trace', 'stop']).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness render-trace stop and subcommand validation errors are explicit', async () => {
  const workspace = createWorkspace();
  const sessionName = 'render-trace-stop-missing';
  try {
    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'stop',
    ]);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stderr.includes('no active render trace run for this session'), true);

    const badSubcommandResult = await runHarness(workspace, ['render-trace', 'bogus']);
    assert.equal(badSubcommandResult.code, 1);
    assert.equal(
      badSubcommandResult.stderr.includes('unknown render-trace subcommand: bogus'),
      true,
    );

    const badOptionResult = await runHarness(workspace, [
      'render-trace',
      'start',
      '--conversation-id',
      '',
    ]);
    assert.equal(badOptionResult.code, 1);
    assert.equal(
      badOptionResult.stderr.includes('invalid --conversation-id value: empty string'),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest(
  'named session can run two terminal threads that execute harness animate for throughput load',
  async () => {
    const workspace = createWorkspace();
    const sessionName = 'perf-throughput-a';
    const port = await reservePort();
    const env = {
      HARNESS_CONTROL_PLANE_PORT: String(port),
    };
    const sessionRecordPath = join(
      workspaceRuntimeRoot(workspace),
      `sessions/${sessionName}/gateway.json`,
    );
    const defaultRecordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');

    let client: Awaited<ReturnType<typeof connectControlPlaneStreamClient>> | null = null;
    try {
      const startResult = await runHarness(
        workspace,
        ['--session', sessionName, 'gateway', 'start', '--port', String(port)],
        env,
      );
      assert.equal(startResult.code, 0);
      await waitForGatewayStatusRunning(
        workspace,
        ['--session', sessionName, 'gateway', 'status'],
        env,
        15_000,
      );
      assert.equal(existsSync(sessionRecordPath), true);
      assert.equal(existsSync(defaultRecordPath), false);

      const recordRaw = readFileSync(sessionRecordPath, 'utf8');
      const record = parseGatewayRecordText(recordRaw);
      assert.notEqual(record, null);

      client = await connectControlPlaneStreamClient({
        host: record?.host ?? '127.0.0.1',
        port: record?.port ?? port,
        ...(record?.authToken === null || record?.authToken === undefined
          ? {}
          : {
              authToken: record.authToken,
            }),
      });

      const sessionIds = ['terminal-throughput-a', 'terminal-throughput-b'] as const;
      const outputBytesBySession = new Map<string, number>();

      client.onEnvelope((envelope) => {
        if (envelope.kind !== 'pty.output') {
          return;
        }
        const chunk = Buffer.from(envelope.chunkBase64, 'base64');
        outputBytesBySession.set(
          envelope.sessionId,
          (outputBytesBySession.get(envelope.sessionId) ?? 0) + chunk.length,
        );
      });

      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-throughput',
        path: workspace,
      });

      for (const sessionId of sessionIds) {
        await client.sendCommand({
          type: 'conversation.create',
          conversationId: sessionId,
          directoryId: 'directory-throughput',
          title: sessionId,
          agentType: 'terminal',
        });
        await client.sendCommand({
          type: 'pty.start',
          sessionId,
          args: [],
          initialCols: 120,
          initialRows: 40,
          cwd: workspace,
        });
        await client.sendCommand({
          type: 'pty.attach',
          sessionId,
        });
      }

      for (const sessionId of sessionIds) {
        await client.sendCommand({
          type: 'session.respond',
          sessionId,
          text: `printf "ready-${sessionId}\\n"\n`,
        });
      }
      await waitForCondition(
        () => sessionIds.every((sessionId) => (outputBytesBySession.get(sessionId) ?? 0) >= 20),
        5_000,
        'timed out waiting for baseline terminal output on both sessions',
      );
      const baselineBytes = new Map<string, number>();
      for (const sessionId of sessionIds) {
        baselineBytes.set(sessionId, outputBytesBySession.get(sessionId) ?? 0);
      }

      for (const sessionId of sessionIds) {
        await client.sendCommand({
          type: 'session.respond',
          sessionId,
          text: 'bun run harness animate --duration-ms 1200 --fps 120 --no-color\n',
        });
      }

      await waitForCondition(
        () =>
          sessionIds.every(
            (sessionId) =>
              (outputBytesBySession.get(sessionId) ?? 0) - (baselineBytes.get(sessionId) ?? 0) >=
              250,
          ),
        25_000,
        'timed out waiting for animate throughput output on both terminal sessions',
      );

      const listResult = await client.sendCommand({
        type: 'session.list',
      });
      const sessions = listResult['sessions'];
      assert.equal(Array.isArray(sessions), true);
      const activeIds = new Set<string>();
      if (Array.isArray(sessions)) {
        for (const session of sessions) {
          if (typeof session !== 'object' || session === null) {
            continue;
          }
          const typed = session as Record<string, unknown>;
          if (typeof typed['sessionId'] === 'string') {
            activeIds.add(typed['sessionId']);
          }
        }
      }
      assert.equal(activeIds.has('terminal-throughput-a'), true);
      assert.equal(activeIds.has('terminal-throughput-b'), true);
    } finally {
      client?.close();
      void runHarness(
        workspace,
        ['--session', sessionName, 'gateway', 'stop', '--force'],
        env,
      ).catch(() => undefined);
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 45_000 },
);


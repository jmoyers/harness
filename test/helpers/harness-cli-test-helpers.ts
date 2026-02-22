import { test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  resolveHarnessConfigPath,
  resolveHarnessConfigDirectory,
} from '../../src/config/config-core.ts';
import { resolveHarnessWorkspaceDirectory } from '../../src/config/harness-paths.ts';

export interface RunHarnessResult {
  code: number;
  stdout: string;
  stderr: string;
}

const HARNESS_SCRIPT_PATH = resolve(process.cwd(), 'scripts/harness.ts');

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

export function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'harness-cli-test-'));
}

export function createStubCommand(dirPath: string, name: string, scriptBody: string): void {
  const commandPath = join(dirPath, name);
  writeFileSync(commandPath, ['#!/bin/sh', scriptBody].join('\n'), 'utf8');
  chmodSync(commandPath, 0o755);
}

export function workspaceXdgConfigHome(workspace: string): string {
  return join(workspace, '.harness-xdg');
}

export function workspaceRuntimeRoot(workspace: string): string {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  };
  return resolveHarnessWorkspaceDirectory(workspace, env);
}

export function workspaceConfigRoot(workspace: string): string {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  };
  return resolveHarnessConfigDirectory(workspace, env);
}

export function writeWorkspaceHarnessConfig(workspace: string, config: unknown): string {
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  };
  const filePath = resolveHarnessConfigPath(workspace, env);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(config), 'utf8');
  return filePath;
}

export async function reservePort(): Promise<number> {
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

export async function reserveDistinctPorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  while (ports.length < count) {
    const candidate = await reservePort();
    if (!ports.includes(candidate)) {
      ports.push(candidate);
    }
  }
  return ports;
}

export async function runHarness(
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

export async function waitForCondition(
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

export async function waitForGatewayStatusRunning(
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

export interface HarnessCliTestOptions {
  timeout?: number;
  retry?: number;
  repeats?: number;
}

type HarnessCliTestCallback = () => void | Promise<unknown>;

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

export function createSerialCliTest(): (
  name: string,
  fn: HarnessCliTestCallback,
  options?: number | HarnessCliTestOptions,
) => void {
  let serialLock: Promise<void> = Promise.resolve();

  async function withLock<T>(run: () => Promise<T>): Promise<T> {
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolveLock) => {
      releaseLock = resolveLock;
    });
    const previousLock = serialLock;
    serialLock = previousLock.then(() => nextLock);
    await previousLock;
    try {
      return await run();
    } finally {
      releaseLock();
    }
  }

  return (name, fn, options) => {
    test(name, normalizeHarnessCliTestOptions(options), async () => {
      await withLock(async () => {
        await fn();
      });
    });
  };
}

export function createConcurrentCliTest(): (
  name: string,
  fn: HarnessCliTestCallback,
  options?: number | HarnessCliTestOptions,
) => void {
  return (name, fn, options) => {
    test(name, normalizeHarnessCliTestOptions(options), async () => {
      await fn();
    });
  };
}

export function isPidRunning(pid: number): boolean {
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

export function readParentPid(pid: number): number | null {
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

export async function waitForParentPid(
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

export async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(25);
  }
  return !isPidRunning(pid);
}

export function setTreeMtime(rootPath: string, mtime: Date): void {
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

export async function spawnOrphanSqliteProcess(dbPath: string): Promise<number> {
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

export async function spawnOrphanGatewayDaemonProcess(
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

export async function spawnOrphanDetachedProcess(
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

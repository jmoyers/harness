import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseGatewayRecordText } from '../../../src/cli/gateway-record.ts';
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
  return mkdtempSync(join(tmpdir(), 'harness-session-auto-port-integration-'));
}

function workspaceXdgConfigHome(workspace: string): string {
  return join(workspace, '.harness-xdg');
}

function workspaceRuntimeRoot(workspace: string): string {
  return resolveHarnessWorkspaceDirectory(workspace, {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  });
}

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => {
          reject(new Error('failed to reserve local port'));
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

void test('harness named-session gateway start auto-resolves occupied preferred port and stops without process leaks', async () => {
  const workspace = createWorkspace();
  const sessionName = 'secondary-int-explicit-a';
  const preferredPort = await reservePort();
  const runtimeRoot = workspaceRuntimeRoot(workspace);
  const defaultRecordPath = join(runtimeRoot, 'gateway.json');
  const namedRecordPath = join(runtimeRoot, `sessions/${sessionName}/gateway.json`);
  const namedLogPath = join(runtimeRoot, `sessions/${sessionName}/gateway.log`);
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(preferredPort),
  };

  let defaultGatewayPid: number | null = null;
  let namedGatewayPid: number | null = null;
  try {
    const defaultStart = await runHarness(workspace, ['gateway', 'start'], env);
    assert.equal(defaultStart.code, 0, defaultStart.stderr);
    const defaultRecord = parseGatewayRecordText(readFileSync(defaultRecordPath, 'utf8'));
    if (defaultRecord === null) {
      throw new Error('expected default gateway record');
    }
    defaultGatewayPid = defaultRecord.pid;
    assert.equal(defaultRecord.port, preferredPort);
    assert.equal(isPidRunning(defaultGatewayPid), true);

    const namedStart = await runHarness(
      workspace,
      ['--session', sessionName, 'gateway', 'start'],
      env,
    );
    assert.equal(namedStart.code, 0, namedStart.stderr);
    const namedRecord = parseGatewayRecordText(readFileSync(namedRecordPath, 'utf8'));
    if (namedRecord === null) {
      throw new Error('expected named-session gateway record');
    }
    namedGatewayPid = namedRecord.pid;
    assert.notEqual(namedRecord.port, preferredPort);
    assert.equal(isPidRunning(namedGatewayPid), true);

    const namedStatus = await runHarness(
      workspace,
      ['--session', sessionName, 'gateway', 'status'],
      env,
    );
    assert.equal(namedStatus.code, 0, namedStatus.stderr);
    assert.equal(namedStatus.stdout.includes('gateway status: running'), true);

    const namedStop = await runHarness(
      workspace,
      ['--session', sessionName, 'gateway', 'stop', '--force'],
      env,
    );
    assert.equal(namedStop.code, 0, namedStop.stderr);
    assert.equal(await waitForPidExit(namedGatewayPid, 5000), true);
    assert.equal(existsSync(namedRecordPath), false);
    assert.equal(existsSync(namedLogPath), false);
    assert.equal(isPidRunning(namedGatewayPid), false);
    namedGatewayPid = null;

    const defaultStop = await runHarness(workspace, ['gateway', 'stop', '--force'], env);
    assert.equal(defaultStop.code, 0, defaultStop.stderr);
    assert.equal(await waitForPidExit(defaultGatewayPid, 5000), true);
    assert.equal(isPidRunning(defaultGatewayPid), false);
    defaultGatewayPid = null;
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'gateway', 'stop', '--force'], env).catch(
      () => undefined,
    );
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    if (namedGatewayPid !== null && isPidRunning(namedGatewayPid)) {
      process.kill(namedGatewayPid, 'SIGKILL');
      await waitForPidExit(namedGatewayPid, 5000);
    }
    if (defaultGatewayPid !== null && isPidRunning(defaultGatewayPid)) {
      process.kill(defaultGatewayPid, 'SIGKILL');
      await waitForPidExit(defaultGatewayPid, 5000);
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

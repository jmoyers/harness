import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseGatewayRecordText } from '../../../src/cli/gateway-record.ts';
import { resolveHarnessConfigPath } from '../../../src/config/config-core.ts';
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
  return mkdtempSync(join(tmpdir(), 'harness-profile-live-attach-integration-'));
}

function workspaceXdgConfigHome(workspace: string): string {
  return join(workspace, '.harness-xdg');
}

function workspaceRuntimeRoot(workspace: string): string {
  return resolveHarnessWorkspaceDirectory(workspace, {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  });
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

async function waitForFileExists(filePath: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) {
      return true;
    }
    await delay(25);
  }
  return existsSync(filePath);
}

void test('harness profile live-attach integration writes gateway cpuprofile with custom inspect config and no process leaks', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-live-attach-int-a';
  const [gatewayPort, gatewayInspectPort, clientInspectPort] = await reserveDistinctPorts(3);
  const sessionRecordPath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/gateway.json`,
  );
  const defaultRecordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  const profileStatePath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/active-profile.json`,
  );
  const gatewayProfilePath = join(
    workspaceRuntimeRoot(workspace),
    `profiles/${sessionName}/gateway.cpuprofile`,
  );
  writeWorkspaceHarnessConfig(workspace, {
    debug: {
      inspect: {
        enabled: true,
        gatewayPort: gatewayInspectPort,
        clientPort: clientInspectPort,
      },
    },
  });

  let gatewayPid: number | null = null;
  try {
    const gatewayStart = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'start',
      '--port',
      String(gatewayPort),
    ]);
    assert.equal(gatewayStart.code, 0, gatewayStart.stderr);
    assert.equal(existsSync(defaultRecordPath), false);
    assert.equal(existsSync(sessionRecordPath), true);
    const record = parseGatewayRecordText(readFileSync(sessionRecordPath, 'utf8'));
    if (record === null) {
      throw new Error('expected session gateway record');
    }
    gatewayPid = record.pid;
    assert.equal(isPidRunning(gatewayPid), true);

    const profileStart = await runHarness(workspace, [
      '--session',
      sessionName,
      'profile',
      'start',
    ]);
    assert.equal(profileStart.code, 0, profileStart.stderr);
    assert.equal(existsSync(profileStatePath), true);

    const profileStop = await runHarness(workspace, [
      '--session',
      sessionName,
      'profile',
      'stop',
      '--timeout-ms',
      '10000',
    ]);
    assert.equal(profileStop.code, 0, profileStop.stderr);
    assert.equal(await waitForFileExists(gatewayProfilePath, 10000), true);
    assert.equal(existsSync(profileStatePath), false);
    const rawProfile = readFileSync(gatewayProfilePath, 'utf8');
    assert.equal(rawProfile.length > 0, true);
    const parsedProfile = JSON.parse(rawProfile) as Record<string, unknown>;
    assert.equal(Array.isArray(parsedProfile['nodes']), true);

    const runningStatus = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'status',
    ]);
    assert.equal(runningStatus.code, 0, runningStatus.stderr);
    assert.equal(runningStatus.stdout.includes('gateway status: running'), true);

    const gatewayStop = await runHarness(workspace, [
      '--session',
      sessionName,
      'gateway',
      'stop',
      '--force',
    ]);
    assert.equal(gatewayStop.code, 0, gatewayStop.stderr);
    assert.equal(await waitForPidExit(gatewayPid, 5000), true);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'gateway', 'stop', '--force']).catch(
      () => undefined,
    );
    if (gatewayPid !== null) {
      await waitForPidExit(gatewayPid, 5000);
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

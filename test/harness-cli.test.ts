import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseGatewayRecordText } from '../src/cli/gateway-record.ts';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import {
  resolveHarnessConfigPath,
  resolveHarnessConfigDirectory,
} from '../src/config/config-core.ts';
import { resolveHarnessWorkspaceDirectory } from '../src/config/harness-paths.ts';

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

void test('harness gateway status reports stopped when no record exists', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['gateway', 'status']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('gateway status: stopped'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness auto-migrates legacy local .harness record path to global runtime root on first run', async () => {
  const workspace = createWorkspace();
  const legacyRoot = join(workspace, '.harness');
  const legacyRecordPath = join(legacyRoot, 'gateway.json');
  const runtimeRecordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(
    legacyRecordPath,
    JSON.stringify(
      {
        version: 1,
        pid: process.pid,
        host: '127.0.0.1',
        port: 6553,
        authToken: null,
        stateDbPath: join(legacyRoot, 'control-plane.sqlite'),
        startedAt: new Date().toISOString(),
        workspaceRoot: workspace,
      },
      null,
      2,
    ),
    'utf8',
  );

  try {
    const result = await runHarness(workspace, ['gateway', 'status']);
    assert.equal(existsSync(runtimeRecordPath), true);
    assert.equal(result.stdout.includes(`[migration] local .harness migrated`), true);
    assert.equal(result.stdout.includes(`record: ${runtimeRecordPath}`), true);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force']).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness gateway start ignores stale record state db path and uses runtime default', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const runtimeRoot = workspaceRuntimeRoot(workspace);
  const recordPath = join(runtimeRoot, 'gateway.json');
  const staleStateDbPath = join(workspace, '.harness', 'control-plane.sqlite');
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    recordPath,
    JSON.stringify(
      {
        version: 1,
        pid: 2147483647,
        host: '127.0.0.1',
        port,
        authToken: null,
        stateDbPath: staleStateDbPath,
        startedAt: new Date().toISOString(),
        workspaceRoot: workspace,
      },
      null,
      2,
    ),
    'utf8',
  );
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
    const recordRaw = readFileSync(recordPath, 'utf8');
    const record = parseGatewayRecordText(recordRaw);
    assert.notEqual(record, null);
    assert.equal(record?.stateDbPath, join(runtimeRoot, 'control-plane.sqlite'));
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness gateway start ignores HARNESS_CONTROL_PLANE_DB_PATH and uses runtime default', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const runtimeRoot = workspaceRuntimeRoot(workspace);
  const recordPath = join(runtimeRoot, 'gateway.json');
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
    HARNESS_CONTROL_PLANE_DB_PATH: join(workspace, '.harness', 'legacy-control-plane.sqlite'),
  };
  try {
    const startResult = await runHarness(
      workspace,
      ['gateway', 'start', '--port', String(port)],
      env,
    );
    assert.equal(startResult.code, 0);
    const recordRaw = readFileSync(recordPath, 'utf8');
    const record = parseGatewayRecordText(recordRaw);
    assert.notEqual(record, null);
    assert.equal(record?.stateDbPath, join(runtimeRoot, 'control-plane.sqlite'));
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness gateway start rejects local workspace .harness state db path', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
  };
  const localLegacyDbPath = join(workspace, '.harness', 'control-plane.sqlite');
  try {
    const startResult = await runHarness(
      workspace,
      ['gateway', 'start', '--port', String(port), '--state-db-path', localLegacyDbPath],
      env,
    );
    assert.equal(startResult.code, 1);
    assert.equal(startResult.stderr.includes('invalid --state-db-path'), true);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness gateway start adopts an already-reachable daemon when gateway record is missing', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const runtimeRoot = workspaceRuntimeRoot(workspace);
  const recordPath = join(runtimeRoot, 'gateway.json');
  const adoptedAuthToken = `adopt-token-${process.pid}-${Date.now()}`;
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
  };
  let originalPid: number | null = null;
  try {
    const startResult = await runHarness(
      workspace,
      ['gateway', 'start', '--port', String(port), '--auth-token', adoptedAuthToken],
      env,
    );
    assert.equal(startResult.code, 0);
    const originalRecord = parseGatewayRecordText(readFileSync(recordPath, 'utf8'));
    if (originalRecord === null) {
      throw new Error('expected initial gateway record');
    }
    originalPid = originalRecord.pid;
    assert.equal(isPidRunning(originalPid), true);

    unlinkSync(recordPath);
    const adoptionAttempt = await runHarness(
      workspace,
      [
        'gateway',
        'start',
        '--port',
        String(port),
        '--auth-token',
        adoptedAuthToken,
        '--state-db-path',
        './custom-overwrite-attempt.sqlite',
      ],
      env,
    );
    assert.equal(adoptionAttempt.code, 0);
    const adoptedRecord = parseGatewayRecordText(readFileSync(recordPath, 'utf8'));
    assert.notEqual(adoptedRecord, null);
    assert.equal(adoptedRecord?.pid, originalRecord.pid);
    assert.equal(adoptedRecord?.stateDbPath, originalRecord.stateDbPath);
    assert.equal(adoptedRecord?.authToken, adoptedAuthToken);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    if (originalPid !== null && isPidRunning(originalPid)) {
      process.kill(originalPid, 'SIGKILL');
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness rejects invalid session names', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['--session', '../bad', 'gateway', 'status']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('invalid --session value'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness update runs global latest install command via bun', async () => {
  const workspace = createWorkspace();
  const commandDir = join(workspace, 'bin');
  mkdirSync(commandDir, { recursive: true });
  const bunArgsPath = join(workspace, 'bun-args.txt');
  createStubCommand(
    commandDir,
    'bun',
    [
      'if [ -n "${HARNESS_TEST_BUN_ARGS_PATH:-}" ]; then',
      '  printf "%s\\n" "$@" > "$HARNESS_TEST_BUN_ARGS_PATH"',
      'fi',
      'if [ -n "${HARNESS_TEST_BUN_STDOUT:-}" ]; then',
      '  printf "%s\\n" "$HARNESS_TEST_BUN_STDOUT"',
      'fi',
      'exit "${HARNESS_TEST_BUN_EXIT_CODE:-0}"',
    ].join('\n'),
  );
  try {
    const result = await runHarness(workspace, ['update'], {
      PATH: commandDir,
      HARNESS_TEST_BUN_ARGS_PATH: bunArgsPath,
      HARNESS_TEST_BUN_STDOUT: 'bun install ok',
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('updating Harness package: @jmoyers/harness@latest'), true);
    assert.equal(result.stdout.includes('bun install ok'), true);
    assert.equal(result.stdout.includes('harness update complete: @jmoyers/harness@latest'), true);
    assert.equal(
      readFileSync(bunArgsPath, 'utf8'),
      ['add', '-g', '--trust', '@jmoyers/harness@latest'].join('\n') + '\n',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness upgrade aliases harness update and honors HARNESS_UPDATE_PACKAGE override', async () => {
  const workspace = createWorkspace();
  const commandDir = join(workspace, 'bin');
  mkdirSync(commandDir, { recursive: true });
  const bunArgsPath = join(workspace, 'bun-args.txt');
  createStubCommand(
    commandDir,
    'bun',
    [
      'if [ -n "${HARNESS_TEST_BUN_ARGS_PATH:-}" ]; then',
      '  printf "%s\\n" "$@" > "$HARNESS_TEST_BUN_ARGS_PATH"',
      'fi',
      'exit 0',
    ].join('\n'),
  );
  try {
    const result = await runHarness(workspace, ['upgrade'], {
      PATH: commandDir,
      HARNESS_TEST_BUN_ARGS_PATH: bunArgsPath,
      HARNESS_UPDATE_PACKAGE: '@jmoyers/harness@next',
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('updating Harness package: @jmoyers/harness@next'), true);
    assert.equal(result.stdout.includes('harness update complete: @jmoyers/harness@next'), true);
    assert.equal(
      readFileSync(bunArgsPath, 'utf8'),
      ['add', '-g', '--trust', '@jmoyers/harness@next'].join('\n') + '\n',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness update rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['update', '--bad-option']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown update option: --bad-option'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness cursor-hooks install creates managed cursor hooks in user scope', async () => {
  const workspace = createWorkspace();
  const fakeHome = join(workspace, 'fake-home');
  const hooksFilePath = join(fakeHome, '.cursor/hooks.json');
  try {
    const result = await runHarness(workspace, ['cursor-hooks', 'install'], {
      HOME: fakeHome,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('cursor hooks install:'), true);
    assert.equal(existsSync(hooksFilePath), true);
    const parsed = JSON.parse(readFileSync(hooksFilePath, 'utf8')) as Record<string, unknown>;
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    const managedBeforeSubmit = hooks['beforeSubmitPrompt'] ?? [];
    assert.equal(
      managedBeforeSubmit.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes('harness-cursor-hook-v1:beforeSubmitPrompt'),
      ),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness cursor-hooks uninstall removes only managed cursor entries', async () => {
  const workspace = createWorkspace();
  const fakeHome = join(workspace, 'fake-home');
  const hooksFilePath = join(fakeHome, '.cursor/hooks.json');
  mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      version: 1,
      hooks: {
        beforeSubmitPrompt: [
          { command: 'echo user-hook' },
          {
            command:
              "/usr/bin/env node /tmp/cursor-hook-relay.ts --managed-hook-id 'harness-cursor-hook-v1:beforeSubmitPrompt'",
          },
        ],
      },
    }),
    'utf8',
  );
  try {
    const result = await runHarness(workspace, ['cursor-hooks', 'uninstall'], {
      HOME: fakeHome,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('cursor hooks uninstall:'), true);
    const parsed = JSON.parse(readFileSync(hooksFilePath, 'utf8')) as Record<string, unknown>;
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(
      hooks['beforeSubmitPrompt']?.some((entry) => entry['command'] === 'echo user-hook'),
      true,
    );
    assert.equal(
      hooks['beforeSubmitPrompt']?.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes('harness-cursor-hook-v1'),
      ),
      false,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness animate --help prints usage', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate', '--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('harness animate [--fps <fps>]'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness animate requires explicit bounds in non-tty mode', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate']);
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr.includes(
        'harness animate requires a TTY or explicit --frames/--duration-ms bounds',
      ),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness animate renders bounded frames without starting gateway', async () => {
  const workspace = createWorkspace();
  const recordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  try {
    const result = await runHarness(workspace, [
      'animate',
      '--frames',
      '1',
      '--seed',
      '7',
      '--no-color',
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('HARNESS'), true);
    assert.equal(existsSync(recordPath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness animate default color output uses muted palette', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate', '--frames', '1', '--seed', '7']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('\u001b[38;5;109m'), true);
    assert.equal(result.stdout.includes('\u001b[38;5;46m'), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness gateway start/status/call/stop manages daemon lifecycle', async () => {
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
      startResult.stdout.includes('gateway started') ||
        startResult.stdout.includes('gateway already running'),
      true,
    );

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

    const stopResult = await runHarness(workspace, ['gateway', 'stop'], env);
    assert.equal(stopResult.code, 0);
    assert.equal(stopResult.stdout.includes('gateway stopped'), true);

    const finalStatus = await runHarness(workspace, ['gateway', 'status'], env);
    assert.equal(finalStatus.code, 0);
    assert.equal(finalStatus.stdout.includes('gateway status: stopped'), true);
    assert.equal(existsSync(recordPath), false);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness gateway call github.pr-create reaches command validation before github disabled guard', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
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

    const missingDirectoryCall = await runHarness(
      workspace,
      [
        'gateway',
        'call',
        '--json',
        '{"type":"github.pr-create","directoryId":"directory-missing"}',
      ],
      env,
    );
    assert.equal(missingDirectoryCall.code, 1);
    assert.equal(
      missingDirectoryCall.stderr.includes('directory not found: directory-missing'),
      true,
    );
    assert.equal(missingDirectoryCall.stderr.includes('github integration is disabled'), false);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness default client auto-starts detached gateway and leaves it running on client exit', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const muxArgsPath = join(workspaceRuntimeRoot(workspace), 'mux-args.json');
  const muxStubPath = join(workspace, 'mux-stub.js');
  const recordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  writeFileSync(
    muxStubPath,
    [
      "import { writeFileSync } from 'node:fs';",
      'const target = process.env.HARNESS_TEST_MUX_ARGS_PATH;',
      "if (typeof target === 'string' && target.length > 0) {",
      "  writeFileSync(target, JSON.stringify(process.argv.slice(2)), 'utf8');",
      '}',
    ].join('\n'),
    'utf8',
  );
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
    HARNESS_MUX_SCRIPT_PATH: muxStubPath,
    HARNESS_TEST_MUX_ARGS_PATH: muxArgsPath,
  };
  try {
    const clientResult = await runHarness(workspace, [], env);
    assert.equal(clientResult.code, 0);
    assert.equal(existsSync(recordPath), true);
    assert.equal(existsSync(muxArgsPath), true);

    const muxArgs = JSON.parse(readFileSync(muxArgsPath, 'utf8')) as string[];
    assert.equal(muxArgs.includes('--harness-server-host'), true);
    assert.equal(muxArgs.includes('--harness-server-port'), true);
    assert.equal(muxArgs.includes(String(port)), true);

    const statusResult = await runHarness(workspace, ['gateway', 'status'], env);
    assert.equal(statusResult.code, 0);
    assert.equal(statusResult.stdout.includes('gateway status: running'), true);

    const stopResult = await runHarness(workspace, ['gateway', 'stop'], env);
    assert.equal(stopResult.code, 0);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness gateway run applies inspect runtime args from harness config', async () => {
  const workspace = createWorkspace();
  const daemonStubPath = join(workspace, 'daemon-inspect-stub.js');
  const daemonExecArgvPath = join(workspaceRuntimeRoot(workspace), 'daemon-exec-argv.json');
  const [gatewayInspectPort, clientInspectPort] = await reserveDistinctPorts(2);
  writeWorkspaceHarnessConfig(workspace, {
    debug: {
      inspect: {
        enabled: true,
        gatewayPort: gatewayInspectPort,
        clientPort: clientInspectPort,
      },
    },
  });
  writeFileSync(
    daemonStubPath,
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      'const target = process.env.HARNESS_TEST_DAEMON_EXEC_ARGV_PATH;',
      "if (typeof target === 'string' && target.length > 0) {",
      '  mkdirSync(dirname(target), { recursive: true });',
      "  writeFileSync(target, JSON.stringify(process.execArgv), 'utf8');",
      '}',
    ].join('\n'),
    'utf8',
  );

  const env = {
    HARNESS_DAEMON_SCRIPT_PATH: daemonStubPath,
    HARNESS_TEST_DAEMON_EXEC_ARGV_PATH: daemonExecArgvPath,
  };
  try {
    const runResult = await runHarness(workspace, ['gateway', 'run'], env);
    assert.equal(runResult.code, 0);
    assert.equal(existsSync(daemonExecArgvPath), true);
    const daemonExecArgv = JSON.parse(readFileSync(daemonExecArgvPath, 'utf8')) as string[];
    assert.equal(
      daemonExecArgv.includes(`--inspect=localhost:${String(gatewayInspectPort)}/harness-gateway`),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness default client applies inspect runtime args to mux process from harness config', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const muxStubPath = join(workspace, 'mux-inspect-stub.js');
  const muxExecArgvPath = join(workspaceRuntimeRoot(workspace), 'mux-exec-argv.json');
  const [gatewayInspectPort, clientInspectPort] = await reserveDistinctPorts(2);
  writeWorkspaceHarnessConfig(workspace, {
    debug: {
      inspect: {
        enabled: true,
        gatewayPort: gatewayInspectPort,
        clientPort: clientInspectPort,
      },
    },
  });
  writeFileSync(
    muxStubPath,
    [
      "import { writeFileSync } from 'node:fs';",
      'const target = process.env.HARNESS_TEST_MUX_EXEC_ARGV_PATH;',
      "if (typeof target === 'string' && target.length > 0) {",
      "  writeFileSync(target, JSON.stringify(process.execArgv), 'utf8');",
      '}',
    ].join('\n'),
    'utf8',
  );
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
    HARNESS_MUX_SCRIPT_PATH: muxStubPath,
    HARNESS_TEST_MUX_EXEC_ARGV_PATH: muxExecArgvPath,
  };
  try {
    const clientResult = await runHarness(workspace, [], env);
    assert.equal(clientResult.code, 0);
    assert.equal(existsSync(muxExecArgvPath), true);
    const muxExecArgv = JSON.parse(readFileSync(muxExecArgvPath, 'utf8')) as string[];
    assert.equal(
      muxExecArgv.includes(`--inspect=localhost:${String(clientInspectPort)}/harness-client`),
      true,
    );
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness default client loads global secrets.env and forwards ANTHROPIC_API_KEY to mux process', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const muxStubPath = join(workspace, 'mux-secrets-stub.js');
  const observedKeyPath = join(workspaceRuntimeRoot(workspace), 'observed-anthropic-key.txt');
  mkdirSync(workspaceConfigRoot(workspace), { recursive: true });
  writeFileSync(
    join(workspaceConfigRoot(workspace), 'secrets.env'),
    'ANTHROPIC_API_KEY=from-secrets-file',
    'utf8',
  );
  writeFileSync(
    muxStubPath,
    [
      "import { writeFileSync } from 'node:fs';",
      'const target = process.env.HARNESS_TEST_ANTHROPIC_KEY_PATH;',
      "if (typeof target === 'string' && target.length > 0) {",
      "  writeFileSync(target, process.env.ANTHROPIC_API_KEY ?? '', 'utf8');",
      '}',
    ].join('\n'),
    'utf8',
  );
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
    HARNESS_MUX_SCRIPT_PATH: muxStubPath,
    HARNESS_TEST_ANTHROPIC_KEY_PATH: observedKeyPath,
    ANTHROPIC_API_KEY: undefined,
  };
  try {
    const clientResult = await runHarness(workspace, [], env);
    assert.equal(clientResult.code, 0);
    assert.equal(existsSync(observedKeyPath), true);
    assert.equal(readFileSync(observedKeyPath, 'utf8'), 'from-secrets-file');
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness profile writes client and gateway CPU profiles in isolated session paths', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-session-a';
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
  const env = {
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

void test('harness profile start/stop writes gateway CPU profile to global profiles path for the target session', async () => {
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

void test('harness profile start fails when target session gateway is not running', async () => {
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

void test('harness profile start fails when gateway inspector endpoint is unavailable', async () => {
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

void test('harness profile stop fails when there is no active profile state', async () => {
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

void test('harness status-timeline start/stop writes and clears active state for the target session', async () => {
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

void test('harness status-timeline start supports custom output path and rejects duplicate active runs', async () => {
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

void test('harness status-timeline stop fails when there is no active status timeline state', async () => {
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

void test('harness status-timeline rejects unknown subcommands', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'bogus']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline subcommand: bogus'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness status-timeline stop rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'stop', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline option: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness status-timeline start rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'start', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline option: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness render-trace start/stop writes and clears active state for the target session', async () => {
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

void test('harness render-trace rejects duplicate start and validates stop/options', async () => {
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

void test('harness render-trace stop and subcommand validation errors are explicit', async () => {
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

void test(
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
              400,
          ),
        12_000,
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
  { timeout: 30_000 },
);

void test('harness gateway stop cleans up orphan sqlite processes for the workspace db', async () => {
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

void test('harness gateway stop --force cleans up orphan gateway daemon processes for the workspace db', async () => {
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

void test('harness gateway stop --force cleans up orphan gateway daemon processes by workspace script path', async () => {
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

void test('harness gateway stop --force cleans up orphan workspace pty helper processes', async () => {
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

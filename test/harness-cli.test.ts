import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseGatewayRecordText } from '../src/cli/gateway-record.ts';

interface RunHarnessResult {
  code: number;
  stdout: string;
  stderr: string;
}

const HARNESS_SCRIPT_PATH = resolve(process.cwd(), 'scripts/harness.ts');

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'harness-cli-test-'));
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

async function runHarness(
  cwd: string,
  args: readonly string[],
  extraEnv: Record<string, string | undefined> = {}
): Promise<RunHarnessResult> {
  return await new Promise<RunHarnessResult>((resolveRun, rejectRun) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HARNESS_INVOKE_CWD: cwd,
      ...extraEnv
    };
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) {
        delete env[key];
      }
    }
    const child = spawn(process.execPath, ['--experimental-strip-types', HARNESS_SCRIPT_PATH, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env
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
        stderr: Buffer.concat(stderrChunks).toString('utf8')
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

function readParentPid(pid: number): number | null {
  try {
    const output = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
      encoding: 'utf8'
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

async function waitForParentPid(pid: number, targetParentPid: number, timeoutMs: number): Promise<boolean> {
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
      'child.unref();'
    ].join('\n');

    const launcher = spawn(process.execPath, ['-e', launcherScript, dbPath, longRunningSql], {
      stdio: ['ignore', 'pipe', 'pipe']
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
            `orphan sqlite launcher failed (code=${String(code)}): ${Buffer.concat(stderrChunks).toString('utf8')}`
          )
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
    assert.equal(result.stderr.includes('harness animate requires a TTY or explicit --frames/--duration-ms bounds'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('harness animate renders bounded frames without starting gateway', async () => {
  const workspace = createWorkspace();
  const recordPath = join(workspace, '.harness/gateway.json');
  try {
    const result = await runHarness(workspace, ['animate', '--frames', '1', '--seed', '7', '--no-color']);
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
  const recordPath = join(workspace, '.harness/gateway.json');
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port)
  };
  try {
    const startResult = await runHarness(workspace, ['gateway', 'start', '--port', String(port)], env);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes('gateway started') || startResult.stdout.includes('gateway already running'), true);

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
      env
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

void test('harness default client auto-starts detached gateway and leaves it running on client exit', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const muxArgsPath = join(workspace, '.harness/mux-args.json');
  const muxStubPath = join(workspace, 'mux-stub.js');
  const recordPath = join(workspace, '.harness/gateway.json');
  writeFileSync(
    muxStubPath,
    [
      "import { writeFileSync } from 'node:fs';",
      'const target = process.env.HARNESS_TEST_MUX_ARGS_PATH;',
      "if (typeof target === 'string' && target.length > 0) {",
      "  writeFileSync(target, JSON.stringify(process.argv.slice(2)), 'utf8');",
      '}'
    ].join('\n'),
    'utf8'
  );
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
    HARNESS_MUX_SCRIPT_PATH: muxStubPath,
    HARNESS_TEST_MUX_ARGS_PATH: muxArgsPath
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

void test('harness default client loads .harness/secrets.env and forwards ANTHROPIC_API_KEY to mux process', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const muxStubPath = join(workspace, 'mux-secrets-stub.js');
  const observedKeyPath = join(workspace, '.harness/observed-anthropic-key.txt');
  mkdirSync(join(workspace, '.harness'), { recursive: true });
  writeFileSync(
    join(workspace, '.harness/secrets.env'),
    'ANTHROPIC_API_KEY=from-secrets-file',
    'utf8'
  );
  writeFileSync(
    muxStubPath,
    [
      "import { writeFileSync } from 'node:fs';",
      'const target = process.env.HARNESS_TEST_ANTHROPIC_KEY_PATH;',
      "if (typeof target === 'string' && target.length > 0) {",
      "  writeFileSync(target, process.env.ANTHROPIC_API_KEY ?? '', 'utf8');",
      '}'
    ].join('\n'),
    'utf8'
  );
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
    HARNESS_MUX_SCRIPT_PATH: muxStubPath,
    HARNESS_TEST_ANTHROPIC_KEY_PATH: observedKeyPath,
    ANTHROPIC_API_KEY: undefined
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

void test('harness gateway stop cleans up orphan sqlite processes for the workspace db', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const dbPath = join(workspace, '.harness/control-plane.sqlite');
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port)
  };
  let orphanPid: number | null = null;
  try {
    const startResult = await runHarness(workspace, ['gateway', 'start', '--port', String(port)], env);
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

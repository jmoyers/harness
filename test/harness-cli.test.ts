import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
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
  extraEnv: Record<string, string> = {}
): Promise<RunHarnessResult> {
  return await new Promise<RunHarnessResult>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', HARNESS_SCRIPT_PATH, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HARNESS_INVOKE_CWD: cwd,
        ...extraEnv
      }
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

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import {
  clearDefaultGatewayPointerForRecordPath,
  parseDefaultGatewayPointerText,
  readDefaultGatewayPointer,
  resolveDefaultGatewayPointerPath,
  writeDefaultGatewayPointerFromGatewayRecord,
} from '../src/cli/default-gateway-pointer.ts';
import { GATEWAY_RECORD_VERSION, type GatewayRecord } from '../src/cli/gateway-record.ts';

function gatewayRecord(overrides: Partial<GatewayRecord> = {}): GatewayRecord {
  return {
    version: GATEWAY_RECORD_VERSION,
    pid: 12345,
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath: '/tmp/runtime/control-plane.sqlite',
    startedAt: '2026-02-19T00:00:00.000Z',
    workspaceRoot: '/tmp/workspace',
    ...overrides,
  };
}

void test('default gateway pointer parsing accepts valid payloads', () => {
  const parsed = parseDefaultGatewayPointerText(
    JSON.stringify({
      version: 1,
      workspaceRoot: '/tmp/workspace',
      workspaceRuntimeRoot: '/tmp/runtime',
      gatewayRecordPath: '/tmp/runtime/gateway.json',
      gatewayLogPath: '/tmp/runtime/gateway.log',
      stateDbPath: '/tmp/runtime/control-plane.sqlite',
      pid: 12345,
      startedAt: '2026-02-19T00:00:00.000Z',
      updatedAt: '2026-02-19T00:00:01.000Z',
      gatewayRunId: 'run-1',
    }),
  );
  assert.notEqual(parsed, null);
  assert.equal(parsed?.workspaceRoot, '/tmp/workspace');
  assert.equal(parsed?.gatewayRunId, 'run-1');
});

void test('default gateway pointer parsing rejects malformed payloads', () => {
  assert.equal(parseDefaultGatewayPointerText('not-json'), null);
  assert.equal(parseDefaultGatewayPointerText('[]'), null);
  assert.equal(
    parseDefaultGatewayPointerText(
      JSON.stringify({
        version: 1,
        workspaceRoot: '/tmp/workspace',
      }),
    ),
    null,
  );
  assert.equal(
    parseDefaultGatewayPointerText(
      JSON.stringify({
        version: 2,
        workspaceRoot: '/tmp/workspace',
        workspaceRuntimeRoot: '/tmp/runtime',
        gatewayRecordPath: '/tmp/runtime/gateway.json',
        gatewayLogPath: '/tmp/runtime/gateway.log',
        stateDbPath: '/tmp/runtime/control-plane.sqlite',
        pid: 1,
        startedAt: '2026-02-19T00:00:00.000Z',
        updatedAt: '2026-02-19T00:00:01.000Z',
      }),
    ),
    null,
  );
});

void test('default gateway pointer read returns null when pointer file is missing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    assert.equal(readDefaultGatewayPointer('/tmp/workspace-missing', env), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer read returns null when pointer path is unreadable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const workspaceRoot = '/tmp/workspace-unreadable';
    const pointerPath = resolveDefaultGatewayPointerPath(workspaceRoot, env);
    mkdirSync(pointerPath, { recursive: true });
    assert.equal(readDefaultGatewayPointer(workspaceRoot, env), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer writes and reads for default session records', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const recordPath = '/tmp/runtime/gateway.json';
    const record = gatewayRecord({
      workspaceRoot: '/tmp/workspace-a',
      stateDbPath: '/tmp/runtime/control-plane.sqlite',
      gatewayRunId: 'run-default',
    });
    writeDefaultGatewayPointerFromGatewayRecord(recordPath, record, env);

    const pointerPath = resolveDefaultGatewayPointerPath(record.workspaceRoot, env);
    assert.equal(existsSync(pointerPath), true);
    const readBack = readDefaultGatewayPointer(record.workspaceRoot, env);
    assert.notEqual(readBack, null);
    assert.equal(readBack?.gatewayRecordPath, '/tmp/runtime/gateway.json');
    assert.equal(readBack?.gatewayLogPath, '/tmp/runtime/gateway.log');
    assert.equal(readBack?.gatewayRunId, 'run-default');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer ignores named session gateway records', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const record = gatewayRecord({
      workspaceRoot: '/tmp/workspace-b',
    });
    writeDefaultGatewayPointerFromGatewayRecord(
      '/tmp/runtime/sessions/named-a/gateway.json',
      record,
      env,
    );

    const pointerPath = resolveDefaultGatewayPointerPath(record.workspaceRoot, env);
    assert.equal(existsSync(pointerPath), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer clear ignores non-default session paths and missing pointers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const workspaceRoot = '/tmp/workspace-ignore-clear';
    clearDefaultGatewayPointerForRecordPath(
      '/tmp/runtime/sessions/named-a/gateway.json',
      workspaceRoot,
      env,
    );
    clearDefaultGatewayPointerForRecordPath('/tmp/runtime/gateway.json', workspaceRoot, env);
    const pointerPath = resolveDefaultGatewayPointerPath(workspaceRoot, env);
    assert.equal(existsSync(pointerPath), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer clears only when record path matches', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const workspaceRoot = '/tmp/workspace-c';
    const pointerRecord = gatewayRecord({
      workspaceRoot,
      stateDbPath: '/tmp/runtime-a/control-plane.sqlite',
    });
    writeDefaultGatewayPointerFromGatewayRecord('/tmp/runtime-a/gateway.json', pointerRecord, env);
    const pointerPath = resolveDefaultGatewayPointerPath(workspaceRoot, env);
    assert.equal(existsSync(pointerPath), true);

    clearDefaultGatewayPointerForRecordPath('/tmp/runtime-b/gateway.json', workspaceRoot, env);
    assert.equal(existsSync(pointerPath), true);

    clearDefaultGatewayPointerForRecordPath('/tmp/runtime-a/gateway.json', workspaceRoot, env);
    assert.equal(existsSync(pointerPath), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer clear tolerates unreadable pointer file path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const workspaceRoot = '/tmp/workspace-unreadable-clear';
    const pointerPath = resolveDefaultGatewayPointerPath(workspaceRoot, env);
    mkdirSync(pointerPath, { recursive: true });
    clearDefaultGatewayPointerForRecordPath('/tmp/runtime/gateway.json', workspaceRoot, env);
    assert.equal(existsSync(pointerPath), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer clear rethrows non-ENOENT unlink errors', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  let pointerDirReadOnly = false;
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const workspaceRoot = '/tmp/workspace-unlink-error';
    writeDefaultGatewayPointerFromGatewayRecord(
      '/tmp/runtime-unlink-error/gateway.json',
      gatewayRecord({
        workspaceRoot,
        stateDbPath: '/tmp/runtime-unlink-error/control-plane.sqlite',
      }),
      env,
    );
    const pointerPath = resolveDefaultGatewayPointerPath(workspaceRoot, env);
    const pointerDir = join(home, '.harness');
    chmodSync(pointerDir, 0o555);
    pointerDirReadOnly = true;
    assert.throws(() =>
      clearDefaultGatewayPointerForRecordPath(
        '/tmp/runtime-unlink-error/gateway.json',
        workspaceRoot,
        env,
      ),
    );
    chmodSync(pointerDir, 0o755);
    pointerDirReadOnly = false;
    assert.equal(existsSync(pointerPath), true);
  } finally {
    if (pointerDirReadOnly) {
      chmodSync(join(home, '.harness'), 0o755);
    }
    await rm(home, { recursive: true, force: true });
  }
});

void test('default gateway pointer clear leaves malformed pointer files untouched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harness-pointer-home-'));
  try {
    const env: NodeJS.ProcessEnv = { HOME: home };
    const workspaceRoot = '/tmp/workspace-d';
    const pointerPath = resolveDefaultGatewayPointerPath(workspaceRoot, env);
    mkdirSync(home, { recursive: true });
    mkdirSync(join(home, '.harness'), { recursive: true });
    writeFileSync(pointerPath, 'not-json', 'utf8');

    clearDefaultGatewayPointerForRecordPath('/tmp/runtime/gateway.json', workspaceRoot, env);
    const contents = readFileSync(pointerPath, 'utf8');
    assert.equal(contents, 'not-json');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

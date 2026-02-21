import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import { GATEWAY_RECORD_VERSION, type GatewayRecord } from '../src/cli/gateway-record.ts';
import { GatewayControlInfra } from '../src/cli/runtime-infra/gateway-control.ts';
import { resolveHarnessWorkspaceDirectory } from '../src/config/harness-paths.ts';

interface ParsedGatewayDaemonLike {
  pid: number;
  host: string;
  port: number;
  authToken: string | null;
  stateDbPath: string;
}

interface OrphanCleanupLike {
  matchedPids: readonly number[];
  terminatedPids: readonly number[];
  failedPids: readonly number[];
  errorMessage: string | null;
}

interface GatewayControlInternals {
  parseGatewayControlLockText: (text: string) => unknown;
  parseGatewayDaemonProcessEntry: (entry: {
    pid: number;
    ppid: number;
    command: string;
  }) => ParsedGatewayDaemonLike | null;
  tokenizeProcessCommand: (command: string) => readonly string[];
  readCommandFlagValue: (tokens: readonly string[], flag: string) => string | null;
  readProcessTable: () => readonly { pid: number; ppid: number; command: string }[];
  findOrphanSqlitePidsForDbPath: (stateDbPath: string) => readonly number[];
  findOrphanGatewayDaemonPids: (stateDbPath: string, daemonScriptPath: string) => readonly number[];
  findOrphanPtyHelperPidsForWorkspace: (invocationDirectory: string) => readonly number[];
  findOrphanRelayLinkedAgentPidsForWorkspace: (invocationDirectory: string) => readonly number[];
  cleanupOrphanPids: (
    matchedPids: readonly number[],
    options: { force: boolean; timeoutMs: number },
    killProcessGroup?: boolean,
  ) => Promise<OrphanCleanupLike>;
  isPidRunning: (pid: number) => boolean;
  signalPidWithOptionalProcessGroup: (
    pid: number,
    signal: NodeJS.Signals,
    includeProcessGroup: boolean,
  ) => boolean;
  waitForPidExit: (pid: number, timeoutMs: number) => Promise<boolean>;
  readProcessStartedAt: (pid: number) => string | null;
  isGatewayControlLockOwnerAlive: (record: {
    version: number;
    owner: { pid: number; startedAt: string };
    acquiredAt: string;
    workspaceRoot: string;
    token: string;
  }) => boolean;
}

function internals(infra: GatewayControlInfra): GatewayControlInternals {
  return infra as unknown as GatewayControlInternals;
}

function createTempWorkspaceRoot(): string {
  return mkdtempSync(join(tmpdir(), 'gateway-control-infra-test-'));
}

function createInfra(workspaceRoot: string): GatewayControlInfra {
  return new GatewayControlInfra({
    cwd: workspaceRoot,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(workspaceRoot, '.xdg-config'),
    },
  });
}

function createGatewayRecord(workspaceRoot: string): GatewayRecord {
  return {
    version: GATEWAY_RECORD_VERSION,
    pid: process.pid,
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath: resolve(workspaceRoot, 'control-plane.sqlite'),
    startedAt: new Date().toISOString(),
    workspaceRoot,
  };
}

test('gateway control infra read/write/remove gateway record and atomic file writes', () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const recordPath = resolve(workspaceRoot, '.harness', 'gateway.json');
  const textPath = resolve(workspaceRoot, '.harness', 'state', 'value.txt');

  assert.equal(infra.readGatewayRecord(recordPath), null);
  infra.writeTextFileAtomically(textPath, 'hello\n');
  assert.equal(readFileSync(textPath, 'utf8'), 'hello\n');

  const record = createGatewayRecord(workspaceRoot);
  infra.writeGatewayRecord(recordPath, record);
  assert.deepEqual(infra.readGatewayRecord(recordPath), record);

  infra.removeGatewayRecord(recordPath);
  assert.equal(infra.readGatewayRecord(recordPath), null);
});

test('gateway control infra lock helpers parse and acquire/release lock records', async () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const lockPath = resolve(workspaceRoot, '.harness', 'gateway.lock');
  const internal = internals(infra);

  assert.equal(internal.parseGatewayControlLockText('not json'), null);
  assert.equal(internal.parseGatewayControlLockText('{}'), null);

  const handle = await infra.acquireGatewayControlLock(lockPath, workspaceRoot, 250);
  assert.equal(typeof handle.release, 'function');
  const reentrant = await infra.acquireGatewayControlLock(lockPath, workspaceRoot, 250);
  assert.equal(reentrant.record.owner.pid, handle.record.owner.pid);
  reentrant.release();
  handle.release();

  const result = await infra.withGatewayControlLock(lockPath, workspaceRoot, async () => 'ok');
  assert.equal(result, 'ok');
});

test('gateway control infra wait helpers and signal helper cover success/failure branches', async () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const markerPath = resolve(workspaceRoot, 'marker.txt');

  const missing = await infra.waitForFileExists(markerPath, 20, 5);
  assert.equal(missing, false);

  setTimeout(() => {
    writeFileSync(markerPath, 'ready', 'utf8');
  }, 10);
  const found = await infra.waitForFileExists(markerPath, 250, 5);
  assert.equal(found, true);

  const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 50)'], {
    stdio: 'ignore',
  });
  assert.ok(typeof child.pid === 'number');
  const exited = await infra.waitForPidExit(child.pid!, 500, 10);
  assert.equal(exited, true);

  const sentToMissing = infra.signalPidWithOptionalProcessGroup(999_999, 'SIGTERM', true);
  assert.equal(sentToMissing, false);
});

test('gateway control infra process parsing and cleanup helpers remain deterministic', async () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const internal = internals(infra);
  const stateDbPath = resolve(workspaceRoot, 'control-plane.sqlite');

  const parsed = internal.parseGatewayDaemonProcessEntry({
    pid: 123,
    ppid: 1,
    command:
      'bun scripts/control-plane-daemon.ts --host 127.0.0.1 --port 7777 --state-db-path ./db.sqlite --auth-token abc',
  });
  assert.deepEqual(parsed, {
    pid: 123,
    host: '127.0.0.1',
    port: 7777,
    authToken: 'abc',
    stateDbPath: resolve('./db.sqlite'),
  });
  assert.equal(
    internal.parseGatewayDaemonProcessEntry({
      pid: 124,
      ppid: 1,
      command: 'node not-gateway.js',
    }),
    null,
  );
  assert.deepEqual(internal.tokenizeProcessCommand('  a   b  c  '), ['a', 'b', 'c']);
  assert.equal(internal.readCommandFlagValue(['--foo=bar'], '--foo'), 'bar');
  assert.equal(internal.readCommandFlagValue(['--foo', 'bar'], '--foo'), 'bar');
  assert.equal(internal.readCommandFlagValue(['--foo'], '--foo'), null);

  internal.readProcessTable = () => [
    {
      pid: 3001,
      ppid: 1,
      command: `bun scripts/control-plane-daemon.ts --host 127.0.0.1 --port 7777 --state-db-path ${stateDbPath}`,
    },
    {
      pid: 3002,
      ppid: 1,
      command: `sqlite3 ${stateDbPath}`,
    },
    {
      pid: 3003,
      ppid: 1,
      command: `bun ${resolve(workspaceRoot, 'scripts/codex-notify-relay.ts')}`,
    },
  ];

  assert.equal(infra.listGatewayDaemonProcesses().length, 1);
  assert.equal(internal.findOrphanSqlitePidsForDbPath(stateDbPath)[0], 3002);
  assert.equal(
    internal.findOrphanGatewayDaemonPids(
      stateDbPath,
      resolve(workspaceRoot, 'scripts/control-plane-daemon.ts'),
    )[0],
    3001,
  );
  assert.equal(internal.findOrphanRelayLinkedAgentPidsForWorkspace(workspaceRoot)[0], 3003);

  const summary = infra.formatOrphanProcessCleanupResult('sqlite', {
    matchedPids: [1, 2],
    terminatedPids: [1],
    failedPids: [2],
    errorMessage: null,
  });
  assert.match(summary, /sqlite cleanup:/u);

  internal.isPidRunning = (pid: number) => pid === 11 || pid === 12;
  internal.signalPidWithOptionalProcessGroup = (pid: number) => pid !== 12;
  internal.waitForPidExit = async (pid: number) => pid === 11;
  const cleaned = await internal.cleanupOrphanPids(
    [10, 11, 12],
    { force: true, timeoutMs: 25 },
    false,
  );
  assert.deepEqual(cleaned.matchedPids, [10, 11, 12]);
  assert.deepEqual(cleaned.terminatedPids.includes(11), true);
  assert.deepEqual(cleaned.terminatedPids.includes(12), true);
});

test('gateway control infra handles process-table command failures through fallback branches', async () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const internal = internals(infra);

  assert.equal(typeof internal.readProcessStartedAt(process.pid), 'string');
  assert.equal(Array.isArray(internal.readProcessTable()), true);

  internal.findOrphanSqlitePidsForDbPath = () => {
    throw new Error('boom');
  };
  const failed = await infra.cleanupOrphanSqliteProcessesForDbPath(
    resolve(workspaceRoot, 'db.sqlite'),
    {
      force: false,
      timeoutMs: 1,
    },
  );
  assert.equal(failed.errorMessage, 'boom');
});

test('gateway control infra lock owner liveness helpers treat stale owners as dead', () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const internal = internals(infra);

  internal.isPidRunning = () => true;
  internal.readProcessStartedAt = () => 'now';
  assert.equal(
    internal.isGatewayControlLockOwnerAlive({
      version: 1,
      owner: { pid: 123, startedAt: 'then' },
      acquiredAt: new Date().toISOString(),
      workspaceRoot,
      token: 'token',
    }),
    false,
  );
  assert.equal(
    internal.isGatewayControlLockOwnerAlive({
      version: 1,
      owner: { pid: 123, startedAt: 'now' },
      acquiredAt: new Date().toISOString(),
      workspaceRoot,
      token: 'token',
    }),
    true,
  );
});

test('gateway control infra isPathWithinWorkspaceRuntimeScope accepts only workspace runtime descendants', () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspaceRoot, {
    ...process.env,
    XDG_CONFIG_HOME: join(workspaceRoot, '.xdg-config'),
  });
  const insidePath = resolve(runtimeRoot, 'sessions', 'alpha', 'control-plane.sqlite');
  const outsidePath = resolve(workspaceRoot, 'outside.sqlite');

  assert.equal(infra.isPathWithinWorkspaceRuntimeScope(insidePath, workspaceRoot), true);
  assert.equal(infra.isPathWithinWorkspaceRuntimeScope(outsidePath, workspaceRoot), false);
});

test('gateway control infra orphan helper wrappers cover pty/relay/gateway daemon branches', async () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const infra = createInfra(workspaceRoot);
  const internal = internals(infra);
  const stateDbPath = resolve(workspaceRoot, 'control-plane.sqlite');
  const daemonScriptPath = resolve(workspaceRoot, 'scripts/control-plane-daemon.ts');
  const ptyHelperPath = resolve(workspaceRoot, 'native/ptyd/target/release/ptyd');
  const relayScriptPath = resolve(workspaceRoot, 'scripts/codex-notify-relay.ts');

  internal.readProcessTable = () => [
    {
      pid: 4101,
      ppid: 1,
      command: `bun ${daemonScriptPath} --state-db-path ${stateDbPath}`,
    },
    {
      pid: 4102,
      ppid: 1,
      command: `${ptyHelperPath} --stdio`,
    },
    {
      pid: 4103,
      ppid: 1,
      command: `bun ${relayScriptPath} --session alpha`,
    },
  ];
  const cleanedPidSets: number[][] = [];
  internal.cleanupOrphanPids = async (
    matchedPids: readonly number[],
  ): Promise<OrphanCleanupLike> => {
    cleanedPidSets.push([...matchedPids]);
    return {
      matchedPids,
      terminatedPids: matchedPids,
      failedPids: [],
      errorMessage: null,
    };
  };

  assert.deepEqual(internal.findOrphanPtyHelperPidsForWorkspace(workspaceRoot), [4102]);
  assert.deepEqual(
    await infra.cleanupOrphanGatewayDaemons(stateDbPath, daemonScriptPath, {
      force: true,
      timeoutMs: 10,
    }),
    {
      matchedPids: [4101],
      terminatedPids: [4101],
      failedPids: [],
      errorMessage: null,
    },
  );
  assert.deepEqual(
    await infra.cleanupOrphanPtyHelpersForWorkspace(workspaceRoot, { force: true, timeoutMs: 10 }),
    {
      matchedPids: [4102],
      terminatedPids: [4102],
      failedPids: [],
      errorMessage: null,
    },
  );
  assert.deepEqual(
    await infra.cleanupOrphanRelayLinkedAgentsForWorkspace(workspaceRoot, {
      force: true,
      timeoutMs: 10,
    }),
    {
      matchedPids: [4103],
      terminatedPids: [4103],
      failedPids: [],
      errorMessage: null,
    },
  );
  assert.equal(cleanedPidSets.length >= 3, true);

  internal.findOrphanGatewayDaemonPids = () => {
    throw new Error('daemon lookup failed');
  };
  const daemonError = await infra.cleanupOrphanGatewayDaemons(stateDbPath, daemonScriptPath, {
    force: false,
    timeoutMs: 10,
  });
  assert.equal(daemonError.errorMessage, 'daemon lookup failed');

  internal.findOrphanRelayLinkedAgentPidsForWorkspace = () => {
    throw new Error('relay lookup failed');
  };
  const relayError = await infra.cleanupOrphanRelayLinkedAgentsForWorkspace(workspaceRoot, {
    force: false,
    timeoutMs: 10,
  });
  assert.equal(relayError.errorMessage, 'relay lookup failed');
});

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'bun:test';
import { GATEWAY_RECORD_VERSION, type GatewayRecord } from '../../../src/cli/gateway-record.ts';
import {
  GatewayRuntimeService,
  type EnsureGatewayResult,
  type GatewayGcOptions,
  type GatewayProbeResult,
  type GatewayStartOptions,
  type GatewayStopOptions,
  type GatewayStopResult,
  type ResolvedGatewaySettings,
} from '../../../src/cli/gateway/runtime.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../src/config/harness-paths.ts';
import type { GatewayControlInfra } from '../../../src/cli/runtime-infra/gateway-control.ts';

type ParsedCommandInput = Parameters<GatewayRuntimeService['run']>[0];
type InfraFunctionMap = Record<string, (...args: unknown[]) => unknown>;

interface RuntimeServiceInternals {
  authTokenMatches: (
    candidate: { authToken: string | null },
    expectedAuthToken: string | null,
  ) => boolean;
  findReachableGatewayDaemonCandidates: (
    settings: ResolvedGatewaySettings,
  ) => readonly Record<string, unknown>[];
  findGatewayDaemonCandidatesByStateDbPath: (
    stateDbPath: string,
  ) => readonly Record<string, unknown>[];
  createAdoptedGatewayRecord: (daemon: Record<string, unknown>) => GatewayRecord;
  executeGatewayCall: (record: GatewayRecord, rawCommand: string) => Promise<number>;
  parseCallCommand: (raw: string) => unknown;
  probeGateway: (record: GatewayRecord) => Promise<GatewayProbeResult>;
  ensureGatewayRunning: (overrides?: GatewayStartOptions) => Promise<EnsureGatewayResult>;
  stopGateway: (options: GatewayStopOptions) => Promise<GatewayStopResult>;
  runGatewaySessionGc: (options: GatewayGcOptions) => Promise<{
    scanned: number;
    deleted: number;
    skippedRecent: number;
    skippedLive: number;
    skippedCurrent: number;
    deletedSessions: readonly string[];
    errors: readonly string[];
  }>;
  resolveGatewaySettings: (
    record: GatewayRecord | null,
    overrides: GatewayStartOptions,
  ) => ResolvedGatewaySettings;
  runGatewayForeground: (settings: ResolvedGatewaySettings) => Promise<number>;
  resolveAdoptableGatewayByStateDbPath: (stateDbPath: string) => Promise<unknown>;
  probeGatewayEndpoint: (
    host: string,
    port: number,
    authToken: string | null,
  ) => Promise<GatewayProbeResult>;
  shouldAutoResolveNamedSessionPort: (overrides: GatewayStartOptions) => boolean;
  canBindPort: (host: string, port: number) => Promise<boolean>;
  reservePort: (host: string) => Promise<number>;
  waitForGatewayReady: (record: GatewayRecord) => Promise<void>;
  startDetachedGateway: (
    settings: ResolvedGatewaySettings,
    runtimeArgs?: readonly string[],
  ) => Promise<GatewayRecord>;
  cleanupNamedSessionGatewayArtifacts: () => void;
  isSessionGatewayLive: (sessionRoot: string) => Promise<boolean>;
  readGatewayRecordForSessionRoot: (sessionRoot: string) => GatewayRecord | null;
  resolveNewestSessionArtifactMtimeMs: (sessionRoot: string) => number;
  listNamedSessionNames: () => readonly string[];
  resolveNamedSessionsRoot: () => string;
  listGatewaySessionsForEndpoint: (
    host: string,
    port: number,
    authToken: string | null,
  ) => Promise<{
    connected: boolean;
    totalSessions: number;
    liveSessions: number;
    sessions: readonly {
      sessionId: string;
      live: boolean;
      status: string | null;
      phase: string | null;
      detail: string | null;
      processId: number | null;
      controller: string | null;
    }[];
    error: string | null;
  }>;
  discoverGatewayListTargets: () => readonly {
    scope: 'default' | 'named' | 'unscoped';
    sessionName: string | null;
    source: 'record' | 'daemon';
    pid: number;
    host: string;
    port: number;
    authToken: string | null;
    stateDbPath: string;
    startedAt: string | null;
    gatewayRunId: string | null;
    recordPath: string | null;
    logPath: string | null;
    lockPath: string | null;
  }[];
  runGatewayList: () => Promise<number>;
}

interface RuntimeHarness {
  service: GatewayRuntimeService;
  stdout: string[];
  stderr: string[];
  infra: InfraFunctionMap;
  workspaceRoot: string;
  gatewayPaths: {
    gatewayRecordPath: string;
    gatewayLogPath: string;
    gatewayLockPath: string;
    gatewayDefaultStateDbPath: string;
  };
}

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'gateway-runtime-service-test-'));
}

function createGatewayRecord(
  workspaceRoot: string,
  overrides: Partial<GatewayRecord> = {},
): GatewayRecord {
  return {
    version: GATEWAY_RECORD_VERSION,
    pid: process.pid,
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath: resolve(workspaceRoot, 'control-plane.sqlite'),
    startedAt: new Date().toISOString(),
    workspaceRoot,
    ...overrides,
  };
}

function createRuntimeHarness(
  options: {
    sessionName?: string | null;
    daemonScriptPath?: string;
    muxScriptPath?: string;
  } = {},
): RuntimeHarness {
  const workspaceRoot = createWorkspace();
  const gatewayPaths = {
    gatewayRecordPath: resolve(workspaceRoot, '.harness', 'gateway.json'),
    gatewayLogPath: resolve(workspaceRoot, '.harness', 'gateway.log'),
    gatewayLockPath: resolve(workspaceRoot, '.harness', 'gateway.lock'),
    gatewayDefaultStateDbPath: resolve(workspaceRoot, '.harness', 'control-plane.sqlite'),
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const infra: InfraFunctionMap = {
    withGatewayControlLock: async (_lockPath, _workspaceRoot, operation) =>
      await (operation as () => Promise<unknown>)(),
    readGatewayRecord: () => null,
    removeGatewayRecord: () => undefined,
    isPidRunning: () => false,
    writeGatewayRecord: () => undefined,
    acquireGatewayControlLock: async () => ({ release: () => undefined }),
    cleanupOrphanGatewayDaemons: async () => ({
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: null,
    }),
    cleanupOrphanPtyHelpersForWorkspace: async () => ({
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: null,
    }),
    cleanupOrphanRelayLinkedAgentsForWorkspace: async () => ({
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: null,
    }),
    cleanupOrphanSqliteProcessesForDbPath: async () => ({
      matchedPids: [],
      terminatedPids: [],
      failedPids: [],
      errorMessage: null,
    }),
    formatOrphanProcessCleanupResult: (_label, _result) => 'cleanup',
    signalPidWithOptionalProcessGroup: () => true,
    waitForPidExit: async () => true,
    isPathWithinWorkspaceRuntimeScope: () => true,
    listGatewayDaemonProcesses: () => [],
  };

  const service = new GatewayRuntimeService(
    {
      invocationDirectory: workspaceRoot,
      sessionName: options.sessionName ?? null,
      daemonScriptPath:
        options.daemonScriptPath ?? resolve(workspaceRoot, 'scripts', 'gateway-daemon.js'),
      muxScriptPath: options.muxScriptPath ?? resolve(workspaceRoot, 'scripts', 'gateway-mux.js'),
      ...gatewayPaths,
      runtimeOptions: {
        gatewayRuntimeArgs: [],
        clientRuntimeArgs: [],
      },
      authRuntime: {
        refreshLinearOauthTokenBeforeGatewayStart: async () => undefined,
      },
      env: {
        ...process.env,
        XDG_CONFIG_HOME: resolve(workspaceRoot, '.xdg-config'),
        HARNESS_CONTROL_PLANE_HOST: '127.0.0.1',
        HARNESS_CONTROL_PLANE_PORT: '7777',
      },
      writeStdout: (text: string) => {
        stdout.push(text);
      },
      writeStderr: (text: string) => {
        stderr.push(text);
      },
    },
    {
      infra: infra as unknown as GatewayControlInfra,
    },
  );

  return {
    service,
    stdout,
    stderr,
    infra,
    workspaceRoot,
    gatewayPaths,
  };
}

function internals(service: GatewayRuntimeService): RuntimeServiceInternals {
  return service as unknown as RuntimeServiceInternals;
}

async function withMockStreamServer(
  handler: (payload: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const server = createServer((socket) => {
    let remainder = '';
    socket.on('data', (chunk: Buffer) => {
      remainder += chunk.toString('utf8');
      const lines = remainder.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }
        const payload = JSON.parse(trimmed) as Record<string, unknown>;
        const kind = payload['kind'];
        if (kind === 'auth') {
          socket.write(`${JSON.stringify({ kind: 'auth.ok' })}\n`);
          continue;
        }
        if (kind !== 'command') {
          continue;
        }
        const commandId = payload['commandId'];
        if (typeof commandId !== 'string') {
          continue;
        }
        socket.write(`${JSON.stringify({ kind: 'command.accepted', commandId })}\n`);
        const result = handler(payload);
        if (result !== null) {
          socket.write(`${JSON.stringify({ kind: 'command.completed', commandId, result })}\n`);
        }
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to resolve mock stream server address');
  }
  return {
    host: '127.0.0.1',
    port: address.port,
    close: async () => {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    },
  };
}

test('gateway runtime parser handles command variants and argument validation', () => {
  const { service } = createRuntimeHarness();
  assert.deepEqual(service.parseCommand(['status']), { type: 'status' });
  assert.deepEqual(service.parseCommand(['start', '--host', '127.0.0.1']).type, 'start');
  assert.deepEqual(service.parseCommand(['run']).type, 'run');
  assert.deepEqual(service.parseCommand(['restart']).type, 'restart');
  assert.deepEqual(service.parseCommand(['stop', '--force']).type, 'stop');
  assert.deepEqual(service.parseCommand(['list']).type, 'list');
  assert.deepEqual(service.parseCommand(['gc', '--older-than-days', '3']).type, 'gc');
  assert.deepEqual(
    service.parseCommand(['call', '--json', '{"type":"session.list"}']).type,
    'call',
  );
  assert.throws(() => service.parseCommand([]), /missing gateway subcommand/u);
  assert.throws(() => service.parseCommand(['wat']), /unknown gateway subcommand/u);
  assert.throws(() => service.parseCommand(['start', '--port', '0']), /invalid --port value/u);
  assert.throws(
    () => service.parseCommand(['stop', '--timeout-ms', '0']),
    /invalid --timeout-ms value/u,
  );
  assert.throws(() => service.parseCommand(['list', '--bad']), /unknown gateway option/u);
  assert.throws(() => service.parseCommand(['gc', '--older-than-days', '0']), /invalid/u);
});

test('gateway runtime probe and call command paths work with a stream-compatible server', async () => {
  const { service } = createRuntimeHarness();
  const internal = internals(service);
  const server = await withMockStreamServer(() => ({
    sessions: [
      { id: 's1', live: true },
      { id: 's2', live: false },
    ],
  }));
  try {
    const probe = await service.probeGatewayEndpoint(server.host, server.port, null);
    assert.equal(probe.connected, true);
    assert.equal(probe.sessionCount, 2);
    assert.equal(probe.liveSessionCount, 1);

    const record = createGatewayRecord(createWorkspace(), {
      host: server.host,
      port: server.port,
    });
    const exitCode = await internal.executeGatewayCall(record, '{"type":"session.list"}');
    assert.equal(exitCode, 0);
  } finally {
    await server.close();
  }

  const failedProbe = await service.probeGatewayEndpoint('127.0.0.1', 1, null);
  assert.equal(failedProbe.connected, false);
  assert.throws(() => internal.parseCallCommand('{'), /invalid JSON command/u);
  assert.throws(
    () => internal.parseCallCommand('{"type":"not-a-command"}'),
    /invalid stream command payload/u,
  );
});

test(
  'gateway runtime session listing parses optional summary fields defensively',
  async () => {
    const { service } = createRuntimeHarness();
    const internal = internals(service);
    const server = await withMockStreamServer(() => ({
      sessions: [
        {
          sessionId: 'session-good',
          live: true,
          status: 'running',
          statusModel: {
            phase: 'working',
            detailText: 'streaming',
          },
          processId: 42,
          controller: {
            controllerLabel: 'human',
          },
        },
        {
          sessionId: 'session-fallback',
          live: 'yes',
          status: '   ',
          statusModel: {
            phase: '',
            detailText: ' ',
          },
          processId: 'not-a-number',
          controller: {
            controllerType: 'agent',
          },
        },
        {
          id: 'invalid-shape',
          live: true,
        },
      ],
    }));
    try {
      const listed = await internal.listGatewaySessionsForEndpoint(server.host, server.port, null);
      assert.equal(listed.connected, true);
      assert.equal(listed.totalSessions, 3);
      assert.equal(listed.liveSessions, 2);
      assert.equal(listed.sessions.length, 2);
      assert.deepEqual(listed.sessions[0], {
        sessionId: 'session-good',
        live: true,
        status: 'running',
        phase: 'working',
        detail: 'streaming',
        processId: 42,
        controller: 'human',
      });
      assert.deepEqual(listed.sessions[1], {
        sessionId: 'session-fallback',
        live: false,
        status: null,
        phase: null,
        detail: null,
        processId: null,
        controller: 'agent',
      });
    } finally {
      await server.close();
    }
  },
);

test('gateway runtime list session parser normalizes malformed optional fields', async () => {
  const { service } = createRuntimeHarness();
  const internal = internals(service);
  const server = await withMockStreamServer(() => ({
    sessions: [
      {
        sessionId: 'session-malformed',
        live: 'yes',
        status: 42,
        statusModel: {
          phase: 42,
          detailText: 42,
        },
        processId: 'not-a-number',
        controller: {
          id: 42,
        },
      },
      {
        sessionId: 'session-valid',
        live: true,
        status: 'running',
        statusModel: {
          phase: 'working',
          detailText: 'streaming',
        },
        processId: 321,
        controller: {
          controllerLabel: 'human',
        },
      },
    ],
  }));
  try {
    const result = await internal.listGatewaySessionsForEndpoint(server.host, server.port, null);
    assert.equal(result.connected, true);
    assert.equal(result.totalSessions, 2);
    assert.equal(result.liveSessions, 1);
    assert.deepEqual(result.sessions[0], {
      sessionId: 'session-malformed',
      live: false,
      status: null,
      phase: null,
      detail: null,
      processId: null,
      controller: null,
    });
    assert.deepEqual(result.sessions[1], {
      sessionId: 'session-valid',
      live: true,
      status: 'running',
      phase: 'working',
      detail: 'streaming',
      processId: 321,
      controller: 'human',
    });
  } finally {
    await server.close();
  }
});

test('gateway runtime run dispatcher covers status/list/start/stop/restart/run/call/gc flows', async () => {
  const harness = createRuntimeHarness();
  const { service, stdout, stderr } = harness;
  const internal = internals(service);
  const record = createGatewayRecord(harness.workspaceRoot);

  harness.infra.readGatewayRecord = () => null;
  assert.equal(await service.run({ type: 'status' } as ParsedCommandInput), 0);
  assert.match(stdout.join(''), /gateway status: stopped/u);
  stdout.length = 0;

  harness.infra.readGatewayRecord = () => record;
  harness.infra.isPidRunning = () => true;
  internal.probeGateway = async () => ({
    connected: false,
    sessionCount: 0,
    liveSessionCount: 0,
    error: 'offline',
  });
  assert.equal(await service.run({ type: 'status' } as ParsedCommandInput), 1);
  assert.match(stdout.join(''), /lastError: offline/u);
  stdout.length = 0;

  internal.ensureGatewayRunning = async () => ({ record, started: true });
  assert.equal(await service.run({ type: 'start' } as ParsedCommandInput), 0);
  assert.match(stdout.join(''), /gateway started/u);
  stdout.length = 0;

  internal.stopGateway = async () => ({ stopped: false, message: 'nope' });
  assert.equal(
    await service.run({
      type: 'stop',
      stopOptions: { force: true, timeoutMs: 5, cleanupOrphans: true },
    } as ParsedCommandInput),
    1,
  );
  assert.match(stdout.join(''), /nope/u);
  stdout.length = 0;

  internal.stopGateway = async () => ({ stopped: true, message: 'stopped' });
  internal.ensureGatewayRunning = async () => ({ record, started: false });
  assert.equal(await service.run({ type: 'restart' } as ParsedCommandInput), 0);
  assert.match(stdout.join(''), /gateway restarted/u);
  stdout.length = 0;

  internal.runGatewaySessionGc = async () => ({
    scanned: 2,
    deleted: 1,
    skippedRecent: 1,
    skippedLive: 0,
    skippedCurrent: 0,
    deletedSessions: ['alpha'],
    errors: ['bad'],
  });
  assert.equal(await service.run({ type: 'gc' } as ParsedCommandInput), 1);
  assert.match(stderr.join(''), /gateway gc error: bad/u);
  stderr.length = 0;

  internal.runGatewayList = async () => 29;
  assert.equal(await service.run({ type: 'list' } as ParsedCommandInput), 29);

  internal.resolveGatewaySettings = () => ({
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath: harness.gatewayPaths.gatewayDefaultStateDbPath,
  });
  internal.runGatewayForeground = async () => 23;
  assert.equal(await service.run({ type: 'run' } as ParsedCommandInput), 23);

  harness.infra.readGatewayRecord = () => record;
  internal.executeGatewayCall = async () => 0;
  assert.equal(
    await service.run({ type: 'call', callJson: '{"type":"session.list"}' } as ParsedCommandInput),
    0,
  );
  harness.infra.readGatewayRecord = () => null;
  await assert.rejects(
    async () =>
      await service.run({
        type: 'call',
        callJson: '{"type":"session.list"}',
      } as ParsedCommandInput),
    /gateway not running/u,
  );
});

test('gateway runtime list discovery includes record-backed and daemon-only targets', () => {
  const harness = createRuntimeHarness();
  const { service, workspaceRoot } = harness;
  const internal = internals(service);
  const runtimeRoot = resolveHarnessWorkspaceDirectory(workspaceRoot, {
    ...process.env,
    XDG_CONFIG_HOME: resolve(workspaceRoot, '.xdg-config'),
  });
  const defaultRecordPath = resolve(runtimeRoot, 'gateway.json');
  const namedRecordPath = resolve(runtimeRoot, 'sessions', 'alpha', 'gateway.json');
  const defaultStateDbPath = resolve(runtimeRoot, 'control-plane.sqlite');
  const namedStateDbPath = resolve(runtimeRoot, 'sessions', 'alpha', 'control-plane.sqlite');

  internal.listNamedSessionNames = () => ['alpha'];
  harness.infra.readGatewayRecord = (recordPath: unknown) => {
    if (recordPath === defaultRecordPath) {
      return createGatewayRecord(workspaceRoot, {
        pid: 111,
        stateDbPath: defaultStateDbPath,
      });
    }
    if (recordPath === namedRecordPath) {
      return createGatewayRecord(workspaceRoot, {
        pid: 222,
        stateDbPath: namedStateDbPath,
      });
    }
    return null;
  };
  harness.infra.listGatewayDaemonProcesses = () => [
    {
      pid: 111,
      host: '127.0.0.1',
      port: 7777,
      authToken: null,
      stateDbPath: defaultStateDbPath,
    },
    {
      pid: 333,
      host: '127.0.0.1',
      port: 7788,
      authToken: null,
      stateDbPath: namedStateDbPath,
    },
    {
      pid: 444,
      host: '127.0.0.1',
      port: 7789,
      authToken: null,
      stateDbPath: resolve(runtimeRoot, 'custom', 'other.sqlite'),
    },
  ];
  harness.infra.isPathWithinWorkspaceRuntimeScope = () => true;

  const discovered = internal.discoverGatewayListTargets();
  assert.equal(discovered.length, 4);
  assert.equal(
    discovered.some((target) => target.source === 'record' && target.scope === 'default'),
    true,
  );
  assert.equal(
    discovered.some(
      (target) =>
        target.source === 'record' && target.scope === 'named' && target.sessionName === 'alpha',
    ),
    true,
  );
  assert.equal(
    discovered.some(
      (target) =>
        target.source === 'daemon' &&
        target.scope === 'named' &&
        target.sessionName === 'alpha' &&
        target.pid === 333,
    ),
    true,
  );
  assert.equal(
    discovered.some(
      (target) => target.source === 'daemon' && target.scope === 'unscoped' && target.pid === 444,
    ),
    true,
  );
});

test('gateway runtime list renderer prints session detail and stop hints', async () => {
  const harness = createRuntimeHarness();
  const { service, stdout } = harness;
  const internal = internals(service);

  internal.discoverGatewayListTargets = () => [
    {
      scope: 'default',
      sessionName: null,
      source: 'record',
      pid: 101,
      host: '127.0.0.1',
      port: 7777,
      authToken: null,
      stateDbPath: '/tmp/default.sqlite',
      startedAt: '2026-01-01T00:00:00.000Z',
      gatewayRunId: 'run-default',
      recordPath: '/tmp/gateway.json',
      logPath: '/tmp/gateway.log',
      lockPath: '/tmp/gateway.lock',
    },
    {
      scope: 'named',
      sessionName: 'alpha',
      source: 'daemon',
      pid: 202,
      host: '127.0.0.1',
      port: 7788,
      authToken: 'token',
      stateDbPath: '/tmp/sessions/alpha/control-plane.sqlite',
      startedAt: null,
      gatewayRunId: null,
      recordPath: '/tmp/sessions/alpha/gateway.json',
      logPath: '/tmp/sessions/alpha/gateway.log',
      lockPath: '/tmp/sessions/alpha/gateway.lock',
    },
  ];
  harness.infra.isPidRunning = (pid: unknown) => pid === 101 || pid === 202;
  internal.listGatewaySessionsForEndpoint = async (_host, port) => {
    if (port === 7777) {
      return {
        connected: true,
        totalSessions: 1,
        liveSessions: 1,
        sessions: [
          {
            sessionId: 'session-a',
            live: true,
            status: 'running',
            phase: 'working',
            detail: 'streaming',
            processId: 909,
            controller: 'human',
          },
        ],
        error: null,
      };
    }
    return {
      connected: false,
      totalSessions: 0,
      liveSessions: 0,
      sessions: [],
      error: 'offline',
    };
  };

  const exitCode = await internal.runGatewayList();
  assert.equal(exitCode, 1);
  const rendered = stdout.join('');
  assert.match(rendered, /gateway list: 2 target\(s\)/u);
  assert.match(rendered, /scope=default/u);
  assert.match(rendered, /scope=session:alpha/u);
  assert.match(rendered, /session: id=session-a/u);
  assert.match(rendered, /stop: harness gateway stop --force/u);
  assert.match(rendered, /stop: harness --session alpha gateway stop --force/u);
  assert.match(rendered, /lastError: offline/u);
});

test('gateway runtime ensureGatewayRunning and stopGateway cover adoption/start/cleanup branches', async () => {
  const harness = createRuntimeHarness({ sessionName: 'alpha' });
  const { service } = harness;
  const internal = internals(service);
  const record = createGatewayRecord(harness.workspaceRoot, {
    pid: 3210,
  });

  harness.infra.readGatewayRecord = () => record;
  harness.infra.isPidRunning = () => false;
  internal.probeGateway = async () => ({
    connected: true,
    sessionCount: 0,
    liveSessionCount: 0,
    error: null,
  });
  const existing = await service.ensureGatewayRunning({});
  assert.equal(existing.started, false);

  harness.infra.readGatewayRecord = () => record;
  harness.infra.isPidRunning = () => true;
  internal.probeGateway = async () => ({
    connected: false,
    sessionCount: 0,
    liveSessionCount: 0,
    error: 'down',
  });
  await assert.rejects(async () => await service.ensureGatewayRunning({}), /still running/u);

  harness.infra.readGatewayRecord = () => null;
  internal.resolveGatewaySettings = () => ({
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath: harness.gatewayPaths.gatewayDefaultStateDbPath,
  });
  internal.resolveAdoptableGatewayByStateDbPath = async () => null;
  internal.probeGatewayEndpoint = async () => ({
    connected: false,
    sessionCount: 0,
    liveSessionCount: 0,
    error: null,
  });
  internal.shouldAutoResolveNamedSessionPort = () => true;
  internal.canBindPort = async () => false;
  internal.reservePort = async () => 9010;
  internal.startDetachedGateway = async (settings: ResolvedGatewaySettings) =>
    createGatewayRecord(harness.workspaceRoot, {
      pid: 6543,
      port: settings.port,
    });
  const started = await service.ensureGatewayRunning({});
  assert.equal(started.started, true);
  assert.equal(started.record.port, 9010);

  harness.infra.readGatewayRecord = () => null;
  internal.cleanupNamedSessionGatewayArtifacts = () => undefined;
  const notRunning = await service.stopGateway({
    force: false,
    timeoutMs: 5,
    cleanupOrphans: false,
  });
  assert.equal(notRunning.stopped, false);

  harness.infra.readGatewayRecord = () => record;
  harness.infra.isPidRunning = () => true;
  internal.probeGateway = async () => ({
    connected: false,
    sessionCount: 0,
    liveSessionCount: 0,
    error: 'offline',
  });
  const unreachable = await service.stopGateway({
    force: false,
    timeoutMs: 5,
    cleanupOrphans: true,
  });
  assert.equal(unreachable.stopped, false);

  harness.infra.readGatewayRecord = () => record;
  harness.infra.isPidRunning = () => true;
  harness.infra.signalPidWithOptionalProcessGroup = () => true;
  harness.infra.waitForPidExit = async () => true;
  internal.probeGateway = async () => ({
    connected: true,
    sessionCount: 0,
    liveSessionCount: 0,
    error: null,
  });
  const stopped = await service.stopGateway({
    force: true,
    timeoutMs: 5,
    cleanupOrphans: true,
  });
  assert.equal(stopped.stopped, true);
});

test('gateway runtime session gc and root helpers cover session-selection branches', async () => {
  const harness = createRuntimeHarness({ sessionName: 'keep' });
  const { service, workspaceRoot } = harness;
  const internal = internals(service);
  const sessionsRoot = resolve(
    resolveHarnessWorkspaceDirectory(workspaceRoot, {
      ...process.env,
      XDG_CONFIG_HOME: resolve(workspaceRoot, '.xdg-config'),
    }),
    'sessions',
  );
  const oldSession = resolve(sessionsRoot, 'old');
  const keepSession = resolve(sessionsRoot, 'keep');
  mkdirSync(oldSession, { recursive: true });
  mkdirSync(keepSession, { recursive: true });
  writeFileSync(resolve(oldSession, 'artifact.txt'), 'artifact', 'utf8');

  harness.infra.acquireGatewayControlLock = async () => ({ release: () => undefined });
  internal.isSessionGatewayLive = async () => false;
  internal.resolveNewestSessionArtifactMtimeMs = () => 0;

  const gc = await service.runGatewaySessionGc({ olderThanDays: 1 });
  assert.equal(gc.scanned >= 1, true);
  assert.equal(gc.deletedSessions.includes('old'), true);

  const names = internal.listNamedSessionNames();
  assert.equal(Array.isArray(names), true);
  const root = internal.resolveNamedSessionsRoot();
  assert.equal(root.endsWith('/sessions'), true);

  const newest = internal.resolveNewestSessionArtifactMtimeMs(keepSession);
  assert.equal(typeof newest, 'number');
});

test('gateway runtime mux and foreground process runners execute adapter scripts', async () => {
  const workspaceRoot = createWorkspace();
  const daemonScriptPath = resolve(workspaceRoot, 'scripts', 'daemon.js');
  const muxScriptPath = resolve(workspaceRoot, 'scripts', 'mux.js');
  mkdirSync(dirname(daemonScriptPath), { recursive: true });
  writeFileSync(daemonScriptPath, 'setTimeout(() => process.exit(0), 10);\n', 'utf8');
  writeFileSync(muxScriptPath, 'process.exit(7);\n', 'utf8');

  const harness = createRuntimeHarness({
    daemonScriptPath,
    muxScriptPath,
  });
  const { service } = harness;
  const record = createGatewayRecord(workspaceRoot, {
    host: '127.0.0.1',
    port: 7777,
  });
  const clientExit = await service.runMuxClient(record, []);
  assert.equal(clientExit, 7);

  harness.infra.readGatewayRecord = () => null;
  harness.infra.writeGatewayRecord = () => undefined;
  harness.infra.removeGatewayRecord = () => undefined;
  const foregroundExit = await service.runGatewayForeground({
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath: harness.gatewayPaths.gatewayDefaultStateDbPath,
  });
  assert.equal(foregroundExit, 0);
});

test('gateway runtime helper methods cover settings validation and readiness probes', async () => {
  const harness = createRuntimeHarness();
  const { service } = harness;
  const internal = internals(service);

  harness.infra.isPidRunning = (pid: unknown) => pid === 123;
  assert.equal(service.isPidRunning(123), true);
  harness.infra.waitForFileExists = async () => true;
  assert.equal(
    await service.waitForFileExists(resolve(harness.workspaceRoot, 'marker.txt'), 25),
    true,
  );

  assert.equal(service.resolveGatewayHostFromConfigOrEnv(), '127.0.0.1');
  const reservedPort = await service.reservePort('127.0.0.1');
  assert.equal(Number.isInteger(reservedPort) && reservedPort > 0, true);

  harness.infra.isPathWithinWorkspaceRuntimeScope = () => true;
  const resolved = service.resolveGatewaySettings(null, {
    host: '127.0.0.1',
    port: 9020,
    stateDbPath: harness.gatewayPaths.gatewayDefaultStateDbPath,
  });
  assert.equal(resolved.host, '127.0.0.1');
  assert.equal(resolved.port, 9020);
  assert.equal(
    typeof resolved.authToken === 'string' && resolved.authToken.startsWith('gateway-'),
    true,
  );

  harness.infra.isPathWithinWorkspaceRuntimeScope = () => false;
  assert.throws(
    () =>
      service.resolveGatewaySettings(null, {
        host: '127.0.0.1',
        port: 9021,
        stateDbPath: harness.gatewayPaths.gatewayDefaultStateDbPath,
      }),
    /invalid --state-db-path/u,
  );

  harness.infra.isPathWithinWorkspaceRuntimeScope = () => true;
  assert.throws(
    () =>
      service.resolveGatewaySettings(null, {
        host: '192.0.2.55',
        port: 9022,
        stateDbPath: harness.gatewayPaths.gatewayDefaultStateDbPath,
      }),
    /non-loopback hosts require --auth-token/u,
  );

  const server = await withMockStreamServer(() => ({ sessions: [] }));
  try {
    await internal.waitForGatewayReady(
      createGatewayRecord(harness.workspaceRoot, {
        host: server.host,
        port: server.port,
      }),
    );
  } finally {
    await server.close();
  }
});

test('gateway runtime default stdio writer fallbacks are exercised', () => {
  const workspaceRoot = createWorkspace();
  const writes: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown): boolean => {
    writes.stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    writes.stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const service = new GatewayRuntimeService({
      invocationDirectory: workspaceRoot,
      sessionName: null,
      daemonScriptPath: resolve(workspaceRoot, 'scripts', 'gateway-daemon.js'),
      muxScriptPath: resolve(workspaceRoot, 'scripts', 'gateway-mux.js'),
      gatewayRecordPath: resolve(workspaceRoot, 'gateway.json'),
      gatewayLogPath: resolve(workspaceRoot, 'gateway.log'),
      gatewayLockPath: resolve(workspaceRoot, 'gateway.lock'),
      gatewayDefaultStateDbPath: resolve(workspaceRoot, 'control-plane.sqlite'),
      runtimeOptions: {
        gatewayRuntimeArgs: [],
        clientRuntimeArgs: [],
      },
      authRuntime: {
        refreshLinearOauthTokenBeforeGatewayStart: async () => undefined,
      },
      env: process.env,
    });
    const methods = service as unknown as {
      writeStdout: (text: string) => void;
      writeStderr: (text: string) => void;
    };
    methods.writeStdout('default-gateway-stdout\n');
    methods.writeStderr('default-gateway-stderr\n');
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  assert.equal(writes.stdout.join('').includes('default-gateway-stdout'), true);
  assert.equal(writes.stderr.join('').includes('default-gateway-stderr'), true);
});

test('gateway runtime port binding helpers cover named-session auto-port logic', async () => {
  const defaultHarness = createRuntimeHarness({ sessionName: null });
  const defaultInternal = internals(defaultHarness.service);
  assert.equal(defaultInternal.shouldAutoResolveNamedSessionPort({}), false);

  const namedHarness = createRuntimeHarness({ sessionName: 'alpha' });
  const namedInternal = internals(namedHarness.service);
  assert.equal(namedInternal.shouldAutoResolveNamedSessionPort({}), true);
  assert.equal(namedInternal.shouldAutoResolveNamedSessionPort({ port: 7001 }), false);

  const occupiedServer = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    occupiedServer.once('error', rejectListen);
    occupiedServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = occupiedServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to resolve occupied server address');
  }

  try {
    assert.equal(await namedInternal.canBindPort('127.0.0.1', address.port), false);
  } finally {
    await new Promise<void>((resolveClose) => {
      occupiedServer.close(() => resolveClose());
    });
  }

  const freePort = await namedHarness.service.reservePort('127.0.0.1');
  assert.equal(await namedInternal.canBindPort('127.0.0.1', freePort), true);
  await assert.rejects(
    namedInternal.canBindPort('256.256.256.256', freePort),
    /ENOTFOUND|EADDRNOTAVAIL|EINVAL|Failed to listen/u,
  );

  const probe = await namedHarness.service.probeGateway(
    createGatewayRecord(namedHarness.workspaceRoot, {
      host: '127.0.0.1',
      port: 1,
    }),
  );
  assert.equal(probe.connected, false);
});

test(
  'gateway runtime mux runner maps signal exits to shell-style status codes',
  async () => {
    const workspaceRoot = createWorkspace();
    const daemonScriptPath = resolve(workspaceRoot, 'scripts', 'daemon.js');
    const muxScriptPath = resolve(workspaceRoot, 'scripts', 'mux.js');
    mkdirSync(dirname(daemonScriptPath), { recursive: true });
    writeFileSync(daemonScriptPath, 'setTimeout(() => process.exit(0), 10);\n', 'utf8');

    const harness = createRuntimeHarness({
      daemonScriptPath,
      muxScriptPath,
    });
    const { service } = harness;
    const record = createGatewayRecord(workspaceRoot, {
      host: '127.0.0.1',
      port: 7777,
    });

    writeFileSync(
      muxScriptPath,
      'setTimeout(() => process.kill(process.pid, "SIGINT"), 5);\n',
      'utf8',
    );
    assert.equal(await service.runMuxClient(record, []), 130);

    writeFileSync(
      muxScriptPath,
      'setTimeout(() => process.kill(process.pid, "SIGTERM"), 5);\n',
      'utf8',
    );
    assert.equal(await service.runMuxClient(record, []), 143);

    writeFileSync(
      muxScriptPath,
      'setTimeout(() => process.kill(process.pid, "SIGQUIT"), 5);\n',
      'utf8',
    );
    assert.equal(await service.runMuxClient(record, []), 1);
  },
  { timeout: 20000 },
);

test('gateway runtime detached start writes gateway record and log artifacts', async () => {
  const workspaceRoot = createWorkspace();
  const daemonScriptPath = resolve(workspaceRoot, 'scripts', 'daemon.js');
  mkdirSync(dirname(daemonScriptPath), { recursive: true });
  writeFileSync(
    daemonScriptPath,
    [
      "process.on('SIGTERM', () => process.exit(0));",
      'setInterval(() => undefined, 1000);',
      '',
    ].join('\n'),
    'utf8',
  );

  const harness = createRuntimeHarness({ daemonScriptPath });
  const { service } = harness;
  const internal = internals(service);
  let writtenPid: number | null = null;
  harness.infra.writeGatewayRecord = (_recordPath: unknown, record: unknown) => {
    const candidate = record as { pid?: unknown };
    writtenPid = typeof candidate.pid === 'number' ? candidate.pid : null;
  };
  harness.infra.isPidRunning = () => true;
  internal.waitForGatewayReady = async () => undefined;

  const started = await service.startDetachedGateway({
    host: '127.0.0.1',
    port: 9333,
    authToken: 'token-123',
    stateDbPath: harness.gatewayPaths.gatewayDefaultStateDbPath,
  });
  assert.equal(started.host, '127.0.0.1');
  assert.equal(started.port, 9333);
  assert.equal(started.authToken, 'token-123');
  assert.equal(typeof started.gatewayRunId === 'string' && started.gatewayRunId.length > 0, true);
  if (writtenPid === null) {
    throw new Error('expected gateway record to be written');
  }
  assert.equal(writtenPid, started.pid);
  assert.equal(existsSync(harness.gatewayPaths.gatewayLogPath), true);

  process.kill(started.pid, 'SIGTERM');
});

test('gateway runtime private candidate helpers resolve adoption and liveness branches', async () => {
  const harness = createRuntimeHarness();
  const { service } = harness;
  const internal = internals(service);
  const stateDbPath = resolve(harness.workspaceRoot, 'control-plane.sqlite');
  const candidates = [
    {
      pid: 5001,
      host: '127.0.0.1',
      port: 7001,
      authToken: null,
      stateDbPath,
    },
    {
      pid: 5002,
      host: '127.0.0.1',
      port: 7002,
      authToken: 'token-a',
      stateDbPath,
    },
  ];
  harness.infra.listGatewayDaemonProcesses = () => candidates;
  harness.infra.isPathWithinWorkspaceRuntimeScope = () => true;

  assert.equal(internal.authTokenMatches(candidates[0]!, null), true);
  assert.equal(internal.authTokenMatches(candidates[1]!, 'token-a'), true);
  assert.equal(internal.authTokenMatches(candidates[1]!, null), false);

  const reachableByEndpoint = internal.findReachableGatewayDaemonCandidates({
    host: '127.0.0.1',
    port: 7001,
    authToken: null,
    stateDbPath,
  });
  assert.equal(reachableByEndpoint.length, 1);
  assert.equal(reachableByEndpoint[0]?.['pid'], 5001);

  const reachableByDb = internal.findGatewayDaemonCandidatesByStateDbPath(stateDbPath);
  assert.equal(reachableByDb.length, 2);

  internal.probeGatewayEndpoint = async (_host: string, port: number) => ({
    connected: port === 7001,
    sessionCount: 0,
    liveSessionCount: 0,
    error: null,
  });
  const adopted = (await internal.resolveAdoptableGatewayByStateDbPath(stateDbPath)) as Record<
    string,
    unknown
  > | null;
  assert.equal(adopted?.['pid'], 5001);

  const adoptedRecord = internal.createAdoptedGatewayRecord(candidates[0]!);
  assert.equal(adoptedRecord.pid, 5001);
  assert.equal(adoptedRecord.workspaceRoot, harness.workspaceRoot);

  internal.probeGatewayEndpoint = async () => ({
    connected: false,
    sessionCount: 0,
    liveSessionCount: 0,
    error: null,
  });
  assert.equal(await internal.resolveAdoptableGatewayByStateDbPath(stateDbPath), null);

  internal.probeGatewayEndpoint = async () => ({
    connected: true,
    sessionCount: 0,
    liveSessionCount: 0,
    error: null,
  });
  await assert.rejects(
    async () => await internal.resolveAdoptableGatewayByStateDbPath(stateDbPath),
    /multiple reachable daemon candidates/u,
  );
});

test('gateway runtime ensureGatewayRunning fails closed on multiple reachable endpoint candidates', async () => {
  const harness = createRuntimeHarness();
  const { service } = harness;
  const internal = internals(service);
  const stateDbPath = harness.gatewayPaths.gatewayDefaultStateDbPath;

  harness.infra.readGatewayRecord = () => null;
  internal.resolveGatewaySettings = () => ({
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath,
  });
  internal.resolveAdoptableGatewayByStateDbPath = async () => null;
  internal.probeGatewayEndpoint = async () => ({
    connected: true,
    sessionCount: 1,
    liveSessionCount: 1,
    error: null,
  });
  internal.findReachableGatewayDaemonCandidates = () => [
    {
      pid: 9001,
      host: '127.0.0.1',
      port: 7777,
      authToken: null,
      stateDbPath,
    },
    {
      pid: 9002,
      host: '127.0.0.1',
      port: 7777,
      authToken: null,
      stateDbPath,
    },
  ];

  await assert.rejects(
    async () => await service.ensureGatewayRunning({}),
    /multiple daemon candidates/u,
  );
});

test('gateway runtime session-root helpers parse gateway records and clean named-session artifacts', async () => {
  const harness = createRuntimeHarness({ sessionName: 'alpha' });
  const { service } = harness;
  const internal = internals(service);
  const sessionRoot = resolve(harness.workspaceRoot, '.harness', 'sessions', 'alpha');
  mkdirSync(sessionRoot, { recursive: true });
  const recordPath = resolve(sessionRoot, 'gateway.json');
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      createGatewayRecord(harness.workspaceRoot, {
        pid: 7101,
        stateDbPath: resolve(sessionRoot, 'control-plane.sqlite'),
      }),
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(resolve(sessionRoot, 'artifact.txt'), 'artifact', 'utf8');
  writeFileSync(resolve(sessionRoot, 'gateway.lock'), 'lock', 'utf8');

  const record = internal.readGatewayRecordForSessionRoot(sessionRoot);
  assert.equal(record?.pid, 7101);
  writeFileSync(recordPath, '{', 'utf8');
  assert.equal(internal.readGatewayRecordForSessionRoot(sessionRoot), null);

  const newest = internal.resolveNewestSessionArtifactMtimeMs(sessionRoot);
  assert.equal(newest > 0, true);

  harness.infra.listGatewayDaemonProcesses = () => [
    {
      pid: 8101,
      host: '127.0.0.1',
      port: 7001,
      authToken: null,
      stateDbPath: resolve(sessionRoot, 'control-plane.sqlite'),
    },
  ];
  assert.equal(await internal.isSessionGatewayLive(sessionRoot), true);

  harness.infra.listGatewayDaemonProcesses = () => [];
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      createGatewayRecord(harness.workspaceRoot, {
        pid: 8102,
        host: '127.0.0.1',
        port: 7002,
        stateDbPath: resolve(sessionRoot, 'control-plane.sqlite'),
      }),
      null,
      2,
    )}\n`,
    'utf8',
  );
  internal.probeGateway = async () => ({
    connected: false,
    sessionCount: 0,
    liveSessionCount: 0,
    error: 'down',
  });
  harness.infra.isPidRunning = () => true;
  assert.equal(await internal.isSessionGatewayLive(sessionRoot), true);

  harness.infra.isPidRunning = () => false;
  assert.equal(await internal.isSessionGatewayLive(sessionRoot), false);

  const runtime = (
    service as unknown as {
      runtime: { gatewayRecordPath: string; gatewayLogPath: string };
    }
  ).runtime;
  runtime.gatewayRecordPath = resolve(sessionRoot, 'gateway.json');
  runtime.gatewayLogPath = resolve(sessionRoot, 'gateway.log');
  writeFileSync(runtime.gatewayLogPath, 'log\n', 'utf8');
  internal.cleanupNamedSessionGatewayArtifacts();
  assert.equal(existsSync(runtime.gatewayLogPath), false);

  const recordText = readFileSync(recordPath, 'utf8');
  assert.equal(recordText.includes('"pid"'), true);
});

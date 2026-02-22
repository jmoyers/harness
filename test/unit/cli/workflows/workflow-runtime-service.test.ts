import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import { GATEWAY_RECORD_VERSION, type GatewayRecord } from '../../../../src/cli/gateway-record.ts';
import type { HarnessRuntimeContext } from '../../../../src/cli/runtime/context.ts';
import { WorkflowRuntimeService } from '../../../../src/cli/workflows/runtime.ts';

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'workflow-runtime-service-test-'));
}

function createGatewayRecord(workspace: string): GatewayRecord {
  return {
    version: GATEWAY_RECORD_VERSION,
    pid: process.pid,
    host: '127.0.0.1',
    port: 7777,
    authToken: null,
    stateDbPath: resolve(workspace, 'control-plane.sqlite'),
    startedAt: new Date().toISOString(),
    workspaceRoot: workspace,
  };
}

function createRuntimeContext(workspace: string): HarnessRuntimeContext {
  return {
    invocationDirectory: workspace,
    daemonScriptPath: resolve(workspace, 'scripts/control-plane-daemon.ts'),
    muxScriptPath: resolve(workspace, 'scripts/harness-core.ts'),
    runtimeOptions: {
      gatewayRuntimeArgs: [],
      clientRuntimeArgs: [],
    },
    sessionName: 'session-a',
    gatewayRecordPath: resolve(workspace, 'gateway.json'),
    gatewayLogPath: resolve(workspace, 'gateway.log'),
    gatewayLockPath: resolve(workspace, 'gateway.lock'),
    gatewayDefaultStateDbPath: resolve(workspace, 'control-plane.sqlite'),
    profileDir: resolve(workspace, 'profiles/session-a'),
    profileStatePath: resolve(workspace, 'active-profile.json'),
    statusTimelineStatePath: resolve(workspace, 'active-status-timeline.json'),
    defaultStatusTimelineOutputPath: resolve(workspace, 'status-timeline.log'),
    renderTraceStatePath: resolve(workspace, 'active-render-trace.json'),
    defaultRenderTraceOutputPath: resolve(workspace, 'render-trace.log'),
  };
}

function createGatewayStub(workspace: string): Record<string, unknown> {
  const record = createGatewayRecord(workspace);
  return {
    withLock: async <T>(operation: () => Promise<T>): Promise<T> => await operation(),
    ensureGatewayRunning: async (): Promise<{ record: GatewayRecord; started: boolean }> => ({
      record,
      started: true,
    }),
    runMuxClient: async (): Promise<number> => 0,
    isPidRunning: (): boolean => false,
    readGatewayRecord: (): GatewayRecord | null => null,
    probeGateway: async () => ({
      connected: false,
      sessionCount: 0,
      liveSessionCount: 0,
      error: null,
    }),
    removeGatewayRecord: (): void => undefined,
    resolveGatewayHostFromConfigOrEnv: (): string => '127.0.0.1',
    reservePort: async (): Promise<number> => 4000,
    resolveGatewaySettings: (): {
      host: string;
      port: number;
      authToken: string | null;
      stateDbPath: string;
    } => ({
      host: '127.0.0.1',
      port: 4000,
      authToken: null,
      stateDbPath: resolve(workspace, 'control-plane.sqlite'),
    }),
    startDetachedGateway: async (): Promise<GatewayRecord> => record,
    stopGateway: async (): Promise<{ stopped: boolean; message: string }> => ({
      stopped: true,
      message: 'gateway stopped',
    }),
    waitForFileExists: async (): Promise<boolean> => true,
  };
}

interface WorkflowRuntimeInternals {
  parseActiveProfileState: (raw: unknown) => unknown;
  readActiveProfileState: (profileStatePath: string) => unknown;
  writeActiveProfileState: (profileStatePath: string, state: unknown) => void;
  removeActiveProfileState: (profileStatePath: string) => void;
}

function internals(service: WorkflowRuntimeService): WorkflowRuntimeInternals {
  return service as unknown as WorkflowRuntimeInternals;
}

function parseRuntimeArgValue(runtimeArgs: readonly string[], flag: string): string {
  const index = runtimeArgs.indexOf(flag);
  if (index < 0) {
    throw new Error(`missing runtime flag: ${flag}`);
  }
  const value = runtimeArgs[index + 1];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing runtime flag value: ${flag}`);
  }
  return value;
}

test('workflow runtime status timeline lifecycle writes and clears active state', async () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const service = new WorkflowRuntimeService(
    runtime,
    createGatewayStub(workspace) as never,
    undefined,
    () => undefined,
  );

  const startCode = await service.runStatusTimelineCli([]);
  assert.equal(startCode, 0);
  const stateRaw = JSON.parse(readFileSync(runtime.statusTimelineStatePath, 'utf8')) as {
    outputPath: string;
  };
  assert.equal(stateRaw.outputPath, runtime.defaultStatusTimelineOutputPath);

  const stopCode = await service.runStatusTimelineCli(['stop']);
  assert.equal(stopCode, 0);
  assert.throws(() => readFileSync(runtime.statusTimelineStatePath, 'utf8'), /ENOENT/u);
});

test('workflow runtime render trace lifecycle writes conversation id and validates duplicate start', async () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const service = new WorkflowRuntimeService(
    runtime,
    createGatewayStub(workspace) as never,
    undefined,
    () => undefined,
  );

  const startCode = await service.runRenderTraceCli(['--conversation-id', 'conversation-1']);
  assert.equal(startCode, 0);
  const stateRaw = JSON.parse(readFileSync(runtime.renderTraceStatePath, 'utf8')) as {
    conversationId: string | null;
  };
  assert.equal(stateRaw.conversationId, 'conversation-1');

  await assert.rejects(async () => {
    await service.runRenderTraceCli(['start']);
  }, /render trace already running/u);

  const stopCode = await service.runRenderTraceCli(['stop']);
  assert.equal(stopCode, 0);
  assert.equal(existsSync(runtime.renderTraceStatePath), false);
});

test('workflow runtime parser validation errors are explicit', async () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const service = new WorkflowRuntimeService(
    runtime,
    createGatewayStub(workspace) as never,
    undefined,
    () => undefined,
  );

  await assert.rejects(async () => {
    await service.runStatusTimelineCli(['bogus']);
  }, /unknown status-timeline subcommand/u);
  await assert.rejects(async () => {
    await service.runRenderTraceCli(['start', '--conversation-id', '']);
  }, /invalid --conversation-id value/u);
  await assert.rejects(async () => {
    await service.runProfileCli(['stop', '--timeout-ms', '0']);
  }, /invalid --timeout-ms value/u);
});

test('workflow runtime default client routes through gateway start + mux run', async () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const stdout: string[] = [];
  let runMuxArgs: readonly string[] = [];
  const record = createGatewayRecord(workspace);
  const gateway = {
    ...createGatewayStub(workspace),
    ensureGatewayRunning: async (): Promise<{ record: GatewayRecord; started: boolean }> => ({
      record,
      started: true,
    }),
    runMuxClient: async (_record: GatewayRecord, args: readonly string[]): Promise<number> => {
      runMuxArgs = args;
      return 7;
    },
  };
  const service = new WorkflowRuntimeService(runtime, gateway as never, undefined, (text) => {
    stdout.push(text);
  });

  const exitCode = await service.runDefaultClient(['--example']);
  assert.equal(exitCode, 7);
  assert.deepEqual(runMuxArgs, ['--example']);
  assert.equal(stdout.join('').includes('gateway started pid='), true);
});

test('workflow runtime profile run command orchestrates profile artifacts end-to-end', async () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const stdout: string[] = [];
  const record = createGatewayRecord(workspace);
  let detachedRuntimeArgs: readonly string[] = [];
  let muxRuntimeArgs: readonly string[] = [];
  let muxPassthroughArgs: readonly string[] = [];
  const gateway = {
    ...createGatewayStub(workspace),
    readGatewayRecord: (): GatewayRecord | null => null,
    resolveGatewaySettings: (_record: GatewayRecord | null, overrides: { port?: number }) => ({
      host: '127.0.0.1',
      port: overrides.port ?? 4000,
      authToken: null,
      stateDbPath: runtime.gatewayDefaultStateDbPath,
    }),
    startDetachedGateway: async (
      _settings: { host: string; port: number; authToken: string | null; stateDbPath: string },
      runtimeArgs: readonly string[] = [],
    ): Promise<GatewayRecord> => {
      detachedRuntimeArgs = runtimeArgs;
      const cpuProfileDir = parseRuntimeArgValue(runtimeArgs, '--cpu-prof-dir');
      const cpuProfileName = parseRuntimeArgValue(runtimeArgs, '--cpu-prof-name');
      writeFileSync(resolve(cpuProfileDir, cpuProfileName), 'gateway-profile', 'utf8');
      return record;
    },
    runMuxClient: async (
      _record: GatewayRecord,
      args: readonly string[],
      runtimeArgs: readonly string[] = [],
    ): Promise<number> => {
      muxPassthroughArgs = args;
      muxRuntimeArgs = runtimeArgs;
      const cpuProfileDir = parseRuntimeArgValue(runtimeArgs, '--cpu-prof-dir');
      const cpuProfileName = parseRuntimeArgValue(runtimeArgs, '--cpu-prof-name');
      writeFileSync(resolve(cpuProfileDir, cpuProfileName), 'client-profile', 'utf8');
      return 3;
    },
  };

  const service = new WorkflowRuntimeService(runtime, gateway as never, undefined, (text) => {
    stdout.push(text);
  });

  const exitCode = await service.runProfileCli(['--profile-dir', 'profiles/custom', '--example']);
  assert.equal(exitCode, 3);
  assert.deepEqual(muxPassthroughArgs, ['--example']);
  assert.equal(detachedRuntimeArgs.includes('--cpu-prof'), true);
  assert.equal(muxRuntimeArgs.includes('--cpu-prof'), true);
  assert.equal(
    stdout.join('').includes('profiles: client=') && stdout.join('').includes('gateway='),
    true,
  );
});

test('workflow runtime profile parse/guard paths are explicit', async () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const service = new WorkflowRuntimeService(
    runtime,
    createGatewayStub(workspace) as never,
    undefined,
    () => undefined,
  );

  await assert.rejects(
    async () => await service.runProfileCli(['start', '--bad']),
    /unknown profile option/u,
  );
  await assert.rejects(
    async () => await service.runProfileCli(['stop', '--bad']),
    /unknown profile option/u,
  );
  await assert.rejects(
    async () => await service.runProfileCli(['start']),
    /profile start requires the target session gateway to be running/u,
  );
  await assert.rejects(
    async () => await service.runProfileCli(['stop', '--timeout-ms', '50']),
    /no active profile run/u,
  );
  await assert.rejects(
    async () => await service.runRenderTraceCli(['stop', '--extra']),
    /unknown render-trace option/u,
  );
});

test('workflow runtime active profile state helpers parse, read, write, and remove files', () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const service = new WorkflowRuntimeService(
    runtime,
    createGatewayStub(workspace) as never,
    undefined,
    () => undefined,
  );
  const internal = internals(service);
  const validState = {
    version: 2,
    mode: 'live-inspector',
    pid: process.pid,
    host: '127.0.0.1',
    port: 7777,
    stateDbPath: runtime.gatewayDefaultStateDbPath,
    profileDir: runtime.profileDir,
    gatewayProfilePath: resolve(runtime.profileDir, 'harness-gateway.cpuprofile'),
    inspectWebSocketUrl: 'ws://127.0.0.1:9229/ws',
    startedAt: new Date().toISOString(),
  };

  const parsed = internal.parseActiveProfileState(validState) as Record<string, unknown> | null;
  assert.equal(parsed?.['mode'], 'live-inspector');

  internal.writeActiveProfileState(runtime.profileStatePath, validState);
  const readBack = internal.readActiveProfileState(runtime.profileStatePath) as Record<
    string,
    unknown
  > | null;
  assert.equal(readBack?.['gatewayProfilePath'], validState.gatewayProfilePath);

  writeFileSync(runtime.profileStatePath, '{', 'utf8');
  assert.equal(internal.readActiveProfileState(runtime.profileStatePath), null);

  internal.writeActiveProfileState(runtime.profileStatePath, validState);
  assert.equal(existsSync(runtime.profileStatePath), true);
  internal.removeActiveProfileState(runtime.profileStatePath);
  assert.equal(existsSync(runtime.profileStatePath), false);
});

test('workflow runtime default stdout dependency writes client startup notices', async () => {
  const workspace = createWorkspace();
  const runtime = createRuntimeContext(workspace);
  const record = createGatewayRecord(workspace);
  const gateway = {
    ...createGatewayStub(workspace),
    ensureGatewayRunning: async (): Promise<{ record: GatewayRecord; started: boolean }> => ({
      record,
      started: true,
    }),
    runMuxClient: async (): Promise<number> => 0,
  };

  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown): boolean => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const service = new WorkflowRuntimeService(runtime, gateway as never);
    (service as unknown as { writeStdout: (text: string) => void }).writeStdout(
      'default-workflow-stdout\n',
    );
    const exitCode = await service.runDefaultClient([]);
    assert.equal(exitCode, 0);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(writes.join('').includes('gateway started pid='), true);
});

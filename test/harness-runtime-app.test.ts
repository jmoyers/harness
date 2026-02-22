import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import type { HarnessRuntimeContext } from '../src/cli/runtime/context.ts';
import {
  CursorHooksCliRunner,
  DiffCliRunner,
  HarnessRuntimeApplication,
  HarnessRuntimeScopeFactory,
  HarnessUpdateInstaller,
  createDefaultHarnessRuntimeApplication,
} from '../src/cli/runtime-app/application.ts';

type RuntimeServices = ReturnType<HarnessRuntimeScopeFactory['create']>;

function createRuntimeContext(workspace: string): HarnessRuntimeContext {
  return {
    invocationDirectory: workspace,
    daemonScriptPath: `${workspace}/scripts/control-plane-daemon.ts`,
    muxScriptPath: `${workspace}/scripts/harness-core.ts`,
    runtimeOptions: {
      gatewayRuntimeArgs: [],
      clientRuntimeArgs: [],
    },
    sessionName: 'session-a',
    gatewayRecordPath: `${workspace}/gateway.json`,
    gatewayLogPath: `${workspace}/gateway.log`,
    gatewayLockPath: `${workspace}/gateway.lock`,
    gatewayDefaultStateDbPath: `${workspace}/control-plane.sqlite`,
    profileDir: `${workspace}/profiles/session-a`,
    profileStatePath: `${workspace}/active-profile.json`,
    statusTimelineStatePath: `${workspace}/active-status-timeline.json`,
    defaultStatusTimelineOutputPath: `${workspace}/status-timeline.log`,
    renderTraceStatePath: `${workspace}/active-render-trace.json`,
    defaultRenderTraceOutputPath: `${workspace}/render-trace.log`,
  };
}

class StubScopeFactory extends HarnessRuntimeScopeFactory {
  public readonly createCalls: Array<string | null> = [];

  constructor(private readonly services: RuntimeServices) {
    super();
  }

  override create(sessionName: string | null): RuntimeServices {
    this.createCalls.push(sessionName);
    return this.services;
  }
}

class StubUpdateInstaller extends HarnessUpdateInstaller {
  public readonly runCalls: Array<{ invocationDirectory: string; argv: readonly string[] }> = [];

  constructor(private readonly exitCode: number) {
    super(
      {},
      () => undefined,
      () => undefined,
    );
  }

  override run(invocationDirectory: string, argv: readonly string[]): number {
    this.runCalls.push({ invocationDirectory, argv });
    return this.exitCode;
  }
}

class StubCursorHooksCliRunner extends CursorHooksCliRunner {
  public readonly runCalls: Array<{ invocationDirectory: string; argv: readonly string[] }> = [];

  constructor(private readonly exitCode: number) {
    super({}, () => undefined);
  }

  override run(invocationDirectory: string, argv: readonly string[]): number {
    this.runCalls.push({ invocationDirectory, argv });
    return this.exitCode;
  }
}

class StubDiffCliRunner extends DiffCliRunner {
  public readonly runCalls: Array<readonly string[]> = [];

  constructor(private readonly exitCode: number) {
    super({}, '.', () => undefined);
  }

  override async run(argv: readonly string[]): Promise<number> {
    this.runCalls.push(argv);
    return this.exitCode;
  }
}

test('runtime app delegates command families to class collaborators', async () => {
  let parsedGatewayArgs: readonly string[] = [];
  const runtime = createRuntimeContext('/workspace');
  const services = {
    runtime,
    authRuntime: {
      run: async (): Promise<number> => 31,
    } as unknown as RuntimeServices['authRuntime'],
    gatewayRuntime: {
      parseCommand: (argv: readonly string[]): unknown => {
        parsedGatewayArgs = argv;
        return { type: 'status' };
      },
      run: async (): Promise<number> => 11,
    } as unknown as RuntimeServices['gatewayRuntime'],
    workflowRuntime: {
      runProfileCli: async (): Promise<number> => 21,
      runStatusTimelineCli: async (): Promise<number> => 22,
      runRenderTraceCli: async (): Promise<number> => 23,
      runDefaultClient: async (): Promise<number> => 24,
    } as unknown as RuntimeServices['workflowRuntime'],
  } satisfies RuntimeServices;
  const scopeFactory = new StubScopeFactory(services);
  const updateInstaller = new StubUpdateInstaller(41);
  const cursorHooksRunner = new StubCursorHooksCliRunner(51);
  const diffCliRunner = new StubDiffCliRunner(61);

  const app = new HarnessRuntimeApplication(
    scopeFactory,
    updateInstaller,
    cursorHooksRunner,
    diffCliRunner,
    () => undefined,
  );

  assert.equal(await app.runGatewayCli(['status'], 'session-1'), 11);
  assert.deepEqual(parsedGatewayArgs, ['status']);
  assert.equal(await app.runProfileCli(['run'], 'session-2'), 21);
  assert.equal(await app.runStatusTimelineCli(['start'], 'session-3'), 22);
  assert.equal(await app.runRenderTraceCli(['start'], 'session-4'), 23);
  assert.equal(await app.runAuthCli(['status'], 'session-5'), 31);
  assert.equal(app.runUpdateCli([], 'session-6'), 41);
  assert.equal(await app.runCursorHooksCli(['install'], 'session-7'), 51);
  assert.equal(await app.runClientCli(['--example'], 'session-8'), 24);
  assert.equal(await app.runDiffCli(['--json'], 'session-9'), 61);

  assert.deepEqual(scopeFactory.createCalls, [
    'session-1',
    'session-2',
    'session-3',
    'session-4',
    'session-5',
    'session-6',
    'session-7',
    'session-8',
  ]);
  assert.deepEqual(updateInstaller.runCalls, [
    {
      invocationDirectory: '/workspace',
      argv: [],
    },
  ]);
  assert.deepEqual(cursorHooksRunner.runCalls, [
    {
      invocationDirectory: '/workspace',
      argv: ['install'],
    },
  ]);
  assert.deepEqual(diffCliRunner.runCalls, [['--json']]);
});

test('runtime app help paths short-circuit without creating runtime scope', async () => {
  const runtime = createRuntimeContext('/workspace');
  const services = {
    runtime,
    authRuntime: {
      run: async (): Promise<number> => 0,
    } as unknown as RuntimeServices['authRuntime'],
    gatewayRuntime: {
      parseCommand: (): unknown => ({ type: 'status' }),
      run: async (): Promise<number> => 0,
    } as unknown as RuntimeServices['gatewayRuntime'],
    workflowRuntime: {
      runProfileCli: async (): Promise<number> => 1,
      runStatusTimelineCli: async (): Promise<number> => 1,
      runRenderTraceCli: async (): Promise<number> => 1,
      runDefaultClient: async (): Promise<number> => 1,
    } as unknown as RuntimeServices['workflowRuntime'],
  } satisfies RuntimeServices;
  const scopeFactory = new StubScopeFactory(services);
  const stdout: string[] = [];
  const app = new HarnessRuntimeApplication(
    scopeFactory,
    new StubUpdateInstaller(0),
    new StubCursorHooksCliRunner(0),
    new StubDiffCliRunner(0),
    (text) => {
      stdout.push(text);
    },
  );

  assert.equal(await app.runProfileCli(['--help'], 'alpha'), 0);
  assert.equal(await app.runStatusTimelineCli(['-h'], 'beta'), 0);
  assert.equal(await app.runRenderTraceCli(['--help'], 'gamma'), 0);
  assert.deepEqual(scopeFactory.createCalls, []);
  assert.equal(stdout.join('').includes('usage:'), true);
  assert.equal(stdout.join('').includes('harness [--session <name>] gateway start'), true);
});

test('runtime scope factory creates typed runtime services from context factory output', () => {
  const runtime = createRuntimeContext('/workspace');
  const contextFactory = {
    create: (sessionName: string | null): HarnessRuntimeContext => ({
      ...runtime,
      sessionName,
    }),
  };
  const factory = new HarnessRuntimeScopeFactory(contextFactory, {});
  const services = factory.create('scope-session');
  assert.equal(services.runtime.sessionName, 'scope-session');
  assert.equal(typeof services.authRuntime.run, 'function');
  assert.equal(typeof services.gatewayRuntime.parseCommand, 'function');
  assert.equal(typeof services.workflowRuntime.runProfileCli, 'function');
});

test('update installer runs bun add with configured package and streams stdout', () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let command: string | null = null;
  let args: readonly string[] = [];
  const installer = new HarnessUpdateInstaller(
    {
      HARNESS_UPDATE_PACKAGE: '  @example/harness@2.3.4  ',
    },
    (text) => {
      stdout.push(text);
    },
    (text) => {
      stderr.push(text);
    },
    (file, execArgs) => {
      command = file;
      args = execArgs;
      return 'installed\n';
    },
  );
  assert.equal(installer.run('/workspace', []), 0);
  assert.equal(command, 'bun');
  assert.deepEqual(args, ['add', '-g', '--trust', '@example/harness@2.3.4']);
  assert.equal(
    stdout.join(''),
    'updating Harness package: @example/harness@2.3.4\ninstalled\nharness update complete: @example/harness@2.3.4\n',
  );
  assert.deepEqual(stderr, []);
});

test('update installer validates args and propagates stderr/stdout on command failure', () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const installer = new HarnessUpdateInstaller(
    {
      HARNESS_UPDATE_PACKAGE: '   ',
    },
    (text) => {
      stdout.push(text);
    },
    (text) => {
      stderr.push(text);
    },
    () => {
      throw {
        stdout: Buffer.from('stdout failure\n'),
        stderr: 'stderr failure\n',
        status: 42,
      };
    },
  );
  assert.throws(() => installer.run('/workspace', ['--bad']), /unknown update option/u);
  assert.throws(
    () => installer.run('/workspace', []),
    /harness update command failed \(exit=42\)/u,
  );
  assert.equal(
    stdout.join(''),
    'updating Harness package: @jmoyers/harness@latest\nstdout failure\n',
  );
  assert.equal(stderr.join(''), 'stderr failure\n');
});

test('cursor hooks runner parses install and uninstall commands with resolved paths', () => {
  const stdout: string[] = [];
  const relayScriptPaths: string[] = [];
  const installCalls: Array<{
    readonly relayCommand: string;
    readonly hooksFilePath?: string;
  }> = [];
  const uninstallCalls: Array<{
    readonly hooksFilePath?: string;
  }> = [];
  const runner = new CursorHooksCliRunner(
    {
      HARNESS_CURSOR_HOOK_RELAY_SCRIPT_PATH: 'tools/cursor-relay.ts',
    },
    (text) => {
      stdout.push(text);
    },
    (relayScriptPath) => {
      relayScriptPaths.push(relayScriptPath);
      return `relay:${relayScriptPath}`;
    },
    (options) => {
      installCalls.push(options);
      return {
        changed: true,
        filePath: '/tmp/hooks.json',
        removedCount: 1,
        addedCount: 2,
      };
    },
    (options) => {
      uninstallCalls.push(options ?? {});
      return {
        changed: false,
        filePath: '/tmp/hooks.json',
        removedCount: 0,
        addedCount: 0,
      };
    },
  );

  assert.equal(runner.run('/workspace', ['install', '--hooks-file', 'cursor/hooks.json']), 0);
  assert.equal(runner.run('/workspace', ['uninstall']), 0);
  assert.deepEqual(relayScriptPaths, ['/workspace/tools/cursor-relay.ts']);
  assert.deepEqual(installCalls, [
    {
      relayCommand: 'relay:/workspace/tools/cursor-relay.ts',
      hooksFilePath: '/workspace/cursor/hooks.json',
    },
  ]);
  assert.deepEqual(uninstallCalls, [{}]);
  assert.equal(
    stdout.join(''),
    'cursor hooks install: updated file=/tmp/hooks.json removed=1 added=2\ncursor hooks uninstall: no changes file=/tmp/hooks.json removed=0\n',
  );
});

test('cursor hooks runner rejects missing subcommand and unknown flags', () => {
  const runner = new CursorHooksCliRunner(
    {},
    () => undefined,
    () => 'relay',
    () => ({
      changed: false,
      filePath: '/tmp/hooks.json',
      removedCount: 0,
      addedCount: 0,
    }),
    () => ({
      changed: false,
      filePath: '/tmp/hooks.json',
      removedCount: 0,
      addedCount: 0,
    }),
  );

  assert.throws(() => runner.run('/workspace', []), /missing cursor-hooks subcommand/u);
  assert.throws(
    () => runner.run('/workspace', ['install', '--unknown']),
    /unknown cursor-hooks option/u,
  );
  assert.throws(() => runner.run('/workspace', ['remove']), /unknown cursor-hooks subcommand/u);
});

test('diff runner handles help and delegates runtime execution to injected diff cli', async () => {
  const stdout: string[] = [];
  const calls: Array<{ argv: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
  const runner = new DiffCliRunner(
    { DIFF_ENV: 'yes' },
    '/workspace',
    (text) => {
      stdout.push(text);
    },
    () => 'diff usage',
    async (options) => {
      calls.push(options);
      return {
        exitCode: 73,
      };
    },
  );
  assert.equal(await runner.run(['--help']), 0);
  assert.equal(stdout.join(''), 'diff usage\n');
  assert.equal(await runner.run(['--json']), 73);
  assert.deepEqual(calls, [
    {
      argv: ['--json'],
      cwd: '/workspace',
      env: { DIFF_ENV: 'yes' },
    },
  ]);
});

test('default runtime app factory returns class instance', () => {
  const app = createDefaultHarnessRuntimeApplication();
  assert.equal(app instanceof HarnessRuntimeApplication, true);
});

test('runtime app default stdout fallbacks print help and usage text', async () => {
  const stdout: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const app = new HarnessRuntimeApplication();
    (app as unknown as { writeStdout: (text: string) => void }).writeStdout(
      'default-runtime-app-stdout\n',
    );
    assert.equal(await app.runProfileCli(['--help'], null), 0);
    const diffRunner = new DiffCliRunner({}, '/workspace');
    assert.equal(await diffRunner.run(['--help']), 0);
    assert.equal(typeof (await diffRunner.run(['--unknown-flag'])), 'number');
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = stdout.join('');
  assert.equal(output.includes('usage:'), true);
  assert.equal(output.includes('usage: harness diff [options]'), true);
});

test('runtime app default installers use default stdio writers and default exec adapter', () => {
  const fakeBinDir = mkdtempSync(join(tmpdir(), 'harness-update-fake-bin-'));
  const fakeBunPath = join(fakeBinDir, 'bun');
  writeFileSync(
    fakeBunPath,
    ['#!/bin/sh', 'echo "fake bun success: $@"', 'exit 0', ''].join('\n'),
    'utf8',
  );
  chmodSync(fakeBunPath, 0o755);

  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const installer = new HarnessUpdateInstaller({
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
    });
    assert.equal(installer.run(process.cwd(), []), 0);

    const stderrInstaller = new HarnessUpdateInstaller({}, undefined, undefined, () => {
      throw {
        stderr: 'fake bun failed\n',
        status: 42,
      };
    });
    assert.throws(() => stderrInstaller.run(process.cwd(), []), /harness update command failed/u);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  assert.equal(stdout.join('').includes('harness update complete'), true);
  assert.equal(stderr.join('').includes('fake bun failed'), true);
});

test('cursor hooks runner default stdout writer is exercised with injected install adapter', () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown): boolean => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const runner = new CursorHooksCliRunner(
      {},
      undefined,
      () => 'relay:default',
      () => ({
        changed: true,
        filePath: '/tmp/hooks.json',
        removedCount: 0,
        addedCount: 1,
      }),
      () => ({
        changed: false,
        filePath: '/tmp/hooks.json',
        removedCount: 1,
        addedCount: 0,
      }),
    );
    assert.equal(runner.run('/workspace', ['install']), 0);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(writes.join('').includes('cursor hooks install: updated'), true);
});

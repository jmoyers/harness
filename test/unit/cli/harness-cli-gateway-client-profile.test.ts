/* oxlint-disable no-unused-vars */
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseGatewayRecordText } from '../../../src/cli/gateway-record.ts';
import { connectControlPlaneStreamClient } from '../../../src/control-plane/stream-client.ts';
import {
  resolveHarnessConfigPath,
  resolveHarnessConfigDirectory,
} from '../../../src/config/config-core.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../src/config/harness-paths.ts';

import {
  createSerialCliTest,
  createStubCommand,
  createWorkspace,
  isPidRunning,
  readParentPid,
  reserveDistinctPorts,
  reservePort,
  runHarness,
  setTreeMtime,
  spawnOrphanDetachedProcess,
  spawnOrphanGatewayDaemonProcess,
  spawnOrphanSqliteProcess,
  waitForCondition,
  waitForGatewayStatusRunning,
  waitForParentPid,
  waitForPidExit,
  workspaceConfigRoot,
  workspaceRuntimeRoot,
  workspaceXdgConfigHome,
  writeWorkspaceHarnessConfig,
} from '../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createSerialCliTest();

void serialCliTest('harness gateway lifecycle and github.pr-create validation stay healthy', async () => {
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
    await waitForGatewayStatusRunning(workspace, ['gateway', 'status'], env);

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

    const stopResult = await runHarness(workspace, ['gateway', 'stop'], env);
    assert.equal(stopResult.code, 0);
    assert.equal(
      stopResult.stdout.includes('gateway stopped') ||
        stopResult.stdout.includes('removed stale gateway record'),
      true,
    );

    const finalStatus = await runHarness(workspace, ['gateway', 'status'], env);
    assert.equal(finalStatus.code, 0);
    assert.equal(finalStatus.stdout.includes('gateway status: stopped'), true);
    assert.equal(existsSync(recordPath), false);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness default client auto-starts detached gateway and leaves it running on client exit', async () => {
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
    await waitForGatewayStatusRunning(workspace, ['gateway', 'status'], env);

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

void serialCliTest('harness named session client auto-resolves gateway port when preferred port is occupied and cleans up named gateway artifacts on stop', async () => {
  const workspace = createWorkspace();
  const preferredPort = await reservePort();
  const sessionName = 'secondary-auto-port-a';
  const runtimeRoot = workspaceRuntimeRoot(workspace);
  const muxArgsPath = join(runtimeRoot, `mux-${sessionName}-args.json`);
  const muxStubPath = join(workspace, 'mux-named-session-auto-port-stub.js');
  const defaultRecordPath = join(runtimeRoot, 'gateway.json');
  const namedRecordPath = join(runtimeRoot, `sessions/${sessionName}/gateway.json`);
  const namedLogPath = join(runtimeRoot, `sessions/${sessionName}/gateway.log`);
  writeFileSync(
    muxStubPath,
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      'const target = process.env.HARNESS_TEST_MUX_ARGS_PATH;',
      "if (typeof target === 'string' && target.length > 0) {",
      '  mkdirSync(dirname(target), { recursive: true });',
      "  writeFileSync(target, JSON.stringify(process.argv.slice(2)), 'utf8');",
      '}',
    ].join('\n'),
    'utf8',
  );
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(preferredPort),
    HARNESS_MUX_SCRIPT_PATH: muxStubPath,
    HARNESS_TEST_MUX_ARGS_PATH: muxArgsPath,
  };
  try {
    const defaultStart = await runHarness(workspace, ['gateway', 'start'], env);
    assert.equal(defaultStart.code, 0);
    await waitForGatewayStatusRunning(workspace, ['gateway', 'status'], env);
    const defaultRecord = parseGatewayRecordText(readFileSync(defaultRecordPath, 'utf8'));
    assert.notEqual(defaultRecord, null);
    assert.equal(defaultRecord?.port, preferredPort);

    const namedClientResult = await runHarness(workspace, ['--session', sessionName], env);
    assert.equal(namedClientResult.code, 0);
    assert.equal(existsSync(namedRecordPath), true);
    assert.equal(existsSync(muxArgsPath), true);

    const namedRecord = parseGatewayRecordText(readFileSync(namedRecordPath, 'utf8'));
    assert.notEqual(namedRecord, null);
    assert.notEqual(namedRecord?.port, preferredPort);

    const muxArgs = JSON.parse(readFileSync(muxArgsPath, 'utf8')) as string[];
    const portFlagIndex = muxArgs.indexOf('--harness-server-port');
    assert.notEqual(portFlagIndex, -1);
    assert.equal(muxArgs[portFlagIndex + 1], String(namedRecord?.port));

    const namedStop = await runHarness(
      workspace,
      ['--session', sessionName, 'gateway', 'stop'],
      env,
    );
    assert.equal(namedStop.code, 0);
    assert.equal(existsSync(namedRecordPath), false);
    assert.equal(existsSync(namedLogPath), false);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'gateway', 'stop', '--force'], env).catch(
      () => undefined,
    );
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness default client uses gateway.host from harness config for gateway and mux connection', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const muxArgsPath = join(workspaceRuntimeRoot(workspace), 'mux-config-host-args.json');
  const muxStubPath = join(workspace, 'mux-config-host-stub.js');
  const recordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  writeWorkspaceHarnessConfig(workspace, {
    gateway: {
      host: 'localhost',
    },
  });
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

    const record = parseGatewayRecordText(readFileSync(recordPath, 'utf8'));
    assert.notEqual(record, null);
    assert.equal(record?.host, 'localhost');

    const muxArgs = JSON.parse(readFileSync(muxArgsPath, 'utf8')) as string[];
    const hostFlagIndex = muxArgs.indexOf('--harness-server-host');
    assert.notEqual(hostFlagIndex, -1);
    assert.equal(muxArgs[hostFlagIndex + 1], 'localhost');
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway run applies inspect runtime args from harness config', async () => {
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

void serialCliTest('harness default client applies inspect runtime args to mux process from harness config', async () => {
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

void serialCliTest('harness default client loads global secrets.env and forwards ANTHROPIC_API_KEY to mux process', async () => {
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

void serialCliTest('harness profile writes client and gateway CPU profiles in isolated session paths', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-session-a';
  const [gatewayPort, gatewayInspectPort, clientInspectPort] = await reserveDistinctPorts(3);
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
  writeWorkspaceHarnessConfig(workspace, {
    debug: {
      inspect: {
        enabled: true,
        gatewayPort: gatewayInspectPort,
        clientPort: clientInspectPort,
      },
    },
  });
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(gatewayPort),
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

void serialCliTest('harness profile start/stop writes gateway CPU profile to global profiles path for the target session', async () => {
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
    await waitForGatewayStatusRunning(
      workspace,
      ['--session', sessionName, 'gateway', 'status'],
      {},
      15_000,
    );
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

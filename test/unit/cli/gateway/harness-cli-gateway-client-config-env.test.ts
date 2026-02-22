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
import { parseGatewayRecordText } from '../../../../src/cli/gateway-record.ts';
import { connectControlPlaneStreamClient } from '../../../../src/control-plane/stream-client.ts';
import {
  resolveHarnessConfigPath,
  resolveHarnessConfigDirectory,
} from '../../../../src/config/config-core.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../../src/config/harness-paths.ts';

import {
  createConcurrentCliTest,
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
} from '../../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createConcurrentCliTest();

void serialCliTest(
  'harness default client uses gateway.host from harness config for gateway and mux connection',
  async () => {
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
  },
);

void serialCliTest(
  'harness gateway run applies inspect runtime args from harness config',
  async () => {
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
        daemonExecArgv.includes(
          `--inspect=localhost:${String(gatewayInspectPort)}/harness-gateway`,
        ),
        true,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

void serialCliTest(
  'harness default client applies inspect runtime args to mux process from harness config',
  async () => {
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
  },
);

void serialCliTest(
  'harness default client loads global secrets.env and forwards ANTHROPIC_API_KEY to mux process',
  async () => {
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
  },
);

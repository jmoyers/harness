import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGatewayRecordText } from '../../../../src/cli/gateway-record.ts';
import {
  createSerialCliTest,
  createWorkspace,
  reservePort,
  runHarness,
  waitForGatewayStatusRunning,
  workspaceRuntimeRoot,
} from '../../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createSerialCliTest();

void serialCliTest(
  'harness named session client auto-resolves gateway port when preferred port is occupied and cleans up named gateway artifacts on stop',
  async () => {
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
      void runHarness(
        workspace,
        ['--session', sessionName, 'gateway', 'stop', '--force'],
        env,
      ).catch(() => undefined);
      void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

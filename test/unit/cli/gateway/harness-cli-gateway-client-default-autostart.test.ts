import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  'harness default client auto-starts detached gateway and leaves it running on client exit',
  async () => {
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
  },
);

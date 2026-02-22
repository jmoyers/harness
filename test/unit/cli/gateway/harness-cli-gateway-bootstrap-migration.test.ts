import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGatewayRecordText } from '../../../../src/cli/gateway-record.ts';
import { resolveHarnessConfigPath } from '../../../../src/config/config-core.ts';
import {
  createSerialCliTest,
  createWorkspace,
  isPidRunning,
  reservePort,
  runHarness,
  waitForGatewayStatusRunning,
  workspaceConfigRoot,
  workspaceRuntimeRoot,
  workspaceXdgConfigHome,
} from '../../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createSerialCliTest();

void serialCliTest('harness gateway status reports stopped when no record exists', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['gateway', 'status']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('gateway status: stopped'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway list reports no targets when no gateway records or daemons are present', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['gateway', 'list']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('gateway list: none'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness auto-migrates legacy local .harness record path to global runtime root on first run', async () => {
  const workspace = createWorkspace();
  const legacyRoot = join(workspace, '.harness');
  const legacyRecordPath = join(legacyRoot, 'gateway.json');
  const runtimeRecordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(
    legacyRecordPath,
    JSON.stringify(
      {
        version: 1,
        pid: process.pid,
        host: '127.0.0.1',
        port: 6553,
        authToken: null,
        stateDbPath: join(legacyRoot, 'control-plane.sqlite'),
        startedAt: new Date().toISOString(),
        workspaceRoot: workspace,
      },
      null,
      2,
    ),
    'utf8',
  );

  try {
    const result = await runHarness(workspace, ['gateway', 'status']);
    assert.equal(existsSync(runtimeRecordPath), true);
    assert.equal(existsSync(legacyRoot), false);
    assert.equal(result.stdout.includes(`[migration] local .harness migrated`), true);
    assert.equal(result.stdout.includes(`record: ${runtimeRecordPath}`), true);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force']).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness migrates legacy local config when global config is only bootstrapped default', async () => {
  const workspace = createWorkspace();
  try {
    const initial = await runHarness(workspace, ['gateway', 'status']);
    assert.equal(initial.code, 0);

    const configPath = resolveHarnessConfigPath(workspace, {
      XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
    });
    const initialConfigText = readFileSync(configPath, 'utf8');
    assert.equal(initialConfigText.trim().length > 0, true);

    const legacyRoot = join(workspace, '.harness');
    mkdirSync(legacyRoot, { recursive: true });
    const legacyConfigPath = join(legacyRoot, 'harness.config.jsonc');
    const legacyConfigText = '{"configVersion":1,"github":{"enabled":false}}\n';
    writeFileSync(legacyConfigPath, legacyConfigText, 'utf8');

    const migrated = await runHarness(workspace, ['gateway', 'status']);
    const backupPath = join(
      workspaceConfigRoot(workspace),
      'harness.config.jsonc.pre-migration.bak',
    );

    assert.equal(migrated.code, 0);
    assert.equal(migrated.stdout.includes('[migration] local .harness migrated'), true);
    assert.equal(existsSync(legacyRoot), false);
    assert.equal(readFileSync(configPath, 'utf8'), legacyConfigText);
    assert.equal(readFileSync(backupPath, 'utf8'), initialConfigText);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force']).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest(
  'harness gateway start normalizes stale and legacy env db paths to runtime default',
  async () => {
    const workspace = createWorkspace();
    const port = await reservePort();
    const runtimeRoot = workspaceRuntimeRoot(workspace);
    const recordPath = join(runtimeRoot, 'gateway.json');
    const staleStateDbPath = join(workspace, '.harness', 'control-plane.sqlite');
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(
      recordPath,
      JSON.stringify(
        {
          version: 1,
          pid: 2147483647,
          host: '127.0.0.1',
          port,
          authToken: null,
          stateDbPath: staleStateDbPath,
          startedAt: new Date().toISOString(),
          workspaceRoot: workspace,
        },
        null,
        2,
      ),
      'utf8',
    );

    const baseEnv = {
      HARNESS_CONTROL_PLANE_PORT: String(port),
    };
    try {
      const staleStartResult = await runHarness(
        workspace,
        ['gateway', 'start', '--port', String(port)],
        baseEnv,
      );
      assert.equal(staleStartResult.code, 0);
      const staleRecordRaw = readFileSync(recordPath, 'utf8');
      const staleRecord = parseGatewayRecordText(staleRecordRaw);
      assert.notEqual(staleRecord, null);
      assert.equal(staleRecord?.stateDbPath, join(runtimeRoot, 'control-plane.sqlite'));

      await runHarness(workspace, ['gateway', 'stop', '--force'], baseEnv);

      const legacyEnvStartResult = await runHarness(
        workspace,
        ['gateway', 'start', '--port', String(port)],
        {
          ...baseEnv,
          HARNESS_CONTROL_PLANE_DB_PATH: join(
            workspace,
            '.harness',
            'legacy-control-plane.sqlite',
          ),
        },
      );
      assert.equal(legacyEnvStartResult.code, 0);
      const legacyEnvRecordRaw = readFileSync(recordPath, 'utf8');
      const legacyEnvRecord = parseGatewayRecordText(legacyEnvRecordRaw);
      assert.notEqual(legacyEnvRecord, null);
      assert.equal(legacyEnvRecord?.stateDbPath, join(runtimeRoot, 'control-plane.sqlite'));
    } finally {
      void runHarness(workspace, ['gateway', 'stop', '--force'], baseEnv).catch(() => undefined);
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 20_000 },
);

void serialCliTest('harness gateway start rejects local workspace .harness state db path', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const localLegacyDbPath = join(workspace, '.harness', 'control-plane.sqlite');
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
  };
  try {
    const startResult = await runHarness(
      workspace,
      ['gateway', 'start', '--port', String(port), '--state-db-path', localLegacyDbPath],
      env,
    );
    assert.equal(startResult.code, 1);
    assert.equal(startResult.stderr.includes('invalid --state-db-path'), true);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway start adopts an already-reachable daemon when gateway record is missing', async () => {
  const workspace = createWorkspace();
  const port = await reservePort();
  const runtimeRoot = workspaceRuntimeRoot(workspace);
  const recordPath = join(runtimeRoot, 'gateway.json');
  const adoptedAuthToken = `adopt-token-${process.pid}-${Date.now()}`;
  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(port),
  };
  let originalPid: number | null = null;
  try {
    const startResult = await runHarness(
      workspace,
      ['gateway', 'start', '--port', String(port), '--auth-token', adoptedAuthToken],
      env,
    );
    assert.equal(startResult.code, 0);
    await waitForGatewayStatusRunning(workspace, ['gateway', 'status'], env);
    const originalRecord = parseGatewayRecordText(readFileSync(recordPath, 'utf8'));
    if (originalRecord === null) {
      throw new Error('expected initial gateway record');
    }
    originalPid = originalRecord.pid;
    assert.equal(isPidRunning(originalPid), true);

    unlinkSync(recordPath);
    const adoptionAttempt = await runHarness(
      workspace,
      [
        'gateway',
        'start',
        '--port',
        String(port),
        '--auth-token',
        adoptedAuthToken,
        '--state-db-path',
        './custom-overwrite-attempt.sqlite',
      ],
      env,
    );
    assert.equal(adoptionAttempt.code, 0);
    const adoptedRecord = parseGatewayRecordText(readFileSync(recordPath, 'utf8'));
    assert.notEqual(adoptedRecord, null);
    assert.equal(isPidRunning(adoptedRecord!.pid), true);
    assert.equal(adoptedRecord?.stateDbPath, originalRecord.stateDbPath);
    assert.equal(adoptedRecord?.authToken, adoptedAuthToken);
  } finally {
    void runHarness(workspace, ['gateway', 'stop', '--force'], env).catch(() => undefined);
    if (originalPid !== null && isPidRunning(originalPid)) {
      process.kill(originalPid, 'SIGKILL');
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

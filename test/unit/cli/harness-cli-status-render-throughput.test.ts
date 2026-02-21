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

void serialCliTest('harness profile start fails when target session gateway is not running', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-start-missing-gateway';
  try {
    const startResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'start']);
    assert.equal(startResult.code, 1);
    assert.equal(
      startResult.stderr.includes(
        'profile start requires the target session gateway to be running',
      ),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness profile start fails when gateway inspector endpoint is unavailable', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-start-no-inspect';
  const gatewayPort = await reservePort();
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
    const startResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'start']);
    assert.equal(startResult.code, 1);
    assert.equal(startResult.stderr.includes('gateway inspector endpoint unavailable'), true);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'gateway', 'stop', '--force']).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness profile stop fails when there is no active profile state', async () => {
  const workspace = createWorkspace();
  const sessionName = 'profile-stop-missing';
  try {
    const stopResult = await runHarness(workspace, ['--session', sessionName, 'profile', 'stop']);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stderr.includes('no active profile run for this session'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline start/stop writes and clears active state for the target session', async () => {
  const workspace = createWorkspace();
  const sessionName = 'status-timeline-start-stop-a';
  const statusTimelineStatePath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/active-status-timeline.json`,
  );
  const statusTimelineOutputPath = join(
    workspaceRuntimeRoot(workspace),
    `status-timelines/${sessionName}/status-timeline.log`,
  );
  try {
    const startResult = await runHarness(workspace, ['--session', sessionName, 'status-timeline']);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes('status timeline started'), true);
    assert.equal(
      startResult.stdout.includes(`status-timeline-target: ${statusTimelineOutputPath}`),
      true,
    );
    assert.equal(existsSync(statusTimelineStatePath), true);
    assert.equal(existsSync(statusTimelineOutputPath), true);
    assert.equal(readFileSync(statusTimelineOutputPath, 'utf8'), '');

    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'stop',
    ]);
    assert.equal(stopResult.code, 0);
    assert.equal(
      stopResult.stdout.includes(`status timeline stopped: ${statusTimelineOutputPath}`),
      true,
    );
    assert.equal(existsSync(statusTimelineStatePath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline start supports custom output path and rejects duplicate active runs', async () => {
  const workspace = createWorkspace();
  const sessionName = 'status-timeline-custom-output-a';
  const customOutputPath = join(workspace, 'custom', 'status.log');
  try {
    const startResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'start',
      '--output-path',
      './custom/status.log',
    ]);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes(`status-timeline-target: ${customOutputPath}`), true);
    assert.equal(existsSync(customOutputPath), true);

    const duplicateStartResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'start',
    ]);
    assert.equal(duplicateStartResult.code, 1);
    assert.equal(
      duplicateStartResult.stderr.includes('status timeline already running; stop it first'),
      true,
    );
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'status-timeline', 'stop']).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline stop fails when there is no active status timeline state', async () => {
  const workspace = createWorkspace();
  const sessionName = 'status-timeline-stop-missing';
  try {
    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'status-timeline',
      'stop',
    ]);
    assert.equal(stopResult.code, 1);
    assert.equal(
      stopResult.stderr.includes('no active status timeline run for this session'),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline rejects unknown subcommands', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'bogus']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline subcommand: bogus'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline stop rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'stop', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline option: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness status-timeline start rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['status-timeline', 'start', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown status-timeline option: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness render-trace start/stop writes and clears active state for the target session', async () => {
  const workspace = createWorkspace();
  const sessionName = 'render-trace-start-stop-a';
  const renderTraceStatePath = join(
    workspaceRuntimeRoot(workspace),
    `sessions/${sessionName}/active-render-trace.json`,
  );
  const renderTraceOutputPath = join(
    workspaceRuntimeRoot(workspace),
    `render-traces/${sessionName}/render-trace.log`,
  );
  try {
    const startResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      '--conversation-id',
      'session-1',
    ]);
    assert.equal(startResult.code, 0);
    assert.equal(startResult.stdout.includes('render trace started'), true);
    assert.equal(
      startResult.stdout.includes(`render-trace-target: ${renderTraceOutputPath}`),
      true,
    );
    assert.equal(startResult.stdout.includes('render-trace-conversation-id: session-1'), true);
    assert.equal(existsSync(renderTraceStatePath), true);
    assert.equal(existsSync(renderTraceOutputPath), true);
    assert.equal(readFileSync(renderTraceOutputPath, 'utf8'), '');

    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'stop',
    ]);
    assert.equal(stopResult.code, 0);
    assert.equal(
      stopResult.stdout.includes(`render trace stopped: ${renderTraceOutputPath}`),
      true,
    );
    assert.equal(existsSync(renderTraceStatePath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness render-trace rejects duplicate start and validates stop/options', async () => {
  const workspace = createWorkspace();
  const sessionName = 'render-trace-validation-a';
  try {
    const startResult = await runHarness(workspace, ['--session', sessionName, 'render-trace']);
    assert.equal(startResult.code, 0);

    const duplicateStartResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'start',
    ]);
    assert.equal(duplicateStartResult.code, 1);
    assert.equal(
      duplicateStartResult.stderr.includes('render trace already running; stop it first'),
      true,
    );

    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'stop',
      '--bad',
    ]);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stderr.includes('unknown render-trace option: --bad'), true);
  } finally {
    void runHarness(workspace, ['--session', sessionName, 'render-trace', 'stop']).catch(
      () => undefined,
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness render-trace stop and subcommand validation errors are explicit', async () => {
  const workspace = createWorkspace();
  const sessionName = 'render-trace-stop-missing';
  try {
    const stopResult = await runHarness(workspace, [
      '--session',
      sessionName,
      'render-trace',
      'stop',
    ]);
    assert.equal(stopResult.code, 1);
    assert.equal(stopResult.stderr.includes('no active render trace run for this session'), true);

    const badSubcommandResult = await runHarness(workspace, ['render-trace', 'bogus']);
    assert.equal(badSubcommandResult.code, 1);
    assert.equal(
      badSubcommandResult.stderr.includes('unknown render-trace subcommand: bogus'),
      true,
    );

    const badOptionResult = await runHarness(workspace, [
      'render-trace',
      'start',
      '--conversation-id',
      '',
    ]);
    assert.equal(badOptionResult.code, 1);
    assert.equal(
      badOptionResult.stderr.includes('invalid --conversation-id value: empty string'),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest(
  'named session can run two terminal threads that execute harness animate for throughput load',
  async () => {
    const workspace = createWorkspace();
    const sessionName = 'perf-throughput-a';
    const port = await reservePort();
    const env = {
      HARNESS_CONTROL_PLANE_PORT: String(port),
    };
    const sessionRecordPath = join(
      workspaceRuntimeRoot(workspace),
      `sessions/${sessionName}/gateway.json`,
    );
    const defaultRecordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');

    let client: Awaited<ReturnType<typeof connectControlPlaneStreamClient>> | null = null;
    try {
      const startResult = await runHarness(
        workspace,
        ['--session', sessionName, 'gateway', 'start', '--port', String(port)],
        env,
      );
      assert.equal(startResult.code, 0);
      await waitForGatewayStatusRunning(
        workspace,
        ['--session', sessionName, 'gateway', 'status'],
        env,
        15_000,
      );
      assert.equal(existsSync(sessionRecordPath), true);
      assert.equal(existsSync(defaultRecordPath), false);

      const recordRaw = readFileSync(sessionRecordPath, 'utf8');
      const record = parseGatewayRecordText(recordRaw);
      assert.notEqual(record, null);

      client = await connectControlPlaneStreamClient({
        host: record?.host ?? '127.0.0.1',
        port: record?.port ?? port,
        ...(record?.authToken === null || record?.authToken === undefined
          ? {}
          : {
              authToken: record.authToken,
            }),
      });

      const sessionIds = ['terminal-throughput-a', 'terminal-throughput-b'] as const;
      const outputBytesBySession = new Map<string, number>();

      client.onEnvelope((envelope) => {
        if (envelope.kind !== 'pty.output') {
          return;
        }
        const chunk = Buffer.from(envelope.chunkBase64, 'base64');
        outputBytesBySession.set(
          envelope.sessionId,
          (outputBytesBySession.get(envelope.sessionId) ?? 0) + chunk.length,
        );
      });

      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-throughput',
        path: workspace,
      });

      for (const sessionId of sessionIds) {
        await client.sendCommand({
          type: 'conversation.create',
          conversationId: sessionId,
          directoryId: 'directory-throughput',
          title: sessionId,
          agentType: 'terminal',
        });
        await client.sendCommand({
          type: 'pty.start',
          sessionId,
          args: [],
          initialCols: 120,
          initialRows: 40,
          cwd: workspace,
        });
        await client.sendCommand({
          type: 'pty.attach',
          sessionId,
        });
      }

      for (const sessionId of sessionIds) {
        await client.sendCommand({
          type: 'session.respond',
          sessionId,
          text: `printf "ready-${sessionId}\\n"\n`,
        });
      }
      await waitForCondition(
        () => sessionIds.every((sessionId) => (outputBytesBySession.get(sessionId) ?? 0) >= 20),
        5_000,
        'timed out waiting for baseline terminal output on both sessions',
      );
      const baselineBytes = new Map<string, number>();
      for (const sessionId of sessionIds) {
        baselineBytes.set(sessionId, outputBytesBySession.get(sessionId) ?? 0);
      }

      for (const sessionId of sessionIds) {
        await client.sendCommand({
          type: 'session.respond',
          sessionId,
          text: 'bun run harness animate --duration-ms 1200 --fps 120 --no-color\n',
        });
      }

      await waitForCondition(
        () =>
          sessionIds.every(
            (sessionId) =>
              (outputBytesBySession.get(sessionId) ?? 0) - (baselineBytes.get(sessionId) ?? 0) >=
              250,
          ),
        25_000,
        'timed out waiting for animate throughput output on both terminal sessions',
      );

      const listResult = await client.sendCommand({
        type: 'session.list',
      });
      const sessions = listResult['sessions'];
      assert.equal(Array.isArray(sessions), true);
      const activeIds = new Set<string>();
      if (Array.isArray(sessions)) {
        for (const session of sessions) {
          if (typeof session !== 'object' || session === null) {
            continue;
          }
          const typed = session as Record<string, unknown>;
          if (typeof typed['sessionId'] === 'string') {
            activeIds.add(typed['sessionId']);
          }
        }
      }
      assert.equal(activeIds.has('terminal-throughput-a'), true);
      assert.equal(activeIds.has('terminal-throughput-b'), true);
    } finally {
      client?.close();
      void runHarness(
        workspace,
        ['--session', sessionName, 'gateway', 'stop', '--force'],
        env,
      ).catch(() => undefined);
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 45_000 },
);


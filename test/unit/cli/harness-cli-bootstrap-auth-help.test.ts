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
} from '../../helpers/harness-cli-test-helpers.ts';

const serialCliTest = createConcurrentCliTest();

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
    assert.equal(adoptedRecord?.pid, originalRecord.pid);
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

void serialCliTest('harness rejects invalid session names', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['--session', '../bad', 'gateway', 'status']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('invalid --session value'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness update runs global latest install command via bun', async () => {
  const workspace = createWorkspace();
  const commandDir = join(workspace, 'bin');
  mkdirSync(commandDir, { recursive: true });
  const bunArgsPath = join(workspace, 'bun-args.txt');
  createStubCommand(
    commandDir,
    'bun',
    [
      'if [ -n "${HARNESS_TEST_BUN_ARGS_PATH:-}" ]; then',
      '  printf "%s\\n" "$@" > "$HARNESS_TEST_BUN_ARGS_PATH"',
      'fi',
      'if [ -n "${HARNESS_TEST_BUN_STDOUT:-}" ]; then',
      '  printf "%s\\n" "$HARNESS_TEST_BUN_STDOUT"',
      'fi',
      'exit "${HARNESS_TEST_BUN_EXIT_CODE:-0}"',
    ].join('\n'),
  );
  try {
    const result = await runHarness(workspace, ['update'], {
      PATH: commandDir,
      HARNESS_TEST_BUN_ARGS_PATH: bunArgsPath,
      HARNESS_TEST_BUN_STDOUT: 'bun install ok',
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('updating Harness package: @jmoyers/harness@latest'), true);
    assert.equal(result.stdout.includes('bun install ok'), true);
    assert.equal(result.stdout.includes('harness update complete: @jmoyers/harness@latest'), true);
    assert.equal(
      readFileSync(bunArgsPath, 'utf8'),
      ['add', '-g', '--trust', '@jmoyers/harness@latest'].join('\n') + '\n',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness upgrade aliases harness update and honors HARNESS_UPDATE_PACKAGE override', async () => {
  const workspace = createWorkspace();
  const commandDir = join(workspace, 'bin');
  mkdirSync(commandDir, { recursive: true });
  const bunArgsPath = join(workspace, 'bun-args.txt');
  createStubCommand(
    commandDir,
    'bun',
    [
      'if [ -n "${HARNESS_TEST_BUN_ARGS_PATH:-}" ]; then',
      '  printf "%s\\n" "$@" > "$HARNESS_TEST_BUN_ARGS_PATH"',
      'fi',
      'exit 0',
    ].join('\n'),
  );
  try {
    const result = await runHarness(workspace, ['upgrade'], {
      PATH: commandDir,
      HARNESS_TEST_BUN_ARGS_PATH: bunArgsPath,
      HARNESS_UPDATE_PACKAGE: '@jmoyers/harness@next',
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('updating Harness package: @jmoyers/harness@next'), true);
    assert.equal(result.stdout.includes('harness update complete: @jmoyers/harness@next'), true);
    assert.equal(
      readFileSync(bunArgsPath, 'utf8'),
      ['add', '-g', '--trust', '@jmoyers/harness@next'].join('\n') + '\n',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness update rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['update', '--bad-option']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown update option: --bad-option'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness auth login github requires HARNESS_GITHUB_OAUTH_CLIENT_ID', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['auth', 'login', 'github', '--no-browser'], {
      HARNESS_GITHUB_OAUTH_CLIENT_ID: undefined,
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('missing required HARNESS_GITHUB_OAUTH_CLIENT_ID'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness auth login github stores oauth tokens in secrets.env', async () => {
  const workspace = createWorkspace();
  let deviceRequestCount = 0;
  let tokenRequestCount = 0;
  const oauthServer = createHttpServer((request, response) => {
    const path = request.url ?? '/';
    if (request.method === 'POST' && path === '/login/device/code') {
      deviceRequestCount += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          device_code: 'device-test-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://example.invalid/device',
          verification_uri_complete: 'https://example.invalid/device?code=ABCD-EFGH',
          expires_in: 600,
          interval: 0.1,
        }),
      );
      return;
    }
    if (request.method === 'POST' && path === '/login/oauth/access_token') {
      tokenRequestCount += 1;
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          access_token: 'gho_test_access_token',
          refresh_token: 'ghr_test_refresh_token',
          expires_in: 3600,
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    oauthServer.once('error', rejectListen);
    oauthServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = oauthServer.address();
  if (address === null || typeof address === 'string') {
    oauthServer.close();
    throw new Error('failed to resolve github oauth server address');
  }
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const secretsPath = join(workspaceConfigRoot(workspace), 'secrets.env');
  mkdirSync(dirname(secretsPath), { recursive: true });
  writeFileSync(secretsPath, 'GITHUB_TOKEN=manual_github_token\n', 'utf8');

  try {
    const result = await runHarness(workspace, ['auth', 'login', 'github', '--no-browser'], {
      HARNESS_GITHUB_OAUTH_CLIENT_ID: 'github-client-id-test',
      HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL: `${baseUrl}/login/device/code`,
      HARNESS_GITHUB_OAUTH_TOKEN_URL: `${baseUrl}/login/oauth/access_token`,
      GITHUB_TOKEN: undefined,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('github oauth login complete'), true);
    assert.equal(deviceRequestCount, 1);
    assert.equal(tokenRequestCount >= 1, true);
    const secretsText = readFileSync(secretsPath, 'utf8');
    assert.equal(secretsText.includes('GITHUB_TOKEN=manual_github_token'), true);
    assert.equal(
      secretsText.includes('HARNESS_GITHUB_OAUTH_ACCESS_TOKEN=gho_test_access_token'),
      true,
    );
    assert.equal(
      secretsText.includes('HARNESS_GITHUB_OAUTH_REFRESH_TOKEN=ghr_test_refresh_token'),
      true,
    );
    assert.equal(secretsText.includes('HARNESS_GITHUB_OAUTH_ACCESS_EXPIRES_AT='), true);
  } finally {
    await new Promise<void>((resolveClose) => oauthServer.close(() => resolveClose()));
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness auth login linear completes oauth callback flow and stores tokens', async () => {
  const workspace = createWorkspace();
  let tokenRequestBody: Record<string, unknown> | null = null;
  const oauthServer = createHttpServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && requestUrl.pathname === '/oauth/authorize') {
      const redirectUri = requestUrl.searchParams.get('redirect_uri');
      const state = requestUrl.searchParams.get('state');
      if (redirectUri === null || state === null) {
        response.statusCode = 400;
        response.end('missing redirect_uri/state');
        return;
      }
      const redirect = new URL(redirectUri);
      redirect.searchParams.set('code', 'linear-code-test');
      redirect.searchParams.set('state', state);
      response.statusCode = 302;
      response.setHeader('location', redirect.toString());
      response.end();
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/oauth/token') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        tokenRequestBody = JSON.parse(bodyText) as Record<string, unknown>;
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            access_token: 'linear_access_token_test',
            refresh_token: 'linear_refresh_token_test',
            expires_in: 7200,
          }),
        );
      });
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    oauthServer.once('error', rejectListen);
    oauthServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = oauthServer.address();
  if (address === null || typeof address === 'string') {
    oauthServer.close();
    throw new Error('failed to resolve linear oauth server address');
  }
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const secretsPath = join(workspaceConfigRoot(workspace), 'secrets.env');
  mkdirSync(dirname(secretsPath), { recursive: true });
  writeFileSync(secretsPath, 'LINEAR_API_KEY=manual_linear_token\n', 'utf8');
  const browserStubPath = join(workspace, 'browser-oauth-stub.js');
  writeFileSync(
    browserStubPath,
    [
      '#!/usr/bin/env node',
      '(async () => {',
      '  const target = process.argv[2];',
      "  if (typeof target !== 'string' || target.length === 0) {",
      '    process.exit(2);',
      '    return;',
      '  }',
      "  const response = await fetch(target, { redirect: 'follow' });",
      '  process.exit(response.ok ? 0 : 1);',
      '})().catch(() => {',
      '  process.exit(1);',
      '});',
    ].join('\n'),
    'utf8',
  );
  chmodSync(browserStubPath, 0o755);

  try {
    const result = await runHarness(
      workspace,
      ['auth', 'login', 'linear', '--timeout-ms', '10000'],
      {
        HARNESS_AUTH_BROWSER_COMMAND: browserStubPath,
        HARNESS_LINEAR_OAUTH_CLIENT_ID: 'linear-client-id-test',
        HARNESS_LINEAR_OAUTH_AUTHORIZE_URL: `${baseUrl}/oauth/authorize`,
        HARNESS_LINEAR_OAUTH_TOKEN_URL: `${baseUrl}/oauth/token`,
        LINEAR_API_KEY: undefined,
      },
    );
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('linear oauth login complete'), true);
    assert.notEqual(tokenRequestBody, null);
    assert.equal(tokenRequestBody?.['grant_type'], 'authorization_code');
    assert.equal(tokenRequestBody?.['client_id'], 'linear-client-id-test');
    assert.equal(tokenRequestBody?.['code'], 'linear-code-test');
    assert.equal(typeof tokenRequestBody?.['code_verifier'], 'string');
    const secretsText = readFileSync(secretsPath, 'utf8');
    assert.equal(secretsText.includes('LINEAR_API_KEY=manual_linear_token'), true);
    assert.equal(
      secretsText.includes('HARNESS_LINEAR_OAUTH_ACCESS_TOKEN=linear_access_token_test'),
      true,
    );
    assert.equal(
      secretsText.includes('HARNESS_LINEAR_OAUTH_REFRESH_TOKEN=linear_refresh_token_test'),
      true,
    );
    assert.equal(secretsText.includes('HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT='), true);
  } finally {
    await new Promise<void>((resolveClose) => oauthServer.close(() => resolveClose()));
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness auth refresh linear updates expired oauth token and auth logout clears secrets', async () => {
  const workspace = createWorkspace();
  let refreshRequestCount = 0;
  const oauthServer = createHttpServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'POST' && requestUrl.pathname === '/oauth/token') {
      refreshRequestCount += 1;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const payload = JSON.parse(bodyText) as Record<string, unknown>;
        if (payload['grant_type'] !== 'refresh_token') {
          response.statusCode = 400;
          response.end('invalid grant type');
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            access_token: 'linear_refreshed_access_token',
            refresh_token: 'linear_refreshed_refresh_token',
            expires_in: 3600,
          }),
        );
      });
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    oauthServer.once('error', rejectListen);
    oauthServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = oauthServer.address();
  if (address === null || typeof address === 'string') {
    oauthServer.close();
    throw new Error('failed to resolve linear oauth refresh server address');
  }
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const secretsPath = join(workspaceConfigRoot(workspace), 'secrets.env');
  mkdirSync(dirname(secretsPath), { recursive: true });
  writeFileSync(
    secretsPath,
    [
      'LINEAR_API_KEY=manual_linear_token',
      'HARNESS_LINEAR_OAUTH_ACCESS_TOKEN=linear_old_access_token',
      'HARNESS_LINEAR_OAUTH_REFRESH_TOKEN=linear_old_refresh_token',
      'HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT=1970-01-01T00:00:00.000Z',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const refreshResult = await runHarness(workspace, ['auth', 'refresh', 'linear'], {
      HARNESS_LINEAR_OAUTH_CLIENT_ID: 'linear-client-id-test',
      HARNESS_LINEAR_OAUTH_TOKEN_URL: `${baseUrl}/oauth/token`,
    });
    assert.equal(refreshResult.code, 0);
    assert.equal(refreshResult.stdout.includes('linear oauth refresh: refreshed'), true);
    assert.equal(refreshRequestCount, 1);
    const refreshedSecrets = readFileSync(secretsPath, 'utf8');
    assert.equal(refreshedSecrets.includes('LINEAR_API_KEY=manual_linear_token'), true);
    assert.equal(
      refreshedSecrets.includes('HARNESS_LINEAR_OAUTH_ACCESS_TOKEN=linear_refreshed_access_token'),
      true,
    );
    assert.equal(
      refreshedSecrets.includes(
        'HARNESS_LINEAR_OAUTH_REFRESH_TOKEN=linear_refreshed_refresh_token',
      ),
      true,
    );

    const logoutResult = await runHarness(workspace, ['auth', 'logout', 'linear']);
    assert.equal(logoutResult.code, 0);
    assert.equal(logoutResult.stdout.includes('auth logout complete'), true);
    const afterLogoutSecrets = readFileSync(secretsPath, 'utf8');
    assert.equal(afterLogoutSecrets.includes('LINEAR_API_KEY=manual_linear_token'), true);
    assert.equal(afterLogoutSecrets.includes('HARNESS_LINEAR_OAUTH_ACCESS_TOKEN='), false);
    assert.equal(afterLogoutSecrets.includes('HARNESS_LINEAR_OAUTH_REFRESH_TOKEN='), false);
    assert.equal(afterLogoutSecrets.includes('HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT='), false);
  } finally {
    await new Promise<void>((resolveClose) => oauthServer.close(() => resolveClose()));
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness cursor-hooks install creates managed cursor hooks in user scope', async () => {
  const workspace = createWorkspace();
  const fakeHome = join(workspace, 'fake-home');
  const hooksFilePath = join(fakeHome, '.cursor/hooks.json');
  try {
    const result = await runHarness(workspace, ['cursor-hooks', 'install'], {
      HOME: fakeHome,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('cursor hooks install:'), true);
    assert.equal(existsSync(hooksFilePath), true);
    const parsed = JSON.parse(readFileSync(hooksFilePath, 'utf8')) as Record<string, unknown>;
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    const managedBeforeSubmit = hooks['beforeSubmitPrompt'] ?? [];
    assert.equal(
      managedBeforeSubmit.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes('harness-cursor-hook-v1:beforeSubmitPrompt'),
      ),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness cursor-hooks uninstall removes only managed cursor entries', async () => {
  const workspace = createWorkspace();
  const fakeHome = join(workspace, 'fake-home');
  const hooksFilePath = join(fakeHome, '.cursor/hooks.json');
  mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      version: 1,
      hooks: {
        beforeSubmitPrompt: [
          { command: 'echo user-hook' },
          {
            command:
              "/usr/bin/env node /tmp/cursor-hook-relay.ts --managed-hook-id 'harness-cursor-hook-v1:beforeSubmitPrompt'",
          },
        ],
      },
    }),
    'utf8',
  );
  try {
    const result = await runHarness(workspace, ['cursor-hooks', 'uninstall'], {
      HOME: fakeHome,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('cursor hooks uninstall:'), true);
    const parsed = JSON.parse(readFileSync(hooksFilePath, 'utf8')) as Record<string, unknown>;
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(
      hooks['beforeSubmitPrompt']?.some((entry) => entry['command'] === 'echo user-hook'),
      true,
    );
    assert.equal(
      hooks['beforeSubmitPrompt']?.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes('harness-cursor-hook-v1'),
      ),
      false,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness animate --help prints usage', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate', '--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('harness animate [--fps <fps>]'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness nim --help prints usage', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['nim', '--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('harness nim [options]'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness --help prints oclif root command menu', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('USAGE'), true);
    assert.equal(result.stdout.includes('COMMANDS'), true);
    assert.equal(result.stdout.includes('gateway'), true);
    assert.equal(result.stdout.includes('status-timeline'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness nim rejects unknown arguments', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['nim', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown argument: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness gateway --help prints standardized command usage', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['gateway', '--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('USAGE'), true);
    assert.equal(result.stdout.includes('harness gateway'), true);
    assert.equal(result.stdout.includes('--session'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness animate requires explicit bounds in non-tty mode', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('harness animate requires a TTY'), true);
    assert.equal(result.stderr.includes('--frames/--duration-ms'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness animate renders bounded frames without starting gateway', async () => {
  const workspace = createWorkspace();
  const recordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
  try {
    const result = await runHarness(workspace, [
      'animate',
      '--frames',
      '1',
      '--seed',
      '7',
      '--no-color',
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('HARNESS'), true);
    assert.equal(existsSync(recordPath), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void serialCliTest('harness animate default color output uses muted palette', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate', '--frames', '1', '--seed', '7']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('\u001b[38;5;109m'), true);
    assert.equal(result.stdout.includes('\u001b[38;5;46m'), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

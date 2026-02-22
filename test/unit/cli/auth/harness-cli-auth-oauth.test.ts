import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createConcurrentCliTest,
  createWorkspace,
  runHarness,
  workspaceConfigRoot,
} from '../../../helpers/harness-cli-test-helpers.ts';

const concurrentCliTest = createConcurrentCliTest();

void concurrentCliTest(
  'harness auth login github requires HARNESS_GITHUB_OAUTH_CLIENT_ID',
  async () => {
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
  },
);

void concurrentCliTest('harness auth login github stores oauth tokens in secrets.env', async () => {
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

void concurrentCliTest(
  'harness auth login linear completes oauth callback flow and stores tokens',
  async () => {
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
  },
);

void concurrentCliTest(
  'harness auth refresh linear updates expired oauth token and auth logout clears secrets',
  async () => {
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
        refreshedSecrets.includes(
          'HARNESS_LINEAR_OAUTH_ACCESS_TOKEN=linear_refreshed_access_token',
        ),
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
  },
);

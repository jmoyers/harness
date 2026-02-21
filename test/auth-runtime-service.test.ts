import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import { resolveHarnessConfigPath, loadHarnessConfig } from '../src/config/config-core.ts';
import { resolveHarnessSecretsPath } from '../src/config/secrets-core.ts';
import { AuthRuntimeService } from '../src/cli/auth/runtime.ts';

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'auth-runtime-service-test-'));
}

function createEnv(workspace: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HARNESS_INVOKE_CWD: workspace,
    XDG_CONFIG_HOME: resolve(workspace, '.xdg-config'),
    HOME: workspace,
  };
}

async function waitForAuthorizeUrl(
  stdout: readonly string[],
  startLength: number,
  timeoutMs = 1_000,
): Promise<URL> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const nextText = stdout.slice(startLength).join('');
    const marker = 'linear oauth authorize url: ';
    const markerIndex = nextText.lastIndexOf(marker);
    if (markerIndex >= 0) {
      const line =
        nextText
          .slice(markerIndex + marker.length)
          .split('\n')[0]
          ?.trim() ?? '';
      if (line.length > 0) {
        return new URL(line);
      }
    }
    await new Promise<void>((resolveSleep) => {
      setTimeout(resolveSleep, 10);
    });
  }
  throw new Error('timed out waiting for authorize url output');
}

test('auth runtime parser validates command shapes and options', () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const service = new AuthRuntimeService(
    workspace,
    env,
    () => undefined,
    () => undefined,
  );

  assert.equal(service.parseCommand([]).type, 'status');
  assert.equal(service.parseCommand(['status']).type, 'status');
  assert.equal(service.parseCommand(['login', 'github']).type, 'login');
  assert.equal(service.parseCommand(['refresh']).type, 'refresh');
  assert.equal(service.parseCommand(['logout', 'linear']).type, 'logout');
  assert.throws(() => service.parseCommand(['login']), /missing auth login provider/u);
  assert.throws(
    () => service.parseCommand(['refresh', 'all', 'extra']),
    /unknown auth refresh option/u,
  );
  assert.throws(() => service.parseCommand(['login', 'all']), /unsupported auth provider/u);
  assert.throws(() => service.parseCommand(['unknown']), /unknown auth subcommand/u);
});

test('auth runtime status reports manual and oauth token source precedence', async () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const configPath = resolveHarnessConfigPath(workspace, env);
  mkdirSync(resolve(configPath, '..'), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        configVersion: 1,
        github: { tokenEnvVar: 'HARNESS_TEST_GITHUB_TOKEN' },
        linear: { tokenEnvVar: 'HARNESS_TEST_LINEAR_TOKEN' },
      },
      null,
      2,
    ),
    'utf8',
  );
  const stdout: string[] = [];
  const service = new AuthRuntimeService(
    workspace,
    env,
    (text) => {
      stdout.push(text);
    },
    () => undefined,
  );

  env.HARNESS_TEST_GITHUB_TOKEN = 'manual-token';
  env.HARNESS_GITHUB_OAUTH_ACCESS_TOKEN = 'oauth-token';
  env.HARNESS_GITHUB_OAUTH_REFRESH_TOKEN = 'refresh-token';
  env.HARNESS_GITHUB_OAUTH_ACCESS_EXPIRES_AT = '2030-01-01T00:00:00.000Z';
  env.HARNESS_LINEAR_OAUTH_ACCESS_TOKEN = 'linear-oauth';

  const exitCode = await service.run(['status']);
  assert.equal(exitCode, 0);
  const merged = stdout.join('');
  assert.equal(merged.includes('github: connected active=manual'), true);
  assert.equal(merged.includes('linear: connected active=oauth'), true);
});

test('auth runtime logout removes oauth keys from secrets file and in-memory env', async () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const loaded = loadHarnessConfig({ cwd: workspace, env });
  void loaded;
  const secretsPath = resolveHarnessSecretsPath(workspace, undefined, env);
  mkdirSync(resolve(secretsPath, '..'), { recursive: true });
  writeFileSync(
    secretsPath,
    [
      'HARNESS_LINEAR_OAUTH_ACCESS_TOKEN=access',
      'HARNESS_LINEAR_OAUTH_REFRESH_TOKEN=refresh',
      'HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT=2030-01-01T00:00:00.000Z',
      'KEEP_ME=1',
      '',
    ].join('\n'),
    'utf8',
  );
  env.HARNESS_LINEAR_OAUTH_ACCESS_TOKEN = 'access';
  env.HARNESS_LINEAR_OAUTH_REFRESH_TOKEN = 'refresh';
  env.HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT = '2030-01-01T00:00:00.000Z';

  const stdout: string[] = [];
  const service = new AuthRuntimeService(
    workspace,
    env,
    (text) => {
      stdout.push(text);
    },
    () => undefined,
  );

  const exitCode = await service.run(['logout', 'linear']);
  assert.equal(exitCode, 0);
  assert.equal(stdout.join('').includes('auth logout complete'), true);
  const nextSecrets = readFileSync(secretsPath, 'utf8');
  assert.equal(nextSecrets.includes('HARNESS_LINEAR_OAUTH_ACCESS_TOKEN'), false);
  assert.equal(nextSecrets.includes('HARNESS_LINEAR_OAUTH_REFRESH_TOKEN'), false);
  assert.equal(nextSecrets.includes('HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT'), false);
  assert.equal(nextSecrets.includes('KEEP_ME=1'), true);
  assert.equal(env.HARNESS_LINEAR_OAUTH_ACCESS_TOKEN, undefined);
  assert.equal(env.HARNESS_LINEAR_OAUTH_REFRESH_TOKEN, undefined);
  assert.equal(env.HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT, undefined);
});

test('auth runtime helper internals cover scope parsing, token timing, and URL resolution', () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const service = new AuthRuntimeService(
    workspace,
    env,
    () => undefined,
    () => undefined,
  );
  const internal = service as unknown as Record<string, unknown>;
  const callInternal = <T>(name: string, ...args: unknown[]): T =>
    (internal[name] as (...innerArgs: unknown[]) => T).apply(service, args);

  assert.equal(
    callInternal<string>('normalizeScopeList', 'repo, read:user repo', 'fallback'),
    'repo read:user',
  );
  assert.equal(callInternal<string>('normalizeScopeList', '   ', 'fallback'), 'fallback');

  env.HARNESS_REQUIRED = '  value ';
  assert.equal(callInternal<string>('readRequiredEnvValue', 'HARNESS_REQUIRED'), 'value');
  assert.throws(
    () => callInternal<string>('readRequiredEnvValue', 'MISSING_REQUIRED_KEY'),
    /missing required/u,
  );

  assert.equal(callInternal<number | null>('parseOptionalIsoTimestamp', null), null);
  assert.equal(callInternal<number | null>('parseOptionalIsoTimestamp', 'not-iso'), null);
  assert.equal(
    typeof callInternal<number | null>('parseOptionalIsoTimestamp', '2030-01-01T00:00:00.000Z'),
    'number',
  );
  assert.equal(callInternal<boolean>('isTokenNearExpiry', null), false);
  assert.equal(callInternal<boolean>('isTokenNearExpiry', Date.now() + 3600_000, 1000), false);
  assert.equal(callInternal<boolean>('isTokenNearExpiry', Date.now() + 1000, 5000), true);

  assert.equal(callInternal<string | null>('expiresAtFromExpiresIn', 0), null);
  assert.equal(callInternal<string | null>('expiresAtFromExpiresIn', -1), null);
  assert.equal(callInternal<string | null>('expiresAtFromExpiresIn', 'x'), null);
  assert.equal(typeof callInternal<string | null>('expiresAtFromExpiresIn', 60), 'string');

  assert.equal(callInternal<string | null>('parseSecretLineKeyForDeletion', '# comment'), null);
  assert.equal(
    callInternal<string | null>('parseSecretLineKeyForDeletion', 'export HARNESS_TEST=value'),
    'HARNESS_TEST',
  );
  assert.equal(
    callInternal<string | null>('parseSecretLineKeyForDeletion', '  HARNESS_TEST_2 = value  '),
    'HARNESS_TEST_2',
  );
  assert.equal(callInternal<string | null>('parseSecretLineKeyForDeletion', 'broken-line'), null);

  env.HARNESS_GITHUB_OAUTH_BASE_URL = 'https://example.github.test///';
  assert.equal(
    callInternal<string>('resolveGitHubDeviceCodeUrl'),
    'https://example.github.test/login/device/code',
  );
  assert.equal(
    callInternal<string>('resolveGitHubOauthTokenUrl'),
    'https://example.github.test/login/oauth/access_token',
  );
  env.HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL = 'https://override.github/device';
  env.HARNESS_GITHUB_OAUTH_TOKEN_URL = 'https://override.github/token';
  assert.equal(
    callInternal<string>('resolveGitHubDeviceCodeUrl'),
    'https://override.github/device',
  );
  assert.equal(callInternal<string>('resolveGitHubOauthTokenUrl'), 'https://override.github/token');

  env.HARNESS_LINEAR_OAUTH_AUTHORIZE_URL = 'https://override.linear/authorize';
  env.HARNESS_LINEAR_OAUTH_TOKEN_URL = 'https://override.linear/token';
  assert.equal(
    callInternal<string>('resolveLinearAuthorizeUrl'),
    'https://override.linear/authorize',
  );
  assert.equal(callInternal<string>('resolveLinearTokenUrl'), 'https://override.linear/token');

  const verifier = callInternal<string>('createPkceVerifier');
  const challenge = callInternal<string>('createPkceChallenge', verifier);
  assert.equal(verifier.length > 0, true);
  assert.equal(challenge.length > 0, true);
  assert.equal(callInternal<string | null>('asStringField', { key: '  value ' }, 'key'), 'value');
  assert.equal(callInternal<string | null>('asStringField', { key: '' }, 'key'), null);

  env.HARNESS_MANUAL_TOKEN = 'manual';
  env.HARNESS_OAUTH_TOKEN = 'oauth';
  env.HARNESS_GITHUB_OAUTH_REFRESH_TOKEN = 'refresh';
  env.HARNESS_GITHUB_OAUTH_ACCESS_EXPIRES_AT = '2030-01-01T00:00:00.000Z';
  const githubLine = callInternal<string>(
    'formatAuthProviderStatusLine',
    'github',
    'HARNESS_MANUAL_TOKEN',
    'HARNESS_OAUTH_TOKEN',
  );
  assert.equal(githubLine.includes('active=manual'), true);
  assert.equal(githubLine.includes('refresh=yes'), true);
});

test('auth runtime fetch helper and refresh-before-start branches handle success and errors', async () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const service = new AuthRuntimeService(
    workspace,
    env,
    (text) => stdout.push(text),
    (text) => stderr.push(text),
  );
  const internal = service as unknown as Record<string, unknown>;
  const fetchJsonRecord = internal['fetchJsonRecord'] as (
    url: string,
    init?: RequestInit & { timeoutMs?: number },
  ) => Promise<Record<string, unknown>>;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    assert.deepEqual(await fetchJsonRecord('https://example.test/ok', { timeoutMs: 25 }), {
      ok: true,
    });

    globalThis.fetch = (async () =>
      new Response('{', {
        status: 200,
      })) as typeof fetch;
    await assert.rejects(
      fetchJsonRecord('https://example.test/not-json'),
      /oauth endpoint returned non-json payload/u,
    );

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error_description: 'denied' }), {
        status: 401,
        statusText: 'Unauthorized',
      })) as typeof fetch;
    await assert.rejects(fetchJsonRecord('https://example.test/denied'), /oauth request failed/u);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(['not-an-object']), {
        status: 200,
      })) as typeof fetch;
    await assert.rejects(
      fetchJsonRecord('https://example.test/malformed'),
      /oauth endpoint returned malformed payload/u,
    );

    globalThis.fetch = ((_: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted by timeout'));
        });
      })) as typeof fetch;
    await assert.rejects(
      fetchJsonRecord('https://example.test/timeout', { timeoutMs: 1 }),
      /aborted by timeout/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const resolveIntegrationTokenEnvVars = internal['resolveIntegrationTokenEnvVars'] as () => {
    githubTokenEnvVar: string;
    linearTokenEnvVar: string;
  };
  const refreshLinearOauthTokenBeforeGatewayStart =
    service.refreshLinearOauthTokenBeforeGatewayStart.bind(service);

  internal['resolveIntegrationTokenEnvVars'] = () => ({
    githubTokenEnvVar: 'HARNESS_GITHUB_TOKEN',
    linearTokenEnvVar: 'HARNESS_LINEAR_MANUAL_TOKEN',
  });
  env.HARNESS_LINEAR_MANUAL_TOKEN = 'manual-token';
  await refreshLinearOauthTokenBeforeGatewayStart();
  assert.equal(stdout.length, 0);

  delete env.HARNESS_LINEAR_MANUAL_TOKEN;
  internal['refreshLinearOauthToken'] = async () => ({
    refreshed: true,
    skippedReason: null,
  });
  await refreshLinearOauthTokenBeforeGatewayStart();
  assert.equal(stdout.join('').includes('linear oauth token refreshed before gateway start'), true);

  internal['refreshLinearOauthToken'] = async () => {
    throw new Error('refresh failed');
  };
  await refreshLinearOauthTokenBeforeGatewayStart();
  assert.equal(stderr.join('').includes('linear oauth refresh skipped: refresh failed'), true);
  internal['resolveIntegrationTokenEnvVars'] = resolveIntegrationTokenEnvVars;
});

test('auth runtime oauth login and refresh internals handle token persistence branches', async () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  env.HARNESS_GITHUB_OAUTH_CLIENT_ID = 'github-client-id';
  env.HARNESS_LINEAR_OAUTH_CLIENT_ID = 'linear-client-id';
  const stdout: string[] = [];
  const service = new AuthRuntimeService(
    workspace,
    env,
    (text) => stdout.push(text),
    () => undefined,
  );
  const internal = service as unknown as Record<string, unknown>;

  const upserts: Array<{ key: string; value: string }> = [];
  const removedKeys: string[] = [];
  internal['upsertHarnessSecretValue'] = (key: string, value: string): void => {
    upserts.push({ key, value });
    env[key] = value;
  };
  internal['removeHarnessSecrets'] = (
    keys: readonly string[],
  ): { filePath: string; removedCount: number } => {
    removedKeys.push(...keys);
    return {
      filePath: resolve(workspace, '.secrets'),
      removedCount: keys.length,
    };
  };

  const githubLogin = service.parseCommand([
    'login',
    'github',
    '--no-browser',
    '--timeout-ms',
    '250',
  ]);
  const githubFetchPayloads: Array<Record<string, unknown>> = [
    {
      device_code: 'device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-EFGH',
      expires_in: 120,
      interval: 0.001,
    },
    {
      access_token: 'github-access',
    },
  ];
  internal['fetchJsonRecord'] = async () => githubFetchPayloads.shift() ?? {};
  await (internal['loginGitHubWithOAuthDeviceFlow'] as (command: unknown) => Promise<void>).call(
    service,
    githubLogin,
  );
  assert.equal(stdout.join('').includes('github oauth user code: ABCD-EFGH'), true);
  assert.equal(stdout.join('').includes('github oauth login complete'), true);
  assert.equal(
    upserts.some((entry) => entry.key === 'HARNESS_GITHUB_OAUTH_ACCESS_TOKEN'),
    true,
  );
  assert.equal(
    removedKeys.includes('HARNESS_GITHUB_OAUTH_REFRESH_TOKEN') &&
      removedKeys.includes('HARNESS_GITHUB_OAUTH_ACCESS_EXPIRES_AT'),
    true,
  );

  const linearLogin = service.parseCommand([
    'login',
    'linear',
    '--no-browser',
    '--timeout-ms',
    '250',
  ]);
  internal['waitForLinearOauthCodeViaCallback'] = async () => ({
    code: 'linear-code',
    redirectUri: 'http://127.0.0.1/callback',
    verifier: 'verifier',
  });
  internal['fetchJsonRecord'] = async () => ({
    access_token: 'linear-access',
  });
  await (internal['loginLinearWithOAuthPkce'] as (command: unknown) => Promise<void>).call(
    service,
    linearLogin,
  );
  assert.equal(stdout.join('').includes('linear oauth login complete'), true);
  assert.equal(
    upserts.some((entry) => entry.key === 'HARNESS_LINEAR_OAUTH_ACCESS_TOKEN'),
    true,
  );

  const refreshLinearOauthToken = async (options: {
    force: boolean;
    timeoutMs: number;
  }): Promise<{ refreshed: boolean; skippedReason: string | null }> =>
    await (
      internal['refreshLinearOauthToken'] as (input: {
        force: boolean;
        timeoutMs: number;
      }) => Promise<{ refreshed: boolean; skippedReason: string | null }>
    ).call(service, options);
  delete env.HARNESS_LINEAR_OAUTH_REFRESH_TOKEN;
  assert.deepEqual(await refreshLinearOauthToken({ force: true, timeoutMs: 25 }), {
    refreshed: false,
    skippedReason: 'missing linear oauth refresh token',
  });

  env.HARNESS_LINEAR_OAUTH_REFRESH_TOKEN = 'refresh-token';
  env.HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT = '2999-01-01T00:00:00.000Z';
  assert.deepEqual(await refreshLinearOauthToken({ force: false, timeoutMs: 25 }), {
    refreshed: false,
    skippedReason: 'linear oauth token still valid',
  });

  env.HARNESS_LINEAR_OAUTH_CLIENT_ID = 'linear-client-id';
  internal['fetchJsonRecord'] = async () => ({
    access_token: 'linear-access-next',
    refresh_token: 'linear-refresh-next',
    expires_in: 120,
  });
  const refreshResult = await refreshLinearOauthToken({ force: true, timeoutMs: 25 });
  assert.equal(refreshResult.refreshed, true);
  assert.equal(refreshResult.skippedReason, null);

  internal['fetchJsonRecord'] = async () => ({});
  await assert.rejects(
    refreshLinearOauthToken({ force: true, timeoutMs: 25 }),
    /linear oauth refresh response missing access_token/u,
  );
});

test('auth runtime linear oauth callback helper handles success and callback error branches', async () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const stdout: string[] = [];
  const service = new AuthRuntimeService(
    workspace,
    env,
    (text) => stdout.push(text),
    () => undefined,
  );
  const internal = service as unknown as Record<string, unknown>;
  const waitForLinearOauthCodeViaCallback = internal['waitForLinearOauthCodeViaCallback'] as (
    clientId: string,
    scopes: string,
    timeoutMs: number,
    noBrowser: boolean,
  ) => Promise<{ code: string; redirectUri: string; verifier: string }>;
  const browserUrls: string[] = [];
  internal['tryOpenBrowserUrl'] = (url: string): void => {
    browserUrls.push(url);
  };

  const successStart = stdout.length;
  const successPromise = waitForLinearOauthCodeViaCallback.call(
    service,
    'linear-client-id',
    'read write',
    750,
    false,
  );
  const successAuthorizeUrl = await waitForAuthorizeUrl(stdout, successStart);
  const successRedirectUri = successAuthorizeUrl.searchParams.get('redirect_uri');
  const successState = successAuthorizeUrl.searchParams.get('state');
  assert.equal(typeof successRedirectUri, 'string');
  assert.equal(typeof successState, 'string');
  const successCallbackUrl = new URL(successRedirectUri!);
  successCallbackUrl.searchParams.set('state', successState!);
  successCallbackUrl.searchParams.set('code', 'linear-code');
  const successResponse = await fetch(successCallbackUrl.toString());
  assert.equal(successResponse.status, 200);
  const successResult = await successPromise;
  assert.equal(successResult.code, 'linear-code');
  assert.equal(successResult.redirectUri, successRedirectUri);
  assert.equal(successResult.verifier.length > 0, true);
  assert.equal(browserUrls.length > 0, true);

  const mismatchStart = stdout.length;
  const mismatchPromise = waitForLinearOauthCodeViaCallback.call(
    service,
    'linear-client-id',
    'read',
    750,
    true,
  );
  const mismatchRejected = assert.rejects(mismatchPromise, /state mismatch/u);
  const mismatchAuthorizeUrl = await waitForAuthorizeUrl(stdout, mismatchStart);
  const mismatchRedirectUri = mismatchAuthorizeUrl.searchParams.get('redirect_uri');
  const mismatchCallbackUrl = new URL(mismatchRedirectUri!);
  mismatchCallbackUrl.searchParams.set('state', 'mismatch');
  mismatchCallbackUrl.searchParams.set('code', 'linear-code');
  const mismatchResponse = await fetch(mismatchCallbackUrl.toString());
  assert.equal(mismatchResponse.status, 400);
  await mismatchRejected;

  const missingCodeStart = stdout.length;
  const missingCodePromise = waitForLinearOauthCodeViaCallback.call(
    service,
    'linear-client-id',
    'read',
    750,
    true,
  );
  const missingCodeRejected = assert.rejects(missingCodePromise, /missing code/u);
  const missingCodeAuthorizeUrl = await waitForAuthorizeUrl(stdout, missingCodeStart);
  const missingCodeRedirectUri = missingCodeAuthorizeUrl.searchParams.get('redirect_uri');
  const missingCodeState = missingCodeAuthorizeUrl.searchParams.get('state');
  const missingCodeCallbackUrl = new URL(missingCodeRedirectUri!);
  missingCodeCallbackUrl.searchParams.set('state', missingCodeState!);
  const missingCodeResponse = await fetch(missingCodeCallbackUrl.toString());
  assert.equal(missingCodeResponse.status, 400);
  await missingCodeRejected;
});

test('auth runtime browser opener tolerates configured command failures', async () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  env.HARNESS_AUTH_BROWSER_COMMAND = '/definitely/missing/browser-command';
  const service = new AuthRuntimeService(
    workspace,
    env,
    () => undefined,
    () => undefined,
  );
  const internal = service as unknown as Record<string, unknown>;
  const tryOpenBrowserUrl = internal['tryOpenBrowserUrl'] as (url: string) => void;
  assert.doesNotThrow(() => tryOpenBrowserUrl.call(service, 'https://example.com/path?q=1'));
  await new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, 10);
  });
});

test('auth runtime default stdio and internal secret/timeout branches are exercised', async () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
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
    const service = new AuthRuntimeService(workspace, env);
    const internal = service as unknown as Record<string, unknown>;

    (internal['writeStdout'] as (text: string) => void).call(service, 'default-auth-stdout\n');
    (internal['writeStderr'] as (text: string) => void).call(service, 'default-auth-stderr\n');
    assert.equal(await service.run(['status']), 0);

    internal['resolveIntegrationTokenEnvVars'] = () => ({
      githubTokenEnvVar: 'HARNESS_GITHUB_TOKEN',
      linearTokenEnvVar: 'HARNESS_LINEAR_TOKEN',
    });
    internal['refreshLinearOauthToken'] = async () => {
      throw new Error('forced-refresh-error');
    };
    await service.refreshLinearOauthTokenBeforeGatewayStart();

    (internal['upsertHarnessSecretValue'] as (key: string, value: string) => void).call(
      service,
      'HARNESS_TEST_OAUTH_TOKEN',
      'token-value',
    );
    assert.equal(env.HARNESS_TEST_OAUTH_TOKEN, 'token-value');

    const waitForLinearOauthCodeViaCallback = internal['waitForLinearOauthCodeViaCallback'] as (
      clientId: string,
      scopes: string,
      timeoutMs: number,
      noBrowser: boolean,
    ) => Promise<{ code: string; redirectUri: string; verifier: string }>;
    await assert.rejects(
      waitForLinearOauthCodeViaCallback.call(service, 'linear-client-id', 'read', 1, true),
      /timed out waiting for linear oauth callback/u,
    );
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    delete process.env.HARNESS_TEST_OAUTH_TOKEN;
  }

  assert.equal(stdout.join('').includes('github:'), true);
  assert.equal(stderr.join('').includes('forced-refresh-error'), true);
});

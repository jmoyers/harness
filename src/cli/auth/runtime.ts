import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { loadHarnessConfig } from '../../config/config-core.ts';
import { resolveHarnessSecretsPath, upsertHarnessSecret } from '../../config/secrets-core.ts';
import { parsePositiveIntFlag, readCliValue } from '../parsing/flags.ts';
import { GatewayControlInfra } from '../runtime-infra/gateway-control.ts';

const DEFAULT_AUTH_TIMEOUT_MS = 120_000;
const DEFAULT_GITHUB_DEVICE_BASE_URL = 'https://github.com';
const DEFAULT_LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const DEFAULT_LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const DEFAULT_GITHUB_OAUTH_SCOPE = 'repo read:user';
const DEFAULT_LINEAR_OAUTH_SCOPE = 'read';

const GITHUB_OAUTH_ACCESS_TOKEN_KEY = 'HARNESS_GITHUB_OAUTH_ACCESS_TOKEN';
const GITHUB_OAUTH_REFRESH_TOKEN_KEY = 'HARNESS_GITHUB_OAUTH_REFRESH_TOKEN';
const GITHUB_OAUTH_EXPIRES_AT_KEY = 'HARNESS_GITHUB_OAUTH_ACCESS_EXPIRES_AT';
const LINEAR_OAUTH_ACCESS_TOKEN_KEY = 'HARNESS_LINEAR_OAUTH_ACCESS_TOKEN';
const LINEAR_OAUTH_REFRESH_TOKEN_KEY = 'HARNESS_LINEAR_OAUTH_REFRESH_TOKEN';
const LINEAR_OAUTH_EXPIRES_AT_KEY = 'HARNESS_LINEAR_OAUTH_ACCESS_EXPIRES_AT';

type AuthProvider = 'github' | 'linear';
type AuthProviderOrAll = AuthProvider | 'all';

interface ParsedAuthStatusCommand {
  readonly type: 'status';
}

interface ParsedAuthLoginCommand {
  readonly type: 'login';
  readonly provider: AuthProvider;
  readonly noBrowser: boolean;
  readonly timeoutMs: number;
  readonly scopes: string | null;
  readonly callbackPort: number | null;
}

interface ParsedAuthRefreshCommand {
  readonly type: 'refresh';
  readonly provider: AuthProviderOrAll;
}

interface ParsedAuthLogoutCommand {
  readonly type: 'logout';
  readonly provider: AuthProviderOrAll;
}

type ParsedAuthCommand =
  | ParsedAuthStatusCommand
  | ParsedAuthLoginCommand
  | ParsedAuthRefreshCommand
  | ParsedAuthLogoutCommand;

interface RefreshLinearOauthTokenOptions {
  readonly force: boolean;
  readonly timeoutMs: number;
}

interface RefreshLinearOauthTokenResult {
  readonly refreshed: boolean;
  readonly skippedReason: string | null;
}

function parseOauthCallbackPort(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error(`invalid ${label} value: ${value}`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`invalid ${label} value: ${value}`);
  }
  return parsed;
}

class AuthCommandParser {
  public constructor() {}

  private parseAuthProvider(value: string, allowAll: boolean): AuthProviderOrAll {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'github' || normalized === 'linear') {
      return normalized;
    }
    if (allowAll && normalized === 'all') {
      return 'all';
    }
    throw new Error(`unsupported auth provider: ${value}`);
  }

  private parseLoginCommand(argv: readonly string[]): ParsedAuthLoginCommand {
    if (argv.length === 0) {
      throw new Error('missing auth login provider (expected: github|linear)');
    }
    const provider = this.parseAuthProvider(argv[0]!, false);
    if (provider === 'all') {
      throw new Error('auth login requires a single provider (github|linear)');
    }
    let noBrowser = false;
    let timeoutMs = DEFAULT_AUTH_TIMEOUT_MS;
    let scopes: string | null = null;
    let callbackPort: number | null = null;
    for (let index = 1; index < argv.length; index += 1) {
      const arg = argv[index]!;
      if (arg === '--no-browser') {
        noBrowser = true;
        continue;
      }
      if (arg === '--timeout-ms') {
        timeoutMs = parsePositiveIntFlag(readCliValue(argv, index, '--timeout-ms'), '--timeout-ms');
        index += 1;
        continue;
      }
      if (arg === '--scopes') {
        scopes = readCliValue(argv, index, '--scopes');
        index += 1;
        continue;
      }
      if (arg === '--callback-port') {
        callbackPort = parseOauthCallbackPort(
          readCliValue(argv, index, '--callback-port'),
          '--callback-port',
        );
        index += 1;
        continue;
      }
      throw new Error(`unknown auth login option: ${arg}`);
    }
    if (provider !== 'linear' && callbackPort !== null) {
      throw new Error('--callback-port is only supported for auth login linear');
    }
    return {
      type: 'login',
      provider,
      noBrowser,
      timeoutMs,
      scopes,
      callbackPort,
    };
  }

  private parseProviderSelectorCommand(
    type: 'refresh' | 'logout',
    argv: readonly string[],
  ): ParsedAuthRefreshCommand | ParsedAuthLogoutCommand {
    if (argv.length > 1) {
      throw new Error(`unknown auth ${type} option: ${argv[1]}`);
    }
    const provider = argv.length === 0 ? 'all' : this.parseAuthProvider(argv[0]!, true);
    return {
      type,
      provider,
    };
  }

  public parse(argv: readonly string[]): ParsedAuthCommand {
    if (argv.length === 0) {
      return { type: 'status' };
    }
    const subcommand = argv[0]!;
    if (subcommand === 'status') {
      if (argv.length > 1) {
        throw new Error(`unknown auth status option: ${argv[1]}`);
      }
      return { type: 'status' };
    }
    if (subcommand === 'login') {
      return this.parseLoginCommand(argv.slice(1));
    }
    if (subcommand === 'refresh') {
      return this.parseProviderSelectorCommand('refresh', argv.slice(1));
    }
    if (subcommand === 'logout') {
      return this.parseProviderSelectorCommand('logout', argv.slice(1));
    }
    throw new Error(`unknown auth subcommand: ${subcommand}`);
  }
}

export class AuthRuntimeService {
  public readonly parser = new AuthCommandParser();
  private readonly infra: GatewayControlInfra;

  constructor(
    private readonly invocationDirectory: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly writeStdout: (text: string) => void = (text) => {
      process.stdout.write(text);
    },
    private readonly writeStderr: (text: string) => void = (text) => {
      process.stderr.write(text);
    },
  ) {
    this.infra = new GatewayControlInfra({ env: this.env, cwd: this.invocationDirectory });
  }

  public parseCommand(argv: readonly string[]): ParsedAuthCommand {
    return this.parser.parse(argv);
  }

  public async run(argv: readonly string[]): Promise<number> {
    const command = this.parseCommand(argv);
    const tokenEnvVars = this.resolveIntegrationTokenEnvVars();
    if (command.type === 'status') {
      this.writeStdout(
        `${this.formatAuthProviderStatusLine(
          'github',
          tokenEnvVars.githubTokenEnvVar,
          GITHUB_OAUTH_ACCESS_TOKEN_KEY,
        )}\n`,
      );
      this.writeStdout(
        `${this.formatAuthProviderStatusLine(
          'linear',
          tokenEnvVars.linearTokenEnvVar,
          LINEAR_OAUTH_ACCESS_TOKEN_KEY,
        )}\n`,
      );
      return 0;
    }
    if (command.type === 'login') {
      if (command.provider === 'github') {
        await this.loginGitHubWithOAuthDeviceFlow(command);
        return 0;
      }
      await this.loginLinearWithOAuthPkce(command);
      return 0;
    }
    if (command.type === 'refresh') {
      const providers: readonly AuthProvider[] =
        command.provider === 'all' ? ['github', 'linear'] : [command.provider];
      let hadFailure = false;
      for (const provider of providers) {
        if (provider === 'github') {
          this.writeStdout(
            'github oauth refresh: skipped (device-flow tokens do not guarantee refresh support)\n',
          );
          continue;
        }
        try {
          const result = await this.refreshLinearOauthToken({
            force: true,
            timeoutMs: DEFAULT_AUTH_TIMEOUT_MS,
          });
          if (result.refreshed) {
            this.writeStdout('linear oauth refresh: refreshed\n');
            continue;
          }
          this.writeStdout(
            `linear oauth refresh: skipped (${result.skippedReason ?? 'unknown'})\n`,
          );
        } catch (error: unknown) {
          hadFailure = true;
          this.writeStderr(
            `linear oauth refresh failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
      return hadFailure ? 1 : 0;
    }
    const providers: readonly AuthProvider[] =
      command.provider === 'all' ? ['github', 'linear'] : [command.provider];
    const keysToRemove: string[] = [];
    for (const provider of providers) {
      if (provider === 'github') {
        keysToRemove.push(
          GITHUB_OAUTH_ACCESS_TOKEN_KEY,
          GITHUB_OAUTH_REFRESH_TOKEN_KEY,
          GITHUB_OAUTH_EXPIRES_AT_KEY,
        );
      } else {
        keysToRemove.push(
          LINEAR_OAUTH_ACCESS_TOKEN_KEY,
          LINEAR_OAUTH_REFRESH_TOKEN_KEY,
          LINEAR_OAUTH_EXPIRES_AT_KEY,
        );
      }
    }
    const removed = this.removeHarnessSecrets(keysToRemove);
    this.writeStdout(
      `auth logout complete: providers=${providers.join(',')} removed=${String(removed.removedCount)} file=${removed.filePath}\n`,
    );
    return 0;
  }

  public async refreshLinearOauthTokenBeforeGatewayStart(): Promise<void> {
    try {
      const tokenEnvVars = this.resolveIntegrationTokenEnvVars();
      const manualToken = this.env[tokenEnvVars.linearTokenEnvVar];
      if (typeof manualToken === 'string' && manualToken.trim().length > 0) {
        return;
      }
      const result = await this.refreshLinearOauthToken({
        force: false,
        timeoutMs: 10_000,
      });
      if (result.refreshed) {
        this.writeStdout('[auth] linear oauth token refreshed before gateway start\n');
      }
    } catch (error: unknown) {
      this.writeStderr(
        `[auth] linear oauth refresh skipped: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  private normalizeScopeList(rawValue: string | null | undefined, fallback: string): string {
    const candidate = typeof rawValue === 'string' ? rawValue : fallback;
    const tokens = candidate
      .split(/[\s,]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return fallback;
    }
    return [...new Set(tokens)].join(' ');
  }

  private readRequiredEnvValue(key: string): string {
    const value = this.env[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`missing required ${key}`);
    }
    return value.trim();
  }

  private parseOptionalIsoTimestamp(value: string | null | undefined): number | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isTokenNearExpiry(expiresAtMs: number | null, skewMs = 60_000): boolean {
    if (expiresAtMs === null) {
      return false;
    }
    return Date.now() + skewMs >= expiresAtMs;
  }

  private expiresAtFromExpiresIn(rawExpiresIn: unknown): string | null {
    if (typeof rawExpiresIn !== 'number' || !Number.isFinite(rawExpiresIn) || rawExpiresIn <= 0) {
      return null;
    }
    const expiresMs = Math.floor(rawExpiresIn * 1000);
    return new Date(Date.now() + expiresMs).toISOString();
  }

  private parseSecretLineKeyForDeletion(line: string): string | null {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      return null;
    }
    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trimStart()
      : trimmed;
    const equalIndex = withoutExport.indexOf('=');
    if (equalIndex <= 0) {
      return null;
    }
    return withoutExport.slice(0, equalIndex).trim();
  }

  private removeHarnessSecrets(keys: readonly string[]): {
    filePath: string;
    removedCount: number;
  } {
    const uniqueKeys = [...new Set(keys)].filter((key) => key.length > 0);
    const filePath = resolveHarnessSecretsPath(this.invocationDirectory, undefined, this.env);
    if (uniqueKeys.length === 0) {
      return {
        filePath,
        removedCount: 0,
      };
    }
    let removedCount = 0;
    if (existsSync(filePath)) {
      const sourceText = readFileSync(filePath, 'utf8');
      const sourceLines = sourceText.split(/\r?\n/u);
      const nextLines: string[] = [];
      for (const line of sourceLines) {
        const key = this.parseSecretLineKeyForDeletion(line);
        if (key !== null && uniqueKeys.includes(key)) {
          removedCount += 1;
          continue;
        }
        nextLines.push(line);
      }
      while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
        nextLines.pop();
      }
      this.infra.writeTextFileAtomically(filePath, `${nextLines.join('\n')}\n`);
    }
    for (const key of uniqueKeys) {
      delete this.env[key];
      delete process.env[key];
    }
    return {
      filePath,
      removedCount,
    };
  }

  private upsertHarnessSecretValue(key: string, value: string): void {
    upsertHarnessSecret({
      cwd: this.invocationDirectory,
      env: this.env,
      key,
      value,
    });
    this.env[key] = value;
    process.env[key] = value;
  }

  private tryOpenBrowserUrl(url: string): void {
    const commandOverride =
      typeof this.env.HARNESS_AUTH_BROWSER_COMMAND === 'string' &&
      this.env.HARNESS_AUTH_BROWSER_COMMAND.trim().length > 0
        ? this.env.HARNESS_AUTH_BROWSER_COMMAND.trim()
        : null;
    const child =
      commandOverride !== null
        ? spawn(commandOverride, [url], {
            detached: true,
            stdio: 'ignore',
            env: this.env,
          })
        : process.platform === 'darwin'
          ? spawn('open', [url], {
              detached: true,
              stdio: 'ignore',
              env: this.env,
            })
          : process.platform === 'win32'
            ? spawn('cmd', ['/c', 'start', '', url], {
                detached: true,
                stdio: 'ignore',
                env: this.env,
              })
            : spawn('xdg-open', [url], {
                detached: true,
                stdio: 'ignore',
                env: this.env,
              });
    child.once('error', () => undefined);
    child.unref();
  }

  private async fetchJsonRecord(
    url: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const timeoutMs = init.timeoutMs ?? 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let parsed: unknown = {};
    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch (error: unknown) {
        throw new Error(
          `oauth endpoint returned non-json payload (${response.status}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (!response.ok) {
      const message =
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>)['error_description'] === 'string'
          ? ((parsed as Record<string, unknown>)['error_description'] as string)
          : text || response.statusText;
      throw new Error(`oauth request failed (${response.status}): ${message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('oauth endpoint returned malformed payload');
    }
    return parsed as Record<string, unknown>;
  }

  private asStringField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private resolveGitHubDeviceCodeUrl(): string {
    if (
      typeof this.env.HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL === 'string' &&
      this.env.HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL.trim().length > 0
    ) {
      return this.env.HARNESS_GITHUB_OAUTH_DEVICE_CODE_URL.trim();
    }
    const base =
      typeof this.env.HARNESS_GITHUB_OAUTH_BASE_URL === 'string' &&
      this.env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().length > 0
        ? this.env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().replace(/\/+$/u, '')
        : DEFAULT_GITHUB_DEVICE_BASE_URL;
    return `${base}/login/device/code`;
  }

  private resolveGitHubOauthTokenUrl(): string {
    if (
      typeof this.env.HARNESS_GITHUB_OAUTH_TOKEN_URL === 'string' &&
      this.env.HARNESS_GITHUB_OAUTH_TOKEN_URL.trim().length > 0
    ) {
      return this.env.HARNESS_GITHUB_OAUTH_TOKEN_URL.trim();
    }
    const base =
      typeof this.env.HARNESS_GITHUB_OAUTH_BASE_URL === 'string' &&
      this.env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().length > 0
        ? this.env.HARNESS_GITHUB_OAUTH_BASE_URL.trim().replace(/\/+$/u, '')
        : DEFAULT_GITHUB_DEVICE_BASE_URL;
    return `${base}/login/oauth/access_token`;
  }

  private resolveLinearAuthorizeUrl(): string {
    if (
      typeof this.env.HARNESS_LINEAR_OAUTH_AUTHORIZE_URL === 'string' &&
      this.env.HARNESS_LINEAR_OAUTH_AUTHORIZE_URL.trim().length > 0
    ) {
      return this.env.HARNESS_LINEAR_OAUTH_AUTHORIZE_URL.trim();
    }
    return DEFAULT_LINEAR_AUTHORIZE_URL;
  }

  private resolveLinearTokenUrl(): string {
    if (
      typeof this.env.HARNESS_LINEAR_OAUTH_TOKEN_URL === 'string' &&
      this.env.HARNESS_LINEAR_OAUTH_TOKEN_URL.trim().length > 0
    ) {
      return this.env.HARNESS_LINEAR_OAUTH_TOKEN_URL.trim();
    }
    return DEFAULT_LINEAR_TOKEN_URL;
  }

  private resolveLinearOauthCallbackPort(command: ParsedAuthLoginCommand): number {
    if (command.callbackPort !== null) {
      return command.callbackPort;
    }
    const configured = this.env.HARNESS_LINEAR_OAUTH_CALLBACK_PORT;
    if (typeof configured !== 'string' || configured.trim().length === 0) {
      return 0;
    }
    return parseOauthCallbackPort(configured, 'HARNESS_LINEAR_OAUTH_CALLBACK_PORT');
  }

  private createPkceVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  private createPkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private resolveIntegrationTokenEnvVars(): {
    githubTokenEnvVar: string;
    linearTokenEnvVar: string;
  } {
    const loaded = loadHarnessConfig({
      cwd: this.invocationDirectory,
      env: this.env,
    });
    return {
      githubTokenEnvVar: loaded.config.github.tokenEnvVar,
      linearTokenEnvVar: loaded.config.linear.tokenEnvVar,
    };
  }

  private async loginGitHubWithOAuthDeviceFlow(command: ParsedAuthLoginCommand): Promise<void> {
    const clientId = this.readRequiredEnvValue('HARNESS_GITHUB_OAUTH_CLIENT_ID');
    const clientSecret =
      typeof this.env.HARNESS_GITHUB_OAUTH_CLIENT_SECRET === 'string' &&
      this.env.HARNESS_GITHUB_OAUTH_CLIENT_SECRET.trim().length > 0
        ? this.env.HARNESS_GITHUB_OAUTH_CLIENT_SECRET.trim()
        : null;
    const scopes = this.normalizeScopeList(
      command.scopes ?? this.env.HARNESS_GITHUB_OAUTH_SCOPES,
      DEFAULT_GITHUB_OAUTH_SCOPE,
    );
    const deviceCodePayload = await this.fetchJsonRecord(this.resolveGitHubDeviceCodeUrl(), {
      method: 'POST',
      timeoutMs: command.timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: scopes,
      }).toString(),
    });
    const deviceCode = this.asStringField(deviceCodePayload, 'device_code');
    const userCode = this.asStringField(deviceCodePayload, 'user_code');
    const verificationUri = this.asStringField(deviceCodePayload, 'verification_uri');
    const verificationUriComplete =
      this.asStringField(deviceCodePayload, 'verification_uri_complete') ?? verificationUri;
    const expiresInRaw = deviceCodePayload['expires_in'];
    const expiresIn =
      typeof expiresInRaw === 'number' && Number.isFinite(expiresInRaw) && expiresInRaw > 0
        ? expiresInRaw
        : 900;
    const intervalRaw = deviceCodePayload['interval'];
    let intervalMs =
      typeof intervalRaw === 'number' && Number.isFinite(intervalRaw) && intervalRaw > 0
        ? Math.floor(intervalRaw * 1000)
        : 5000;
    if (deviceCode === null || userCode === null || verificationUri === null) {
      throw new Error('github oauth device-code response malformed');
    }

    this.writeStdout(`github oauth user code: ${userCode}\n`);
    this.writeStdout(`github oauth verify url: ${verificationUri}\n`);
    if (verificationUriComplete !== null) {
      this.writeStdout(`github oauth direct url: ${verificationUriComplete}\n`);
      if (!command.noBrowser) {
        this.tryOpenBrowserUrl(verificationUriComplete);
      }
    }

    const pollDeadlineMs = Date.now() + Math.min(command.timeoutMs, Math.floor(expiresIn * 1000));
    let tokenPayload: Record<string, unknown> | null = null;
    while (Date.now() <= pollDeadlineMs) {
      await delay(intervalMs);
      const candidatePayload = await this.fetchJsonRecord(this.resolveGitHubOauthTokenUrl(), {
        method: 'POST',
        timeoutMs: command.timeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          ...(clientSecret === null ? {} : { client_secret: clientSecret }),
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      });
      const accessToken = this.asStringField(candidatePayload, 'access_token');
      if (accessToken !== null) {
        tokenPayload = candidatePayload;
        break;
      }
      const errorCode = this.asStringField(candidatePayload, 'error');
      if (errorCode === 'authorization_pending') {
        continue;
      }
      if (errorCode === 'slow_down') {
        intervalMs = Math.min(30_000, intervalMs + 5000);
        continue;
      }
      if (errorCode !== null) {
        const description =
          this.asStringField(candidatePayload, 'error_description') ??
          this.asStringField(candidatePayload, 'error_uri') ??
          'oauth device login failed';
        throw new Error(`github oauth login failed (${errorCode}): ${description}`);
      }
    }
    if (tokenPayload === null) {
      throw new Error('timed out waiting for github oauth authorization');
    }

    const accessToken = this.asStringField(tokenPayload, 'access_token');
    if (accessToken === null) {
      throw new Error('github oauth token response missing access_token');
    }
    const refreshToken = this.asStringField(tokenPayload, 'refresh_token');
    const expiresAt = this.expiresAtFromExpiresIn(tokenPayload['expires_in']);
    this.upsertHarnessSecretValue('HARNESS_GITHUB_OAUTH_CLIENT_ID', clientId);
    this.upsertHarnessSecretValue(GITHUB_OAUTH_ACCESS_TOKEN_KEY, accessToken);
    if (refreshToken !== null) {
      this.upsertHarnessSecretValue(GITHUB_OAUTH_REFRESH_TOKEN_KEY, refreshToken);
    } else {
      this.removeHarnessSecrets([GITHUB_OAUTH_REFRESH_TOKEN_KEY]);
    }
    if (expiresAt !== null) {
      this.upsertHarnessSecretValue(GITHUB_OAUTH_EXPIRES_AT_KEY, expiresAt);
    } else {
      this.removeHarnessSecrets([GITHUB_OAUTH_EXPIRES_AT_KEY]);
    }
    this.writeStdout(
      `github oauth login complete: token saved to ${GITHUB_OAUTH_ACCESS_TOKEN_KEY}\n`,
    );
  }

  private async waitForLinearOauthCodeViaCallback(
    clientId: string,
    scopes: string,
    timeoutMs: number,
    noBrowser: boolean,
    preferredCallbackPort: number,
  ): Promise<{ code: string; redirectUri: string; verifier: string }> {
    const verifier = this.createPkceVerifier();
    const challenge = this.createPkceChallenge(verifier);
    const state = randomUUID();
    const authorizeBaseUrl = this.resolveLinearAuthorizeUrl();
    return await new Promise<{ code: string; redirectUri: string; verifier: string }>(
      (resolveCode, rejectCode) => {
        let settled = false;
        let attemptedDynamicFallback = preferredCallbackPort === 0;
        const server = createHttpServer((request, response) => {
          const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
          if (requestUrl.pathname !== '/oauth/callback') {
            response.statusCode = 404;
            response.end('Not found');
            return;
          }
          const code = requestUrl.searchParams.get('code');
          const receivedState = requestUrl.searchParams.get('state');
          if (receivedState !== state) {
            response.statusCode = 400;
            response.end('State mismatch');
            finish(new Error('linear oauth callback state mismatch'));
            return;
          }
          if (code === null || code.trim().length === 0) {
            response.statusCode = 400;
            response.end('Missing code');
            finish(new Error('linear oauth callback missing code'));
            return;
          }
          response.statusCode = 200;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(
            '<html><body><h3>Harness Linear OAuth complete</h3><p>You can close this tab.</p></body></html>',
          );
          finish(null, {
            code: code.trim(),
            redirectUri,
            verifier,
          });
        });
        const finish = (
          error: Error | null,
          result?: { code: string; redirectUri: string; verifier: string },
        ): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutHandle);
          server.off('error', onListenError);
          server.close(() => {
            if (error !== null) {
              rejectCode(error);
              return;
            }
            if (result === undefined) {
              rejectCode(new Error('linear oauth callback failed without result'));
              return;
            }
            resolveCode(result);
          });
        };
        const onListening = (): void => {
          const address = server.address();
          if (address === null || typeof address === 'string') {
            finish(new Error('unable to determine linear oauth callback address'));
            return;
          }
          redirectUri = `http://127.0.0.1:${String(address.port)}/oauth/callback`;
          const authorizeUrl = new URL(authorizeBaseUrl);
          authorizeUrl.searchParams.set('response_type', 'code');
          authorizeUrl.searchParams.set('client_id', clientId);
          authorizeUrl.searchParams.set('redirect_uri', redirectUri);
          authorizeUrl.searchParams.set('scope', scopes);
          authorizeUrl.searchParams.set('state', state);
          authorizeUrl.searchParams.set('code_challenge', challenge);
          authorizeUrl.searchParams.set('code_challenge_method', 'S256');
          const authorizeUrlText = authorizeUrl.toString();
          this.writeStdout(`linear oauth authorize url: ${authorizeUrlText}\n`);
          if (!noBrowser) {
            this.tryOpenBrowserUrl(authorizeUrlText);
          }
        };
        const onListenError = (error: Error): void => {
          const typedError = error as NodeJS.ErrnoException;
          if (!attemptedDynamicFallback && typedError.code === 'EADDRINUSE') {
            attemptedDynamicFallback = true;
            this.writeStdout(
              `linear oauth callback port ${String(preferredCallbackPort)} in use, retrying with dynamic port\n`,
            );
            server.listen(0, '127.0.0.1', onListening);
            return;
          }
          finish(typedError);
        };
        server.on('error', onListenError);
        const timeoutHandle = setTimeout(() => {
          finish(new Error('timed out waiting for linear oauth callback'));
        }, timeoutMs);
        timeoutHandle.unref();
        let redirectUri = '';
        server.listen(preferredCallbackPort, '127.0.0.1', onListening);
      },
    );
  }

  private async loginLinearWithOAuthPkce(command: ParsedAuthLoginCommand): Promise<void> {
    const clientId = this.readRequiredEnvValue('HARNESS_LINEAR_OAUTH_CLIENT_ID');
    const clientSecret =
      typeof this.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET === 'string' &&
      this.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim().length > 0
        ? this.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim()
        : null;
    const scopes = this.normalizeScopeList(
      command.scopes ?? this.env.HARNESS_LINEAR_OAUTH_SCOPES,
      DEFAULT_LINEAR_OAUTH_SCOPE,
    );
    const callbackPort = this.resolveLinearOauthCallbackPort(command);
    const callback = await this.waitForLinearOauthCodeViaCallback(
      clientId,
      scopes,
      command.timeoutMs,
      command.noBrowser,
      callbackPort,
    );
    const tokenPayload = await this.fetchJsonRecord(this.resolveLinearTokenUrl(), {
      method: 'POST',
      timeoutMs: command.timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        ...(clientSecret === null ? {} : { client_secret: clientSecret }),
        code: callback.code,
        redirect_uri: callback.redirectUri,
        code_verifier: callback.verifier,
      }),
    });
    const accessToken = this.asStringField(tokenPayload, 'access_token');
    if (accessToken === null) {
      throw new Error('linear oauth token response missing access_token');
    }
    const refreshToken = this.asStringField(tokenPayload, 'refresh_token');
    const expiresAt = this.expiresAtFromExpiresIn(tokenPayload['expires_in']);
    this.upsertHarnessSecretValue('HARNESS_LINEAR_OAUTH_CLIENT_ID', clientId);
    this.upsertHarnessSecretValue(LINEAR_OAUTH_ACCESS_TOKEN_KEY, accessToken);
    if (refreshToken !== null) {
      this.upsertHarnessSecretValue(LINEAR_OAUTH_REFRESH_TOKEN_KEY, refreshToken);
    } else {
      this.removeHarnessSecrets([LINEAR_OAUTH_REFRESH_TOKEN_KEY]);
    }
    if (expiresAt !== null) {
      this.upsertHarnessSecretValue(LINEAR_OAUTH_EXPIRES_AT_KEY, expiresAt);
    } else {
      this.removeHarnessSecrets([LINEAR_OAUTH_EXPIRES_AT_KEY]);
    }
    this.writeStdout(
      `linear oauth login complete: token saved to ${LINEAR_OAUTH_ACCESS_TOKEN_KEY}\n`,
    );
  }

  private async refreshLinearOauthToken(
    options: RefreshLinearOauthTokenOptions,
  ): Promise<RefreshLinearOauthTokenResult> {
    const refreshToken = this.env[LINEAR_OAUTH_REFRESH_TOKEN_KEY];
    if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
      return {
        refreshed: false,
        skippedReason: 'missing linear oauth refresh token',
      };
    }
    const expiresAt = this.parseOptionalIsoTimestamp(this.env[LINEAR_OAUTH_EXPIRES_AT_KEY]);
    if (!options.force && !this.isTokenNearExpiry(expiresAt)) {
      return {
        refreshed: false,
        skippedReason: 'linear oauth token still valid',
      };
    }
    const clientId = this.readRequiredEnvValue('HARNESS_LINEAR_OAUTH_CLIENT_ID');
    const clientSecret =
      typeof this.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET === 'string' &&
      this.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim().length > 0
        ? this.env.HARNESS_LINEAR_OAUTH_CLIENT_SECRET.trim()
        : null;
    const tokenPayload = await this.fetchJsonRecord(this.resolveLinearTokenUrl(), {
      method: 'POST',
      timeoutMs: options.timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        ...(clientSecret === null ? {} : { client_secret: clientSecret }),
        refresh_token: refreshToken.trim(),
      }),
    });
    const accessToken = this.asStringField(tokenPayload, 'access_token');
    if (accessToken === null) {
      throw new Error('linear oauth refresh response missing access_token');
    }
    const nextRefreshToken =
      this.asStringField(tokenPayload, 'refresh_token') ?? refreshToken.trim();
    const nextExpiresAt = this.expiresAtFromExpiresIn(tokenPayload['expires_in']);
    this.upsertHarnessSecretValue(LINEAR_OAUTH_ACCESS_TOKEN_KEY, accessToken);
    this.upsertHarnessSecretValue(LINEAR_OAUTH_REFRESH_TOKEN_KEY, nextRefreshToken);
    if (nextExpiresAt !== null) {
      this.upsertHarnessSecretValue(LINEAR_OAUTH_EXPIRES_AT_KEY, nextExpiresAt);
    }
    return {
      refreshed: true,
      skippedReason: null,
    };
  }

  private formatAuthProviderStatusLine(
    provider: AuthProvider,
    manualTokenEnvVar: string,
    oauthAccessTokenEnvVar: string,
  ): string {
    const manualToken = this.env[manualTokenEnvVar];
    const oauthAccessToken = this.env[oauthAccessTokenEnvVar];
    const manualPresent = typeof manualToken === 'string' && manualToken.trim().length > 0;
    const oauthPresent = typeof oauthAccessToken === 'string' && oauthAccessToken.trim().length > 0;
    const activeSource = manualPresent ? 'manual' : oauthPresent ? 'oauth' : 'none';
    const refreshKey =
      provider === 'github' ? GITHUB_OAUTH_REFRESH_TOKEN_KEY : LINEAR_OAUTH_REFRESH_TOKEN_KEY;
    const expiresKey =
      provider === 'github' ? GITHUB_OAUTH_EXPIRES_AT_KEY : LINEAR_OAUTH_EXPIRES_AT_KEY;
    const refreshPresent =
      typeof this.env[refreshKey] === 'string' &&
      (this.env[refreshKey] as string).trim().length > 0;
    const expiresAt = this.env[expiresKey];
    const expiresText =
      typeof expiresAt === 'string' && expiresAt.trim().length > 0 ? expiresAt.trim() : 'n/a';
    return `${provider}: ${activeSource === 'none' ? 'disconnected' : 'connected'} active=${activeSource} manualEnvVar=${manualTokenEnvVar} oauthEnvVar=${oauthAccessTokenEnvVar} refresh=${refreshPresent ? 'yes' : 'no'} expiresAt=${expiresText}`;
  }
}

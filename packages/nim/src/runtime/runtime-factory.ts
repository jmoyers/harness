import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createAnthropicNimProviderDriver,
  createSqliteBackedNimRuntime,
  NimProviderRouter,
  type NimModelRef,
  type NimRuntime,
} from '../../../nim-core/src/index.ts';
import { resolveHarnessRuntimePath } from '../../../../src/config/harness-paths.ts';
import {
  NIM_CONTROL_PLANE_AUTH_TOKEN_ENV,
  NIM_CONTROL_PLANE_HOST_ENV,
  NIM_CONTROL_PLANE_PORT_ENV,
} from '../../../../src/contracts/nim-control-plane.ts';
import { createRuntimeNimControlPlaneApi } from '../../../../src/services/runtime-nim-control-plane-api.ts';
import { RuntimeNimToolBridge } from '../../../../src/services/runtime-nim-tool-bridge.ts';

export interface NimRuntimeHandle {
  readonly runtime: NimRuntime;
  readonly model: NimModelRef;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly requiredApiKey:
    | {
        readonly envVar: 'ANTHROPIC_API_KEY';
        readonly displayName: 'Anthropic API Key';
      }
    | null;
  hasRequiredApiKey(): boolean;
  configureRequiredApiKey(apiKey: string): void;
  close(): void;
}

export interface CreateRuntimeFromEnvInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly sessionName?: string | null;
  readonly model?: NimModelRef;
  readonly liveAnthropic?: boolean;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly eventStorePath?: string;
  readonly sessionStorePath?: string;
  readonly telemetryPath?: string | null;
  readonly baseUrl?: string;
  readonly controlPlaneHost?: string;
  readonly controlPlanePort?: number;
  readonly controlPlaneAuthToken?: string | null;
}

const DEFAULT_LIVE_MODEL: NimModelRef = 'anthropic/claude-sonnet-4-20250514';
const DEFAULT_MOCK_MODEL: NimModelRef = 'mock/echo';
const DEFAULT_TENANT_ID = 'nim-standalone';
const DEFAULT_USER_ID = 'user';
const DEFAULT_WORKSPACE_ID = 'workspace-local';

function providerIdFromModel(model: NimModelRef): string {
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0) {
    return 'mock';
  }
  return model.slice(0, slashIndex);
}

function resolveRuntimePaths(
  input: CreateRuntimeFromEnvInput,
  env: NodeJS.ProcessEnv,
): {
  readonly eventStorePath: string;
  readonly sessionStorePath: string;
  readonly telemetryPath: string | null;
} {
  const cwd = input.cwd ?? process.cwd();
  const sessionName = input.sessionName ?? null;
  const runtimeRoot =
    sessionName === null ? '.harness/nim' : `.harness/sessions/${sessionName}/nim`;
  const eventStorePath =
    input.eventStorePath === undefined
      ? resolveHarnessRuntimePath(cwd, `${runtimeRoot}/events.sqlite`, env)
      : resolve(cwd, input.eventStorePath);
  const sessionStorePath =
    input.sessionStorePath === undefined
      ? resolveHarnessRuntimePath(cwd, `${runtimeRoot}/sessions.sqlite`, env)
      : resolve(cwd, input.sessionStorePath);
  const telemetryPath =
    input.telemetryPath === undefined
      ? resolveHarnessRuntimePath(cwd, `${runtimeRoot}/events.jsonl`, env)
      : input.telemetryPath === null
        ? null
        : resolve(cwd, input.telemetryPath);
  return {
    eventStorePath,
    sessionStorePath,
    telemetryPath,
  };
}

function resolveRuntimeModel(input: CreateRuntimeFromEnvInput, env: NodeJS.ProcessEnv): NimModelRef {
  if (input.model !== undefined) {
    return input.model;
  }
  if (input.liveAnthropic === false) {
    return DEFAULT_MOCK_MODEL;
  }
  const envModel = env.HARNESS_NIM_MODEL;
  if (typeof envModel === 'string' && envModel.trim().length > 0) {
    return envModel as NimModelRef;
  }
  return DEFAULT_LIVE_MODEL;
}

function readEnvString(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parsePositivePort(value: unknown): number | null {
  if (typeof value !== 'number') {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    return null;
  }
  return value;
}

function parsePositivePortFromString(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return parsePositivePort(parsed);
}

function resolveRuntimeScope(
  input: CreateRuntimeFromEnvInput,
): {
  tenantId: string;
  userId: string;
  workspaceId: string;
} {
  return {
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    userId: input.userId ?? DEFAULT_USER_ID,
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
  };
}

function resolveControlPlaneConfig(
  input: CreateRuntimeFromEnvInput,
  env: NodeJS.ProcessEnv,
): {
  host: string;
  port: number;
  authToken?: string;
} | null {
  const host = input.controlPlaneHost ?? readEnvString(env, NIM_CONTROL_PLANE_HOST_ENV);
  const port =
    parsePositivePort(input.controlPlanePort) ??
    parsePositivePortFromString(readEnvString(env, NIM_CONTROL_PLANE_PORT_ENV));
  if (host === null || port === null) {
    return null;
  }
  const authToken =
    input.controlPlaneAuthToken === null
      ? null
      : input.controlPlaneAuthToken ?? readEnvString(env, NIM_CONTROL_PLANE_AUTH_TOKEN_ENV);
  return {
    host,
    port,
    ...(authToken === null ? {} : { authToken }),
  };
}

export function createRuntimeFromEnv(input: CreateRuntimeFromEnvInput = {}): NimRuntimeHandle {
  const env = input.env ?? process.env;
  const liveAnthropic = input.liveAnthropic ?? true;
  const runtimeScope = resolveRuntimeScope(input);
  const model = resolveRuntimeModel(input, env);
  const providerId = providerIdFromModel(model);
  const requiresAnthropicApiKey = providerId === 'anthropic';

  if (liveAnthropic && providerId !== 'anthropic') {
    throw new Error(
      `live provider mode requires anthropic model ref until additional drivers are implemented; got ${model}`,
    );
  }

  const controlPlaneConfig = resolveControlPlaneConfig(input, env);
  const controlPlaneApi =
    controlPlaneConfig === null
      ? null
      : createRuntimeNimControlPlaneApi({
          host: controlPlaneConfig.host,
          port: controlPlaneConfig.port,
          ...(controlPlaneConfig.authToken === undefined
            ? {}
            : { authToken: controlPlaneConfig.authToken }),
          tenantId: runtimeScope.tenantId,
          userId: runtimeScope.userId,
          workspaceId: runtimeScope.workspaceId,
        });
  const controlPlaneToolBridge =
    controlPlaneApi === null
      ? null
      : new RuntimeNimToolBridge({
          listDirectories: async () => await controlPlaneApi.listDirectories(),
          listRepositories: async () => await controlPlaneApi.listRepositories(),
          listTasks: async (limit) => await controlPlaneApi.listTasks(limit),
          listThreads: async (query) => await controlPlaneApi.listThreads(query),
          createThread: async (toolInput) => await controlPlaneApi.createThread(toolInput),
          updateThread: async (toolInput) => await controlPlaneApi.updateThread(toolInput),
          archiveThread: async (threadId) => await controlPlaneApi.archiveThread(threadId),
          deleteThread: async (threadId) => await controlPlaneApi.deleteThread(threadId),
          threadStatus: async (threadId) => await controlPlaneApi.threadStatus(threadId),
          threadSnapshot: async (toolInput) => await controlPlaneApi.threadSnapshot(toolInput),
          threadRespond: async (toolInput) => await controlPlaneApi.threadRespond(toolInput),
          threadInterrupt: async (threadId) => await controlPlaneApi.threadInterrupt(threadId),
          threadClaim: async (toolInput) =>
            await controlPlaneApi.threadClaim({
              sessionId: toolInput.threadId,
              controllerId: toolInput.controllerId,
              controllerType: toolInput.controllerType,
              ...(toolInput.controllerLabel === undefined
                ? {}
                : { controllerLabel: toolInput.controllerLabel }),
              ...(toolInput.reason === undefined ? {} : { reason: toolInput.reason }),
              ...(toolInput.takeover === undefined ? {} : { takeover: toolInput.takeover }),
            }),
          threadRelease: async (toolInput) => await controlPlaneApi.threadRelease(toolInput),
          threadStart: async (toolInput) => await controlPlaneApi.threadStart(toolInput),
          threadAttach: async (toolInput) => await controlPlaneApi.threadAttach(toolInput),
          threadDetach: async (threadId) => await controlPlaneApi.threadDetach(threadId),
          threadSubscribeEvents: async (threadId) =>
            await controlPlaneApi.threadSubscribeEvents(threadId),
          threadUnsubscribeEvents: async (threadId) =>
            await controlPlaneApi.threadUnsubscribeEvents(threadId),
          threadClose: async (threadId) => await controlPlaneApi.threadClose(threadId),
          threadRemove: async (threadId) => await controlPlaneApi.threadRemove(threadId),
          listSessions: async () => await controlPlaneApi.listSessions(),
          defaultControllerId: `nim:${runtimeScope.userId}`,
          defaultControllerLabel: 'nim',
        });

  const providerRouter = new NimProviderRouter();
  let requiredApiKeyConfigured = !requiresAnthropicApiKey;
  const registerAnthropicDriver = (apiKey: string): void => {
    providerRouter.registerDriver(
      createAnthropicNimProviderDriver({
        apiKey,
        ...(input.baseUrl === undefined
          ? {}
          : {
              baseUrl: input.baseUrl,
            }),
        ...(controlPlaneToolBridge === null
          ? {}
          : {
              executeTool: async (toolInput) =>
                await controlPlaneToolBridge.invoke({
                  toolName: toolInput.toolName,
                  argumentsValue: toolInput.toolInput,
                }),
            }),
      }),
    );
    requiredApiKeyConfigured = true;
  };
  if (requiresAnthropicApiKey) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey.trim().length === 0) {
      requiredApiKeyConfigured = false;
    } else {
      registerAnthropicDriver(apiKey.trim());
    }
  }

  const paths = resolveRuntimePaths(input, env);
  if (paths.telemetryPath !== null) {
    mkdirSync(dirname(paths.telemetryPath), { recursive: true });
    writeFileSync(paths.telemetryPath, '', {
      flag: 'a',
      encoding: 'utf8',
    });
  }
  const runtimeHandle = createSqliteBackedNimRuntime({
    eventStorePath: paths.eventStorePath,
    sessionStorePath: paths.sessionStorePath,
    ...(paths.telemetryPath === null
      ? {}
      : {
          telemetry: {
            filePath: paths.telemetryPath,
            mode: 'append',
          },
        }),
    providerRouter,
  });
  runtimeHandle.runtime.registerProvider({
    id: providerId,
    displayName: providerId === 'anthropic' ? 'Anthropic' : 'Mock',
    models: [model],
  });
  if (controlPlaneToolBridge !== null) {
    controlPlaneToolBridge.registerWithRuntime(runtimeHandle.runtime);
  }

  return {
    runtime: runtimeHandle.runtime,
    model,
    tenantId: runtimeScope.tenantId,
    userId: runtimeScope.userId,
    workspaceId: runtimeScope.workspaceId,
    requiredApiKey:
      requiresAnthropicApiKey
        ? {
            envVar: 'ANTHROPIC_API_KEY',
            displayName: 'Anthropic API Key',
          }
        : null,
    hasRequiredApiKey: () => requiredApiKeyConfigured,
    configureRequiredApiKey: (apiKey) => {
      if (!requiresAnthropicApiKey) {
        return;
      }
      const trimmed = apiKey.trim();
      if (trimmed.length === 0) {
        throw new Error('API key is required');
      }
      registerAnthropicDriver(trimmed);
    },
    close: () => {
      runtimeHandle.close();
      if (controlPlaneApi !== null) {
        void controlPlaneApi.close().catch(() => {});
      }
    },
  };
}

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

export interface NimRuntimeHandle {
  readonly runtime: NimRuntime;
  readonly model: NimModelRef;
  readonly tenantId: string;
  readonly userId: string;
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
  readonly eventStorePath?: string;
  readonly sessionStorePath?: string;
  readonly telemetryPath?: string | null;
  readonly baseUrl?: string;
}

const DEFAULT_LIVE_MODEL: NimModelRef = 'anthropic/claude-sonnet-4-20250514';
const DEFAULT_MOCK_MODEL: NimModelRef = 'mock/echo';
const DEFAULT_TENANT_ID = 'nim-standalone';
const DEFAULT_USER_ID = 'user';

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

export function createRuntimeFromEnv(input: CreateRuntimeFromEnvInput = {}): NimRuntimeHandle {
  const env = input.env ?? process.env;
  const liveAnthropic = input.liveAnthropic ?? true;
  const model = resolveRuntimeModel(input, env);
  const providerId = providerIdFromModel(model);

  if (liveAnthropic && providerId !== 'anthropic') {
    throw new Error(
      `live provider mode requires anthropic model ref until additional drivers are implemented; got ${model}`,
    );
  }

  const providerRouter = new NimProviderRouter();
  if (liveAnthropic) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey.trim().length === 0) {
      throw new Error(
        'ANTHROPIC_API_KEY not found in ~/.harness/secrets.env or environment. ' +
          'Run: echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/.harness/secrets.env',
      );
    }
    providerRouter.registerDriver(
      createAnthropicNimProviderDriver({
        apiKey: apiKey.trim(),
        ...(input.baseUrl === undefined
          ? {}
          : {
              baseUrl: input.baseUrl,
            }),
      }),
    );
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

  return {
    runtime: runtimeHandle.runtime,
    model,
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    userId: input.userId ?? DEFAULT_USER_ID,
    close: () => {
      runtimeHandle.close();
    },
  };
}

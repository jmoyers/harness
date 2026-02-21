import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GATEWAY_DB_PATH,
  resolveGatewayLockPath,
  resolveGatewayLogPath,
  resolveGatewayRecordPath,
  resolveInvocationDirectory,
} from '../gateway-record.ts';
import { loadHarnessConfig } from '../../config/config-core.ts';
import {
  resolveHarnessRuntimePath,
  resolveHarnessWorkspaceDirectory,
} from '../../config/harness-paths.ts';
import { migrateLegacyHarnessLayout } from '../../config/harness-runtime-migration.ts';
import { loadHarnessSecrets } from '../../config/secrets-core.ts';
import {
  resolveDefaultStatusTimelineOutputPath,
  resolveStatusTimelineStatePath,
} from '../../mux/live-mux/status-timeline-state.ts';
import {
  resolveDefaultRenderTraceOutputPath,
  resolveRenderTraceStatePath,
} from '../../mux/live-mux/render-trace-state.ts';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(MODULE_DIR, '../../..');

const DEFAULT_DAEMON_SCRIPT_PATH = resolve(PROJECT_ROOT, 'scripts/control-plane-daemon.ts');
const DEFAULT_MUX_SCRIPT_PATH = resolve(PROJECT_ROOT, 'scripts/harness-core.ts');

const DEFAULT_SESSION_ROOT_PATH = 'sessions';
const DEFAULT_PROFILE_ROOT_PATH = 'profiles';

interface RuntimeInspectOptions {
  readonly gatewayRuntimeArgs: readonly string[];
  readonly clientRuntimeArgs: readonly string[];
}

export interface HarnessRuntimeContext {
  readonly invocationDirectory: string;
  readonly daemonScriptPath: string;
  readonly muxScriptPath: string;
  readonly runtimeOptions: RuntimeInspectOptions;
  readonly sessionName: string | null;
  readonly gatewayRecordPath: string;
  readonly gatewayLogPath: string;
  readonly gatewayLockPath: string;
  readonly gatewayDefaultStateDbPath: string;
  readonly profileDir: string;
  readonly profileStatePath: string;
  readonly statusTimelineStatePath: string;
  readonly defaultStatusTimelineOutputPath: string;
  readonly renderTraceStatePath: string;
  readonly defaultRenderTraceOutputPath: string;
}

function resolveScriptPath(envValue: string | undefined, fallback: string, cwd: string): string {
  if (typeof envValue !== 'string' || envValue.trim().length === 0) {
    return fallback;
  }
  const trimmed = envValue.trim();
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  return resolve(cwd, trimmed);
}

function resolveInspectRuntimeOptions(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv,
): RuntimeInspectOptions {
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory, env });
  const debugConfig = loadedConfig.config.debug;
  if (!debugConfig.enabled || !debugConfig.inspect.enabled) {
    return {
      gatewayRuntimeArgs: [],
      clientRuntimeArgs: [],
    };
  }
  return {
    gatewayRuntimeArgs: [
      `--inspect=localhost:${String(debugConfig.inspect.gatewayPort)}/harness-gateway`,
    ],
    clientRuntimeArgs: [
      `--inspect=localhost:${String(debugConfig.inspect.clientPort)}/harness-client`,
    ],
  };
}

function resolveSessionPaths(
  invocationDirectory: string,
  sessionName: string | null,
  env: NodeJS.ProcessEnv,
): Pick<
  HarnessRuntimeContext,
  | 'gatewayRecordPath'
  | 'gatewayLogPath'
  | 'gatewayLockPath'
  | 'gatewayDefaultStateDbPath'
  | 'profileDir'
  | 'profileStatePath'
  | 'statusTimelineStatePath'
  | 'defaultStatusTimelineOutputPath'
  | 'renderTraceStatePath'
  | 'defaultRenderTraceOutputPath'
> {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  const statusTimelineStatePath = resolveStatusTimelineStatePath(
    invocationDirectory,
    sessionName,
    env,
  );
  const defaultStatusTimelineOutputPath = resolveDefaultStatusTimelineOutputPath(
    invocationDirectory,
    sessionName,
    env,
  );
  const renderTraceStatePath = resolveRenderTraceStatePath(invocationDirectory, sessionName, env);
  const defaultRenderTraceOutputPath = resolveDefaultRenderTraceOutputPath(
    invocationDirectory,
    sessionName,
    env,
  );
  if (sessionName === null) {
    return {
      gatewayRecordPath: resolveGatewayRecordPath(invocationDirectory, env),
      gatewayLogPath: resolveGatewayLogPath(invocationDirectory, env),
      gatewayLockPath: resolveGatewayLockPath(invocationDirectory, env),
      gatewayDefaultStateDbPath: resolveHarnessRuntimePath(
        invocationDirectory,
        DEFAULT_GATEWAY_DB_PATH,
        env,
      ),
      profileDir: resolve(workspaceDirectory, DEFAULT_PROFILE_ROOT_PATH),
      profileStatePath: resolve(workspaceDirectory, 'active-profile.json'),
      statusTimelineStatePath,
      defaultStatusTimelineOutputPath,
      renderTraceStatePath,
      defaultRenderTraceOutputPath,
    };
  }
  const sessionRoot = resolve(workspaceDirectory, DEFAULT_SESSION_ROOT_PATH, sessionName);
  return {
    gatewayRecordPath: resolve(sessionRoot, 'gateway.json'),
    gatewayLogPath: resolve(sessionRoot, 'gateway.log'),
    gatewayLockPath: resolve(sessionRoot, 'gateway.lock'),
    gatewayDefaultStateDbPath: resolve(sessionRoot, 'control-plane.sqlite'),
    profileDir: resolve(workspaceDirectory, DEFAULT_PROFILE_ROOT_PATH, sessionName),
    profileStatePath: resolve(sessionRoot, 'active-profile.json'),
    statusTimelineStatePath,
    defaultStatusTimelineOutputPath,
    renderTraceStatePath,
    defaultRenderTraceOutputPath,
  };
}

export class HarnessRuntimeContextFactory {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly cwd: string = process.cwd(),
    private readonly writeStdout: (text: string) => void = (text) => {
      process.stdout.write(text);
    },
  ) {}

  public create(sessionName: string | null): HarnessRuntimeContext {
    const invocationDirectory = resolveInvocationDirectory(this.env, this.cwd);
    const migration = migrateLegacyHarnessLayout(invocationDirectory, this.env);
    if (migration.migrated) {
      this.writeStdout(
        `[migration] local .harness migrated to global runtime layout (${String(migration.migratedEntries)} entries, configCopied=${String(migration.configCopied)}, secretsCopied=${String(migration.secretsCopied)}, legacyRootRemoved=${String(migration.legacyRootRemoved)})\n`,
      );
    }
    loadHarnessSecrets({ cwd: invocationDirectory, env: this.env });
    return {
      invocationDirectory,
      daemonScriptPath: resolveScriptPath(
        this.env.HARNESS_DAEMON_SCRIPT_PATH,
        DEFAULT_DAEMON_SCRIPT_PATH,
        invocationDirectory,
      ),
      muxScriptPath: resolveScriptPath(
        this.env.HARNESS_MUX_SCRIPT_PATH,
        DEFAULT_MUX_SCRIPT_PATH,
        invocationDirectory,
      ),
      runtimeOptions: resolveInspectRuntimeOptions(invocationDirectory, this.env),
      sessionName,
      ...resolveSessionPaths(invocationDirectory, sessionName, this.env),
    };
  }
}

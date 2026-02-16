import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { EventScope } from '../../events/normalized-events.ts';
import { parsePositiveInt } from './startup-utils.ts';

interface MuxOptions {
  codexArgs: string[];
  storePath: string;
  initialConversationId: string;
  invocationDirectory: string;
  controlPlaneHost: string | null;
  controlPlanePort: number | null;
  controlPlaneAuthToken: string | null;
  recordingPath: string | null;
  recordingGifOutputPath: string | null;
  recordingFps: number;
  scope: EventScope;
}

interface ParseMuxArgsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly randomId?: () => string;
}

export function parseMuxArgs(argv: string[], options: ParseMuxArgsOptions = {}): MuxOptions {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const randomId = options.randomId ?? randomUUID;

  const codexArgs: string[] = [];
  let controlPlaneHost = env.HARNESS_CONTROL_PLANE_HOST ?? null;
  let controlPlanePortRaw = env.HARNESS_CONTROL_PLANE_PORT ?? null;
  let controlPlaneAuthToken = env.HARNESS_CONTROL_PLANE_AUTH_TOKEN ?? null;
  let recordingPath = env.HARNESS_RECORDING_PATH ?? null;
  let recordingOutputPath = env.HARNESS_RECORD_OUTPUT ?? null;
  let recordingFps = parsePositiveInt(env.HARNESS_RECORDING_FPS, 15);
  const invocationDirectory = env.HARNESS_INVOKE_CWD ?? env.INIT_CWD ?? cwd;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--harness-server-host') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --harness-server-host');
      }
      controlPlaneHost = value;
      idx += 1;
      continue;
    }

    if (arg === '--harness-server-port') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --harness-server-port');
      }
      controlPlanePortRaw = value;
      idx += 1;
      continue;
    }

    if (arg === '--harness-server-token') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --harness-server-token');
      }
      controlPlaneAuthToken = value;
      idx += 1;
      continue;
    }

    if (arg === '--record-path') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --record-path');
      }
      recordingPath = value;
      idx += 1;
      continue;
    }

    if (arg === '--record-output') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --record-output');
      }
      recordingOutputPath = value;
      idx += 1;
      continue;
    }

    if (arg === '--record-fps') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --record-fps');
      }
      recordingFps = parsePositiveInt(value, recordingFps);
      idx += 1;
      continue;
    }

    codexArgs.push(arg);
  }

  let controlPlanePort: number | null = null;
  if (controlPlanePortRaw !== null) {
    const parsed = Number.parseInt(controlPlanePortRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`invalid --harness-server-port value: ${controlPlanePortRaw}`);
    }
    controlPlanePort = parsed;
  }

  if ((controlPlaneHost === null) !== (controlPlanePort === null)) {
    throw new Error('both control-plane host and port must be set together');
  }

  if (recordingPath !== null && recordingPath.length > 0) {
    recordingPath = resolve(invocationDirectory, recordingPath);
  }
  if (recordingOutputPath !== null && recordingOutputPath.length > 0) {
    recordingOutputPath = resolve(invocationDirectory, recordingOutputPath);
  }

  let recordingGifOutputPath: string | null = null;
  if (recordingOutputPath !== null && recordingOutputPath.length > 0) {
    if (extname(recordingOutputPath).toLowerCase() === '.gif') {
      recordingGifOutputPath = recordingOutputPath;
      const fileName = basename(recordingOutputPath, '.gif');
      const sidecarName = `${fileName}.jsonl`;
      recordingPath = join(dirname(recordingOutputPath), sidecarName);
    } else {
      recordingPath = recordingOutputPath;
    }
  }

  const initialConversationId = env.HARNESS_CONVERSATION_ID ?? `conversation-${randomId()}`;
  const turnId = env.HARNESS_TURN_ID ?? `turn-${randomId()}`;

  return {
    codexArgs,
    storePath: env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite',
    initialConversationId,
    invocationDirectory,
    controlPlaneHost,
    controlPlanePort,
    controlPlaneAuthToken,
    recordingPath,
    recordingGifOutputPath,
    recordingFps: Math.max(1, recordingFps),
    scope: {
      tenantId: env.HARNESS_TENANT_ID ?? 'tenant-local',
      userId: env.HARNESS_USER_ID ?? 'user-local',
      workspaceId: env.HARNESS_WORKSPACE_ID ?? basename(cwd),
      worktreeId: env.HARNESS_WORKTREE_ID ?? 'worktree-local',
      conversationId: initialConversationId,
      turnId
    }
  };
}

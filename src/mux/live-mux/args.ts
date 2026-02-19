import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import type { EventScope } from '../../events/normalized-events.ts';

const DEFAULT_RECORDING_FPS = 30;
const RECORDINGS_DIR_RELATIVE_PATH = '.harness/recordings';

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
  readonly nowIso?: () => string;
}

function sanitizeFileToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'recording';
  }
  const normalized = trimmed.replace(/[^A-Za-z0-9._-]/g, '-');
  return normalized.length > 0 ? normalized : 'recording';
}

export function parseMuxArgs(argv: string[], options: ParseMuxArgsOptions = {}): MuxOptions {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const randomId = options.randomId ?? randomUUID;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());

  const codexArgs: string[] = [];
  let controlPlaneHost = env.HARNESS_CONTROL_PLANE_HOST ?? null;
  let controlPlanePortRaw = env.HARNESS_CONTROL_PLANE_PORT ?? null;
  let controlPlaneAuthToken = env.HARNESS_CONTROL_PLANE_AUTH_TOKEN ?? null;
  let recordEnabled = false;
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

    if (arg === '--record') {
      recordEnabled = true;
      continue;
    }

    if (arg === '--record-path' || arg === '--record-output' || arg === '--record-fps') {
      throw new Error(`${arg} is no longer supported; use --record`);
    }

    codexArgs.push(arg);
  }

  let controlPlanePort: number | null = null;
  if (controlPlanePortRaw !== null) {
    const trimmedPort = controlPlanePortRaw.trim();
    if (!/^\d+$/u.test(trimmedPort)) {
      throw new Error(`invalid --harness-server-port value: ${controlPlanePortRaw}`);
    }
    const parsed = Number.parseInt(trimmedPort, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`invalid --harness-server-port value: ${controlPlanePortRaw}`);
    }
    controlPlanePort = parsed;
  }

  if ((controlPlaneHost === null) !== (controlPlanePort === null)) {
    throw new Error('both control-plane host and port must be set together');
  }

  let recordingPath: string | null = null;
  let recordingGifOutputPath: string | null = null;
  if (recordEnabled) {
    const recordingsDirectoryPath = resolve(invocationDirectory, RECORDINGS_DIR_RELATIVE_PATH);
    const nowToken = sanitizeFileToken(nowIso().replaceAll(':', '-').replaceAll('.', '-'));
    const randomToken = sanitizeFileToken(randomId());
    const stem = `${nowToken}-${randomToken}`;
    recordingGifOutputPath = join(recordingsDirectoryPath, `${stem}.gif`);
    recordingPath = join(recordingsDirectoryPath, `${stem}.jsonl`);
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
    recordingFps: DEFAULT_RECORDING_FPS,
    scope: {
      tenantId: env.HARNESS_TENANT_ID ?? 'tenant-local',
      userId: env.HARNESS_USER_ID ?? 'user-local',
      workspaceId: env.HARNESS_WORKSPACE_ID ?? basename(cwd),
      worktreeId: env.HARNESS_WORKTREE_ID ?? 'worktree-local',
      conversationId: initialConversationId,
      turnId,
    },
  };
}

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startPtySession, type PtyExit } from '../pty/pty_host.ts';
import type { NimModelRef } from '../../packages/nim-core/src/index.ts';
import type { RuntimeNimViewModel } from './runtime-nim-session.ts';

type NimSessionStatus = RuntimeNimViewModel['status'];

interface RuntimeNimCliSessionOptions {
  readonly invocationDirectory: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly markDirty: () => void;
  readonly sessionName: string | null;
  readonly model: NimModelRef;
  readonly useMock: boolean;
  readonly baseUrl?: string;
  readonly maxTranscriptLines?: number;
  readonly harnessScriptPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly startPtySession?: typeof startPtySession;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(MODULE_DIR, '../..');
const DEFAULT_HARNESS_SCRIPT_PATH = resolve(PROJECT_ROOT, 'scripts/harness.ts');
const DEFAULT_MAX_TRANSCRIPT_LINES = 200;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

function stripAnsiSequences(value: string): string {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const oscPattern = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'gu');
  const csiPattern = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'gu');
  const escPattern = new RegExp(`${ESC}[@-_]`, 'gu');
  return value.replace(oscPattern, '').replace(csiPattern, '').replace(escPattern, '');
}

function isPrintableCharacter(char: string): boolean {
  return char.length === 1 && char >= ' ' && char !== '\u007f';
}

function providerIdFromModel(model: NimModelRef): string {
  const slash = model.indexOf('/');
  if (slash <= 0) {
    return 'mock';
  }
  return model.slice(0, slash);
}

interface QueueTurnResultLine {
  readonly queued: boolean;
  readonly position?: number;
  readonly reason?: string;
}

function parseQueueTurnResultLine(line: string): QueueTurnResultLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record['queued'] !== 'boolean') {
    return null;
  }
  const positionValue = record['position'];
  const reasonValue = record['reason'];
  const position =
    typeof positionValue === 'number' && Number.isInteger(positionValue) && positionValue >= 0
      ? positionValue
      : undefined;
  const reason = typeof reasonValue === 'string' && reasonValue.trim().length > 0 ? reasonValue : undefined;
  return {
    queued: record['queued'],
    ...(position === undefined ? {} : { position }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function normalizePtyExit(value: unknown): PtyExit | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { code?: unknown; signal?: unknown };
  if (
    (typeof candidate.code !== 'number' && candidate.code !== null) ||
    (typeof candidate.signal !== 'string' && candidate.signal !== null)
  ) {
    return null;
  }
  return {
    code: candidate.code,
    signal: typeof candidate.signal === 'string' ? (candidate.signal as NodeJS.Signals) : null,
  };
}

export class RuntimeNimCliSession {
  private readonly startPtySessionImpl: typeof startPtySession;
  private readonly harnessScriptPath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxTranscriptLines: number;

  private started = false;
  private disposed = false;
  private session: ReturnType<typeof startPtySession> | null = null;
  private sessionExitPromise: Promise<PtyExit> | null = null;
  private pendingOutput = '';

  private sessionId: string | null = null;
  private status: NimSessionStatus = 'idle';
  private uiMode: RuntimeNimViewModel['uiMode'] = 'debug';
  private composerText = '';
  private queuedCount = 0;
  private transcriptLines: string[] = [];
  private activeRunId: string | null = null;
  private pendingDirectRunStarts = 0;

  constructor(private readonly options: RuntimeNimCliSessionOptions) {
    this.startPtySessionImpl = options.startPtySession ?? startPtySession;
    this.harnessScriptPath = options.harnessScriptPath ?? DEFAULT_HARNESS_SCRIPT_PATH;
    this.env = options.env ?? process.env;
    this.maxTranscriptLines = options.maxTranscriptLines ?? DEFAULT_MAX_TRANSCRIPT_LINES;
  }

  public async start(): Promise<void> {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    const commandArgs: string[] = [this.harnessScriptPath];
    if (this.options.sessionName !== null) {
      commandArgs.push('--session', this.options.sessionName);
    }
    commandArgs.push(
      'nim',
      '--tenant-id',
      this.options.tenantId,
      '--user-id',
      this.options.userId,
      '--model',
      this.options.model,
      '--ui-mode',
      'debug',
    );
    if (this.options.useMock) {
      commandArgs.push('--mock');
    } else {
      commandArgs.push('--live-anthropic');
      if (typeof this.options.baseUrl === 'string' && this.options.baseUrl.trim().length > 0) {
        commandArgs.push('--base-url', this.options.baseUrl.trim());
      }
    }
    const session = this.startPtySessionImpl({
      command: process.execPath,
      commandArgs,
      cwd: this.options.invocationDirectory,
      env: {
        ...this.env,
        HARNESS_INVOKE_CWD: this.options.invocationDirectory,
      },
      initialCols: DEFAULT_COLS,
      initialRows: DEFAULT_ROWS,
    });
    this.session = session;
    this.sessionExitPromise = new Promise((resolveExit) => {
      session.once('exit', (value: unknown) => {
        const normalized = normalizePtyExit(value);
        resolveExit(
          normalized ?? {
            code: 1,
            signal: null,
          },
        );
      });
    });
    session.on('data', (chunk: Buffer) => {
      this.applyOutputChunk(chunk.toString('utf8'));
    });
    this.options.markDirty();
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    const session = this.session;
    const exitPromise = this.sessionExitPromise;
    this.session = null;
    this.sessionExitPromise = null;
    if (session === null) {
      return;
    }
    try {
      session.write('/exit\n');
    } catch {
      // Best-effort shutdown only.
    }
    if (exitPromise !== null) {
      const exited = await Promise.race([
        exitPromise.then(() => true),
        delay(500).then(() => false),
      ]);
      if (exited) {
        return;
      }
    }
    try {
      session.close();
    } catch {
      // Best-effort shutdown only.
    }
    if (exitPromise !== null) {
      await Promise.race([exitPromise, delay(500)]);
    }
  }

  public snapshot(): RuntimeNimViewModel {
    return {
      sessionId: this.sessionId,
      status: this.status,
      uiMode: this.uiMode,
      composerText: this.composerText,
      queuedCount: this.queuedCount,
      activeRunId: this.activeRunId,
      transcriptLines: this.transcriptLines,
      assistantDraftText: '',
    };
  }

  public handleInputChunk(text: string): void {
    if (text.length === 0 || this.disposed) {
      return;
    }
    let skipLf = false;
    for (const char of text) {
      if (skipLf && char === '\n') {
        skipLf = false;
        continue;
      }
      skipLf = false;
      if (char === '\r' || char === '\n') {
        this.flushComposerAsSend();
        if (char === '\r') {
          skipLf = true;
        }
        continue;
      }
      if (char === '\t') {
        this.flushComposerAsQueue();
        continue;
      }
      if (char === '\u007f' || char === '\b') {
        this.composerText = this.composerText.slice(0, -1);
        continue;
      }
      if (!isPrintableCharacter(char)) {
        continue;
      }
      this.composerText += char;
    }
    this.options.markDirty();
  }

  private flushComposerAsSend(): void {
    const message = this.composerText.trim();
    this.composerText = '';
    if (message.length === 0 || this.session === null) {
      return;
    }
    this.pendingDirectRunStarts += 1;
    this.session.write(`${message}\n`);
  }

  private flushComposerAsQueue(): void {
    const message = this.composerText.trim();
    this.composerText = '';
    if (message.length === 0 || this.session === null) {
      return;
    }
    const queueCommand =
      message.startsWith('/queue ') || message === '/queue'
        ? message
        : `/queue ${message}`;
    this.session.write(`${queueCommand}\n`);
  }

  public handleEscape(): void {
    if (this.disposed) {
      return;
    }
    if (this.session !== null) {
      this.session.write('/abort\n');
    }
    this.status = 'idle';
    this.options.markDirty();
  }

  public resize(cols: number, rows: number): void {
    if (this.disposed || this.session === null) {
      return;
    }
    this.session.resize(Math.max(20, Math.floor(cols)), Math.max(6, Math.floor(rows)));
  }

  private applyOutputChunk(text: string): void {
    const stripped = stripAnsiSequences(text).replace(/\r/gu, '');
    if (stripped.length === 0) {
      return;
    }
    this.pendingOutput += stripped;
    while (true) {
      const newlineIndex = this.pendingOutput.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const rawLine = this.pendingOutput.slice(0, newlineIndex);
      this.pendingOutput = this.pendingOutput.slice(newlineIndex + 1);
      this.applyOutputLine(rawLine.trim());
    }
    this.options.markDirty();
  }

  private applyOutputLine(line: string): void {
    if (line.length === 0) {
      return;
    }
    const readyMatch = /^nim tui ready session=([^\s]+)/u.exec(line);
    if (readyMatch !== null) {
      this.sessionId = readyMatch[1] ?? this.sessionId;
      const providerId = providerIdFromModel(this.options.model);
      this.pushTranscriptLine(
        `[notice] nim subprocess ready model=${this.options.model} provider=${providerId}`,
      );
      return;
    }
    if (line.startsWith('run started ')) {
      const runId = line.slice('run started '.length).trim();
      this.activeRunId = runId.length > 0 ? runId : null;
      this.status = 'thinking';
      if (this.pendingDirectRunStarts > 0) {
        this.pendingDirectRunStarts -= 1;
      } else if (this.queuedCount > 0) {
        this.queuedCount = Math.max(0, this.queuedCount - 1);
      }
      this.pushTranscriptLine(line);
      return;
    }
    if (line.startsWith('run completed ')) {
      this.activeRunId = null;
      this.status = 'idle';
      this.pushTranscriptLine(line);
      return;
    }
    if (line.startsWith('ui mode set to ')) {
      const mode = line.slice('ui mode set to '.length).trim();
      if (mode === 'debug' || mode === 'user') {
        this.uiMode = mode;
      }
      this.pushTranscriptLine(`[notice] ${line}`);
      return;
    }
    if (line.startsWith('new session ') || line.startsWith('resumed session ')) {
      const sessionId = line.split(' ').at(-1) ?? '';
      if (sessionId.length > 0) {
        this.sessionId = sessionId;
      }
      this.pushTranscriptLine(`[notice] ${line}`);
      return;
    }
    if (line === 'frame:') {
      this.status = 'responding';
      return;
    }
    if (line.startsWith('[error]')) {
      this.status = 'idle';
      this.activeRunId = null;
      this.pendingDirectRunStarts = 0;
    }
    const queuedTurnResult = parseQueueTurnResultLine(line);
    if (queuedTurnResult !== null) {
      if (queuedTurnResult.queued) {
        const nextQueuedCount =
          queuedTurnResult.position === undefined ? this.queuedCount + 1 : queuedTurnResult.position + 1;
        this.queuedCount = Math.max(this.queuedCount, nextQueuedCount);
        this.pushTranscriptLine(
          `[notice] queued turn position=${String(
            queuedTurnResult.position === undefined ? this.queuedCount - 1 : queuedTurnResult.position,
          )}`,
        );
        return;
      }
      this.pushTranscriptLine(
        `[notice] queue rejected${queuedTurnResult.reason === undefined ? '' : ` reason=${queuedTurnResult.reason}`}`,
      );
      return;
    }
    this.pushTranscriptLine(line);
  }

  private pushTranscriptLine(text: string): void {
    this.transcriptLines.push(text);
    const overflow = this.transcriptLines.length - this.maxTranscriptLines;
    if (overflow > 0) {
      this.transcriptLines.splice(0, overflow);
    }
  }
}

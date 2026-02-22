import { randomUUID } from 'node:crypto';
import {
  InMemoryNimRuntime,
  type NimModelRef,
  type NimEventEnvelope,
  type NimProviderDriver,
  type NimUiEvent,
} from '../../packages/nim-core/src/index.ts';
import {
  projectEventToUiEvents,
  type NimUiMode,
} from '../../packages/nim-ui-core/src/projection.ts';
import { type RuntimeNimToolBridge } from './runtime-nim-tool-bridge.ts';

type NimSessionStatus = 'thinking' | 'tool-calling' | 'responding' | 'idle';

export interface RuntimeNimViewModel {
  readonly sessionId: string | null;
  readonly status: NimSessionStatus;
  readonly uiMode: 'debug' | 'user';
  readonly composerText: string;
  readonly queuedCount: number;
  readonly activeRunId: string | null;
  readonly transcriptLines: readonly string[];
  readonly assistantDraftText: string;
}

interface RuntimeNimSessionOptions {
  readonly tenantId: string;
  readonly userId: string;
  readonly markDirty: () => void;
  readonly toolBridge?: RuntimeNimToolBridge;
  readonly model?: NimModelRef;
  readonly providerDriver?: NimProviderDriver;
  readonly runtime?: InMemoryNimRuntime;
  readonly retryWithMockOnFailedTurn?: boolean;
  readonly responseChunkDelayMs?: number;
  readonly maxTranscriptLines?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_MODEL: NimModelRef = 'mock/echo-v1';
const DEFAULT_UI_MODE: NimUiMode = 'debug';
const DEFAULT_RESPONSE_CHUNK_DELAY_MS = 10;
const DEFAULT_MAX_TRANSCRIPT_LINES = 200;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isPrintableCharacter(char: string): boolean {
  return char.length === 1 && char >= ' ' && char !== '\u007f';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerIdFromModel(model: NimModelRef): string {
  const slash = model.indexOf('/');
  if (slash <= 0) {
    return 'mock';
  }
  return model.slice(0, slash);
}

function parseRequestedToolInvocation(
  input: string,
): { readonly toolName: string; readonly argumentsText: string } | null {
  const match = /(?:^|\s)use-tool(?:\s+([A-Za-z0-9._:-]+))?(?:\s+(.+))?/u.exec(input);
  if (match === null) {
    return null;
  }
  const toolName = match[1];
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return null;
  }
  return {
    toolName,
    argumentsText: typeof match[2] === 'string' ? match[2].trim() : '',
  };
}

function toUiModeLabel(mode: NimUiMode): 'debug' | 'user' {
  return mode === 'debug' ? 'debug' : 'user';
}

function parseCompactTranscriptLine(text: string): { readonly base: string; readonly count: number } {
  const match = /^(.*) \(x(\d+)\)$/u.exec(text);
  if (match === null) {
    return {
      base: text,
      count: 1,
    };
  }
  const count = Number.parseInt(match[2] ?? '1', 10);
  if (!Number.isInteger(count) || count < 2) {
    return {
      base: text,
      count: 1,
    };
  }
  return {
    base: match[1] ?? text,
    count,
  };
}

function createMockProviderDriver(input: {
  readonly providerId: string;
  readonly responseChunkDelayMs: number;
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly invokeTool?: (toolName: string, argumentsText: string) => Promise<unknown>;
}): NimProviderDriver {
  return {
    providerId: input.providerId,
    async *runTurn(turnInput) {
      yield { type: 'provider.thinking.started' };
      await input.sleep(input.responseChunkDelayMs);
      yield { type: 'provider.thinking.completed' };

      const requestedTool = parseRequestedToolInvocation(turnInput.input);
      if (requestedTool !== null) {
        const toolCallId = randomUUID();
        const supportedTool = turnInput.tools.some((tool) => tool.name === requestedTool.toolName);
        if (!supportedTool) {
          yield {
            type: 'tool.call.failed',
            toolCallId,
            toolName: requestedTool.toolName,
            error: 'tool unavailable',
          };
        } else {
          yield {
            type: 'tool.call.started',
            toolCallId,
            toolName: requestedTool.toolName,
          };
          if (requestedTool.argumentsText.length > 0) {
            yield {
              type: 'tool.call.arguments.delta',
              toolCallId,
              delta: requestedTool.argumentsText,
            };
          }
          try {
            const output =
              input.invokeTool === undefined
                ? {
                    notice: 'nim tool bridge unavailable',
                  }
                : await input.invokeTool(requestedTool.toolName, requestedTool.argumentsText);
            yield {
              type: 'tool.call.completed',
              toolCallId,
              toolName: requestedTool.toolName,
            };
            yield {
              type: 'tool.result.emitted',
              toolCallId,
              toolName: requestedTool.toolName,
              output,
            };
          } catch (error: unknown) {
            yield {
              type: 'tool.call.failed',
              toolCallId,
              toolName: requestedTool.toolName,
              error: toErrorMessage(error),
            };
          }
        }
      }

      const response = `nim mock: ${turnInput.input}`;
      const tokens = response.split(/\s+/u);
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === undefined) {
          continue;
        }
        const prefix = index === 0 ? '' : ' ';
        yield {
          type: 'assistant.output.delta',
          text: `${prefix}${token}`,
        };
        await input.sleep(input.responseChunkDelayMs);
      }

      yield { type: 'assistant.output.completed' };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'stop',
      };
    },
  };
}

export class RuntimeNimSession {
  private readonly runtime: InMemoryNimRuntime;
  private readonly model: NimModelRef;
  private readonly providerId: string;
  private readonly providerDriver: NimProviderDriver | undefined;
  private readonly retryWithMockOnFailedTurn: boolean;
  private readonly maxTranscriptLines: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly responseChunkDelayMs: number;

  private started = false;
  private disposed = false;
  private sessionId: string | null = null;
  private status: NimSessionStatus = 'idle';
  private uiMode: NimUiMode = DEFAULT_UI_MODE;
  private composerText = '';
  private assistantDraftText = '';
  private transcriptLines: string[] = [];
  private queuedInputs: string[] = [];
  private activeRunId: string | null = null;
  private runSequence = 0;
  private mockFallbackDriverInstalled = false;
  private inputLane: Promise<void> = Promise.resolve();
  private uiIterator: AsyncIterator<NimEventEnvelope> | null = null;
  private uiPump: Promise<void> | null = null;

  constructor(private readonly options: RuntimeNimSessionOptions) {
    this.runtime = options.runtime ?? new InMemoryNimRuntime();
    this.model = options.model ?? DEFAULT_MODEL;
    this.providerId = providerIdFromModel(this.model);
    this.providerDriver = options.providerDriver;
    this.retryWithMockOnFailedTurn =
      options.retryWithMockOnFailedTurn ?? this.providerDriver !== undefined;
    this.maxTranscriptLines = options.maxTranscriptLines ?? DEFAULT_MAX_TRANSCRIPT_LINES;
    this.sleep = options.sleep ?? sleep;
    this.responseChunkDelayMs = Math.max(
      0,
      options.responseChunkDelayMs ?? DEFAULT_RESPONSE_CHUNK_DELAY_MS,
    );
    this.runtime.registerProvider({
      id: this.providerId,
      displayName: 'Mock',
      models: [this.model],
    });
    this.options.toolBridge?.registerWithRuntime(this.runtime);
    this.runtime.registerProviderDriver(
      this.providerDriver ??
        createMockProviderDriver({
          providerId: this.providerId,
          responseChunkDelayMs: this.responseChunkDelayMs,
          sleep: this.sleep,
          invokeTool: async (toolName, argumentsText) => {
            if (this.options.toolBridge === undefined) {
              return {
                notice: 'nim tool bridge unavailable',
              };
            }
            return await this.options.toolBridge.invoke({
              toolName,
              argumentsText,
            });
          },
        }),
    );
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    const session = await this.runtime.startSession({
      tenantId: this.options.tenantId,
      userId: this.options.userId,
      model: this.model,
    });
    this.sessionId = session.sessionId;
    this.startUiPump(session.sessionId);
    this.options.markDirty();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const iterator = this.uiIterator;
    this.uiIterator = null;
    if (iterator !== null) {
      try {
        void iterator.return?.();
      } catch {
        // Best-effort cleanup only.
      }
    }
    this.uiPump = null;
  }

  snapshot(): RuntimeNimViewModel {
    return {
      sessionId: this.sessionId,
      status: this.status,
      uiMode: toUiModeLabel(this.uiMode),
      composerText: this.composerText,
      queuedCount: this.queuedInputs.length,
      activeRunId: this.activeRunId,
      transcriptLines: this.transcriptLines,
      assistantDraftText: this.assistantDraftText,
    };
  }

  handleInputChunk(text: string): void {
    if (text.length === 0 || this.disposed) {
      return;
    }
    this.enqueueInput(async () => {
      await this.consumeInputText(text);
      this.options.markDirty();
    });
  }

  handleEscape(): void {
    if (this.disposed) {
      return;
    }
    this.enqueueInput(async () => {
      await this.requestAbort({
        emitIdleNotice: false,
      });
      this.options.markDirty();
    });
  }

  private enqueueInput(task: () => Promise<void>): void {
    this.inputLane = this.inputLane
      .then(async () => {
        await task();
      })
      .catch((error: unknown) => {
        this.pushSystemLine(`[error] ${toErrorMessage(error)}`);
        this.options.markDirty();
      });
  }

  private startUiPump(sessionId: string): void {
    const stream = this.runtime.streamEvents({
      tenantId: this.options.tenantId,
      sessionId,
      fidelity: 'semantic',
    });
    const iterator = stream[Symbol.asyncIterator]();
    this.uiIterator = iterator;
    this.uiPump = (async () => {
      try {
        while (!this.disposed) {
          const next = await iterator.next();
          if (next.done) {
            break;
          }
          this.applyEventEnvelope(next.value);
          this.options.markDirty();
        }
      } catch (error: unknown) {
        if (this.disposed) {
          return;
        }
        this.pushSystemLine(`[error] ${toErrorMessage(error)}`);
        this.options.markDirty();
      }
    })();
  }

  private applyEventEnvelope(event: NimEventEnvelope): void {
    const projected = projectEventToUiEvents(event, this.uiMode);
    for (const uiEvent of projected) {
      this.applyUiEvent(uiEvent);
    }
  }

  private applyUiEvent(event: NimUiEvent): void {
    if (event.type === 'assistant.state') {
      this.status = event.state;
      if (event.state === 'idle') {
        this.assistantDraftText = '';
      }
      return;
    }
    if (event.type === 'assistant.text.delta') {
      this.assistantDraftText += event.text;
      return;
    }
    if (event.type === 'assistant.text.message') {
      this.assistantDraftText = '';
      this.pushAssistantLine(event.text);
      return;
    }
    if (event.type === 'tool.activity') {
      this.pushSystemLine(`[tool:${event.phase}] ${event.toolName}`);
      return;
    }
    this.pushSystemLine(`[notice] ${event.text}`);
  }

  private async consumeInputText(chunk: string): Promise<void> {
    if (this.sessionId === null) {
      return;
    }
    let skipLf = false;
    for (const char of chunk) {
      if (skipLf && char === '\n') {
        skipLf = false;
        continue;
      }
      skipLf = false;
      if (char === '\r') {
        await this.submitComposer();
        skipLf = true;
        continue;
      }
      if (char === '\n') {
        await this.submitComposer();
        continue;
      }
      if (char === '\t') {
        await this.queueComposer();
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
  }

  private async submitComposer(): Promise<void> {
    const text = this.composerText.trim();
    this.composerText = '';
    if (text.length === 0) {
      return;
    }
    if (text.startsWith('/')) {
      await this.runCommand(text);
      return;
    }
    if (this.activeRunId === null) {
      await this.startTurn(text);
      return;
    }
    this.pushUserLine(text);
    const result = await this.runtime.steerTurn({
      sessionId: this.requireSessionId(),
      runId: this.activeRunId,
      text,
    });
    if (!result.accepted) {
      this.queuedInputs.push(text);
      this.pushSystemLine(`[notice] steer rejected (${result.reason ?? 'unknown'}), queued`);
    }
  }

  private async runCommand(commandText: string): Promise<void> {
    const trimmed = commandText.trim();
    if (trimmed === '/help') {
      this.pushSystemLine(
        '[help] /help /mode <debug|user> /state /clear /abort use-tool <tool>',
      );
      return;
    }
    if (trimmed === '/state') {
      this.pushSystemLine(
        `[state] status:${this.status} mode:${toUiModeLabel(this.uiMode)} queued:${String(this.queuedInputs.length)} active:${this.activeRunId === null ? 'none' : 'yes'}`,
      );
      return;
    }
    if (trimmed === '/clear') {
      this.transcriptLines = [];
      this.assistantDraftText = '';
      this.pushSystemLine('[notice] transcript cleared');
      return;
    }
    if (trimmed === '/abort') {
      await this.requestAbort({
        emitIdleNotice: true,
      });
      return;
    }
    if (trimmed.startsWith('/mode ')) {
      const rawMode = trimmed.slice('/mode '.length).trim();
      const resolvedMode =
        rawMode === 'debug' ? 'debug' : rawMode === 'user' || rawMode === 'seamless' ? 'seamless' : null;
      if (resolvedMode === null) {
        this.pushSystemLine(`[error] invalid mode: ${rawMode}`);
        return;
      }
      if (this.uiMode === resolvedMode) {
        this.pushSystemLine(`[notice] ui mode already ${toUiModeLabel(this.uiMode)}`);
        return;
      }
      this.uiMode = resolvedMode;
      this.pushSystemLine(`[notice] ui mode set to ${toUiModeLabel(this.uiMode)}`);
      return;
    }
    this.pushSystemLine(`[error] unknown command: ${trimmed}`);
  }

  private async requestAbort(input: { readonly emitIdleNotice: boolean }): Promise<void> {
    if (this.activeRunId === null) {
      if (input.emitIdleNotice) {
        this.pushSystemLine('[notice] no active run');
      }
      return;
    }
    await this.runtime.abortTurn({
      runId: this.activeRunId,
      reason: 'manual',
    });
    this.pushSystemLine('[notice] abort requested');
  }

  private async queueComposer(): Promise<void> {
    const text = this.composerText.trim();
    this.composerText = '';
    if (text.length === 0) {
      return;
    }
    this.queuedInputs.push(text);
    this.pushSystemLine(`[queued] ${text}`);
    await this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.activeRunId !== null) {
      return;
    }
    const next = this.queuedInputs.shift();
    if (next === undefined) {
      return;
    }
    await this.startTurn(next);
  }

  private async startTurn(
    text: string,
    options?: {
      readonly pushUserLine?: boolean;
      readonly allowMockRetry?: boolean;
    },
  ): Promise<void> {
    const turn = await this.runtime.sendTurn({
      sessionId: this.requireSessionId(),
      input: text,
      idempotencyKey: `nim-${String(this.runSequence + 1)}-${randomUUID()}`,
    });
    this.runSequence += 1;
    this.activeRunId = turn.runId;
    if (options?.pushUserLine !== false) {
      this.pushUserLine(text);
    }
    void turn.done
      .then((result) => {
        this.enqueueInput(async () => {
          if (this.activeRunId === turn.runId) {
            this.activeRunId = null;
          }
          if (result.terminalState === 'failed') {
            const failureMessage = await this.resolveRunFailureMessage(turn.runId);
            if ((options?.allowMockRetry ?? true) && this.shouldRetryFailedTurnWithMock()) {
              if (failureMessage !== null) {
                this.pushSystemLine(`[error] ${failureMessage}`);
              }
              this.pushSystemLine('[notice] provider failed; retrying with local fallback');
              this.installMockFallbackDriver();
              await this.startTurn(text, {
                pushUserLine: false,
                allowMockRetry: false,
              });
              this.options.markDirty();
              return;
            }
            if (failureMessage !== null) {
              this.pushSystemLine(`[error] ${failureMessage}`);
            } else {
              this.pushSystemLine(`[turn:failed] ${turn.runId}`);
            }
          } else if (result.terminalState !== 'completed') {
            this.pushSystemLine(`[turn:${result.terminalState}] ${turn.runId}`);
          }
          await this.drainQueue();
          this.options.markDirty();
        });
      })
      .catch((error: unknown) => {
        this.enqueueInput(async () => {
          if (this.activeRunId === turn.runId) {
            this.activeRunId = null;
          }
          this.pushSystemLine(`[error] ${toErrorMessage(error)}`);
          await this.drainQueue();
          this.options.markDirty();
        });
      });
  }

  private shouldRetryFailedTurnWithMock(): boolean {
    return this.retryWithMockOnFailedTurn && !this.mockFallbackDriverInstalled;
  }

  private installMockFallbackDriver(): void {
    if (this.mockFallbackDriverInstalled) {
      return;
    }
    this.runtime.registerProviderDriver(
      createMockProviderDriver({
        providerId: this.providerId,
        responseChunkDelayMs: this.responseChunkDelayMs,
        sleep: this.sleep,
        invokeTool: async (toolName, argumentsText) => {
          if (this.options.toolBridge === undefined) {
            return {
              notice: 'nim tool bridge unavailable',
            };
          }
          return await this.options.toolBridge.invoke({
            toolName,
            argumentsText,
          });
        },
      }),
    );
    this.mockFallbackDriverInstalled = true;
  }

  private async resolveRunFailureMessage(runId: string): Promise<string | null> {
    if (this.sessionId === null) {
      return null;
    }
    try {
      const replay = await this.runtime.replayEvents({
        tenantId: this.options.tenantId,
        sessionId: this.sessionId,
        runId,
        fidelity: 'semantic',
      });
      for (let index = replay.events.length - 1; index >= 0; index -= 1) {
        const event = replay.events[index];
        if (event?.type !== 'turn.failed') {
          continue;
        }
        const message = event.data?.['message'];
        if (typeof message !== 'string') {
          continue;
        }
        const trimmed = message.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private requireSessionId(): string {
    if (this.sessionId === null) {
      throw new Error('nim session not started');
    }
    return this.sessionId;
  }

  private pushUserLine(text: string): void {
    this.pushTranscriptLine(`you> ${text}`);
  }

  private pushAssistantLine(text: string): void {
    this.pushTranscriptLine(`nim> ${text}`);
  }

  private pushSystemLine(text: string): void {
    this.pushTranscriptLine(text);
  }

  private pushTranscriptLine(text: string): void {
    const lastLine = this.transcriptLines[this.transcriptLines.length - 1];
    if (typeof lastLine === 'string') {
      const parsed = parseCompactTranscriptLine(lastLine);
      if (parsed.base === text) {
        this.transcriptLines[this.transcriptLines.length - 1] = `${text} (x${String(parsed.count + 1)})`;
        return;
      }
    }
    this.transcriptLines.push(text);
    const overflow = this.transcriptLines.length - this.maxTranscriptLines;
    if (overflow > 0) {
      this.transcriptLines.splice(0, overflow);
    }
  }
}

interface RuntimeConversationStarterConversationRecord {
  readonly sessionId: string;
  readonly directoryId: string | null;
  readonly agentType: string;
  adapterState: Record<string, unknown>;
  live: boolean;
  lastOutputCursor: number;
  launchCommand: string | null;
}

interface RuntimeConversationStarterPerfSpan {
  end(input?: Record<string, unknown>): void;
}

interface RuntimeConversationStarterPtyStartInput {
  sessionId: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  initialCols: number;
  initialRows: number;
  worktreeId?: string;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
}

interface RuntimeConversationStarterLaunchArgsInput {
  readonly agentType: string;
  readonly baseArgsForAgent: readonly string[];
  readonly adapterState: Record<string, unknown>;
  readonly sessionCwd: string;
}

type RuntimeConversationStarterSpanAttributes = Record<string, string | number | boolean>;

interface RuntimeConversationStarterOptions<
  TConversation extends RuntimeConversationStarterConversationRecord,
  TSessionSummary,
> {
  readonly runWithStartInFlight: (
    sessionId: string,
    run: () => Promise<TConversation>,
  ) => Promise<TConversation>;
  readonly conversationById: (sessionId: string) => TConversation | undefined;
  readonly ensureConversation: (sessionId: string) => TConversation;
  readonly normalizeThreadAgentType: (agentType: string) => string;
  readonly codexArgs: readonly string[];
  readonly critiqueDefaultArgs: readonly string[];
  readonly sessionCwdForConversation: (conversation: TConversation) => string;
  readonly buildLaunchArgs: (
    input: RuntimeConversationStarterLaunchArgsInput,
  ) => readonly string[];
  readonly launchCommandForAgent: (agentType: string) => string;
  readonly formatCommandForDebugBar: (command: string, args: readonly string[]) => string;
  readonly startConversationSpan: (sessionId: string) => RuntimeConversationStarterPerfSpan;
  readonly firstPaintTargetSessionId: () => string | null;
  readonly endStartCommandSpan: (input: RuntimeConversationStarterSpanAttributes) => void;
  readonly layout: () => {
    rightCols: number;
    paneRows: number;
  };
  readonly startPtySession: (input: RuntimeConversationStarterPtyStartInput) => Promise<void>;
  readonly setPtySize: (
    sessionId: string,
    size: {
      cols: number;
      rows: number;
    },
  ) => void;
  readonly sendResize: (sessionId: string, cols: number, rows: number) => void;
  readonly sessionEnv: Record<string, string>;
  readonly worktreeId: string | undefined;
  readonly terminalForegroundHex: string | undefined;
  readonly terminalBackgroundHex: string | undefined;
  readonly recordStartCommand: (sessionId: string, launchArgs: readonly string[]) => void;
  readonly getSessionStatus: (sessionId: string) => Promise<TSessionSummary | null>;
  readonly upsertFromSessionSummary: (summary: TSessionSummary) => void;
  readonly subscribeConversationEvents: (sessionId: string) => Promise<void>;
}

export class RuntimeConversationStarter<
  TConversation extends RuntimeConversationStarterConversationRecord,
  TSessionSummary,
> {
  constructor(
    private readonly options: RuntimeConversationStarterOptions<TConversation, TSessionSummary>,
  ) {}

  async startConversation(sessionId: string): Promise<TConversation> {
    return await this.options.runWithStartInFlight(sessionId, async () => {
      const existing = this.options.conversationById(sessionId);
      const targetConversation = existing ?? this.options.ensureConversation(sessionId);
      const agentType = this.options.normalizeThreadAgentType(targetConversation.agentType);
      const baseArgsForAgent =
        agentType === 'codex'
          ? this.options.codexArgs
          : agentType === 'critique'
            ? this.options.critiqueDefaultArgs
            : [];
      const sessionCwd = this.options.sessionCwdForConversation(targetConversation);
      const launchArgs = this.options.buildLaunchArgs({
        agentType,
        baseArgsForAgent,
        adapterState: targetConversation.adapterState,
        sessionCwd,
      });
      targetConversation.launchCommand = this.options.formatCommandForDebugBar(
        this.options.launchCommandForAgent(agentType),
        launchArgs,
      );

      if (existing?.live === true) {
        this.endStartCommandSpanIfTarget(sessionId, {
          alreadyLive: true,
        });
        return existing;
      }

      const startSpan = this.options.startConversationSpan(sessionId);
      targetConversation.lastOutputCursor = 0;
      const layout = this.options.layout();
      const ptyStartInput: RuntimeConversationStarterPtyStartInput = {
        sessionId,
        args: launchArgs,
        env: this.options.sessionEnv,
        cwd: sessionCwd,
        initialCols: layout.rightCols,
        initialRows: layout.paneRows,
      };
      if (this.options.worktreeId !== undefined) {
        ptyStartInput.worktreeId = this.options.worktreeId;
      }
      if (this.options.terminalForegroundHex !== undefined) {
        ptyStartInput.terminalForegroundHex = this.options.terminalForegroundHex;
      }
      if (this.options.terminalBackgroundHex !== undefined) {
        ptyStartInput.terminalBackgroundHex = this.options.terminalBackgroundHex;
      }
      await this.options.startPtySession(ptyStartInput);
      this.options.setPtySize(sessionId, {
        cols: layout.rightCols,
        rows: layout.paneRows,
      });
      this.options.sendResize(sessionId, layout.rightCols, layout.paneRows);
      this.endStartCommandSpanIfTarget(sessionId, {
        alreadyLive: false,
        argCount: launchArgs.length,
        resumed: launchArgs[0] === 'resume',
      });
      const state = this.options.ensureConversation(sessionId);
      this.options.recordStartCommand(sessionId, launchArgs);
      const statusSummary = await this.options.getSessionStatus(sessionId);
      if (statusSummary !== null) {
        this.options.upsertFromSessionSummary(statusSummary);
      }
      await this.options.subscribeConversationEvents(sessionId);
      startSpan.end({
        live: state.live,
      });
      return state;
    });
  }

  private endStartCommandSpanIfTarget(
    sessionId: string,
    payload: RuntimeConversationStarterSpanAttributes,
  ): void {
    if (this.options.firstPaintTargetSessionId() !== sessionId) {
      return;
    }
    this.options.endStartCommandSpan(payload);
  }
}

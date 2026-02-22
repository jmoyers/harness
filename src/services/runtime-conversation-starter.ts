export interface RuntimeConversationStarterConversationRecord {
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

function isSessionAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes('session already exists');
}

export interface RuntimeConversationStarterOptions<
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
  readonly buildLaunchArgs: (input: RuntimeConversationStarterLaunchArgsInput) => readonly string[];
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

export interface RuntimeConversationStarter<
  TConversation extends RuntimeConversationStarterConversationRecord,
> {
  startConversation(sessionId: string): Promise<TConversation>;
}

export function createRuntimeConversationStarter<
  TConversation extends RuntimeConversationStarterConversationRecord,
  TSessionSummary,
>(
  options: RuntimeConversationStarterOptions<TConversation, TSessionSummary>,
): RuntimeConversationStarter<TConversation> {
  function endStartCommandSpanIfTarget(
    sessionId: string,
    payload: RuntimeConversationStarterSpanAttributes,
  ): void {
    if (options.firstPaintTargetSessionId() !== sessionId) {
      return;
    }
    options.endStartCommandSpan(payload);
  }

  async function startConversation(sessionId: string): Promise<TConversation> {
    return await options.runWithStartInFlight(sessionId, async () => {
      const existing = options.conversationById(sessionId);
      const targetConversation = existing ?? options.ensureConversation(sessionId);
      const agentType = options.normalizeThreadAgentType(targetConversation.agentType);
      const baseArgsForAgent =
        agentType === 'codex'
          ? options.codexArgs
          : agentType === 'critique'
            ? options.critiqueDefaultArgs
            : [];
      const sessionCwd = options.sessionCwdForConversation(targetConversation);
      const launchArgs = options.buildLaunchArgs({
        agentType,
        baseArgsForAgent,
        adapterState: targetConversation.adapterState,
        sessionCwd,
      });
      targetConversation.launchCommand = options.formatCommandForDebugBar(
        options.launchCommandForAgent(agentType),
        launchArgs,
      );

      if (existing?.live === true) {
        endStartCommandSpanIfTarget(sessionId, {
          alreadyLive: true,
        });
        return existing;
      }

      const startSpan = options.startConversationSpan(sessionId);
      targetConversation.lastOutputCursor = 0;
      const layout = options.layout();
      const ptyStartInput: RuntimeConversationStarterPtyStartInput = {
        sessionId,
        args: launchArgs,
        env: options.sessionEnv,
        cwd: sessionCwd,
        initialCols: layout.rightCols,
        initialRows: layout.paneRows,
      };
      if (options.worktreeId !== undefined) {
        ptyStartInput.worktreeId = options.worktreeId;
      }
      if (options.terminalForegroundHex !== undefined) {
        ptyStartInput.terminalForegroundHex = options.terminalForegroundHex;
      }
      if (options.terminalBackgroundHex !== undefined) {
        ptyStartInput.terminalBackgroundHex = options.terminalBackgroundHex;
      }
      let startedSession = false;
      try {
        await options.startPtySession(ptyStartInput);
        startedSession = true;
      } catch (error: unknown) {
        if (!isSessionAlreadyExistsError(error)) {
          throw error;
        }
      }
      options.setPtySize(sessionId, {
        cols: layout.rightCols,
        rows: layout.paneRows,
      });
      options.sendResize(sessionId, layout.rightCols, layout.paneRows);
      if (startedSession) {
        endStartCommandSpanIfTarget(sessionId, {
          alreadyLive: false,
          argCount: launchArgs.length,
          resumed: launchArgs[0] === 'resume',
        });
      } else {
        endStartCommandSpanIfTarget(sessionId, {
          alreadyLive: true,
          recoveredDuplicateStart: true,
        });
      }
      const state = options.ensureConversation(sessionId);
      if (startedSession) {
        options.recordStartCommand(sessionId, launchArgs);
      }
      const statusSummary = await options.getSessionStatus(sessionId);
      if (statusSummary !== null) {
        options.upsertFromSessionSummary(statusSummary);
      }
      await options.subscribeConversationEvents(sessionId);
      startSpan.end({
        live: state.live,
      });
      return state;
    });
  }

  return {
    startConversation,
  };
}

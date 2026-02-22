interface RuntimeInterruptResult {
  readonly interrupted: boolean;
}

interface RuntimeConversationControlState {
  live: boolean;
  status: string;
  attentionReason: string | null;
  lastEventAt: string | null;
}

interface RuntimeGatewayProfilerResult {
  readonly message: string;
}

interface RuntimeGatewayStatusTimelineResult {
  readonly message: string;
}

interface RuntimeGatewayRenderTraceResult {
  readonly message: string;
}

interface RuntimeConversationTitleRefreshResult {
  readonly status: 'updated' | 'unchanged' | 'skipped';
  readonly reason: string | null;
}

const THREAD_TITLE_AGENT_TYPES = new Set(['codex', 'claude', 'cursor']);

export interface RuntimeControlActionsOptions<TConversation extends RuntimeConversationControlState> {
  readonly conversationById: (sessionId: string) => TConversation | undefined;
  readonly interruptSession: (sessionId: string) => Promise<RuntimeInterruptResult>;
  readonly nowIso: () => string;
  readonly markDirty: () => void;
  readonly toggleGatewayProfiler: (input: {
    invocationDirectory: string;
    sessionName: string | null;
  }) => Promise<RuntimeGatewayProfilerResult>;
  readonly toggleGatewayStatusTimeline: (input: {
    invocationDirectory: string;
    sessionName: string | null;
  }) => Promise<RuntimeGatewayStatusTimelineResult>;
  readonly toggleGatewayRenderTrace: (input: {
    invocationDirectory: string;
    sessionName: string | null;
    conversationId: string | null;
  }) => Promise<RuntimeGatewayRenderTraceResult>;
  readonly invocationDirectory: string;
  readonly sessionName: string | null;
  readonly setTaskPaneNotice: (message: string) => void;
  readonly setDebugFooterNotice: (message: string) => void;
  readonly listConversationIdsForTitleRefresh?: () => readonly string[];
  readonly conversationAgentTypeForTitleRefresh?: (sessionId: string) => string | null;
  readonly refreshConversationTitle?: (
    sessionId: string,
  ) => Promise<RuntimeConversationTitleRefreshResult>;
}

export interface RuntimeControlActions {
  interruptConversation(sessionId: string): Promise<void>;
  toggleGatewayProfiler(): Promise<void>;
  toggleGatewayStatusTimeline(): Promise<void>;
  toggleGatewayRenderTrace(conversationId: string | null): Promise<void>;
  refreshAllConversationTitles(): Promise<void>;
}

export function createRuntimeControlActions<TConversation extends RuntimeConversationControlState>(
  options: RuntimeControlActionsOptions<TConversation>,
): RuntimeControlActions {
  const scopeMessage = (prefix: string, message: string): string => {
    if (options.sessionName === null) {
      return `[${prefix}] ${message}`;
    }
    return `[${prefix}:${options.sessionName}] ${message}`;
  };

  const setNotices = (message: string): void => {
    options.setTaskPaneNotice(message);
    options.setDebugFooterNotice(message);
  };

  const interruptConversation = async (sessionId: string): Promise<void> => {
    const conversation = options.conversationById(sessionId);
    if (conversation === undefined || !conversation.live) {
      return;
    }
    const result = await options.interruptSession(sessionId);
    if (!result.interrupted) {
      return;
    }
    conversation.status = 'completed';
    conversation.attentionReason = null;
    conversation.lastEventAt = options.nowIso();
    options.markDirty();
  };

  const toggleGatewayProfiler = async (): Promise<void> => {
    try {
      const result = await options.toggleGatewayProfiler({
        invocationDirectory: options.invocationDirectory,
        sessionName: options.sessionName,
      });
      setNotices(scopeMessage('profile', result.message));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setNotices(scopeMessage('profile', message));
    } finally {
      options.markDirty();
    }
  };

  const toggleGatewayStatusTimeline = async (): Promise<void> => {
    try {
      const result = await options.toggleGatewayStatusTimeline({
        invocationDirectory: options.invocationDirectory,
        sessionName: options.sessionName,
      });
      setNotices(scopeMessage('status-trace', result.message));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setNotices(scopeMessage('status-trace', message));
    } finally {
      options.markDirty();
    }
  };

  const toggleGatewayRenderTrace = async (conversationId: string | null): Promise<void> => {
    try {
      const result = await options.toggleGatewayRenderTrace({
        invocationDirectory: options.invocationDirectory,
        sessionName: options.sessionName,
        conversationId,
      });
      setNotices(scopeMessage('render-trace', result.message));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setNotices(scopeMessage('render-trace', message));
    } finally {
      options.markDirty();
    }
  };

  const refreshAllConversationTitles = async (): Promise<void> => {
    const listConversationIds = options.listConversationIdsForTitleRefresh;
    const resolveAgentType = options.conversationAgentTypeForTitleRefresh;
    const refreshConversationTitle = options.refreshConversationTitle;
    if (
      listConversationIds === undefined ||
      resolveAgentType === undefined ||
      refreshConversationTitle === undefined
    ) {
      setNotices(scopeMessage('thread-title', 'refresh unavailable'));
      options.markDirty();
      return;
    }
    const allConversationIds = listConversationIds();
    const eligibleConversationIds = allConversationIds.filter((sessionId) => {
      const agentType = resolveAgentType(sessionId)?.trim().toLowerCase();
      return agentType !== undefined && THREAD_TITLE_AGENT_TYPES.has(agentType);
    });
    if (eligibleConversationIds.length === 0) {
      setNotices(scopeMessage('thread-title', 'no agent threads to refresh'));
      options.markDirty();
      return;
    }
    const total = eligibleConversationIds.length;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    setNotices(scopeMessage('thread-title', `refreshing names 0/${String(total)}`));
    options.markDirty();
    for (let index = 0; index < eligibleConversationIds.length; index += 1) {
      const sessionId = eligibleConversationIds[index]!;
      try {
        const result = await refreshConversationTitle(sessionId);
        if (result.status === 'updated') {
          updated += 1;
        } else if (result.status === 'unchanged') {
          unchanged += 1;
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
      setNotices(scopeMessage('thread-title', `refreshing names ${String(index + 1)}/${String(total)}`));
      options.markDirty();
    }
    setNotices(
      scopeMessage(
        'thread-title',
        `refreshed ${String(updated)} updated ${String(unchanged)} unchanged ${String(skipped)} skipped`,
      ),
    );
    options.markDirty();
  };

  return {
    interruptConversation,
    toggleGatewayProfiler,
    toggleGatewayStatusTimeline,
    toggleGatewayRenderTrace,
    refreshAllConversationTitles,
  };
}

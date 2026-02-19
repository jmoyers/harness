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

interface RuntimeControlActionsOptions<TConversation extends RuntimeConversationControlState> {
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

export class RuntimeControlActions<TConversation extends RuntimeConversationControlState> {
  constructor(private readonly options: RuntimeControlActionsOptions<TConversation>) {}

  async interruptConversation(sessionId: string): Promise<void> {
    const conversation = this.options.conversationById(sessionId);
    if (conversation === undefined || !conversation.live) {
      return;
    }
    const result = await this.options.interruptSession(sessionId);
    if (!result.interrupted) {
      return;
    }
    conversation.status = 'completed';
    conversation.attentionReason = null;
    conversation.lastEventAt = this.options.nowIso();
    this.options.markDirty();
  }

  async toggleGatewayProfiler(): Promise<void> {
    try {
      const result = await this.options.toggleGatewayProfiler({
        invocationDirectory: this.options.invocationDirectory,
        sessionName: this.options.sessionName,
      });
      this.setNotices(this.scopeMessage('profile', result.message));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setNotices(this.scopeMessage('profile', message));
    } finally {
      this.options.markDirty();
    }
  }

  async toggleGatewayStatusTimeline(): Promise<void> {
    try {
      const result = await this.options.toggleGatewayStatusTimeline({
        invocationDirectory: this.options.invocationDirectory,
        sessionName: this.options.sessionName,
      });
      this.setNotices(this.scopeMessage('status-trace', result.message));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setNotices(this.scopeMessage('status-trace', message));
    } finally {
      this.options.markDirty();
    }
  }

  async toggleGatewayRenderTrace(conversationId: string | null): Promise<void> {
    try {
      const result = await this.options.toggleGatewayRenderTrace({
        invocationDirectory: this.options.invocationDirectory,
        sessionName: this.options.sessionName,
        conversationId,
      });
      this.setNotices(this.scopeMessage('render-trace', result.message));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setNotices(this.scopeMessage('render-trace', message));
    } finally {
      this.options.markDirty();
    }
  }

  async refreshAllConversationTitles(): Promise<void> {
    const listConversationIds = this.options.listConversationIdsForTitleRefresh;
    const resolveAgentType = this.options.conversationAgentTypeForTitleRefresh;
    const refreshConversationTitle = this.options.refreshConversationTitle;
    if (
      listConversationIds === undefined ||
      resolveAgentType === undefined ||
      refreshConversationTitle === undefined
    ) {
      this.setNotices(this.scopeMessage('thread-title', 'refresh unavailable'));
      this.options.markDirty();
      return;
    }
    const allConversationIds = listConversationIds();
    const eligibleConversationIds = allConversationIds.filter((sessionId) => {
      const agentType = resolveAgentType(sessionId)?.trim().toLowerCase();
      return agentType !== undefined && THREAD_TITLE_AGENT_TYPES.has(agentType);
    });
    if (eligibleConversationIds.length === 0) {
      this.setNotices(this.scopeMessage('thread-title', 'no agent threads to refresh'));
      this.options.markDirty();
      return;
    }
    const total = eligibleConversationIds.length;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    this.setNotices(this.scopeMessage('thread-title', `refreshing names 0/${String(total)}`));
    this.options.markDirty();
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
      this.setNotices(
        this.scopeMessage('thread-title', `refreshing names ${String(index + 1)}/${String(total)}`),
      );
      this.options.markDirty();
    }
    this.setNotices(
      this.scopeMessage(
        'thread-title',
        `refreshed ${String(updated)} updated ${String(unchanged)} unchanged ${String(skipped)} skipped`,
      ),
    );
    this.options.markDirty();
  }

  private scopeMessage(prefix: string, message: string): string {
    if (this.options.sessionName === null) {
      return `[${prefix}] ${message}`;
    }
    return `[${prefix}:${this.options.sessionName}] ${message}`;
  }

  private setNotices(message: string): void {
    this.options.setTaskPaneNotice(message);
    this.options.setDebugFooterNotice(message);
  }
}

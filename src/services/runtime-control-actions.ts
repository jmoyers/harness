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

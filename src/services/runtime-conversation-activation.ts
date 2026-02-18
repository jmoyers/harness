interface RuntimeActivationConversationRecord {
  readonly directoryId: string | null;
  readonly live: boolean;
  readonly status: string;
}

export interface RuntimeConversationActivationOptions {
  readonly getActiveConversationId: () => string | null;
  readonly setActiveConversationId: (sessionId: string) => void;
  readonly isConversationPaneMode: () => boolean;
  readonly enterConversationPaneForActiveSession: (sessionId: string) => void;
  readonly enterConversationPaneForSessionSwitch: (sessionId: string) => void;
  readonly stopConversationTitleEditForOtherSession: (sessionId: string) => void;
  readonly clearSelectionState: () => void;
  readonly detachConversation: (sessionId: string) => Promise<void>;
  readonly conversationById: (sessionId: string) => RuntimeActivationConversationRecord | undefined;
  readonly noteGitActivity: (directoryId: string | null) => void;
  readonly startConversation: (sessionId: string) => Promise<unknown>;
  readonly attachConversation: (sessionId: string) => Promise<void>;
  readonly isSessionNotFoundError: (error: unknown) => boolean;
  readonly isSessionNotLiveError: (error: unknown) => boolean;
  readonly markSessionUnavailable: (sessionId: string) => void;
  readonly schedulePtyResizeImmediate: () => void;
  readonly markDirty: () => void;
}

export class RuntimeConversationActivation {
  constructor(private readonly options: RuntimeConversationActivationOptions) {}

  async activateConversation(sessionId: string): Promise<void> {
    if (this.options.getActiveConversationId() === sessionId) {
      if (!this.options.isConversationPaneMode()) {
        this.options.enterConversationPaneForActiveSession(sessionId);
        this.options.markDirty();
      }
      return;
    }

    this.options.stopConversationTitleEditForOtherSession(sessionId);
    const previousActiveId = this.options.getActiveConversationId();
    this.options.clearSelectionState();
    if (previousActiveId !== null) {
      await this.options.detachConversation(previousActiveId);
    }
    this.options.setActiveConversationId(sessionId);
    this.options.enterConversationPaneForSessionSwitch(sessionId);

    const targetConversation = this.options.conversationById(sessionId);
    this.options.noteGitActivity(targetConversation?.directoryId ?? null);

    if (
      targetConversation !== undefined &&
      !targetConversation.live &&
      targetConversation.status !== 'exited'
    ) {
      await this.options.startConversation(sessionId);
    }

    if (targetConversation?.status !== 'exited') {
      try {
        await this.options.attachConversation(sessionId);
      } catch (error: unknown) {
        if (
          !this.options.isSessionNotFoundError(error) &&
          !this.options.isSessionNotLiveError(error)
        ) {
          throw error;
        }
        this.options.markSessionUnavailable(sessionId);
        await this.options.startConversation(sessionId);
        await this.options.attachConversation(sessionId);
      }
    }

    this.options.schedulePtyResizeImmediate();
    this.options.markDirty();
  }
}

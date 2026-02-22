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

export interface RuntimeConversationActivation {
  activateConversation(
    sessionId: string,
    input?: { readonly signal?: AbortSignal },
  ): Promise<void>;
}

export function createRuntimeConversationActivation(
  options: RuntimeConversationActivationOptions,
): RuntimeConversationActivation {
  async function attachConversationWithRecovery(
    sessionId: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    try {
      await options.attachConversation(sessionId);
      return !(signal?.aborted ?? false);
    } catch (error: unknown) {
      if (!options.isSessionNotFoundError(error) && !options.isSessionNotLiveError(error)) {
        throw error;
      }
      options.markSessionUnavailable(sessionId);
      await options.startConversation(sessionId);
      if (signal?.aborted) {
        return false;
      }
      await options.attachConversation(sessionId);
      return !(signal?.aborted ?? false);
    }
  }

  async function activateConversation(
    sessionId: string,
    input: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    const signal = input.signal;
    if (signal?.aborted) {
      return;
    }
    if (options.getActiveConversationId() === sessionId) {
      if (!options.isConversationPaneMode()) {
        const targetConversation = options.conversationById(sessionId);
        if (
          targetConversation !== undefined &&
          !targetConversation.live &&
          targetConversation.status !== 'exited'
        ) {
          await options.startConversation(sessionId);
          if (signal?.aborted) {
            return;
          }
        }
        if (targetConversation?.status !== 'exited') {
          const attached = await attachConversationWithRecovery(sessionId, signal);
          if (!attached) {
            return;
          }
        }
        options.enterConversationPaneForActiveSession(sessionId);
        options.noteGitActivity(targetConversation?.directoryId ?? null);
        options.schedulePtyResizeImmediate();
        options.markDirty();
      }
      return;
    }

    options.stopConversationTitleEditForOtherSession(sessionId);
    const previousActiveId = options.getActiveConversationId();
    options.clearSelectionState();
    if (previousActiveId !== null) {
      await options.detachConversation(previousActiveId);
      if (signal?.aborted) {
        return;
      }
    }

    const targetConversation = options.conversationById(sessionId);

    if (
      targetConversation !== undefined &&
      !targetConversation.live &&
      targetConversation.status !== 'exited'
    ) {
      await options.startConversation(sessionId);
      if (signal?.aborted) {
        return;
      }
    }

    if (targetConversation?.status !== 'exited') {
      const attached = await attachConversationWithRecovery(sessionId, signal);
      if (!attached) {
        return;
      }
    }

    options.setActiveConversationId(sessionId);
    options.enterConversationPaneForSessionSwitch(sessionId);
    options.noteGitActivity(targetConversation?.directoryId ?? null);
    options.schedulePtyResizeImmediate();
    options.markDirty();
  }

  return {
    activateConversation,
  };
}

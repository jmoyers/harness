interface RequestStopOptions {
  stop: boolean;
  hasConversationTitleEdit: boolean;
  stopConversationTitleEdit: () => void;
  activeTaskEditorTaskId: string | null;
  autosaveTaskIds: readonly string[];
  flushTaskComposerPersist: (taskId: string) => void;
  closeLiveSessionsOnClientStop: boolean;
  orderedConversationIds: readonly string[];
  conversations: ReadonlyMap<string, { live: boolean }>;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  sendSignal: (sessionId: string, signal: 'interrupt' | 'terminate') => void;
  closeSession: (sessionId: string) => Promise<void>;
  markDirty: () => void;
  setStop: (next: boolean) => void;
}

export function requestStop(options: RequestStopOptions): boolean {
  if (options.stop) {
    return false;
  }
  if (options.hasConversationTitleEdit) {
    options.stopConversationTitleEdit();
  }
  if (options.activeTaskEditorTaskId !== null) {
    options.flushTaskComposerPersist(options.activeTaskEditorTaskId);
  }
  for (const taskId of options.autosaveTaskIds) {
    options.flushTaskComposerPersist(taskId);
  }
  options.setStop(true);
  if (options.closeLiveSessionsOnClientStop) {
    options.queueControlPlaneOp(async () => {
      for (const sessionId of options.orderedConversationIds) {
        const conversation = options.conversations.get(sessionId);
        if (conversation === undefined || !conversation.live) {
          continue;
        }
        options.sendSignal(sessionId, 'interrupt');
        options.sendSignal(sessionId, 'terminate');
        try {
          await options.closeSession(sessionId);
        } catch {
          // Best-effort shutdown only.
        }
      }
    }, 'shutdown-close-live-sessions');
  }
  options.markDirty();
  return true;
}

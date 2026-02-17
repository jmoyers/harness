type ShortcutCycleDirection = 'next' | 'previous';

interface HandleGlobalShortcutOptions {
  shortcut: string | null;
  requestStop: () => void;
  resolveDirectoryForAction: () => string | null;
  openNewThreadPrompt: (directoryId: string) => void;
  resolveConversationForAction: () => string | null;
  conversationsHas: (sessionId: string) => boolean;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  archiveConversation: (sessionId: string) => Promise<void>;
  takeoverConversation: (sessionId: string) => Promise<void>;
  openAddDirectoryPrompt: () => void;
  resolveClosableDirectoryId: () => string | null;
  closeDirectory: (directoryId: string) => Promise<void>;
  cycleLeftNavSelection: (direction: ShortcutCycleDirection) => void;
}

export function handleGlobalShortcut(options: HandleGlobalShortcutOptions): boolean {
  const {
    shortcut,
    requestStop,
    resolveDirectoryForAction,
    openNewThreadPrompt,
    resolveConversationForAction,
    conversationsHas,
    queueControlPlaneOp,
    archiveConversation,
    takeoverConversation,
    openAddDirectoryPrompt,
    resolveClosableDirectoryId,
    closeDirectory,
    cycleLeftNavSelection,
  } = options;
  if (shortcut === null) {
    return false;
  }
  if (shortcut === 'mux.app.interrupt-all' || shortcut === 'mux.app.quit') {
    requestStop();
    return true;
  }
  if (shortcut === 'mux.conversation.new') {
    const targetDirectoryId = resolveDirectoryForAction();
    if (targetDirectoryId !== null) {
      openNewThreadPrompt(targetDirectoryId);
    }
    return true;
  }
  if (shortcut === 'mux.conversation.archive' || shortcut === 'mux.conversation.delete') {
    const targetConversationId = resolveConversationForAction();
    if (targetConversationId !== null && conversationsHas(targetConversationId)) {
      queueControlPlaneOp(async () => {
        await archiveConversation(targetConversationId);
      }, shortcut === 'mux.conversation.archive' ? 'shortcut-archive-conversation' : 'shortcut-delete-conversation');
    }
    return true;
  }
  if (shortcut === 'mux.conversation.takeover') {
    const targetConversationId = resolveConversationForAction();
    if (targetConversationId !== null && conversationsHas(targetConversationId)) {
      queueControlPlaneOp(async () => {
        await takeoverConversation(targetConversationId);
      }, 'shortcut-takeover-conversation');
    }
    return true;
  }
  if (shortcut === 'mux.directory.add') {
    openAddDirectoryPrompt();
    return true;
  }
  if (shortcut === 'mux.directory.close') {
    const targetDirectoryId = resolveClosableDirectoryId();
    if (targetDirectoryId !== null) {
      queueControlPlaneOp(async () => {
        await closeDirectory(targetDirectoryId);
      }, 'shortcut-close-directory');
    }
    return true;
  }
  if (shortcut === 'mux.conversation.next' || shortcut === 'mux.conversation.previous') {
    cycleLeftNavSelection(shortcut === 'mux.conversation.next' ? 'next' : 'previous');
    return true;
  }
  return false;
}

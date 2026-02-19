type ShortcutCycleDirection = 'next' | 'previous';

interface HandleGlobalShortcutOptions {
  shortcut: string | null;
  requestStop: () => void;
  resolveDirectoryForAction: () => string | null;
  openNewThreadPrompt: (directoryId: string) => void;
  toggleCommandMenu: () => void;
  openOrCreateCritiqueConversationInDirectory: (directoryId: string) => Promise<void>;
  toggleGatewayProfile: () => Promise<void>;
  toggleGatewayStatusTimeline: () => Promise<void>;
  toggleGatewayRenderTrace: (conversationId: string | null) => Promise<void>;
  resolveConversationForAction: () => string | null;
  conversationsHas: (sessionId: string) => boolean;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  archiveConversation: (sessionId: string) => Promise<void>;
  interruptConversation: (sessionId: string) => Promise<void>;
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
    toggleCommandMenu,
    openOrCreateCritiqueConversationInDirectory,
    toggleGatewayProfile,
    toggleGatewayStatusTimeline,
    toggleGatewayRenderTrace,
    resolveConversationForAction,
    conversationsHas,
    queueControlPlaneOp,
    archiveConversation,
    interruptConversation,
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
  if (shortcut === 'mux.command-menu.toggle') {
    toggleCommandMenu();
    return true;
  }
  if (shortcut === 'mux.conversation.critique.open-or-create') {
    const targetDirectoryId = resolveDirectoryForAction();
    if (targetDirectoryId !== null) {
      queueControlPlaneOp(async () => {
        await openOrCreateCritiqueConversationInDirectory(targetDirectoryId);
      }, 'shortcut-open-or-create-critique-conversation');
    }
    return true;
  }
  if (shortcut === 'mux.gateway.profile.toggle') {
    queueControlPlaneOp(async () => {
      await toggleGatewayProfile();
    }, 'shortcut-toggle-gateway-profile');
    return true;
  }
  if (shortcut === 'mux.gateway.status-timeline.toggle') {
    queueControlPlaneOp(async () => {
      await toggleGatewayStatusTimeline();
    }, 'shortcut-toggle-gateway-status-timeline');
    return true;
  }
  if (shortcut === 'mux.gateway.render-trace.toggle') {
    const targetConversationId = resolveConversationForAction();
    queueControlPlaneOp(async () => {
      await toggleGatewayRenderTrace(targetConversationId);
    }, 'shortcut-toggle-gateway-render-trace');
    return true;
  }
  if (shortcut === 'mux.conversation.archive' || shortcut === 'mux.conversation.delete') {
    const targetConversationId = resolveConversationForAction();
    if (targetConversationId !== null && conversationsHas(targetConversationId)) {
      queueControlPlaneOp(
        async () => {
          await archiveConversation(targetConversationId);
        },
        shortcut === 'mux.conversation.archive'
          ? 'shortcut-archive-conversation'
          : 'shortcut-delete-conversation',
      );
    }
    return true;
  }
  if (shortcut === 'mux.conversation.interrupt') {
    const targetConversationId = resolveConversationForAction();
    if (targetConversationId !== null && conversationsHas(targetConversationId)) {
      queueControlPlaneOp(async () => {
        await interruptConversation(targetConversationId);
      }, 'shortcut-interrupt-conversation');
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

import { detectConversationDoubleClick } from '../double-click.ts';

interface ConversationTitleEditClickState {
  readonly conversationId: string;
  readonly atMs: number;
}

interface HandleLeftRailConversationClickOptions {
  selectedConversationId: string | null;
  selectedProjectId: string | null;
  supportsConversationTitleEditClick: boolean;
  previousClickState: ConversationTitleEditClickState | null;
  nowMs: number;
  conversationTitleEditDoubleClickWindowMs: number;
  activeConversationId: string | null;
  isConversationPaneActive: boolean;
  setConversationClickState: (next: ConversationTitleEditClickState | null) => void;
  ensureConversationPaneActive: (conversationId: string) => void;
  beginConversationTitleEdit: (conversationId: string) => void;
  queueActivateConversation: (conversationId: string) => void;
  queueActivateConversationAndEdit: (conversationId: string) => void;
  directoriesHas: (directoryId: string) => boolean;
  enterProjectPane: (directoryId: string) => void;
  markDirty: () => void;
}

export function handleLeftRailConversationClick(
  options: HandleLeftRailConversationClickOptions,
): boolean {
  const conversationClick =
    options.selectedConversationId !== null && options.supportsConversationTitleEditClick
      ? detectConversationDoubleClick(
          options.previousClickState,
          options.selectedConversationId,
          options.nowMs,
          options.conversationTitleEditDoubleClickWindowMs,
        )
      : {
          doubleClick: false,
          nextState: null,
        };
  options.setConversationClickState(conversationClick.nextState);

  if (
    options.selectedConversationId !== null &&
    options.selectedConversationId === options.activeConversationId
  ) {
    if (!options.isConversationPaneActive) {
      if (conversationClick.doubleClick) {
        options.queueActivateConversationAndEdit(options.selectedConversationId);
      } else {
        options.queueActivateConversation(options.selectedConversationId);
      }
    } else if (conversationClick.doubleClick) {
      options.beginConversationTitleEdit(options.selectedConversationId);
    }
    options.markDirty();
    return true;
  }

  if (options.selectedConversationId !== null) {
    if (conversationClick.doubleClick) {
      options.queueActivateConversationAndEdit(options.selectedConversationId);
    } else {
      options.queueActivateConversation(options.selectedConversationId);
    }
    options.markDirty();
    return true;
  }

  if (
    options.selectedConversationId === null &&
    options.selectedProjectId !== null &&
    options.directoriesHas(options.selectedProjectId)
  ) {
    options.setConversationClickState(null);
    options.enterProjectPane(options.selectedProjectId);
    options.markDirty();
    return true;
  }

  options.setConversationClickState(null);
  options.markDirty();
  return true;
}

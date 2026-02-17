import {
  actionAtWorkspaceRailCell,
  conversationIdAtWorkspaceRailRow,
  kindAtWorkspaceRailRow,
  projectIdAtWorkspaceRailRow,
  repositoryIdAtWorkspaceRailRow,
} from '../workspace-rail-model.ts';
import type { buildWorkspaceRailViewRows } from '../workspace-rail-model.ts';

export interface LeftRailPointerContext {
  readonly selectedConversationId: string | null;
  readonly selectedProjectId: string | null;
  readonly selectedRepositoryId: string | null;
  readonly selectedAction: string | null;
  readonly supportsConversationTitleEditClick: boolean;
}

interface HandleLeftRailPointerClickOptions {
  clickEligible: boolean;
  rows: ReturnType<typeof buildWorkspaceRailViewRows>;
  paneRows: number;
  leftCols: number;
  pointerRow: number;
  pointerCol: number;
  hasConversationTitleEdit: boolean;
  conversationTitleEditConversationId: string | null;
  stopConversationTitleEdit: () => void;
  hasSelection: boolean;
  clearSelection: () => void;
  handleAction: (context: LeftRailPointerContext) => boolean;
  handleConversation: (context: LeftRailPointerContext) => void;
}

export function handleLeftRailPointerClick(options: HandleLeftRailPointerClickOptions): boolean {
  if (!options.clickEligible) {
    return false;
  }
  const rowIndex = Math.max(0, Math.min(options.paneRows - 1, options.pointerRow - 1));
  const colIndex = Math.max(0, Math.min(options.leftCols - 1, options.pointerCol - 1));
  const selectedConversationId = conversationIdAtWorkspaceRailRow(options.rows, rowIndex);
  const selectedProjectId = projectIdAtWorkspaceRailRow(options.rows, rowIndex);
  const selectedRepositoryId = repositoryIdAtWorkspaceRailRow(options.rows, rowIndex);
  const selectedAction = actionAtWorkspaceRailCell(options.rows, rowIndex, colIndex, options.leftCols);
  const selectedRowKind = kindAtWorkspaceRailRow(options.rows, rowIndex);
  const supportsConversationTitleEditClick =
    selectedRowKind === 'conversation-title' || selectedRowKind === 'conversation-body';
  const keepTitleEditActive =
    options.hasConversationTitleEdit &&
    selectedConversationId === options.conversationTitleEditConversationId &&
    supportsConversationTitleEditClick;
  if (!keepTitleEditActive && options.hasConversationTitleEdit) {
    options.stopConversationTitleEdit();
  }
  if (options.hasSelection) {
    options.clearSelection();
  }
  const context: LeftRailPointerContext = {
    selectedConversationId,
    selectedProjectId,
    selectedRepositoryId,
    selectedAction,
    supportsConversationTitleEditClick,
  };
  if (options.handleAction(context)) {
    return true;
  }
  options.handleConversation(context);
  return true;
}

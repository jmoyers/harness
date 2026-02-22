import type { WorkspaceModel } from '../domain/workspace.ts';
import type { PaneSelection, PaneSelectionDrag } from '../mux/live-mux/selection.ts';

interface RuntimeRenderStateDirectoryLookup {
  hasDirectory(directoryId: string): boolean;
}

interface RuntimeRenderStateConversationLookup<TConversation> {
  readonly activeConversationId: string | null;
  getActiveConversation(): TConversation | null;
}

export interface RuntimeRenderStateOptions<TConversation, TFrame> {
  readonly workspace: WorkspaceModel;
  readonly directories: RuntimeRenderStateDirectoryLookup;
  readonly conversations: RuntimeRenderStateConversationLookup<TConversation>;
  readonly snapshotFrame: (conversation: TConversation) => TFrame;
  readonly selectionVisibleRows: (
    frame: TFrame,
    selection: PaneSelection | null,
  ) => readonly number[];
}

export interface RuntimeRenderStateResult<TConversation, TFrame> {
  readonly projectPaneActive: boolean;
  readonly homePaneActive: boolean;
  readonly activeConversation: TConversation | null;
  readonly rightFrame: TFrame | null;
  readonly renderSelection: PaneSelection | null;
  readonly selectionRows: readonly number[];
}

export class RuntimeRenderState<TConversation, TFrame> {
  constructor(private readonly options: RuntimeRenderStateOptions<TConversation, TFrame>) {}

  prepareRenderState(
    selection: PaneSelection | null,
    selectionDrag: PaneSelectionDrag | null,
  ): RuntimeRenderStateResult<TConversation, TFrame> | null {
    const workspace = this.options.workspace;
    const projectPaneActive =
      workspace.mainPaneMode === 'project' &&
      workspace.activeDirectoryId !== null &&
      this.options.directories.hasDirectory(workspace.activeDirectoryId);
    const homePaneActive = workspace.mainPaneMode === 'home';
    if (
      !projectPaneActive &&
      !homePaneActive &&
      this.options.conversations.activeConversationId === null
    ) {
      return null;
    }

    const activeConversation = this.options.conversations.getActiveConversation();
    if (!projectPaneActive && !homePaneActive && activeConversation === null) {
      return null;
    }

    const rightFrame =
      !projectPaneActive && !homePaneActive && activeConversation !== null
        ? this.options.snapshotFrame(activeConversation)
        : null;
    const renderSelection =
      rightFrame !== null && selectionDrag !== null && selectionDrag.hasDragged
        ? {
            anchor: selectionDrag.anchor,
            focus: selectionDrag.focus,
            text: '',
          }
        : rightFrame !== null
          ? selection
          : null;
    const selectionRows =
      rightFrame === null ? [] : this.options.selectionVisibleRows(rightFrame, renderSelection);
    return {
      projectPaneActive,
      homePaneActive,
      activeConversation,
      rightFrame,
      renderSelection,
      selectionRows,
    };
  }
}

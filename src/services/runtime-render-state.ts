import type { WorkspaceModel } from '../domain/workspace.ts';
import type { PaneSelection, PaneSelectionDrag } from '../mux/live-mux/selection.ts';

interface RuntimeRenderStateOptions<TConversation, TFrame> {
  readonly workspace: WorkspaceModel;
  readonly hasDirectory: (directoryId: string) => boolean;
  readonly activeConversationId: () => string | null;
  readonly activeConversation: () => TConversation | null;
  readonly snapshotFrame: (conversation: TConversation) => TFrame;
  readonly selectionVisibleRows: (
    frame: TFrame,
    selection: PaneSelection | null,
  ) => readonly number[];
}

interface RuntimeRenderStateResult<TConversation, TFrame> {
  readonly projectPaneActive: boolean;
  readonly homePaneActive: boolean;
  readonly nimPaneActive: boolean;
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
      this.options.hasDirectory(workspace.activeDirectoryId);
    const homePaneActive = workspace.mainPaneMode === 'home';
    const nimPaneActive = workspace.mainPaneMode === 'nim';
    if (
      !projectPaneActive &&
      !homePaneActive &&
      !nimPaneActive &&
      this.options.activeConversationId() === null
    ) {
      return null;
    }

    const activeConversation = this.options.activeConversation();
    if (!projectPaneActive && !homePaneActive && !nimPaneActive && activeConversation === null) {
      return null;
    }

    const rightFrame =
      !projectPaneActive && !homePaneActive && !nimPaneActive && activeConversation !== null
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
      nimPaneActive,
      activeConversation,
      rightFrame,
      renderSelection,
      selectionRows,
    };
  }
}

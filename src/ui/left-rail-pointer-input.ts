import { handleLeftRailActionClick } from '../mux/live-mux/left-rail-actions.ts';
import { handleLeftRailConversationClick } from '../mux/live-mux/left-rail-conversation-click.ts';
import {
  handleLeftRailPointerClick,
  type LeftRailPointerContext,
} from '../mux/live-mux/left-rail-pointer.ts';
import type { buildWorkspaceRailViewRows } from '../mux/workspace-rail-model.ts';

export interface ConversationTitleClickState {
  readonly conversationId: string;
  readonly atMs: number;
}

interface LeftRailPointerInputOptions {
  readonly getLatestRailRows: () => ReturnType<typeof buildWorkspaceRailViewRows>;
  readonly hasConversationTitleEdit: () => boolean;
  readonly conversationTitleEditConversationId: () => string | null;
  readonly stopConversationTitleEdit: () => void;
  readonly hasSelection: () => boolean;
  readonly clearSelection: () => void;
  readonly activeConversationId: () => string | null;
  readonly repositoriesCollapsed: () => boolean;
  readonly clearConversationTitleEditClickState: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly queueArchiveConversation: (conversationId: string) => void;
  readonly openAddDirectoryPrompt: () => void;
  readonly openRepositoryPromptForCreate: () => void;
  readonly repositoryExists: (repositoryId: string) => boolean;
  readonly openRepositoryPromptForEdit: (repositoryId: string) => void;
  readonly queueArchiveRepository: (repositoryId: string) => void;
  readonly toggleRepositoryGroup: (repositoryGroupId: string) => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly expandAllRepositoryGroups: () => void;
  readonly collapseAllRepositoryGroups: () => void;
  readonly enterHomePane: () => void;
  readonly enterTasksPane?: () => void;
  readonly queueCloseDirectory: (directoryId: string) => void;
  readonly previousConversationClickState: () => ConversationTitleClickState | null;
  readonly setConversationClickState: (next: ConversationTitleClickState | null) => void;
  readonly nowMs: () => number;
  readonly conversationTitleEditDoubleClickWindowMs: number;
  readonly isConversationPaneActive: () => boolean;
  readonly ensureConversationPaneActive: (conversationId: string) => void;
  readonly beginConversationTitleEdit: (conversationId: string) => void;
  readonly queueActivateConversation: (conversationId: string) => void;
  readonly queueActivateConversationAndEdit: (conversationId: string) => void;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly markDirty: () => void;
}

interface LeftRailPointerInputDependencies {
  readonly handleLeftRailPointerClick?: typeof handleLeftRailPointerClick;
  readonly handleLeftRailActionClick?: typeof handleLeftRailActionClick;
  readonly handleLeftRailConversationClick?: typeof handleLeftRailConversationClick;
}

interface HandlePointerClickInput {
  readonly clickEligible: boolean;
  readonly paneRows: number;
  readonly leftCols: number;
  readonly pointerRow: number;
  readonly pointerCol: number;
}

export class LeftRailPointerInput {
  private readonly pointerClick: typeof handleLeftRailPointerClick;
  private readonly actionClick: typeof handleLeftRailActionClick;
  private readonly conversationClick: typeof handleLeftRailConversationClick;

  constructor(
    private readonly options: LeftRailPointerInputOptions,
    dependencies: LeftRailPointerInputDependencies = {},
  ) {
    this.pointerClick = dependencies.handleLeftRailPointerClick ?? handleLeftRailPointerClick;
    this.actionClick = dependencies.handleLeftRailActionClick ?? handleLeftRailActionClick;
    this.conversationClick =
      dependencies.handleLeftRailConversationClick ?? handleLeftRailConversationClick;
  }

  handlePointerClick(input: HandlePointerClickInput): boolean {
    return this.pointerClick({
      clickEligible: input.clickEligible,
      rows: this.options.getLatestRailRows(),
      paneRows: input.paneRows,
      leftCols: input.leftCols,
      pointerRow: input.pointerRow,
      pointerCol: input.pointerCol,
      hasConversationTitleEdit: this.options.hasConversationTitleEdit(),
      conversationTitleEditConversationId: this.options.conversationTitleEditConversationId(),
      stopConversationTitleEdit: this.options.stopConversationTitleEdit,
      hasSelection: this.options.hasSelection(),
      clearSelection: this.options.clearSelection,
      handleAction: (context) => this.handleAction(context),
      handleConversation: (context) => this.handleConversation(context),
    });
  }

  private handleAction(context: LeftRailPointerContext): boolean {
    return this.actionClick({
      action: context.selectedAction,
      selectedProjectId: context.selectedProjectId,
      selectedRepositoryId: context.selectedRepositoryId,
      activeConversationId: this.options.activeConversationId(),
      repositoriesCollapsed: this.options.repositoriesCollapsed(),
      clearConversationTitleEditClickState: this.options.clearConversationTitleEditClickState,
      resolveDirectoryForAction: this.options.resolveDirectoryForAction,
      openNewThreadPrompt: this.options.openNewThreadPrompt,
      queueArchiveConversation: this.options.queueArchiveConversation,
      openAddDirectoryPrompt: this.options.openAddDirectoryPrompt,
      openRepositoryPromptForCreate: this.options.openRepositoryPromptForCreate,
      repositoryExists: this.options.repositoryExists,
      openRepositoryPromptForEdit: this.options.openRepositoryPromptForEdit,
      queueArchiveRepository: this.options.queueArchiveRepository,
      toggleRepositoryGroup: this.options.toggleRepositoryGroup,
      selectLeftNavRepository: this.options.selectLeftNavRepository,
      expandAllRepositoryGroups: this.options.expandAllRepositoryGroups,
      collapseAllRepositoryGroups: this.options.collapseAllRepositoryGroups,
      enterHomePane: this.options.enterHomePane,
      queueCloseDirectory: this.options.queueCloseDirectory,
      markDirty: this.options.markDirty,
      ...(this.options.enterTasksPane === undefined
        ? {}
        : {
            enterTasksPane: this.options.enterTasksPane,
          }),
    });
  }

  private handleConversation(context: LeftRailPointerContext): void {
    this.conversationClick({
      selectedConversationId: context.selectedConversationId,
      selectedProjectId: context.selectedProjectId,
      supportsConversationTitleEditClick: context.supportsConversationTitleEditClick,
      previousClickState: this.options.previousConversationClickState(),
      nowMs: this.options.nowMs(),
      conversationTitleEditDoubleClickWindowMs:
        this.options.conversationTitleEditDoubleClickWindowMs,
      activeConversationId: this.options.activeConversationId(),
      isConversationPaneActive: this.options.isConversationPaneActive(),
      setConversationClickState: this.options.setConversationClickState,
      ensureConversationPaneActive: this.options.ensureConversationPaneActive,
      beginConversationTitleEdit: this.options.beginConversationTitleEdit,
      queueActivateConversation: this.options.queueActivateConversation,
      queueActivateConversationAndEdit: this.options.queueActivateConversationAndEdit,
      directoriesHas: this.options.directoriesHas,
      enterProjectPane: this.options.enterProjectPane,
      markDirty: this.options.markDirty,
    });
  }
}

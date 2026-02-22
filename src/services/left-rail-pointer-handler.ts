import { detectConversationDoubleClick } from '../mux/double-click.ts';
import {
  actionAtWorkspaceRailCell,
  conversationIdAtWorkspaceRailRow,
  kindAtWorkspaceRailRow,
  projectIdAtWorkspaceRailRow,
  repositoryIdAtWorkspaceRailRow,
  type buildWorkspaceRailViewRows,
} from '../mux/workspace-rail-model.ts';
import type {
  RailPointerHitDispatcher,
  RailPointerHitResolver,
} from '../../packages/harness-ui/src/interaction/rail-pointer-input.ts';

type RailAction = ReturnType<typeof actionAtWorkspaceRailCell>;

interface ConversationTitleClickState {
  readonly conversationId: string;
  readonly atMs: number;
}

interface LeftRailPointerHit {
  readonly selectedConversationId: string | null;
  readonly selectedProjectId: string | null;
  readonly selectedRepositoryId: string | null;
  readonly selectedAction: RailAction;
  readonly supportsConversationTitleEditClick: boolean;
}

interface LeftRailPointerState {
  readonly latestRailRows: () => ReturnType<typeof buildWorkspaceRailViewRows>;
  readonly conversationTitleEditConversationId: () => string | null;
  readonly activeConversationId: () => string | null;
  readonly repositoriesCollapsed: () => boolean;
  readonly resolveDirectoryForAction: () => string | null;
  readonly previousConversationClickState: () => ConversationTitleClickState | null;
  readonly nowMs: () => number;
  readonly isConversationPaneActive: () => boolean;
  readonly directoriesHas: (directoryId: string) => boolean;
}

interface LeftRailPointerActions {
  readonly clearConversationTitleEditClickState: () => void;
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
  readonly enterNimPane?: () => void;
  readonly enterTasksPane?: () => void;
  readonly queueCloseDirectory: (directoryId: string) => void;
  readonly toggleShortcutsCollapsed: () => void;
  readonly setConversationClickState: (next: ConversationTitleClickState | null) => void;
  readonly ensureConversationPaneActive: (conversationId: string) => void;
  readonly beginConversationTitleEdit: (conversationId: string) => void;
  readonly queueActivateConversation: (conversationId: string) => void;
  readonly queueActivateConversationAndEdit: (conversationId: string) => void;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly enterGitHubPane?: (directoryId: string) => void;
  readonly toggleGitHubProjectExpanded?: (directoryId: string) => void;
  readonly markDirty: () => void;
}

interface LeftRailPointerConfig {
  readonly conversationTitleEditDoubleClickWindowMs: number;
}

export class LeftRailPointerHandler
  implements
    RailPointerHitResolver<LeftRailPointerHit>,
    RailPointerHitDispatcher<LeftRailPointerHit>
{
  constructor(
    private readonly state: LeftRailPointerState,
    private readonly actions: LeftRailPointerActions,
    private readonly config: LeftRailPointerConfig,
  ) {}

  resolveHit(rowIndex: number, colIndex: number, railCols: number): LeftRailPointerHit {
    const rows = this.state.latestRailRows();
    const selectedConversationId = conversationIdAtWorkspaceRailRow(rows, rowIndex);
    const selectedProjectId = projectIdAtWorkspaceRailRow(rows, rowIndex);
    const selectedRepositoryId = repositoryIdAtWorkspaceRailRow(rows, rowIndex);
    const selectedAction = actionAtWorkspaceRailCell(rows, rowIndex, colIndex, railCols);
    const selectedRowKind = kindAtWorkspaceRailRow(rows, rowIndex);
    return {
      selectedConversationId,
      selectedProjectId,
      selectedRepositoryId,
      selectedAction,
      supportsConversationTitleEditClick:
        selectedRowKind === 'conversation-title' || selectedRowKind === 'conversation-body',
    };
  }

  shouldKeepConversationTitleEditActive(hit: LeftRailPointerHit): boolean {
    const editConversationId = this.state.conversationTitleEditConversationId();
    return (
      editConversationId !== null &&
      hit.selectedConversationId === editConversationId &&
      hit.supportsConversationTitleEditClick
    );
  }

  dispatchHit(hit: LeftRailPointerHit): boolean {
    if (this.handleAction(hit)) {
      return true;
    }
    this.handleConversation(hit);
    return true;
  }

  private handleAction(hit: LeftRailPointerHit): boolean {
    const targetDirectoryId = hit.selectedProjectId ?? this.state.resolveDirectoryForAction();
    if (hit.selectedAction === 'conversation.new') {
      this.actions.clearConversationTitleEditClickState();
      if (targetDirectoryId !== null) {
        this.actions.openNewThreadPrompt(targetDirectoryId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'conversation.delete') {
      this.actions.clearConversationTitleEditClickState();
      const activeConversationId = this.state.activeConversationId();
      if (activeConversationId !== null) {
        this.actions.queueArchiveConversation(activeConversationId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'project.add') {
      this.actions.clearConversationTitleEditClickState();
      this.actions.openAddDirectoryPrompt();
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'repository.add') {
      this.actions.clearConversationTitleEditClickState();
      this.actions.openRepositoryPromptForCreate();
      return true;
    }

    if (hit.selectedAction === 'repository.edit') {
      this.actions.clearConversationTitleEditClickState();
      if (
        hit.selectedRepositoryId !== null &&
        this.actions.repositoryExists(hit.selectedRepositoryId)
      ) {
        this.actions.openRepositoryPromptForEdit(hit.selectedRepositoryId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'repository.archive') {
      this.actions.clearConversationTitleEditClickState();
      if (
        hit.selectedRepositoryId !== null &&
        this.actions.repositoryExists(hit.selectedRepositoryId)
      ) {
        this.actions.queueArchiveRepository(hit.selectedRepositoryId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'repository.toggle') {
      this.actions.clearConversationTitleEditClickState();
      if (hit.selectedRepositoryId !== null) {
        this.actions.toggleRepositoryGroup(hit.selectedRepositoryId);
        this.actions.selectLeftNavRepository(hit.selectedRepositoryId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'repositories.toggle') {
      this.actions.clearConversationTitleEditClickState();
      if (this.state.repositoriesCollapsed()) {
        this.actions.expandAllRepositoryGroups();
      } else {
        this.actions.collapseAllRepositoryGroups();
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'home.open') {
      this.actions.clearConversationTitleEditClickState();
      this.actions.enterHomePane();
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'nim.open') {
      this.actions.clearConversationTitleEditClickState();
      if (this.actions.enterNimPane !== undefined) {
        this.actions.enterNimPane();
      } else {
        this.actions.enterHomePane();
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'tasks.open') {
      this.actions.clearConversationTitleEditClickState();
      if (this.actions.enterTasksPane !== undefined) {
        this.actions.enterTasksPane();
      } else {
        this.actions.enterHomePane();
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'project.close') {
      this.actions.clearConversationTitleEditClickState();
      if (targetDirectoryId !== null) {
        this.actions.queueCloseDirectory(targetDirectoryId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'project.github.open') {
      this.actions.clearConversationTitleEditClickState();
      if (targetDirectoryId !== null && this.state.directoriesHas(targetDirectoryId)) {
        if (this.actions.enterGitHubPane !== undefined) {
          this.actions.enterGitHubPane(targetDirectoryId);
        } else {
          this.actions.enterProjectPane(targetDirectoryId);
        }
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'project.github.toggle') {
      this.actions.clearConversationTitleEditClickState();
      if (
        targetDirectoryId !== null &&
        this.state.directoriesHas(targetDirectoryId) &&
        this.actions.toggleGitHubProjectExpanded !== undefined
      ) {
        this.actions.toggleGitHubProjectExpanded(targetDirectoryId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedAction === 'shortcuts.toggle') {
      this.actions.clearConversationTitleEditClickState();
      this.actions.toggleShortcutsCollapsed();
      this.actions.markDirty();
      return true;
    }

    return false;
  }

  private handleConversation(hit: LeftRailPointerHit): boolean {
    const conversationClick =
      hit.selectedConversationId !== null && hit.supportsConversationTitleEditClick
        ? detectConversationDoubleClick(
            this.state.previousConversationClickState(),
            hit.selectedConversationId,
            this.state.nowMs(),
            this.config.conversationTitleEditDoubleClickWindowMs,
          )
        : {
            doubleClick: false,
            nextState: null,
          };
    this.actions.setConversationClickState(conversationClick.nextState);

    const activeConversationId = this.state.activeConversationId();
    if (
      hit.selectedConversationId !== null &&
      hit.selectedConversationId === activeConversationId
    ) {
      if (!this.state.isConversationPaneActive()) {
        if (conversationClick.doubleClick) {
          this.actions.queueActivateConversationAndEdit(hit.selectedConversationId);
        } else {
          this.actions.queueActivateConversation(hit.selectedConversationId);
        }
      } else if (conversationClick.doubleClick) {
        this.actions.beginConversationTitleEdit(hit.selectedConversationId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedConversationId !== null) {
      if (conversationClick.doubleClick) {
        this.actions.queueActivateConversationAndEdit(hit.selectedConversationId);
      } else {
        this.actions.queueActivateConversation(hit.selectedConversationId);
      }
      this.actions.markDirty();
      return true;
    }

    if (hit.selectedProjectId !== null && this.state.directoriesHas(hit.selectedProjectId)) {
      this.actions.setConversationClickState(null);
      this.actions.enterProjectPane(hit.selectedProjectId);
      this.actions.markDirty();
      return true;
    }

    this.actions.setConversationClickState(null);
    this.actions.markDirty();
    return true;
  }
}

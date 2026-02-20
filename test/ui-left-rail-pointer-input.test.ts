import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  LeftRailPointerInput,
  type ConversationTitleClickState,
} from '../src/ui/left-rail-pointer-input.ts';

void test('left-rail pointer input delegates action and conversation routing', () => {
  const calls: string[] = [];
  let clickState: ConversationTitleClickState | null = { conversationId: 'prev', atMs: 5 };
  const input = new LeftRailPointerInput(
    {
      getLatestRailRows: () => [] as never,
      hasConversationTitleEdit: () => true,
      conversationTitleEditConversationId: () => 'session-a',
      stopConversationTitleEdit: () => {
        calls.push('stop-title-edit');
      },
      hasSelection: () => true,
      clearSelection: () => {
        calls.push('clear-selection');
      },
      activeConversationId: () => 'session-active',
      repositoriesCollapsed: () => true,
      clearConversationTitleEditClickState: () => {
        calls.push('clear-click-state');
      },
      resolveDirectoryForAction: () => 'dir-a',
      openNewThreadPrompt: (directoryId) => {
        calls.push(`new-thread:${directoryId}`);
      },
      queueArchiveConversation: (conversationId) => {
        calls.push(`archive-conversation:${conversationId}`);
      },
      openAddDirectoryPrompt: () => {
        calls.push('open-add-directory');
      },
      openRepositoryPromptForCreate: () => {
        calls.push('open-repository-create');
      },
      repositoryExists: (repositoryId) => {
        calls.push(`repository-exists:${repositoryId}`);
        return true;
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        calls.push(`open-repository-edit:${repositoryId}`);
      },
      queueArchiveRepository: (repositoryId) => {
        calls.push(`archive-repository:${repositoryId}`);
      },
      toggleRepositoryGroup: (repositoryId) => {
        calls.push(`toggle-repository:${repositoryId}`);
      },
      selectLeftNavRepository: (repositoryId) => {
        calls.push(`select-repository:${repositoryId}`);
      },
      expandAllRepositoryGroups: () => {
        calls.push('expand-all-repositories');
      },
      collapseAllRepositoryGroups: () => {
        calls.push('collapse-all-repositories');
      },
      enterHomePane: () => {
        calls.push('enter-home');
      },
      queueCloseDirectory: (directoryId) => {
        calls.push(`close-directory:${directoryId}`);
      },
      previousConversationClickState: () => clickState,
      setConversationClickState: (next) => {
        clickState = next;
        calls.push(`set-click-state:${next?.conversationId ?? 'null'}`);
      },
      nowMs: () => 42,
      conversationTitleEditDoubleClickWindowMs: 250,
      isConversationPaneActive: () => false,
      ensureConversationPaneActive: (conversationId) => {
        calls.push(`ensure-conversation-pane:${conversationId}`);
      },
      beginConversationTitleEdit: (conversationId) => {
        calls.push(`begin-title-edit:${conversationId}`);
      },
      queueActivateConversation: (conversationId) => {
        calls.push(`activate-conversation:${conversationId}`);
      },
      queueActivateConversationAndEdit: (conversationId) => {
        calls.push(`activate-and-edit:${conversationId}`);
      },
      directoriesHas: (directoryId) => {
        calls.push(`directory-exists:${directoryId}`);
        return true;
      },
      enterProjectPane: (directoryId) => {
        calls.push(`enter-project:${directoryId}`);
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
    },
    {
      handleLeftRailPointerClick: (options) => {
        calls.push(
          `pointer:${options.clickEligible}:${options.paneRows}:${options.leftCols}:${options.pointerRow}:${options.pointerCol}`,
        );
        options.stopConversationTitleEdit();
        options.clearSelection();
        const context = {
          selectedConversationId: 'session-a',
          selectedProjectId: 'dir-a',
          selectedRepositoryId: 'repo-a',
          selectedAction: 'conversation.new',
          supportsConversationTitleEditClick: true,
        } as const;
        options.handleAction(context);
        options.handleConversation(context);
        return true;
      },
      handleLeftRailActionClick: (options) => {
        calls.push(`action:${options.action}`);
        options.clearConversationTitleEditClickState();
        options.openNewThreadPrompt(
          options.selectedProjectId ?? options.resolveDirectoryForAction() ?? 'none',
        );
        options.queueArchiveConversation(options.activeConversationId ?? 'none');
        options.openAddDirectoryPrompt();
        options.openRepositoryPromptForCreate();
        if (
          options.selectedRepositoryId !== null &&
          options.repositoryExists(options.selectedRepositoryId)
        ) {
          options.openRepositoryPromptForEdit(options.selectedRepositoryId);
          options.queueArchiveRepository(options.selectedRepositoryId);
          options.toggleRepositoryGroup(options.selectedRepositoryId);
          options.selectLeftNavRepository(options.selectedRepositoryId);
        }
        if (options.repositoriesCollapsed) {
          options.expandAllRepositoryGroups();
        } else {
          options.collapseAllRepositoryGroups();
        }
        options.enterHomePane();
        options.queueCloseDirectory(
          options.selectedProjectId ?? options.resolveDirectoryForAction() ?? 'none',
        );
        options.markDirty();
        return true;
      },
      handleLeftRailConversationClick: (options) => {
        calls.push(`conversation:${options.selectedConversationId ?? 'none'}`);
        calls.push(`previous-click:${options.previousClickState?.conversationId ?? 'none'}`);
        options.setConversationClickState({ conversationId: 'session-next', atMs: options.nowMs });
        if (!options.isConversationPaneActive && options.selectedConversationId !== null) {
          options.ensureConversationPaneActive(options.selectedConversationId);
          options.beginConversationTitleEdit(options.selectedConversationId);
          options.queueActivateConversation(options.selectedConversationId);
          options.queueActivateConversationAndEdit(options.selectedConversationId);
        }
        if (
          options.selectedProjectId !== null &&
          options.directoriesHas(options.selectedProjectId)
        ) {
          options.enterProjectPane(options.selectedProjectId);
        }
        options.markDirty();
        return true;
      },
    },
  );

  const handled = input.handlePointerClick({
    clickEligible: true,
    paneRows: 22,
    leftCols: 40,
    pointerRow: 7,
    pointerCol: 3,
  });

  assert.equal(handled, true);
  assert.equal(clickState?.conversationId, 'session-next');
  assert.deepEqual(calls, [
    'pointer:true:22:40:7:3',
    'stop-title-edit',
    'clear-selection',
    'action:conversation.new',
    'clear-click-state',
    'new-thread:dir-a',
    'archive-conversation:session-active',
    'open-add-directory',
    'open-repository-create',
    'repository-exists:repo-a',
    'open-repository-edit:repo-a',
    'archive-repository:repo-a',
    'toggle-repository:repo-a',
    'select-repository:repo-a',
    'expand-all-repositories',
    'enter-home',
    'close-directory:dir-a',
    'mark-dirty',
    'conversation:session-a',
    'previous-click:prev',
    'set-click-state:session-next',
    'ensure-conversation-pane:session-a',
    'begin-title-edit:session-a',
    'activate-conversation:session-a',
    'activate-and-edit:session-a',
    'directory-exists:dir-a',
    'enter-project:dir-a',
    'mark-dirty',
  ]);
});

void test('left-rail pointer input default dependencies handle ineligible clicks', () => {
  const input = new LeftRailPointerInput({
    getLatestRailRows: () => [] as never,
    hasConversationTitleEdit: () => false,
    conversationTitleEditConversationId: () => null,
    stopConversationTitleEdit: () => {},
    hasSelection: () => false,
    clearSelection: () => {},
    activeConversationId: () => null,
    repositoriesCollapsed: () => false,
    clearConversationTitleEditClickState: () => {},
    resolveDirectoryForAction: () => null,
    openNewThreadPrompt: () => {},
    queueArchiveConversation: () => {},
    openAddDirectoryPrompt: () => {},
    openRepositoryPromptForCreate: () => {},
    repositoryExists: () => false,
    openRepositoryPromptForEdit: () => {},
    queueArchiveRepository: () => {},
    toggleRepositoryGroup: () => {},
    selectLeftNavRepository: () => {},
    expandAllRepositoryGroups: () => {},
    collapseAllRepositoryGroups: () => {},
    enterHomePane: () => {},
    queueCloseDirectory: () => {},
    previousConversationClickState: () => null,
    setConversationClickState: () => {},
    nowMs: () => 0,
    conversationTitleEditDoubleClickWindowMs: 250,
    isConversationPaneActive: () => false,
    ensureConversationPaneActive: () => {},
    beginConversationTitleEdit: () => {},
    queueActivateConversation: () => {},
    queueActivateConversationAndEdit: () => {},
    directoriesHas: () => false,
    enterProjectPane: () => {},
    markDirty: () => {},
  });

  assert.equal(
    input.handlePointerClick({
      clickEligible: false,
      paneRows: 10,
      leftCols: 30,
      pointerRow: 1,
      pointerCol: 1,
    }),
    false,
  );
});

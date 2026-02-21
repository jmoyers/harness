import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RailPointerInput } from '../packages/harness-ui/src/interaction/rail-pointer-input.ts';
import { LeftRailPointerHandler } from '../src/services/left-rail-pointer-handler.ts';
import type { buildWorkspaceRailViewRows } from '../src/mux/workspace-rail-model.ts';

type RailRows = ReturnType<typeof buildWorkspaceRailViewRows>;

void test('rail pointer input clamps coordinates and applies edit/selection guards', () => {
  const calls: string[] = [];
  const pointerInput = new RailPointerInput(
    {
      resolveHit: (rowIndex, colIndex, railCols) => {
        calls.push(`resolve:${rowIndex}:${colIndex}:${railCols}`);
        return {
          keepEdit: false,
        };
      },
    },
    {
      dispatchHit: () => {
        calls.push('dispatch');
        return true;
      },
    },
    {
      hasActiveEdit: () => true,
      shouldKeepActiveEdit: (hit) => hit.keepEdit,
      stopActiveEdit: () => {
        calls.push('stop-edit');
      },
    },
    {
      hasSelection: () => true,
      clearSelection: () => {
        calls.push('clear-selection');
      },
    },
  );

  assert.equal(
    pointerInput.handlePointerClick({
      clickEligible: true,
      paneRows: 3,
      leftCols: 4,
      pointerRow: 999,
      pointerCol: 999,
    }),
    true,
  );
  assert.deepEqual(calls, ['resolve:2:3:4', 'stop-edit', 'clear-selection', 'dispatch']);
});

void test('left rail pointer handler resolves hit and dispatches action flow', () => {
  const calls: string[] = [];
  const rows = [
    {
      kind: 'action',
      text: 'add project',
      active: false,
      conversationSessionId: null,
      directoryKey: 'dir-a',
      repositoryId: null,
      railAction: 'project.add',
      conversationStatus: null,
    },
  ] as unknown as RailRows;
  const handler = new LeftRailPointerHandler(
    {
      latestRailRows: () => rows,
      conversationTitleEditConversationId: () => null,
      activeConversationId: () => null,
      repositoriesCollapsed: () => false,
      resolveDirectoryForAction: () => null,
      previousConversationClickState: () => null,
      nowMs: () => 0,
      isConversationPaneActive: () => true,
      directoriesHas: () => false,
    },
    {
      clearConversationTitleEditClickState: () => {
        calls.push('clearConversationTitleEditClickState');
      },
      openNewThreadPrompt: () => {
        calls.push('openNewThreadPrompt');
      },
      queueArchiveConversation: () => {
        calls.push('queueArchiveConversation');
      },
      openAddDirectoryPrompt: () => {
        calls.push('openAddDirectoryPrompt');
      },
      openRepositoryPromptForCreate: () => {
        calls.push('openRepositoryPromptForCreate');
      },
      repositoryExists: () => false,
      openRepositoryPromptForEdit: () => {
        calls.push('openRepositoryPromptForEdit');
      },
      queueArchiveRepository: () => {
        calls.push('queueArchiveRepository');
      },
      toggleRepositoryGroup: () => {
        calls.push('toggleRepositoryGroup');
      },
      selectLeftNavRepository: () => {
        calls.push('selectLeftNavRepository');
      },
      expandAllRepositoryGroups: () => {
        calls.push('expandAllRepositoryGroups');
      },
      collapseAllRepositoryGroups: () => {
        calls.push('collapseAllRepositoryGroups');
      },
      enterHomePane: () => {
        calls.push('enterHomePane');
      },
      queueCloseDirectory: () => {
        calls.push('queueCloseDirectory');
      },
      toggleShortcutsCollapsed: () => {
        calls.push('toggleShortcutsCollapsed');
      },
      setConversationClickState: () => {
        calls.push('setConversationClickState');
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: () => {
        calls.push('beginConversationTitleEdit');
      },
      queueActivateConversation: () => {
        calls.push('queueActivateConversation');
      },
      queueActivateConversationAndEdit: () => {
        calls.push('queueActivateConversationAndEdit');
      },
      enterProjectPane: () => {
        calls.push('enterProjectPane');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    {
      conversationTitleEditDoubleClickWindowMs: 250,
    },
  );

  const hit = handler.resolveHit(0, 0, 40);
  assert.equal(hit.selectedAction, 'project.add');
  assert.equal(handler.dispatchHit(hit), true);
  assert.deepEqual(calls, [
    'clearConversationTitleEditClickState',
    'openAddDirectoryPrompt',
    'markDirty',
  ]);
});

void test('left rail pointer handler dispatches conversation flow and keep-edit check', () => {
  const calls: string[] = [];
  const rows = [
    {
      kind: 'conversation-title',
      text: 'thread',
      active: false,
      conversationSessionId: 'session-a',
      directoryKey: 'dir-a',
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
  ] as unknown as RailRows;
  const handler = new LeftRailPointerHandler(
    {
      latestRailRows: () => rows,
      conversationTitleEditConversationId: () => 'session-a',
      activeConversationId: () => 'session-a',
      repositoriesCollapsed: () => false,
      resolveDirectoryForAction: () => null,
      previousConversationClickState: () => ({
        conversationId: 'session-a',
        atMs: 900,
      }),
      nowMs: () => 1000,
      isConversationPaneActive: () => true,
      directoriesHas: () => true,
    },
    {
      clearConversationTitleEditClickState: () => {
        calls.push('clearConversationTitleEditClickState');
      },
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
      toggleShortcutsCollapsed: () => {},
      setConversationClickState: (next) => {
        calls.push(`setConversationClickState:${next?.conversationId ?? 'null'}`);
      },
      ensureConversationPaneActive: () => {
        calls.push('ensureConversationPaneActive');
      },
      beginConversationTitleEdit: (conversationId) => {
        calls.push(`beginConversationTitleEdit:${conversationId}`);
      },
      queueActivateConversation: (conversationId) => {
        calls.push(`queueActivateConversation:${conversationId}`);
      },
      queueActivateConversationAndEdit: (conversationId) => {
        calls.push(`queueActivateConversationAndEdit:${conversationId}`);
      },
      enterProjectPane: (directoryId) => {
        calls.push(`enterProjectPane:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    {
      conversationTitleEditDoubleClickWindowMs: 200,
    },
  );

  const hit = handler.resolveHit(0, 0, 40);
  assert.equal(handler.shouldKeepConversationTitleEditActive(hit), true);
  assert.equal(handler.dispatchHit(hit), true);
  assert.deepEqual(calls, [
    'setConversationClickState:null',
    'beginConversationTitleEdit:session-a',
    'markDirty',
  ]);
});

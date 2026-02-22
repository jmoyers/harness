import type { WorkspaceModel } from '../domain/workspace.ts';

interface RepositoryRecordShape {
  readonly repositoryId: string;
  readonly remoteUrl: string;
  readonly metadata: Record<string, unknown>;
}

interface RuntimeRepositoryActionService<TRepository extends RepositoryRecordShape> {
  upsertRepository(input: {
    repositoryId?: string;
    name: string;
    remoteUrl: string;
    defaultBranch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<TRepository>;
  updateRepository(input: {
    repositoryId: string;
    name?: string;
    remoteUrl?: string;
    defaultBranch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<TRepository>;
  archiveRepository(repositoryId: string): Promise<unknown>;
}

export interface RuntimeRepositoryActionsOptions<TRepository extends RepositoryRecordShape> {
  readonly workspace: WorkspaceModel;
  readonly repositories: Map<string, TRepository>;
  readonly controlPlaneService: RuntimeRepositoryActionService<TRepository>;
  readonly normalizeGitHubRemoteUrl: (value: string) => string | null;
  readonly repositoryNameFromGitHubRemoteUrl: (value: string) => string;
  readonly createRepositoryId: () => string;
  readonly stopConversationTitleEdit: () => void;
  readonly syncRepositoryAssociationsWithDirectorySnapshots: () => void;
  readonly syncTaskPaneRepositorySelection: () => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly markDirty: () => void;
}

function repositoryHomePriority(repository: RepositoryRecordShape): number | null {
  const raw = repository.metadata['homePriority'];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return null;
  }
  if (!Number.isInteger(raw) || raw < 0) {
    return null;
  }
  return raw;
}

export interface RuntimeRepositoryActions {
  openRepositoryPromptForCreate(): void;
  openRepositoryPromptForEdit(repositoryId: string): void;
  queueRepositoryPriorityOrder(orderedRepositoryIds: readonly string[], label: string): void;
  reorderRepositoryByDrop(
    draggedRepositoryId: string,
    targetRepositoryId: string,
    orderedRepositoryIds: readonly string[],
  ): void;
  upsertRepositoryByRemoteUrl(remoteUrl: string, existingRepositoryId?: string): Promise<void>;
  archiveRepositoryById(repositoryId: string): Promise<void>;
}

export function createRuntimeRepositoryActions<TRepository extends RepositoryRecordShape>(
  options: RuntimeRepositoryActionsOptions<TRepository>,
): RuntimeRepositoryActions {
  const reorderIdsByMove = (
    orderedIds: readonly string[],
    movedId: string,
    targetId: string,
  ): readonly string[] | null => {
    const fromIndex = orderedIds.indexOf(movedId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
      return null;
    }
    const reordered = [...orderedIds];
    const moved = reordered.splice(fromIndex, 1)[0]!;
    reordered.splice(targetIndex, 0, moved);
    return reordered;
  };

  const openRepositoryPromptForCreate = (): void => {
    options.workspace.newThreadPrompt = null;
    options.workspace.addDirectoryPrompt = null;
    options.workspace.apiKeyPrompt = null;
    if (options.workspace.conversationTitleEdit !== null) {
      options.stopConversationTitleEdit();
    }
    options.workspace.conversationTitleEditClickState = null;
    options.workspace.repositoryPrompt = {
      mode: 'add',
      repositoryId: null,
      value: '',
      error: null,
    };
    options.markDirty();
  };

  const openRepositoryPromptForEdit = (repositoryId: string): void => {
    const repository = options.repositories.get(repositoryId);
    if (repository === undefined) {
      return;
    }
    options.workspace.newThreadPrompt = null;
    options.workspace.addDirectoryPrompt = null;
    options.workspace.apiKeyPrompt = null;
    if (options.workspace.conversationTitleEdit !== null) {
      options.stopConversationTitleEdit();
    }
    options.workspace.conversationTitleEditClickState = null;
    options.workspace.repositoryPrompt = {
      mode: 'edit',
      repositoryId,
      value: repository.remoteUrl,
      error: null,
    };
    options.workspace.taskPaneSelectionFocus = 'repository';
    options.markDirty();
  };

  const queueRepositoryPriorityOrder = (
    orderedRepositoryIds: readonly string[],
    label: string,
  ): void => {
    const updates: Array<{ repositoryId: string; metadata: Record<string, unknown> }> = [];
    for (let index = 0; index < orderedRepositoryIds.length; index += 1) {
      const repositoryId = orderedRepositoryIds[index]!;
      const repository = options.repositories.get(repositoryId);
      if (repository === undefined) {
        continue;
      }
      if (repositoryHomePriority(repository) === index) {
        continue;
      }
      updates.push({
        repositoryId,
        metadata: {
          ...repository.metadata,
          homePriority: index,
        },
      });
    }
    if (updates.length === 0) {
      return;
    }
    options.queueControlPlaneOp(async () => {
      for (const update of updates) {
        const repository = await options.controlPlaneService.updateRepository({
          repositoryId: update.repositoryId,
          metadata: update.metadata,
        });
        options.repositories.set(repository.repositoryId, repository);
      }
      options.syncTaskPaneRepositorySelection();
      options.markDirty();
    }, label);
  };

  const reorderRepositoryByDrop = (
    draggedRepositoryId: string,
    targetRepositoryId: string,
    orderedRepositoryIds: readonly string[],
  ): void => {
    const reordered = reorderIdsByMove(orderedRepositoryIds, draggedRepositoryId, targetRepositoryId);
    if (reordered === null) {
      return;
    }
    queueRepositoryPriorityOrder(reordered, 'repositories-reorder-drag');
  };

  const upsertRepositoryByRemoteUrl = async (
    remoteUrl: string,
    existingRepositoryId?: string,
  ): Promise<void> => {
    const normalizedRemoteUrl = options.normalizeGitHubRemoteUrl(remoteUrl);
    if (normalizedRemoteUrl === null) {
      throw new Error('github url required');
    }
    const repositoryName = options.repositoryNameFromGitHubRemoteUrl(normalizedRemoteUrl);
    const repository =
      existingRepositoryId === undefined
        ? await options.controlPlaneService.upsertRepository({
            repositoryId: options.createRepositoryId(),
            name: repositoryName,
            remoteUrl: normalizedRemoteUrl,
            defaultBranch: 'main',
            metadata: {
              source: 'mux-manual',
            },
          })
        : await options.controlPlaneService.updateRepository({
            repositoryId: existingRepositoryId,
            name: repositoryName,
            remoteUrl: normalizedRemoteUrl,
          });
    options.repositories.set(repository.repositoryId, repository);
    options.syncRepositoryAssociationsWithDirectorySnapshots();
    options.syncTaskPaneRepositorySelection();
    options.markDirty();
  };

  const archiveRepositoryById = async (repositoryId: string): Promise<void> => {
    await options.controlPlaneService.archiveRepository(repositoryId);
    options.repositories.delete(repositoryId);
    options.syncRepositoryAssociationsWithDirectorySnapshots();
    options.syncTaskPaneRepositorySelection();
    options.markDirty();
  };

  return {
    openRepositoryPromptForCreate,
    openRepositoryPromptForEdit,
    queueRepositoryPriorityOrder,
    reorderRepositoryByDrop,
    upsertRepositoryByRemoteUrl,
    archiveRepositoryById,
  };
}

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

interface RuntimeRepositoryActionsOptions<TRepository extends RepositoryRecordShape> {
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

export class RuntimeRepositoryActions<TRepository extends RepositoryRecordShape> {
  constructor(private readonly options: RuntimeRepositoryActionsOptions<TRepository>) {}

  openRepositoryPromptForCreate(): void {
    this.options.workspace.newThreadPrompt = null;
    this.options.workspace.addDirectoryPrompt = null;
    this.options.workspace.apiKeyPrompt = null;
    if (this.options.workspace.conversationTitleEdit !== null) {
      this.options.stopConversationTitleEdit();
    }
    this.options.workspace.conversationTitleEditClickState = null;
    this.options.workspace.repositoryPrompt = {
      mode: 'add',
      repositoryId: null,
      value: '',
      error: null,
    };
    this.options.markDirty();
  }

  openRepositoryPromptForEdit(repositoryId: string): void {
    const repository = this.options.repositories.get(repositoryId);
    if (repository === undefined) {
      return;
    }
    this.options.workspace.newThreadPrompt = null;
    this.options.workspace.addDirectoryPrompt = null;
    this.options.workspace.apiKeyPrompt = null;
    if (this.options.workspace.conversationTitleEdit !== null) {
      this.options.stopConversationTitleEdit();
    }
    this.options.workspace.conversationTitleEditClickState = null;
    this.options.workspace.repositoryPrompt = {
      mode: 'edit',
      repositoryId,
      value: repository.remoteUrl,
      error: null,
    };
    this.options.workspace.taskPaneSelectionFocus = 'repository';
    this.options.markDirty();
  }

  queueRepositoryPriorityOrder(orderedRepositoryIds: readonly string[], label: string): void {
    const updates: Array<{ repositoryId: string; metadata: Record<string, unknown> }> = [];
    for (let index = 0; index < orderedRepositoryIds.length; index += 1) {
      const repositoryId = orderedRepositoryIds[index]!;
      const repository = this.options.repositories.get(repositoryId);
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
    this.options.queueControlPlaneOp(async () => {
      for (const update of updates) {
        const repository = await this.options.controlPlaneService.updateRepository({
          repositoryId: update.repositoryId,
          metadata: update.metadata,
        });
        this.options.repositories.set(repository.repositoryId, repository);
      }
      this.options.syncTaskPaneRepositorySelection();
      this.options.markDirty();
    }, label);
  }

  reorderRepositoryByDrop(
    draggedRepositoryId: string,
    targetRepositoryId: string,
    orderedRepositoryIds: readonly string[],
  ): void {
    const reordered = this.reorderIdsByMove(
      orderedRepositoryIds,
      draggedRepositoryId,
      targetRepositoryId,
    );
    if (reordered === null) {
      return;
    }
    this.queueRepositoryPriorityOrder(reordered, 'repositories-reorder-drag');
  }

  async upsertRepositoryByRemoteUrl(
    remoteUrl: string,
    existingRepositoryId?: string,
  ): Promise<void> {
    const normalizedRemoteUrl = this.options.normalizeGitHubRemoteUrl(remoteUrl);
    if (normalizedRemoteUrl === null) {
      throw new Error('github url required');
    }
    const repositoryName = this.options.repositoryNameFromGitHubRemoteUrl(normalizedRemoteUrl);
    const repository =
      existingRepositoryId === undefined
        ? await this.options.controlPlaneService.upsertRepository({
            repositoryId: this.options.createRepositoryId(),
            name: repositoryName,
            remoteUrl: normalizedRemoteUrl,
            defaultBranch: 'main',
            metadata: {
              source: 'mux-manual',
            },
          })
        : await this.options.controlPlaneService.updateRepository({
            repositoryId: existingRepositoryId,
            name: repositoryName,
            remoteUrl: normalizedRemoteUrl,
          });
    this.options.repositories.set(repository.repositoryId, repository);
    this.options.syncRepositoryAssociationsWithDirectorySnapshots();
    this.options.syncTaskPaneRepositorySelection();
    this.options.markDirty();
  }

  async archiveRepositoryById(repositoryId: string): Promise<void> {
    await this.options.controlPlaneService.archiveRepository(repositoryId);
    this.options.repositories.delete(repositoryId);
    this.options.syncRepositoryAssociationsWithDirectorySnapshots();
    this.options.syncTaskPaneRepositorySelection();
    this.options.markDirty();
  }

  private reorderIdsByMove(
    orderedIds: readonly string[],
    movedId: string,
    targetId: string,
  ): readonly string[] | null {
    const fromIndex = orderedIds.indexOf(movedId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
      return null;
    }
    const reordered = [...orderedIds];
    const moved = reordered.splice(fromIndex, 1)[0]!;
    reordered.splice(targetIndex, 0, moved);
    return reordered;
  }
}

interface RepositoryRecordWithMetadata {
  readonly repositoryId: string;
  readonly remoteUrl: string;
  readonly metadata: Record<string, unknown>;
}

interface RepositoryPromptState {
  readonly mode: 'add' | 'edit';
  readonly repositoryId: string | null;
  readonly value: string;
  readonly error: string | null;
}

interface OpenRepositoryPromptForCreateOptions {
  clearNewThreadPrompt: () => void;
  clearAddDirectoryPrompt: () => void;
  hasConversationTitleEdit: boolean;
  stopConversationTitleEdit: () => void;
  clearConversationTitleEditClickState: () => void;
  setRepositoryPrompt: (prompt: RepositoryPromptState) => void;
  markDirty: () => void;
}

export function openRepositoryPromptForCreate(options: OpenRepositoryPromptForCreateOptions): void {
  options.clearNewThreadPrompt();
  options.clearAddDirectoryPrompt();
  if (options.hasConversationTitleEdit) {
    options.stopConversationTitleEdit();
  }
  options.clearConversationTitleEditClickState();
  options.setRepositoryPrompt({
    mode: 'add',
    repositoryId: null,
    value: '',
    error: null,
  });
  options.markDirty();
}

interface OpenRepositoryPromptForEditOptions {
  repositoryId: string;
  repositories: ReadonlyMap<string, RepositoryRecordWithMetadata>;
  clearNewThreadPrompt: () => void;
  clearAddDirectoryPrompt: () => void;
  hasConversationTitleEdit: boolean;
  stopConversationTitleEdit: () => void;
  clearConversationTitleEditClickState: () => void;
  setRepositoryPrompt: (prompt: RepositoryPromptState) => void;
  setTaskPaneSelectionFocusRepository: () => void;
  markDirty: () => void;
}

export function openRepositoryPromptForEdit(options: OpenRepositoryPromptForEditOptions): void {
  const repository = options.repositories.get(options.repositoryId);
  if (repository === undefined) {
    return;
  }
  options.clearNewThreadPrompt();
  options.clearAddDirectoryPrompt();
  if (options.hasConversationTitleEdit) {
    options.stopConversationTitleEdit();
  }
  options.clearConversationTitleEditClickState();
  options.setRepositoryPrompt({
    mode: 'edit',
    repositoryId: options.repositoryId,
    value: repository.remoteUrl,
    error: null,
  });
  options.setTaskPaneSelectionFocusRepository();
  options.markDirty();
}

export function repositoryHomePriority(repository: RepositoryRecordWithMetadata): number | null {
  const raw = repository.metadata['homePriority'];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return null;
  }
  if (!Number.isInteger(raw) || raw < 0) {
    return null;
  }
  return raw;
}

interface QueueRepositoryPriorityOrderOptions<TRepository extends RepositoryRecordWithMetadata> {
  orderedRepositoryIds: readonly string[];
  repositories: ReadonlyMap<string, TRepository>;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  updateRepositoryMetadata: (
    repositoryId: string,
    metadata: Record<string, unknown>,
  ) => Promise<TRepository>;
  upsertRepository: (repository: TRepository) => void;
  syncTaskPaneRepositorySelection: () => void;
  markDirty: () => void;
  label: string;
}

export function queueRepositoryPriorityOrder<TRepository extends RepositoryRecordWithMetadata>(
  options: QueueRepositoryPriorityOrderOptions<TRepository>,
): void {
  const updates: Array<{ repositoryId: string; metadata: Record<string, unknown> }> = [];
  for (let index = 0; index < options.orderedRepositoryIds.length; index += 1) {
    const repositoryId = options.orderedRepositoryIds[index]!;
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
      const repository = await options.updateRepositoryMetadata(update.repositoryId, update.metadata);
      options.upsertRepository(repository);
    }
    options.syncTaskPaneRepositorySelection();
    options.markDirty();
  }, options.label);
}

interface ReorderRepositoryByDropOptions {
  draggedRepositoryId: string;
  targetRepositoryId: string;
  orderedRepositoryIds: readonly string[];
  reorderIdsByMove: (
    ids: readonly string[],
    draggedId: string,
    targetId: string,
  ) => readonly string[] | null;
  queueRepositoryPriorityOrder: (orderedRepositoryIds: readonly string[], label: string) => void;
}

export function reorderRepositoryByDrop(options: ReorderRepositoryByDropOptions): void {
  const reordered = options.reorderIdsByMove(
    options.orderedRepositoryIds,
    options.draggedRepositoryId,
    options.targetRepositoryId,
  );
  if (reordered === null) {
    return;
  }
  options.queueRepositoryPriorityOrder(reordered, 'repositories-reorder-drag');
}

interface UpsertRepositoryByRemoteUrlScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface UpsertRepositoryByRemoteUrlOptions<TRepository extends RepositoryRecordWithMetadata> {
  remoteUrl: string;
  existingRepositoryId: string | null;
  normalizeGitHubRemoteUrl: (value: string) => string | null;
  repositoryNameFromGitHubRemoteUrl: (value: string) => string;
  createRepositoryId: () => string;
  scope: UpsertRepositoryByRemoteUrlScope;
  createRepository: (payload: {
    repositoryId: string;
    tenantId: string;
    userId: string;
    workspaceId: string;
    name: string;
    remoteUrl: string;
    defaultBranch: string;
    metadata: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  updateRepository: (payload: {
    repositoryId: string;
    name: string;
    remoteUrl: string;
  }) => Promise<Record<string, unknown>>;
  parseRepositoryRecord: (value: unknown) => TRepository | null;
  upsertRepository: (repository: TRepository) => void;
  syncRepositoryAssociationsWithDirectorySnapshots: () => void;
  syncTaskPaneRepositorySelection: () => void;
  markDirty: () => void;
}

export async function upsertRepositoryByRemoteUrl<TRepository extends RepositoryRecordWithMetadata>(
  options: UpsertRepositoryByRemoteUrlOptions<TRepository>,
): Promise<void> {
  const normalizedRemoteUrl = options.normalizeGitHubRemoteUrl(options.remoteUrl);
  if (normalizedRemoteUrl === null) {
    throw new Error('github url required');
  }
  const result =
    options.existingRepositoryId === null
      ? await options.createRepository({
          repositoryId: options.createRepositoryId(),
          tenantId: options.scope.tenantId,
          userId: options.scope.userId,
          workspaceId: options.scope.workspaceId,
          name: options.repositoryNameFromGitHubRemoteUrl(normalizedRemoteUrl),
          remoteUrl: normalizedRemoteUrl,
          defaultBranch: 'main',
          metadata: {
            source: 'mux-manual',
          },
        })
      : await options.updateRepository({
          repositoryId: options.existingRepositoryId,
          name: options.repositoryNameFromGitHubRemoteUrl(normalizedRemoteUrl),
          remoteUrl: normalizedRemoteUrl,
        });
  const repository = options.parseRepositoryRecord(result['repository']);
  if (repository === null) {
    throw new Error('control-plane repository command returned malformed repository record');
  }
  options.upsertRepository(repository);
  options.syncRepositoryAssociationsWithDirectorySnapshots();
  options.syncTaskPaneRepositorySelection();
  options.markDirty();
}

interface ArchiveRepositoryByIdOptions {
  repositoryId: string;
  archiveRepository: (repositoryId: string) => Promise<unknown>;
  deleteRepository: (repositoryId: string) => void;
  syncRepositoryAssociationsWithDirectorySnapshots: () => void;
  syncTaskPaneRepositorySelection: () => void;
  markDirty: () => void;
}

export async function archiveRepositoryById(options: ArchiveRepositoryByIdOptions): Promise<void> {
  await options.archiveRepository(options.repositoryId);
  options.deleteRepository(options.repositoryId);
  options.syncRepositoryAssociationsWithDirectorySnapshots();
  options.syncTaskPaneRepositorySelection();
  options.markDirty();
}

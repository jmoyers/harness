import type { StreamObservedEvent } from '../control-plane/stream-protocol.ts';
import {
  applyObservedGitStatusEvent as applyObservedGitStatusEventFn,
  deleteDirectoryGitState as deleteDirectoryGitStateFn,
  type GitRepositorySnapshot,
  type GitSummary,
} from '../mux/live-mux/git-state.ts';

interface RepositoryRecordShape {
  readonly repositoryId: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly defaultBranch: string;
  readonly archivedAt: string | null;
}

interface RuntimeGitStateDirectoryManager {
  hasDirectory(directoryId: string): boolean;
  ensureGitSummary(directoryId: string, loadingSummary: GitSummary): void;
  syncGitSummariesWithDirectories(loadingSummary: GitSummary): void;
  mutableGitSummaries(): Map<string, GitSummary>;
}

interface RuntimeGitStateOptions<TRepositoryRecord extends RepositoryRecordShape> {
  readonly enabled: boolean;
  readonly directoryManager: RuntimeGitStateDirectoryManager;
  readonly directoryRepositorySnapshotByDirectoryId: Map<string, GitRepositorySnapshot>;
  readonly repositoryAssociationByDirectoryId: Map<string, string>;
  readonly repositories: Map<string, TRepositoryRecord>;
  readonly parseRepositoryRecord: (input: unknown) => TRepositoryRecord | null;
  readonly loadingSummary: GitSummary;
  readonly emptyRepositorySnapshot: GitRepositorySnapshot;
  readonly syncRepositoryAssociationsWithDirectorySnapshots: () => void;
  readonly syncTaskPaneRepositorySelection: () => void;
  readonly markDirty: () => void;
}

export interface RuntimeGitState {
  deleteDirectoryGitState(directoryId: string): void;
  syncGitStateWithDirectories(): void;
  noteGitActivity(directoryId: string | null): void;
  applyObservedGitStatusEvent(observed: StreamObservedEvent): void;
}

export function createRuntimeGitState<TRepositoryRecord extends RepositoryRecordShape>(
  options: RuntimeGitStateOptions<TRepositoryRecord>,
): RuntimeGitState {
  const deleteDirectoryGitState = (directoryId: string): void => {
    deleteDirectoryGitStateFn(
      directoryId,
      options.directoryManager.mutableGitSummaries(),
      options.directoryRepositorySnapshotByDirectoryId,
      options.repositoryAssociationByDirectoryId,
    );
  };

  const syncGitStateWithDirectories = (): void => {
    options.directoryManager.syncGitSummariesWithDirectories(options.loadingSummary);
    options.syncRepositoryAssociationsWithDirectorySnapshots();
  };

  const noteGitActivity = (directoryId: string | null): void => {
    if (directoryId === null || !options.directoryManager.hasDirectory(directoryId)) {
      return;
    }
    options.directoryManager.ensureGitSummary(directoryId, options.loadingSummary);
  };

  const applyObservedGitStatusEvent = (observed: StreamObservedEvent): void => {
    const reduced = applyObservedGitStatusEventFn({
      enabled: options.enabled,
      observed,
      gitSummaryByDirectoryId: options.directoryManager.mutableGitSummaries(),
      loadingSummary: options.loadingSummary,
      directoryRepositorySnapshotByDirectoryId: options.directoryRepositorySnapshotByDirectoryId,
      emptyRepositorySnapshot: options.emptyRepositorySnapshot,
      repositoryAssociationByDirectoryId: options.repositoryAssociationByDirectoryId,
      repositories: options.repositories,
      parseRepositoryRecord: options.parseRepositoryRecord,
      repositoryRecordChanged: (previous, repository) =>
        previous === undefined ||
        previous.name !== repository.name ||
        previous.remoteUrl !== repository.remoteUrl ||
        previous.defaultBranch !== repository.defaultBranch ||
        previous.archivedAt !== repository.archivedAt,
    });
    if (!reduced.handled) {
      return;
    }
    if (reduced.repositoryRecordChanged) {
      options.syncRepositoryAssociationsWithDirectorySnapshots();
      options.syncTaskPaneRepositorySelection();
    }
    if (reduced.changed) {
      options.markDirty();
    }
  };

  return {
    deleteDirectoryGitState,
    syncGitStateWithDirectories,
    noteGitActivity,
    applyObservedGitStatusEvent,
  };
}

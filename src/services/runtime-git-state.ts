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

export class RuntimeGitState<TRepositoryRecord extends RepositoryRecordShape> {
  constructor(private readonly options: RuntimeGitStateOptions<TRepositoryRecord>) {}

  deleteDirectoryGitState(directoryId: string): void {
    deleteDirectoryGitStateFn(
      directoryId,
      this.options.directoryManager.mutableGitSummaries(),
      this.options.directoryRepositorySnapshotByDirectoryId,
      this.options.repositoryAssociationByDirectoryId,
    );
  }

  syncGitStateWithDirectories(): void {
    this.options.directoryManager.syncGitSummariesWithDirectories(this.options.loadingSummary);
    this.options.syncRepositoryAssociationsWithDirectorySnapshots();
  }

  noteGitActivity(directoryId: string | null): void {
    if (directoryId === null || !this.options.directoryManager.hasDirectory(directoryId)) {
      return;
    }
    this.options.directoryManager.ensureGitSummary(directoryId, this.options.loadingSummary);
  }

  applyObservedGitStatusEvent(observed: StreamObservedEvent): void {
    const reduced = applyObservedGitStatusEventFn({
      enabled: this.options.enabled,
      observed,
      gitSummaryByDirectoryId: this.options.directoryManager.mutableGitSummaries(),
      loadingSummary: this.options.loadingSummary,
      directoryRepositorySnapshotByDirectoryId: this.options.directoryRepositorySnapshotByDirectoryId,
      emptyRepositorySnapshot: this.options.emptyRepositorySnapshot,
      repositoryAssociationByDirectoryId: this.options.repositoryAssociationByDirectoryId,
      repositories: this.options.repositories,
      parseRepositoryRecord: this.options.parseRepositoryRecord,
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
      this.options.syncRepositoryAssociationsWithDirectorySnapshots();
      this.options.syncTaskPaneRepositorySelection();
    }
    if (reduced.changed) {
      this.options.markDirty();
    }
  }
}

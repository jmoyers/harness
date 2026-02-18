import type { StreamObservedEvent } from '../../control-plane/stream-protocol.ts';

export interface GitSummary {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

export interface GitRepositorySnapshot {
  readonly normalizedRemoteUrl: string | null;
  readonly commitCount: number | null;
  readonly lastCommitAt: string | null;
  readonly shortCommitHash: string | null;
  readonly inferredName: string | null;
  readonly defaultBranch: string | null;
}

function gitSummaryEqual(left: GitSummary, right: GitSummary): boolean {
  return (
    left.branch === right.branch &&
    left.changedFiles === right.changedFiles &&
    left.additions === right.additions &&
    left.deletions === right.deletions
  );
}

function gitRepositorySnapshotEqual(
  left: GitRepositorySnapshot,
  right: GitRepositorySnapshot,
): boolean {
  return (
    left.normalizedRemoteUrl === right.normalizedRemoteUrl &&
    left.commitCount === right.commitCount &&
    left.lastCommitAt === right.lastCommitAt &&
    left.shortCommitHash === right.shortCommitHash &&
    left.defaultBranch === right.defaultBranch &&
    left.inferredName === right.inferredName
  );
}

export function deleteDirectoryGitState(
  directoryId: string,
  gitSummaryByDirectoryId: Map<string, GitSummary>,
  directoryRepositorySnapshotByDirectoryId: Map<string, GitRepositorySnapshot>,
  repositoryAssociationByDirectoryId: Map<string, string>,
): void {
  gitSummaryByDirectoryId.delete(directoryId);
  directoryRepositorySnapshotByDirectoryId.delete(directoryId);
  repositoryAssociationByDirectoryId.delete(directoryId);
}

interface ApplyObservedGitStatusEventOptions<TRepositoryRecord extends { repositoryId: string }> {
  enabled: boolean;
  observed: StreamObservedEvent;
  gitSummaryByDirectoryId: Map<string, GitSummary>;
  loadingSummary: GitSummary;
  directoryRepositorySnapshotByDirectoryId: Map<string, GitRepositorySnapshot>;
  emptyRepositorySnapshot: GitRepositorySnapshot;
  repositoryAssociationByDirectoryId: Map<string, string>;
  repositories: Map<string, TRepositoryRecord>;
  parseRepositoryRecord: (input: unknown) => TRepositoryRecord | null;
  repositoryRecordChanged: (
    previous: TRepositoryRecord | undefined,
    next: TRepositoryRecord,
  ) => boolean;
}

interface ApplyObservedGitStatusEventResult {
  readonly handled: boolean;
  readonly changed: boolean;
  readonly repositoryRecordChanged: boolean;
}

export function applyObservedGitStatusEvent<TRepositoryRecord extends { repositoryId: string }>(
  options: ApplyObservedGitStatusEventOptions<TRepositoryRecord>,
): ApplyObservedGitStatusEventResult {
  const {
    enabled,
    observed,
    gitSummaryByDirectoryId,
    loadingSummary,
    directoryRepositorySnapshotByDirectoryId,
    emptyRepositorySnapshot,
    repositoryAssociationByDirectoryId,
    repositories,
    parseRepositoryRecord,
    repositoryRecordChanged,
  } = options;
  if (!enabled || observed.type !== 'directory-git-updated') {
    return {
      handled: false,
      changed: false,
      repositoryRecordChanged: false,
    };
  }

  const previousSummary = gitSummaryByDirectoryId.get(observed.directoryId) ?? loadingSummary;
  const summaryChanged = !gitSummaryEqual(previousSummary, observed.summary);
  gitSummaryByDirectoryId.set(observed.directoryId, observed.summary);

  const previousRepositorySnapshot =
    directoryRepositorySnapshotByDirectoryId.get(observed.directoryId) ?? emptyRepositorySnapshot;
  const repositorySnapshotChanged = !gitRepositorySnapshotEqual(
    previousRepositorySnapshot,
    observed.repositorySnapshot,
  );
  directoryRepositorySnapshotByDirectoryId.set(observed.directoryId, observed.repositorySnapshot);

  let associationChanged = false;
  if (observed.repositoryId === null) {
    associationChanged = repositoryAssociationByDirectoryId.delete(observed.directoryId);
  } else {
    const previousRepositoryId = repositoryAssociationByDirectoryId.get(observed.directoryId) ?? null;
    repositoryAssociationByDirectoryId.set(observed.directoryId, observed.repositoryId);
    associationChanged = previousRepositoryId !== observed.repositoryId;
  }

  let changedRepositoryRecord = false;
  if (observed.repository !== null) {
    const repository = parseRepositoryRecord(observed.repository);
    if (repository !== null) {
      const previous = repositories.get(repository.repositoryId);
      repositories.set(repository.repositoryId, repository);
      changedRepositoryRecord = repositoryRecordChanged(previous, repository);
    }
  }

  return {
    handled: true,
    changed:
      summaryChanged || repositorySnapshotChanged || associationChanged || changedRepositoryRecord,
    repositoryRecordChanged: changedRepositoryRecord,
  };
}

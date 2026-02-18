export class RepositoryManager<TRepositoryRecord, TRepositorySnapshot> {
  readonly repositories = new Map<string, TRepositoryRecord>();
  readonly repositoryAssociationByDirectoryId = new Map<string, string>();
  readonly directoryRepositorySnapshotByDirectoryId = new Map<string, TRepositorySnapshot>();

  repositoryGroupIdForDirectory(directoryId: string, fallbackGroupId: string): string {
    return this.repositoryAssociationByDirectoryId.get(directoryId) ?? fallbackGroupId;
  }

  setDirectoryRepositorySnapshot(directoryId: string, snapshot: TRepositorySnapshot): void {
    this.directoryRepositorySnapshotByDirectoryId.set(directoryId, snapshot);
  }

  setDirectoryRepositoryAssociation(directoryId: string, repositoryId: string | null): void {
    if (repositoryId === null) {
      this.repositoryAssociationByDirectoryId.delete(directoryId);
      return;
    }
    this.repositoryAssociationByDirectoryId.set(directoryId, repositoryId);
  }

  setRepository(repositoryId: string, repository: TRepositoryRecord): void {
    this.repositories.set(repositoryId, repository);
  }

  syncWithDirectories(directoriesHas: (directoryId: string) => boolean): void {
    for (const directoryId of this.repositoryAssociationByDirectoryId.keys()) {
      if (!directoriesHas(directoryId)) {
        this.repositoryAssociationByDirectoryId.delete(directoryId);
      }
    }
    for (const directoryId of this.directoryRepositorySnapshotByDirectoryId.keys()) {
      if (!directoriesHas(directoryId)) {
        this.directoryRepositorySnapshotByDirectoryId.delete(directoryId);
      }
    }
  }
}

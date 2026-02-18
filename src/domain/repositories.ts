export class RepositoryManager<TRepositoryRecord, TRepositorySnapshot> {
  private readonly repositories = new Map<string, TRepositoryRecord>();
  private readonly repositoryAssociationByDirectoryId = new Map<string, string>();
  private readonly directoryRepositorySnapshotByDirectoryId = new Map<string, TRepositorySnapshot>();
  private readonly collapsedRepositoryGroupIds = new Set<string>();
  private readonly expandedRepositoryGroupIds = new Set<string>();

  constructor() {}

  unsafeMutableRepositories(): Map<string, TRepositoryRecord> {
    return this.repositories;
  }

  unsafeMutableDirectoryAssociations(): Map<string, string> {
    return this.repositoryAssociationByDirectoryId;
  }

  unsafeMutableDirectorySnapshots(): Map<string, TRepositorySnapshot> {
    return this.directoryRepositorySnapshotByDirectoryId;
  }

  readonlyCollapsedRepositoryGroupIds(): ReadonlySet<string> {
    return this.collapsedRepositoryGroupIds;
  }

  clearRepositories(): void {
    this.repositories.clear();
  }

  private isRepositoryGroupCollapsed(
    repositoryGroupId: string,
    repositoriesCollapsed: boolean,
  ): boolean {
    if (repositoriesCollapsed) {
      return !this.expandedRepositoryGroupIds.has(repositoryGroupId);
    }
    return this.collapsedRepositoryGroupIds.has(repositoryGroupId);
  }

  collapseRepositoryGroup(repositoryGroupId: string, repositoriesCollapsed: boolean): void {
    if (repositoriesCollapsed) {
      this.expandedRepositoryGroupIds.delete(repositoryGroupId);
      return;
    }
    this.collapsedRepositoryGroupIds.add(repositoryGroupId);
  }

  expandRepositoryGroup(repositoryGroupId: string, repositoriesCollapsed: boolean): void {
    if (repositoriesCollapsed) {
      this.expandedRepositoryGroupIds.add(repositoryGroupId);
      return;
    }
    this.collapsedRepositoryGroupIds.delete(repositoryGroupId);
  }

  toggleRepositoryGroup(repositoryGroupId: string, repositoriesCollapsed: boolean): void {
    if (this.isRepositoryGroupCollapsed(repositoryGroupId, repositoriesCollapsed)) {
      this.expandRepositoryGroup(repositoryGroupId, repositoriesCollapsed);
      return;
    }
    this.collapseRepositoryGroup(repositoryGroupId, repositoriesCollapsed);
  }

  collapseAllRepositoryGroups(): true {
    this.collapsedRepositoryGroupIds.clear();
    this.expandedRepositoryGroupIds.clear();
    return true;
  }

  expandAllRepositoryGroups(): false {
    this.collapsedRepositoryGroupIds.clear();
    this.expandedRepositoryGroupIds.clear();
    return false;
  }

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

export class DirectoryManager<TDirectoryRecord, TGitSummary> {
  private readonly directoriesById = new Map<string, TDirectoryRecord>();
  private readonly gitSummaryByDirectoryId = new Map<string, TGitSummary>();

  constructor() {}

  readonlyDirectories(): ReadonlyMap<string, TDirectoryRecord> {
    return this.directoriesById;
  }

  mutableGitSummaries(): Map<string, TGitSummary> {
    return this.gitSummaryByDirectoryId;
  }

  hasDirectory(directoryId: string): boolean {
    return this.directoriesById.has(directoryId);
  }

  getDirectory(directoryId: string): TDirectoryRecord | undefined {
    return this.directoriesById.get(directoryId);
  }

  setDirectory(directoryId: string, directory: TDirectoryRecord): void {
    this.directoriesById.set(directoryId, directory);
  }

  deleteDirectory(directoryId: string): void {
    this.directoriesById.delete(directoryId);
  }

  clearDirectories(): void {
    this.directoriesById.clear();
  }

  directoryIds(): readonly string[] {
    return [...this.directoriesById.keys()];
  }

  directoriesSize(): number {
    return this.directoriesById.size;
  }

  firstDirectoryId(): string | null {
    const iterator = this.directoriesById.keys().next();
    if (iterator.done === true) {
      return null;
    }
    return iterator.value;
  }

  resolveActiveDirectoryId(activeDirectoryId: string | null): string | null {
    if (activeDirectoryId !== null && this.directoriesById.has(activeDirectoryId)) {
      return activeDirectoryId;
    }
    return this.firstDirectoryId();
  }

  ensureGitSummary(directoryId: string, loadingSummary: TGitSummary): void {
    if (!this.gitSummaryByDirectoryId.has(directoryId)) {
      this.gitSummaryByDirectoryId.set(directoryId, loadingSummary);
    }
  }

  syncGitSummariesWithDirectories(loadingSummary: TGitSummary): void {
    for (const directoryId of this.directoriesById.keys()) {
      this.ensureGitSummary(directoryId, loadingSummary);
    }
    for (const directoryId of this.gitSummaryByDirectoryId.keys()) {
      if (!this.directoriesById.has(directoryId)) {
        this.gitSummaryByDirectoryId.delete(directoryId);
      }
    }
  }
}

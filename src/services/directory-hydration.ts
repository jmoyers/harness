interface DirectoryRecordLike {
  readonly directoryId: string;
  readonly path: string;
}

interface DirectoryHydrationControlPlane<TDirectoryRecord extends DirectoryRecordLike> {
  listDirectories(): Promise<readonly TDirectoryRecord[]>;
  upsertDirectory(input: {
    directoryId: string;
    path: string;
  }): Promise<TDirectoryRecord>;
}

interface DirectoryHydrationServiceOptions<TDirectoryRecord extends DirectoryRecordLike> {
  readonly controlPlaneService: DirectoryHydrationControlPlane<TDirectoryRecord>;
  readonly resolveWorkspacePathForMux: (rawPath: string) => string;
  readonly clearDirectories: () => void;
  readonly setDirectory: (directoryId: string, directory: TDirectoryRecord) => void;
  readonly hasDirectory: (directoryId: string) => boolean;
  readonly persistedDirectory: TDirectoryRecord;
  readonly resolveActiveDirectoryId: () => string | null;
}

export class DirectoryHydrationService<TDirectoryRecord extends DirectoryRecordLike> {
  constructor(private readonly options: DirectoryHydrationServiceOptions<TDirectoryRecord>) {}

  async hydrate(): Promise<void> {
    const rows = await this.options.controlPlaneService.listDirectories();
    this.options.clearDirectories();
    for (const row of rows) {
      const normalizedPath = this.options.resolveWorkspacePathForMux(row.path);
      if (normalizedPath !== row.path) {
        const repairedRecord = await this.options.controlPlaneService.upsertDirectory({
          directoryId: row.directoryId,
          path: normalizedPath,
        });
        this.options.setDirectory(row.directoryId, repairedRecord);
        continue;
      }
      this.options.setDirectory(row.directoryId, row);
    }
    if (!this.options.hasDirectory(this.options.persistedDirectory.directoryId)) {
      this.options.setDirectory(
        this.options.persistedDirectory.directoryId,
        this.options.persistedDirectory,
      );
    }
    if (this.options.resolveActiveDirectoryId() === null) {
      throw new Error('no active directory available after hydrate');
    }
  }
}

interface DirectoryRecordLike {
  readonly directoryId: string;
  readonly path: string;
}

interface DirectoryHydrationControlPlane<TDirectoryRecord extends DirectoryRecordLike> {
  listDirectories(): Promise<readonly TDirectoryRecord[]>;
  upsertDirectory(input: { directoryId: string; path: string }): Promise<TDirectoryRecord>;
}

export interface DirectoryHydrationServiceOptions<TDirectoryRecord extends DirectoryRecordLike> {
  readonly controlPlaneService: DirectoryHydrationControlPlane<TDirectoryRecord>;
  readonly resolveWorkspacePathForMux: (rawPath: string) => string;
  readonly clearDirectories: () => void;
  readonly setDirectory: (directoryId: string, directory: TDirectoryRecord) => void;
  readonly hasDirectory: (directoryId: string) => boolean;
  readonly persistedDirectory: TDirectoryRecord;
  readonly resolveActiveDirectoryId: () => string | null;
}

export interface DirectoryHydrationService {
  hydrate(): Promise<void>;
}

export function createDirectoryHydrationService<TDirectoryRecord extends DirectoryRecordLike>(
  options: DirectoryHydrationServiceOptions<TDirectoryRecord>,
): DirectoryHydrationService {
  async function hydrate(): Promise<void> {
    const rows = await options.controlPlaneService.listDirectories();
    options.clearDirectories();
    for (const row of rows) {
      const normalizedPath = options.resolveWorkspacePathForMux(row.path);
      if (normalizedPath !== row.path) {
        const repairedRecord = await options.controlPlaneService.upsertDirectory({
          directoryId: row.directoryId,
          path: normalizedPath,
        });
        options.setDirectory(row.directoryId, repairedRecord);
        continue;
      }
      options.setDirectory(row.directoryId, row);
    }
    if (!options.hasDirectory(options.persistedDirectory.directoryId)) {
      options.setDirectory(
        options.persistedDirectory.directoryId,
        options.persistedDirectory,
      );
    }
    if (options.resolveActiveDirectoryId() === null) {
      throw new Error('no active directory available after hydrate');
    }
  }

  return {
    hydrate,
  };
}

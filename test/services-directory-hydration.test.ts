import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { DirectoryHydrationService } from '../src/services/directory-hydration.ts';

interface DirectoryRecord {
  readonly directoryId: string;
  readonly path: string;
}

void test('directory hydration service normalizes paths, repairs records, and ensures persisted directory', async () => {
  const calls: string[] = [];
  const directories = new Map<string, DirectoryRecord>();
  const service = new DirectoryHydrationService<DirectoryRecord>({
    controlPlaneService: {
      listDirectories: async () => [
        { directoryId: 'dir-1', path: './repo-one' },
        { directoryId: 'dir-2', path: '/abs/repo-two' },
      ],
      upsertDirectory: async (input) => {
        calls.push(`upsert:${input.directoryId}:${input.path}`);
        return {
          directoryId: input.directoryId,
          path: input.path,
        };
      },
    },
    resolveWorkspacePathForMux: (rawPath) =>
      rawPath.startsWith('./') ? `/workspace/${rawPath.slice(2)}` : rawPath,
    clearDirectories: () => {
      calls.push('clearDirectories');
      directories.clear();
    },
    setDirectory: (directoryId, directory) => {
      calls.push(`setDirectory:${directoryId}:${directory.path}`);
      directories.set(directoryId, directory);
    },
    hasDirectory: (directoryId) => directories.has(directoryId),
    persistedDirectory: {
      directoryId: 'dir-persisted',
      path: '/persisted',
    },
    resolveActiveDirectoryId: () => 'dir-1',
  });

  await service.hydrate();

  assert.deepEqual(calls, [
    'clearDirectories',
    'upsert:dir-1:/workspace/repo-one',
    'setDirectory:dir-1:/workspace/repo-one',
    'setDirectory:dir-2:/abs/repo-two',
    'setDirectory:dir-persisted:/persisted',
  ]);
  assert.equal(directories.get('dir-1')?.path, '/workspace/repo-one');
  assert.equal(directories.get('dir-persisted')?.path, '/persisted');
});

void test('directory hydration service throws when no active directory resolves', async () => {
  const service = new DirectoryHydrationService<DirectoryRecord>({
    controlPlaneService: {
      listDirectories: async () => [],
      upsertDirectory: async (input) => input,
    },
    resolveWorkspacePathForMux: (rawPath) => rawPath,
    clearDirectories: () => {},
    setDirectory: () => {},
    hasDirectory: () => false,
    persistedDirectory: {
      directoryId: 'dir-persisted',
      path: '/persisted',
    },
    resolveActiveDirectoryId: () => null,
  });

  await assert.rejects(
    async () => {
      await service.hydrate();
    },
    /no active directory available after hydrate/,
  );
});

import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { DirectoryManager } from '../src/domain/directories.ts';

interface TestDirectory {
  readonly directoryId: string;
  readonly path: string;
}

interface TestSummary {
  readonly branch: string;
}

void test('directory manager resolves active directory against owned records', () => {
  const manager = new DirectoryManager<TestDirectory, TestSummary>();
  assert.equal(manager.firstDirectoryId(), null);
  assert.equal(manager.resolveActiveDirectoryId('missing'), null);

  manager.setDirectory('dir-a', { directoryId: 'dir-a', path: '/tmp/a' });
  manager.setDirectory('dir-b', { directoryId: 'dir-b', path: '/tmp/b' });

  assert.equal(manager.resolveActiveDirectoryId('dir-b'), 'dir-b');
  assert.equal(manager.resolveActiveDirectoryId('missing'), 'dir-a');
  assert.equal(manager.directoriesSize(), 2);
});

void test('directory manager syncs git summaries to directory lifecycle', () => {
  const manager = new DirectoryManager<TestDirectory, TestSummary>();
  const loadingSummary: TestSummary = { branch: '(loading)' };

  manager.setDirectory('dir-a', { directoryId: 'dir-a', path: '/tmp/a' });
  manager.setDirectory('dir-b', { directoryId: 'dir-b', path: '/tmp/b' });
  manager.ensureGitSummary('dir-a', { branch: 'main' });
  manager.syncGitSummariesWithDirectories(loadingSummary);

  const summaries = manager.mutableGitSummaries();
  assert.deepEqual(summaries.get('dir-a'), { branch: 'main' });
  assert.deepEqual(summaries.get('dir-b'), loadingSummary);

  manager.deleteDirectory('dir-b');
  manager.syncGitSummariesWithDirectories(loadingSummary);
  assert.equal(summaries.has('dir-b'), false);
});

void test('directory manager exposes directory reads and clear lifecycle helpers', () => {
  const manager = new DirectoryManager<TestDirectory, TestSummary>();
  manager.setDirectory('dir-a', { directoryId: 'dir-a', path: '/tmp/a' });

  const directories = manager.readonlyDirectories();
  assert.equal(manager.hasDirectory('dir-a'), true);
  assert.equal(manager.hasDirectory('dir-missing'), false);
  assert.deepEqual(manager.getDirectory('dir-a'), { directoryId: 'dir-a', path: '/tmp/a' });
  assert.equal(manager.getDirectory('dir-missing'), undefined);
  assert.deepEqual(manager.directoryIds(), ['dir-a']);
  assert.equal(directories.get('dir-a')?.path, '/tmp/a');

  manager.clearDirectories();
  assert.deepEqual(manager.directoryIds(), []);
  assert.equal(manager.directoriesSize(), 0);
});

void test('directory manager exercises all public methods for strict function coverage', () => {
  const manager = new DirectoryManager<TestDirectory, TestSummary>();
  const loadingSummary: TestSummary = { branch: '(loading)' };

  void manager.readonlyDirectories();
  void manager.mutableGitSummaries();
  assert.equal(manager.hasDirectory('missing'), false);
  assert.equal(manager.getDirectory('missing'), undefined);
  assert.equal(manager.firstDirectoryId(), null);
  assert.equal(manager.resolveActiveDirectoryId(null), null);
  assert.deepEqual(manager.directoryIds(), []);
  assert.equal(manager.directoriesSize(), 0);

  manager.setDirectory('dir-a', { directoryId: 'dir-a', path: '/tmp/a' });
  manager.ensureGitSummary('dir-a', loadingSummary);
  manager.syncGitSummariesWithDirectories(loadingSummary);
  manager.deleteDirectory('dir-a');
  manager.clearDirectories();

  assert.equal(manager.firstDirectoryId(), null);
});

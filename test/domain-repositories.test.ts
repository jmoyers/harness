import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RepositoryManager } from '../src/domain/repositories.ts';

interface TestRepository {
  readonly repositoryId: string;
  readonly name: string;
}

interface TestSnapshot {
  readonly commitCount: number | null;
}

void test('repository manager resolves repository-group ids with fallback', () => {
  const manager = new RepositoryManager<TestRepository, TestSnapshot>();
  assert.equal(manager.repositoryGroupIdForDirectory('dir-a', 'untracked'), 'untracked');

  manager.setDirectoryRepositoryAssociation('dir-a', 'repo-a');
  assert.equal(manager.repositoryGroupIdForDirectory('dir-a', 'untracked'), 'repo-a');

  manager.setDirectoryRepositoryAssociation('dir-a', null);
  assert.equal(manager.repositoryGroupIdForDirectory('dir-a', 'untracked'), 'untracked');
});

void test('repository manager sync trims stale directory associations and snapshots', () => {
  const manager = new RepositoryManager<TestRepository, TestSnapshot>();
  manager.setDirectoryRepositoryAssociation('dir-live', 'repo-live');
  manager.setDirectoryRepositoryAssociation('dir-stale', 'repo-stale');
  manager.setDirectoryRepositorySnapshot('dir-live', { commitCount: 1 });
  manager.setDirectoryRepositorySnapshot('dir-stale', { commitCount: 2 });

  manager.syncWithDirectories((directoryId) => directoryId === 'dir-live');

  const associations = manager.unsafeMutableDirectoryAssociations();
  const snapshots = manager.unsafeMutableDirectorySnapshots();
  assert.equal(associations.has('dir-live'), true);
  assert.equal(associations.has('dir-stale'), false);
  assert.equal(snapshots.has('dir-live'), true);
  assert.equal(snapshots.has('dir-stale'), false);
});

void test('repository manager repository-map lifecycle helpers remain deterministic', () => {
  const manager = new RepositoryManager<TestRepository, TestSnapshot>();
  manager.setRepository('repo-a', { repositoryId: 'repo-a', name: 'Repo A' });
  manager.setRepository('repo-b', { repositoryId: 'repo-b', name: 'Repo B' });

  const repositories = manager.unsafeMutableRepositories();
  assert.equal(repositories.size, 2);
  assert.equal(repositories.get('repo-a')?.name, 'Repo A');

  manager.clearRepositories();
  assert.equal(repositories.size, 0);
});

void test('repository manager owns repository-group fold state transitions', () => {
  const manager = new RepositoryManager<TestRepository, TestSnapshot>();
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().size, 0);

  manager.collapseRepositoryGroup('repo-a', false);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().has('repo-a'), true);
  manager.expandRepositoryGroup('repo-a', false);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().has('repo-a'), false);

  manager.collapseRepositoryGroup('repo-a', true);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().has('repo-a'), false);
  manager.expandRepositoryGroup('repo-a', true);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().has('repo-a'), false);

  manager.toggleRepositoryGroup('repo-a', false);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().has('repo-a'), true);
  manager.toggleRepositoryGroup('repo-a', false);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().has('repo-a'), false);

  manager.toggleRepositoryGroup('repo-b', true);
  manager.collapseRepositoryGroup('repo-c', false);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().has('repo-c'), true);
  assert.equal(manager.collapseAllRepositoryGroups(), true);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().size, 0);
  assert.equal(manager.expandAllRepositoryGroups(), false);
  assert.equal(manager.readonlyCollapsedRepositoryGroupIds().size, 0);
});

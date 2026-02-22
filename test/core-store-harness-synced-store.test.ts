import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  applyObservedEventToHarnessSyncedStore,
  createHarnessSyncedStore,
} from '../src/core/store/harness-synced-store.ts';

function directoryEvent(directoryId: string) {
  return {
    type: 'directory-upserted' as const,
    directory: {
      directoryId,
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      path: `/tmp/${directoryId}`,
      createdAt: '2026-02-21T00:00:00.000Z',
      archivedAt: null,
    },
  };
}

void test('harness synced store applies monotonic stream cursors per subscription', () => {
  const store = createHarnessSyncedStore();

  const first = applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-1',
    cursor: 10,
    event: directoryEvent('directory-1'),
  });
  assert.equal(first.cursorAccepted, true);
  assert.equal(first.changed, true);
  assert.equal(store.getState().synced.directoriesById['directory-1']?.directoryId, 'directory-1');

  const duplicate = applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-1',
    cursor: 10,
    event: directoryEvent('directory-2'),
  });
  assert.equal(duplicate.cursorAccepted, false);
  assert.equal(duplicate.changed, false);
  assert.equal(store.getState().synced.directoriesById['directory-2'], undefined);

  const higher = applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-1',
    cursor: 11,
    event: directoryEvent('directory-2'),
  });
  assert.equal(higher.cursorAccepted, true);
  assert.equal(higher.changed, true);
  assert.equal(store.getState().synced.directoriesById['directory-2']?.directoryId, 'directory-2');
});

void test('harness synced store tracks cursors independently by subscription', () => {
  const store = createHarnessSyncedStore();

  const first = applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-a',
    cursor: 3,
    event: directoryEvent('directory-a'),
  });
  const independent = applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-b',
    cursor: 3,
    event: directoryEvent('directory-b'),
  });
  const regressedA = applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-a',
    cursor: 2,
    event: directoryEvent('directory-c'),
  });

  assert.equal(first.cursorAccepted, true);
  assert.equal(independent.cursorAccepted, true);
  assert.equal(regressedA.cursorAccepted, false);
  assert.equal(store.getState().synced.directoriesById['directory-a']?.directoryId, 'directory-a');
  assert.equal(store.getState().synced.directoriesById['directory-b']?.directoryId, 'directory-b');
  assert.equal(store.getState().synced.directoriesById['directory-c'], undefined);
});

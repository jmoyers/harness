import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { snapshotTaskComposerBuffers } from '../src/services/runtime-task-composer-snapshot.ts';

void test('runtime task composer snapshot clones map and composer values', () => {
  const source = new Map<string, { readonly text: string; readonly cursor: number }>([
    [
      'task-1',
      {
        text: 'draft',
        cursor: 3,
      },
    ],
  ]);

  const snapshot = snapshotTaskComposerBuffers(source);
  assert.equal(snapshot === source, false);
  assert.deepEqual(snapshot.get('task-1'), {
    text: 'draft',
    cursor: 3,
  });

  source.set('task-1', {
    text: 'changed',
    cursor: 1,
  });
  assert.deepEqual(snapshot.get('task-1'), {
    text: 'draft',
    cursor: 3,
  });
});

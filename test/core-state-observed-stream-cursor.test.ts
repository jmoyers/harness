import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createObservedStreamCursorState,
  observeStreamCursor,
} from '../src/core/state/observed-stream-cursor.ts';

void test('observeStreamCursor accepts first and increasing cursors for a subscription', () => {
  const initial = createObservedStreamCursorState();
  const first = observeStreamCursor(initial, {
    subscriptionId: 'sub-1',
    cursor: 10,
  });
  assert.equal(first.accepted, true);
  assert.equal(first.previousCursor, null);
  assert.equal(first.state.lastCursorBySubscriptionId.get('sub-1'), 10);

  const second = observeStreamCursor(first.state, {
    subscriptionId: 'sub-1',
    cursor: 11,
  });
  assert.equal(second.accepted, true);
  assert.equal(second.previousCursor, 10);
  assert.equal(second.state.lastCursorBySubscriptionId.get('sub-1'), 11);
});

void test('observeStreamCursor rejects duplicate and regressed cursors without mutating state', () => {
  const initial = observeStreamCursor(createObservedStreamCursorState(), {
    subscriptionId: 'sub-1',
    cursor: 7,
  }).state;

  const duplicate = observeStreamCursor(initial, {
    subscriptionId: 'sub-1',
    cursor: 7,
  });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.previousCursor, 7);
  assert.equal(duplicate.state, initial);

  const regressed = observeStreamCursor(initial, {
    subscriptionId: 'sub-1',
    cursor: 3,
  });
  assert.equal(regressed.accepted, false);
  assert.equal(regressed.previousCursor, 7);
  assert.equal(regressed.state, initial);
});

void test('observeStreamCursor tracks cursor monotonicity independently per subscription', () => {
  const initial = createObservedStreamCursorState();
  const sub1 = observeStreamCursor(initial, {
    subscriptionId: 'sub-1',
    cursor: 4,
  });
  const sub2 = observeStreamCursor(sub1.state, {
    subscriptionId: 'sub-2',
    cursor: 1,
  });
  const sub2Increase = observeStreamCursor(sub2.state, {
    subscriptionId: 'sub-2',
    cursor: 2,
  });
  const sub1Duplicate = observeStreamCursor(sub2Increase.state, {
    subscriptionId: 'sub-1',
    cursor: 4,
  });

  assert.equal(sub2Increase.accepted, true);
  assert.equal(sub2Increase.previousCursor, 1);
  assert.equal(sub1Duplicate.accepted, false);
  assert.equal(sub1Duplicate.previousCursor, 4);
  assert.deepEqual(
    [...sub2Increase.state.lastCursorBySubscriptionId.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    [
      ['sub-1', 4],
      ['sub-2', 2],
    ],
  );
});

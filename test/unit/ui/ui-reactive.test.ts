import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../../packages/harness-ui/src/widget/widget.ts';
import { reactive } from '../../../packages/harness-ui/src/widget/reactive.ts';
import type {
  CellBuffer,
  ClippedCellBuffer,
} from '../../../packages/harness-ui/src/core/cell-buffer.ts';

beforeEach(() => {
  resetAutoIdCounter();
});

class CounterWidget extends Widget {
  count = reactive(0);
  label = reactive('hello');

  watchCalls: Array<{ old: number; new: number }> = [];

  watchCount(oldValue: number, newValue: number): void {
    this.watchCalls.push({ old: oldValue, new: newValue });
  }

  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

class ValidatedWidget extends Widget {
  score = reactive(50);

  validateScore(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

class WatchAndValidateWidget extends Widget {
  temp = reactive(20);
  watchedValues: number[] = [];

  validateTemp(value: number): number {
    return Math.round(value);
  }

  watchTemp(_old: number, newValue: number): void {
    this.watchedValues.push(newValue);
  }

  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

class MultiReactiveWidget extends Widget {
  x = reactive(0);
  y = reactive(0);
  name = reactive('origin');

  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

describe('reactive defaults', () => {
  test('initializes with default value', () => {
    const w = new CounterWidget('c');
    assert.equal(w.count, 0);
    assert.equal(w.label, 'hello');
  });

  test('numeric default', () => {
    const w = new ValidatedWidget('v');
    assert.equal(w.score, 50);
  });

  test('multiple reactive fields coexist', () => {
    const w = new MultiReactiveWidget('m');
    assert.equal(w.x, 0);
    assert.equal(w.y, 0);
    assert.equal(w.name, 'origin');
  });
});

describe('reactive set/get', () => {
  test('setting a value updates it', () => {
    const w = new CounterWidget('c');
    w.count = 42;
    assert.equal(w.count, 42);
  });

  test('setting string reactive', () => {
    const w = new CounterWidget('c');
    w.label = 'world';
    assert.equal(w.label, 'world');
  });

  test('setting same value is no-op', () => {
    const w = new CounterWidget('c');
    w.count = 0;
    assert.equal(w.watchCalls.length, 0);
  });
});

describe('reactive markDirty', () => {
  test('setting a new value marks dirty', () => {
    const w = new CounterWidget('c');
    w.clearDirty();
    assert.equal(w.dirty, false);
    w.count = 5;
    assert.equal(w.dirty, true);
  });

  test('setting same value does not mark dirty', () => {
    const w = new CounterWidget('c');
    w.clearDirty();
    w.count = 0;
    assert.equal(w.dirty, false);
  });

  test('dirty propagates to parent', () => {
    const parent = new MultiReactiveWidget('parent');
    const child = new CounterWidget('child');
    parent.add(child);
    parent.clearDirty();
    child.clearDirty();
    child.count = 10;
    assert.equal(parent.dirty, true);
  });
});

describe('reactive watch', () => {
  test('watch is called with old and new values', () => {
    const w = new CounterWidget('c');
    w.count = 5;
    assert.equal(w.watchCalls.length, 1);
    assert.deepEqual(w.watchCalls[0], { old: 0, new: 5 });
  });

  test('watch is called on each change', () => {
    const w = new CounterWidget('c');
    w.count = 1;
    w.count = 2;
    w.count = 3;
    assert.equal(w.watchCalls.length, 3);
    assert.deepEqual(w.watchCalls[0], { old: 0, new: 1 });
    assert.deepEqual(w.watchCalls[1], { old: 1, new: 2 });
    assert.deepEqual(w.watchCalls[2], { old: 2, new: 3 });
  });

  test('watch is not called when value unchanged', () => {
    const w = new CounterWidget('c');
    w.count = 0;
    assert.equal(w.watchCalls.length, 0);
  });
});

describe('reactive validate', () => {
  test('validator clamps value', () => {
    const w = new ValidatedWidget('v');
    w.score = 150;
    assert.equal(w.score, 100);
    w.score = -20;
    assert.equal(w.score, 0);
  });

  test('validated value is stored', () => {
    const w = new ValidatedWidget('v');
    w.score = 75;
    assert.equal(w.score, 75);
  });

  test('validator runs before equality check', () => {
    const w = new ValidatedWidget('v');
    w.clearDirty();
    w.score = 50;
    assert.equal(w.dirty, false);
  });
});

describe('reactive validate + watch together', () => {
  test('watch sees validated value', () => {
    const w = new WatchAndValidateWidget('w');
    w.temp = 25.7;
    assert.equal(w.temp, 26);
    assert.deepEqual(w.watchedValues, [26]);
  });

  test('validation to same value skips watch', () => {
    const w = new WatchAndValidateWidget('w');
    w.temp = 20.4;
    assert.equal(w.temp, 20);
    assert.deepEqual(w.watchedValues, []);
  });
});

describe('reactive isolation between instances', () => {
  test('two instances have independent state', () => {
    const a = new CounterWidget('a');
    const b = new CounterWidget('b');
    a.count = 10;
    assert.equal(a.count, 10);
    assert.equal(b.count, 0);
  });

  test('watch on one instance does not fire on another', () => {
    const a = new CounterWidget('a');
    const b = new CounterWidget('b');
    a.count = 5;
    assert.equal(a.watchCalls.length, 1);
    assert.equal(b.watchCalls.length, 0);
  });
});

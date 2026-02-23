import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../../packages/harness-ui/src/widget/widget.ts';
import { Message } from '../../../packages/harness-ui/src/widget/message.ts';
import type {
  CellBuffer,
  ClippedCellBuffer,
} from '../../../packages/harness-ui/src/core/cell-buffer.ts';

class TestWidget extends Widget {
  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

class DismissRequested extends Message {}

class ValueChanged extends Message {
  constructor(readonly value: string) {
    super();
  }
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Message basics', () => {
  test('message starts not stopped', () => {
    const msg = new DismissRequested();
    assert.equal(msg.stopped, false);
  });

  test('stop() halts message', () => {
    const msg = new DismissRequested();
    msg.stop();
    assert.equal(msg.stopped, true);
  });

  test('sender is null before emit', () => {
    const msg = new DismissRequested();
    assert.equal(msg.sender, null);
  });
});

describe('emit with method handlers', () => {
  test('handler discovered by on+ClassName convention', () => {
    let received = false;

    class HandlerWidget extends TestWidget {
      onDismissRequested(_msg: DismissRequested): void {
        received = true;
      }
    }

    const w = new HandlerWidget('handler');
    w.emit(new DismissRequested());
    assert.equal(received, true);
  });

  test('message carries data', () => {
    let receivedValue = '';

    class HandlerWidget extends TestWidget {
      onValueChanged(msg: ValueChanged): void {
        receivedValue = msg.value;
      }
    }

    const w = new HandlerWidget('handler');
    w.emit(new ValueChanged('hello'));
    assert.equal(receivedValue, 'hello');
  });

  test('sender is set on emit', () => {
    let receivedSender: Widget | null = null;

    class HandlerWidget extends TestWidget {
      onDismissRequested(msg: DismissRequested): void {
        receivedSender = msg.sender;
      }
    }

    const w = new HandlerWidget('handler');
    w.emit(new DismissRequested());
    assert.equal(receivedSender, w);
  });
});

describe('message bubbling', () => {
  test('message bubbles from child to parent', () => {
    let parentReceived = false;

    class ParentWidget extends TestWidget {
      onDismissRequested(_msg: DismissRequested): void {
        parentReceived = true;
      }
    }

    const parent = new ParentWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    child.emit(new DismissRequested());
    assert.equal(parentReceived, true);
  });

  test('message bubbles through multiple ancestors', () => {
    const received: string[] = [];

    class Level extends TestWidget {
      onDismissRequested(_msg: DismissRequested): void {
        received.push(this.id);
      }
    }

    const root = new Level('root');
    const mid = new Level('mid');
    const leaf = new Level('leaf');
    root.add(mid);
    mid.add(leaf);
    leaf.emit(new DismissRequested());
    assert.deepEqual(received, ['leaf', 'mid', 'root']);
  });

  test('stop() prevents further bubbling', () => {
    const received: string[] = [];

    class StopperWidget extends TestWidget {
      onDismissRequested(msg: DismissRequested): void {
        received.push(this.id);
        msg.stop();
      }
    }

    class ReceiverWidget extends TestWidget {
      onDismissRequested(_msg: DismissRequested): void {
        received.push(this.id);
      }
    }

    const root = new ReceiverWidget('root');
    const stopper = new StopperWidget('stopper');
    const child = new TestWidget('child');
    root.add(stopper);
    stopper.add(child);
    child.emit(new DismissRequested());
    assert.deepEqual(received, ['stopper']);
  });

  test('unhandled message bubbles silently to root', () => {
    const root = new TestWidget('root');
    const child = new TestWidget('child');
    root.add(child);
    child.emit(new DismissRequested());
  });

  test('emitting from root with no parent works', () => {
    let received = false;

    class HandlerWidget extends TestWidget {
      onDismissRequested(_msg: DismissRequested): void {
        received = true;
      }
    }

    const root = new HandlerWidget('root');
    root.emit(new DismissRequested());
    assert.equal(received, true);
  });
});

describe('on() listener API', () => {
  test('listener registered with on() receives messages', () => {
    let received = false;
    const w = new TestWidget('w');
    w.on(DismissRequested, () => {
      received = true;
    });
    w.emit(new DismissRequested());
    assert.equal(received, true);
  });

  test('on() listener receives message data', () => {
    let receivedValue = '';
    const w = new TestWidget('w');
    w.on(ValueChanged, (msg) => {
      receivedValue = msg.value;
    });
    w.emit(new ValueChanged('world'));
    assert.equal(receivedValue, 'world');
  });

  test('on() listeners fire during bubbling', () => {
    let parentListenerFired = false;
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    parent.on(DismissRequested, () => {
      parentListenerFired = true;
    });
    child.emit(new DismissRequested());
    assert.equal(parentListenerFired, true);
  });

  test('multiple on() listeners on same widget', () => {
    let count = 0;
    const w = new TestWidget('w');
    w.on(DismissRequested, () => {
      count += 1;
    });
    w.on(DismissRequested, () => {
      count += 10;
    });
    w.emit(new DismissRequested());
    assert.equal(count, 11);
  });

  test('on() listener and method handler both fire', () => {
    const received: string[] = [];

    class HandlerWidget extends TestWidget {
      onDismissRequested(_msg: DismissRequested): void {
        received.push('method');
      }
    }

    const w = new HandlerWidget('w');
    w.on(DismissRequested, () => {
      received.push('listener');
    });
    w.emit(new DismissRequested());
    assert.ok(received.includes('method'));
    assert.ok(received.includes('listener'));
  });

  test('stop() in method handler prevents listener bubbling', () => {
    const received: string[] = [];

    class StopperWidget extends TestWidget {
      onDismissRequested(msg: DismissRequested): void {
        received.push('stopper');
        msg.stop();
      }
    }

    const root = new TestWidget('root');
    root.on(DismissRequested, () => {
      received.push('root-listener');
    });
    const stopper = new StopperWidget('stopper');
    const child = new TestWidget('child');
    root.add(stopper);
    stopper.add(child);
    child.emit(new DismissRequested());
    assert.deepEqual(received, ['stopper']);
  });
});

describe('message type isolation', () => {
  test('handler only matches its message type', () => {
    let dismissCount = 0;
    let valueCount = 0;

    class HandlerWidget extends TestWidget {
      onDismissRequested(_msg: DismissRequested): void {
        dismissCount += 1;
      }
      onValueChanged(_msg: ValueChanged): void {
        valueCount += 1;
      }
    }

    const w = new HandlerWidget('w');
    w.emit(new DismissRequested());
    assert.equal(dismissCount, 1);
    assert.equal(valueCount, 0);
    w.emit(new ValueChanged('test'));
    assert.equal(dismissCount, 1);
    assert.equal(valueCount, 1);
  });
});

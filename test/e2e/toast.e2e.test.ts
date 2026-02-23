import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import { Toast, ToastManager } from '../../packages/harness-ui/src/widgets/toast.ts';
import { createTestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';

class RootWidget extends Widget {
  render(): void {}
}
function root(children: Widget[]): RootWidget {
  const r = new RootWidget('root');
  r.flexDirection = 'column';
  r.add(...children);
  return r;
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Toast rendering', () => {
  test('shows toast message', () => {
    const t = Toast({ id: 't' });
    t.positionInViewport(40, 20);
    t.show('Copied!', 'success');
    const pilot = createTestPilot(root([t]), { cols: 40, rows: 20 });
    pilot.expectScreen().toContainRow('Copied!');
  });

  test('shows variant icon', () => {
    const t = Toast({ id: 't' });
    t.positionInViewport(40, 20);
    t.success('Done');
    const pilot = createTestPilot(root([t]), { cols: 40, rows: 20 });
    pilot.expectScreen().toContainRow('✓');
  });

  test('error variant', () => {
    const t = Toast({ id: 't' });
    t.positionInViewport(40, 20);
    t.error('Failed');
    const pilot = createTestPilot(root([t]), { cols: 40, rows: 20 });
    pilot.expectScreen().toContainRow('✗');
    pilot.expectScreen().toContainRow('Failed');
  });

  test('clear removes all toasts', () => {
    const t = Toast({ id: 't' });
    t.positionInViewport(40, 20);
    t.info('A');
    t.info('B');
    assert.equal(t.entries.length, 2);
    t.clear();
    assert.equal(t.entries.length, 0);
  });

  test('maxVisible limits queue', () => {
    const t = Toast({ id: 't', maxVisible: 2 });
    t.positionInViewport(40, 20);
    t.info('A');
    t.info('B');
    t.info('C');
    assert.equal(t.entries.length, 2);
  });
});

describe('Toast factory', () => {
  test('returns ToastManager', () => {
    const t = Toast({});
    if (!(t instanceof ToastManager)) throw new Error('should be ToastManager');
  });
});

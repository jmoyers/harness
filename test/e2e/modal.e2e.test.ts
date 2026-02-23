import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { ModalDismissed } from '../../packages/harness-ui/src/widgets/modal.ts';
import { Modal, ModalWidget } from '../../packages/harness-ui/src/widgets/modal.ts';
import { Text } from '../../packages/harness-ui/src/widgets/text.ts';
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

describe('Modal rendering', () => {
  test('renders border', () => {
    const modal = Modal({ id: 'modal', width: 20, height: 5 });
    modal.positionInViewport(40, 20);
    const pilot = createTestPilot(root([modal]), { cols: 40, rows: 20 });
    pilot.expectScreen().toContainRow('┌');
    pilot.expectScreen().toContainRow('└');
  });

  test('renders title in border', () => {
    const modal = Modal({ id: 'modal', title: 'Confirm', width: 20, height: 5 });
    modal.positionInViewport(40, 20);
    const pilot = createTestPilot(root([modal]), { cols: 40, rows: 20 });
    pilot.expectScreen().toContainRow('Confirm');
  });

  test('centered by default', () => {
    const modal = Modal({ id: 'modal', width: 10, height: 4 });
    modal.positionInViewport(40, 20);
    const pilot = createTestPilot(root([modal]), { cols: 40, rows: 20 });
    pilot.expectWidget('#modal').toHaveRect({
      x: 15,
      y: 8,
      width: 10,
      height: 4,
    });
  });

  test('top anchor', () => {
    const modal = Modal({ id: 'modal', width: 10, height: 4, anchor: 'top' });
    modal.positionInViewport(40, 20);
    const pilot = createTestPilot(root([modal]), { cols: 40, rows: 20 });
    pilot.expectWidget('#modal').toHaveRect({ y: 1 });
  });

  test('bottom anchor', () => {
    const modal = Modal({ id: 'modal', width: 10, height: 4, anchor: 'bottom' });
    modal.positionInViewport(40, 20);
    const pilot = createTestPilot(root([modal]), { cols: 40, rows: 20 });
    pilot.expectWidget('#modal').toHaveRect({ y: 15 });
  });

  test('renders children inside border', () => {
    const modal = Modal(
      { id: 'modal', width: 20, height: 5 },
      Text({ id: 'inner', content: 'CONTENT', height: 1 }),
    );
    modal.positionInViewport(40, 20);
    const pilot = createTestPilot(root([modal]), { cols: 40, rows: 20 });
    pilot.expectScreen().toContainRow('CONTENT');
  });
});

describe('Modal dismiss', () => {
  test('escape emits ModalDismissed', () => {
    let dismissed = false;

    class Handler extends RootWidget {
      onModalDismissed(_msg: ModalDismissed): void {
        dismissed = true;
      }
    }

    const r = new Handler('root');
    r.flexDirection = 'column';
    const modal = Modal({ id: 'modal', width: 20, height: 5 });
    modal.positionInViewport(40, 20);
    r.add(modal);
    const pilot = createTestPilot(r, { cols: 40, rows: 20 });
    pilot.focusManager.focus(modal);
    pilot.pressKey('escape');
    assert.equal(dismissed, true);
  });

  test('dismissOnEscape false prevents dismiss', () => {
    let dismissed = false;

    class Handler extends RootWidget {
      onModalDismissed(_msg: ModalDismissed): void {
        dismissed = true;
      }
    }

    const r = new Handler('root');
    r.flexDirection = 'column';
    const modal = Modal({ id: 'modal', width: 20, height: 5, dismissOnEscape: false });
    modal.positionInViewport(40, 20);
    r.add(modal);
    const pilot = createTestPilot(r, { cols: 40, rows: 20 });
    pilot.focusManager.focus(modal);
    pilot.pressKey('escape');
    assert.equal(dismissed, false);
  });

  test('dismiss message can remove modal', () => {
    class Handler extends RootWidget {
      onModalDismissed(_msg: ModalDismissed): void {
        this.remove('modal');
      }
    }

    const r = new Handler('root');
    r.flexDirection = 'column';
    const modal = Modal({ id: 'modal', title: 'Test', width: 20, height: 5 });
    modal.positionInViewport(40, 20);
    r.add(modal);
    const pilot = createTestPilot(r, { cols: 40, rows: 20 });
    pilot.focusManager.focus(modal);
    pilot.expectWidget('#modal').toExist();
    pilot.pressKey('escape');
    pilot.expectWidget('#modal').not.toExist();
  });
});

describe('Modal z-ordering', () => {
  test('renders on top of background content', () => {
    const r = root([]);
    const bg = Text({ id: 'bg', content: 'BACKGROUND'.repeat(5), height: 1, flexGrow: 1 });
    const modal = Modal({ id: 'modal', title: 'Overlay', width: 15, height: 3 });
    modal.positionInViewport(40, 10);
    r.add(bg, modal);
    const pilot = createTestPilot(r, { cols: 40, rows: 10 });
    const modalRow = modal.absoluteRect.y;
    pilot.expectRow(modalRow).toContain('┌');
    pilot.expectRow(modalRow).toContain('Overlay');
  });
});

describe('Modal reactive updates', () => {
  test('title change re-renders', () => {
    const modal = Modal({ id: 'modal', title: 'Old Title', width: 30, height: 5 });
    modal.positionInViewport(40, 20);
    const pilot = createTestPilot(root([modal]), { cols: 40, rows: 20 });
    pilot.expectScreen().toContainRow('Old Title');
    modal.title = 'New Title';
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('New Title');
    pilot.expectScreen().not.toContainRow('Old Title');
  });
});

describe('Modal factory', () => {
  test('returns ModalWidget', () => {
    const modal = Modal({ id: 'test' });
    if (!(modal instanceof ModalWidget)) throw new Error('should be ModalWidget');
    if (!(modal instanceof Widget)) throw new Error('should be Widget');
  });

  test('is absolute positioned with high z-index', () => {
    const modal = Modal({});
    assert.equal(modal.position, 'absolute');
    assert.equal(modal.zIndex, 100);
  });

  test('is focusable by default', () => {
    const modal = Modal({});
    assert.equal(modal.focusable, true);
  });
});

import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import {
  ResponsivePanel,
  ResponsivePanelWidget,
} from '../../packages/harness-ui/src/widgets/responsive.ts';

beforeEach(() => {
  resetAutoIdCounter();
});

describe('ResponsivePanel auto mode', () => {
  test('shows when viewport >= breakpoint', () => {
    const rp = ResponsivePanel({ breakpoint: 100 });
    rp.updateViewport(120);
    assert.equal(rp.shouldShow, true);
    assert.equal(rp.isOverlay, false);
  });

  test('hides when viewport < breakpoint', () => {
    const rp = ResponsivePanel({ breakpoint: 100 });
    rp.updateViewport(80);
    assert.equal(rp.shouldShow, false);
  });

  test('isWide reflects threshold', () => {
    const rp = ResponsivePanel({ breakpoint: 100 });
    rp.updateViewport(100);
    assert.equal(rp.isWide, true);
    rp.updateViewport(99);
    assert.equal(rp.isWide, false);
  });
});

describe('ResponsivePanel manual mode', () => {
  test('mode show always shows', () => {
    const rp = ResponsivePanel({ breakpoint: 100, mode: 'show' });
    rp.updateViewport(50);
    assert.equal(rp.shouldShow, true);
  });

  test('mode hide always hides', () => {
    const rp = ResponsivePanel({ breakpoint: 100, mode: 'hide' });
    rp.updateViewport(200);
    assert.equal(rp.shouldShow, false);
  });
});

describe('ResponsivePanel overlay', () => {
  test('overlay when shown but not wide', () => {
    const rp = ResponsivePanel({ breakpoint: 100, mode: 'show' });
    rp.updateViewport(80);
    assert.equal(rp.isOverlay, true);
  });

  test('not overlay when wide', () => {
    const rp = ResponsivePanel({ breakpoint: 100 });
    rp.updateViewport(120);
    assert.equal(rp.isOverlay, false);
  });
});

describe('ResponsivePanel toggle', () => {
  test('toggle from auto to hide when wide', () => {
    const rp = ResponsivePanel({ breakpoint: 100 });
    rp.updateViewport(120);
    assert.equal(rp.mode, 'auto');
    rp.toggle();
    assert.equal(rp.mode, 'hide');
  });

  test('toggle from auto to show when narrow', () => {
    const rp = ResponsivePanel({ breakpoint: 100 });
    rp.updateViewport(80);
    rp.toggle();
    assert.equal(rp.mode, 'show');
  });

  test('toggle from show to hide', () => {
    const rp = ResponsivePanel({ breakpoint: 100, mode: 'show' });
    rp.toggle();
    assert.equal(rp.mode, 'hide');
  });

  test('toggle from hide to auto when wide', () => {
    const rp = ResponsivePanel({ breakpoint: 100, mode: 'hide' });
    rp.updateViewport(120);
    rp.toggle();
    assert.equal(rp.mode, 'auto');
  });

  test('toggle from hide to show when narrow', () => {
    const rp = ResponsivePanel({ breakpoint: 100, mode: 'hide' });
    rp.updateViewport(80);
    rp.toggle();
    assert.equal(rp.mode, 'show');
  });
});

describe('ResponsivePanel factory', () => {
  test('returns ResponsivePanelWidget', () => {
    const rp = ResponsivePanel({});
    if (!(rp instanceof ResponsivePanelWidget)) throw new Error('should be ResponsivePanelWidget');
  });

  test('default breakpoint is 120', () => {
    assert.equal(ResponsivePanel({}).breakpoint, 120);
  });
});

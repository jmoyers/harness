import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import { Spinner, SpinnerWidget } from '../../packages/harness-ui/src/widgets/spinner.ts';
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

describe('Spinner rendering', () => {
  test('renders frame character', () => {
    const s = Spinner({ id: 's', label: 'Loading...' });
    const pilot = createTestPilot(root([s]), { cols: 20, rows: 1 });
    pilot.expectRow(0).toContain('Loading...');
  });

  test('tick advances frame', () => {
    const s = Spinner({ id: 's' });
    const pilot = createTestPilot(root([s]), { cols: 10, rows: 1 });
    const before = pilot.rowText(0);
    s.tick();
    pilot.resize(pilot.cols, pilot.rows);
    const after = pilot.rowText(0);
    assert.notEqual(before[0], after[0]);
  });

  test('different styles have different frames', () => {
    const braille = Spinner({ id: 'b', style: 'braille' });
    const dots = Spinner({ id: 'd', style: 'dots' });
    const pilotB = createTestPilot(root([braille]), { cols: 10, rows: 1 });
    const pilotD = createTestPilot(root([dots]), { cols: 10, rows: 1 });
    const bFrame = pilotB.rowText(0)[0];
    const dFrame = pilotD.rowText(0)[0];
    assert.notEqual(bFrame, dFrame);
  });
});

describe('Spinner factory', () => {
  test('returns SpinnerWidget', () => {
    const s = Spinner({});
    if (!(s instanceof SpinnerWidget)) throw new Error('should be SpinnerWidget');
  });
});

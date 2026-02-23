import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { DropdownChanged } from '../../packages/harness-ui/src/widgets/dropdown.ts';
import {
  Dropdown,
  DropdownWidget,
  type DropdownOption,
} from '../../packages/harness-ui/src/widgets/dropdown.ts';
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

const OPTS: DropdownOption[] = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
  { label: 'Gamma', value: 'c' },
];

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Dropdown rendering', () => {
  test('shows placeholder when no selection', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('Select...');
    pilot.expectRow(0).toContain('▾');
  });

  test('shows selected label', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS, selectedValue: 'b' });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('Beta');
  });

  test('custom placeholder', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS, placeholder: 'Pick one' });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('Pick one');
  });
});

describe('Dropdown interaction', () => {
  test('enter opens dropdown', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(dd);
    assert.equal(dd.open, false);
    pilot.pressKey('enter');
    assert.equal(dd.open, true);
  });

  test('arrow down moves highlight', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(dd);
    pilot.pressKey('enter');
    assert.equal(dd.highlightIndex, 0);
    pilot.pressKey('down');
    assert.equal(dd.highlightIndex, 1);
    pilot.pressKey('down');
    assert.equal(dd.highlightIndex, 2);
  });

  test('arrow up moves highlight', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(dd);
    pilot.pressKey('enter');
    pilot.pressKey('down');
    pilot.pressKey('down');
    pilot.pressKey('up');
    assert.equal(dd.highlightIndex, 1);
  });

  test('wraps highlight at bottom', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(dd);
    pilot.pressKey('enter');
    pilot.pressKey('down');
    pilot.pressKey('down');
    pilot.pressKey('down');
    assert.equal(dd.highlightIndex, 0);
  });

  test('enter on highlight selects and closes', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(dd);
    pilot.pressKey('enter');
    pilot.pressKey('down');
    pilot.pressKey('enter');
    assert.equal(dd.selectedValue, 'b');
    assert.equal(dd.open, false);
  });

  test('escape closes without selecting', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(dd);
    pilot.pressKey('enter');
    assert.equal(dd.open, true);
    pilot.pressKey('escape');
    assert.equal(dd.open, false);
    assert.equal(dd.selectedValue, null);
  });

  test('selection emits DropdownChanged', () => {
    let changed: { value: string; label: string } | null = null;
    class Handler extends RootWidget {
      onDropdownChanged(msg: DropdownChanged): void {
        changed = { value: msg.value, label: msg.label };
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const dd = Dropdown({ id: 'dd', options: OPTS });
    r.add(dd);
    const pilot = createTestPilot(r, { cols: 20, rows: 5 });
    pilot.focusManager.focus(dd);
    pilot.pressKey('enter');
    pilot.pressKey('down');
    pilot.pressKey('down');
    pilot.pressKey('enter');
    assert.notEqual(changed, null);
    assert.equal(changed!.value, 'c');
    assert.equal(changed!.label, 'Gamma');
  });

  test('opens with highlight on current selection', () => {
    const dd = Dropdown({ id: 'dd', options: OPTS, selectedValue: 'c' });
    const pilot = createTestPilot(root([dd]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(dd);
    pilot.pressKey('enter');
    assert.equal(dd.highlightIndex, 2);
  });
});

describe('Dropdown factory', () => {
  test('returns DropdownWidget', () => {
    const dd = Dropdown({ id: 'test' });
    if (!(dd instanceof DropdownWidget)) throw new Error('should be DropdownWidget');
    if (!(dd instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    assert.equal(Dropdown({}).focusable, true);
  });
});

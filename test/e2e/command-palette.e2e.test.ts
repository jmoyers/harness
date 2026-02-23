import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { CommandExecuted } from '../../packages/harness-ui/src/widgets/command-palette.ts';
import {
  CommandPalette,
  CommandPaletteWidget,
  type CommandAction,
} from '../../packages/harness-ui/src/widgets/command-palette.ts';
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

const ACTIONS: CommandAction[] = [
  { id: 'file.open', title: 'Open File', keywords: ['open'], bindingHint: 'ctrl+o' },
  { id: 'file.save', title: 'Save File', keywords: ['save', 'write'], bindingHint: 'ctrl+s' },
  { id: 'file.close', title: 'Close Tab', keywords: ['close'] },
  { id: 'edit.undo', title: 'Undo', bindingHint: 'ctrl+z' },
  { id: 'edit.redo', title: 'Redo', bindingHint: 'ctrl+shift+z' },
  { id: 'view.theme', title: 'Change Theme', description: 'Switch color theme' },
];

beforeEach(() => {
  resetAutoIdCounter();
});

describe('CommandPalette rendering', () => {
  test('renders border and input prompt', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.expectScreen().toContainRow('┌');
    pilot.expectScreen().toContainRow('>');
  });

  test('shows placeholder when query empty', () => {
    const cp = CommandPalette({
      id: 'cp',
      actions: ACTIONS,
      placeholder: 'Search...',
      width: 40,
      height: 12,
    });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.expectScreen().toContainRow('Search...');
  });

  test('renders action titles', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.expectScreen().toContainRow('Open File');
    pilot.expectScreen().toContainRow('Save File');
    pilot.expectScreen().toContainRow('Undo');
  });

  test('renders binding hints', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 50, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.expectScreen().toContainRow('ctrl+o');
  });
});

describe('CommandPalette filtering', () => {
  test('typing filters results', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('u');
    pilot.pressKey('n');
    pilot.pressKey('d');
    pilot.pressKey('o');
    pilot.expectScreen().toContainRow('Undo');
    pilot.expectScreen().not.toContainRow('Open File');
  });

  test('backspace removes filter character', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('x');
    pilot.pressKey('y');
    pilot.pressKey('z');
    const filteredBefore = cp.filteredActions();
    assert.equal(filteredBefore.length, 0);
    pilot.pressKey('backspace');
    pilot.pressKey('backspace');
    pilot.pressKey('backspace');
    const filteredAfter = cp.filteredActions();
    assert.equal(filteredAfter.length, ACTIONS.length);
  });

  test('keyword match works', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('w');
    pilot.pressKey('r');
    pilot.pressKey('i');
    pilot.pressKey('t');
    pilot.pressKey('e');
    const results = cp.filteredActions();
    assert.ok(results.some((r) => r.action.id === 'file.save'));
  });

  test('description match works', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.query = 'color';
    const results = cp.filteredActions();
    assert.ok(results.some((r) => r.action.id === 'view.theme'));
  });

  test('maxResults limits output', () => {
    const manyActions: CommandAction[] = Array.from({ length: 20 }, (_, i) => ({
      id: `action.${i}`,
      title: `Action ${i}`,
    }));
    const cp = CommandPalette({
      id: 'cp',
      actions: manyActions,
      maxResults: 5,
      width: 40,
      height: 12,
    });
    const results = cp.filteredActions();
    assert.equal(results.length, 5);
  });
});

describe('CommandPalette navigation', () => {
  test('down moves selection', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    assert.equal(cp.selectedIndex, 0);
    pilot.pressKey('down');
    assert.equal(cp.selectedIndex, 1);
  });

  test('up moves selection', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.selectedIndex = 2;
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('up');
    assert.equal(cp.selectedIndex, 1);
  });

  test('wraps at bottom', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.selectedIndex = ACTIONS.length - 1;
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('down');
    assert.equal(cp.selectedIndex, 0);
  });

  test('wraps at top', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('up');
    assert.equal(cp.selectedIndex, ACTIONS.length - 1);
  });

  test('typing resets selection to 0', () => {
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.selectedIndex = 3;
    cp.positionInViewport(60, 20);
    const pilot = createTestPilot(root([cp]), { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('a');
    assert.equal(cp.selectedIndex, 0);
  });
});

describe('CommandPalette execution', () => {
  test('enter emits CommandExecuted', () => {
    let executed: { id: string; title: string } | null = null;
    class Handler extends RootWidget {
      onCommandExecuted(msg: CommandExecuted): void {
        executed = { id: msg.actionId, title: msg.action.title };
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    r.add(cp);
    const pilot = createTestPilot(r, { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('down');
    pilot.pressKey('enter');
    assert.notEqual(executed, null);
    assert.equal(executed!.id, 'file.save');
  });

  test('escape emits CommandPaletteDismissed', () => {
    let dismissed = false;
    class Handler extends RootWidget {
      onCommandPaletteDismissed(): void {
        dismissed = true;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const cp = CommandPalette({ id: 'cp', actions: ACTIONS, width: 40, height: 12 });
    cp.positionInViewport(60, 20);
    r.add(cp);
    const pilot = createTestPilot(r, { cols: 60, rows: 20 });
    pilot.focusManager.focus(cp);
    pilot.pressKey('escape');
    assert.equal(dismissed, true);
  });
});

describe('CommandPalette factory', () => {
  test('returns CommandPaletteWidget', () => {
    const cp = CommandPalette({ id: 'test' });
    if (!(cp instanceof CommandPaletteWidget)) throw new Error('should be CommandPaletteWidget');
    if (!(cp instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable and absolute positioned', () => {
    const cp = CommandPalette({});
    assert.equal(cp.focusable, true);
    assert.equal(cp.position, 'absolute');
    assert.equal(cp.zIndex, 200);
  });
});

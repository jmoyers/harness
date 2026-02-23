import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { AutocompleteSelected } from '../../packages/harness-ui/src/widgets/autocomplete.ts';
import {
  AutocompletePopup,
  AutocompletePopupWidget,
  type AutocompleteOption,
} from '../../packages/harness-ui/src/widgets/autocomplete.ts';
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

const OPTIONS: AutocompleteOption[] = [
  { label: 'help', value: '/help', description: 'Show help' },
  { label: 'new', value: '/new', description: 'New session' },
  { label: 'connect', value: '/connect', description: 'Add provider' },
  { label: 'theme', value: '/theme', description: 'Change theme' },
  { label: 'share', value: '/share', description: 'Share session' },
];

function provider(query: string): AutocompleteOption[] {
  const q = query.toLowerCase();
  if (q.length === 0) return [...OPTIONS];
  return OPTIONS.filter((o) => o.label.toLowerCase().includes(q));
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('AutocompletePopup rendering', () => {
  test('renders options when open', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('', 0, 10);
    const pilot = createTestPilot(root([ac]), { cols: 40, rows: 12 });
    pilot.expectScreen().toContainRow('help');
    pilot.expectScreen().toContainRow('new');
    pilot.expectScreen().toContainRow('theme');
  });

  test('renders descriptions', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 40, maxHeight: 6 });
    ac.show('', 0, 10);
    const pilot = createTestPilot(root([ac]), { cols: 50, rows: 12 });
    pilot.expectScreen().toContainRow('Show help');
  });

  test('hidden when not open', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    const pilot = createTestPilot(root([ac]), { cols: 40, rows: 12 });
    pilot.expectScreen().not.toContainRow('help');
  });

  test('filters by query', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('th', 0, 10);
    const pilot = createTestPilot(root([ac]), { cols: 40, rows: 12 });
    pilot.expectScreen().toContainRow('theme');
    pilot.expectScreen().not.toContainRow('help');
  });
});

describe('AutocompletePopup navigation', () => {
  test('down moves selection', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('', 0, 10);
    assert.equal(ac.selectedIndex, 0);
    ac.handleKeypress({ key: 'down', raw: Buffer.from([]), ctrl: false, alt: false, shift: false });
    assert.equal(ac.selectedIndex, 1);
  });

  test('up moves selection', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('', 0, 10);
    ac.selectedIndex = 2;
    ac.handleKeypress({ key: 'up', raw: Buffer.from([]), ctrl: false, alt: false, shift: false });
    assert.equal(ac.selectedIndex, 1);
  });

  test('wraps at bottom', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('', 0, 10);
    ac.selectedIndex = OPTIONS.length - 1;
    ac.handleKeypress({ key: 'down', raw: Buffer.from([]), ctrl: false, alt: false, shift: false });
    assert.equal(ac.selectedIndex, 0);
  });

  test('wraps at top', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('', 0, 10);
    ac.handleKeypress({ key: 'up', raw: Buffer.from([]), ctrl: false, alt: false, shift: false });
    assert.equal(ac.selectedIndex, OPTIONS.length - 1);
  });
});

describe('AutocompletePopup selection', () => {
  test('enter emits AutocompleteSelected', () => {
    let selected: AutocompleteOption | null = null;
    class Handler extends RootWidget {
      onAutocompleteSelected(msg: AutocompleteSelected): void {
        selected = msg.option;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    r.add(ac);
    ac.show('', 0, 10);
    ac.selectedIndex = 1;
    createTestPilot(r, { cols: 40, rows: 12 });
    ac.handleKeypress({
      key: 'enter',
      raw: Buffer.from([]),
      ctrl: false,
      alt: false,
      shift: false,
    });
    assert.notEqual(selected, null);
    assert.equal(selected!.value, '/new');
    assert.equal(ac.open, false);
  });

  test('tab also selects', () => {
    let selected: AutocompleteOption | null = null;
    class Handler extends RootWidget {
      onAutocompleteSelected(msg: AutocompleteSelected): void {
        selected = msg.option;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    r.add(ac);
    ac.show('', 0, 10);
    createTestPilot(r, { cols: 40, rows: 12 });
    ac.handleKeypress({ key: 'tab', raw: Buffer.from([]), ctrl: false, alt: false, shift: false });
    assert.notEqual(selected, null);
  });

  test('escape dismisses', () => {
    let dismissed = false;
    class Handler extends RootWidget {
      onAutocompleteDismissed(): void {
        dismissed = true;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    r.add(ac);
    ac.show('', 0, 10);
    createTestPilot(r, { cols: 40, rows: 12 });
    ac.handleKeypress({
      key: 'escape',
      raw: Buffer.from([]),
      ctrl: false,
      alt: false,
      shift: false,
    });
    assert.equal(dismissed, true);
    assert.equal(ac.open, false);
  });
});

describe('AutocompletePopup query update', () => {
  test('updateQuery narrows results', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('', 0, 10);
    assert.equal(ac.filteredOptions().length, 5);
    ac.updateQuery('hel');
    assert.equal(ac.filteredOptions().length, 1);
    assert.equal(ac.filteredOptions()[0]!.label, 'help');
  });

  test('updateQuery hides when no results', () => {
    const ac = AutocompletePopup({ id: 'ac', provider, width: 30, maxHeight: 6 });
    ac.show('', 0, 10);
    ac.updateQuery('zzzzz');
    assert.equal(ac.open, false);
  });
});

describe('AutocompletePopup factory', () => {
  test('returns AutocompletePopupWidget', () => {
    const ac = AutocompletePopup({});
    if (!(ac instanceof AutocompletePopupWidget))
      throw new Error('should be AutocompletePopupWidget');
  });

  test('is absolute positioned with high z-index', () => {
    const ac = AutocompletePopup({});
    assert.equal(ac.position, 'absolute');
    assert.equal(ac.zIndex, 250);
  });
});

import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../../packages/harness-ui/src/widget/widget.ts';
import {
  CommandPalette,
  type CommandAction,
} from '../../../packages/harness-ui/src/widgets/command-palette.ts';
import { Markdown } from '../../../packages/harness-ui/src/widgets/markdown.ts';
import { Terminal } from '../../../packages/harness-ui/src/widgets/terminal.ts';
import { createTestPilot } from '../../../packages/harness-ui/src/testing/pilot.ts';
import { assertUiContractSnapshot, createUiContractSnapshot } from '../../support/ui-contract.ts';

class RootWidget extends Widget {
  render(): void {}
}

function root(children: readonly Widget[]): RootWidget {
  const value = new RootWidget('root');
  value.flexDirection = 'column';
  value.add(...children);
  return value;
}

const ACTIONS: readonly CommandAction[] = [
  { id: 'file.open', title: 'Open File', keywords: ['open'], bindingHint: 'ctrl+o' },
  { id: 'file.save', title: 'Save File', keywords: ['save', 'write'], bindingHint: 'ctrl+s' },
  { id: 'file.close', title: 'Close File', keywords: ['close'], bindingHint: 'ctrl+w' },
  { id: 'workspace.switch', title: 'Switch Workspace', keywords: ['workspace'] },
];

beforeEach(() => {
  resetAutoIdCounter();
});

describe('ui visual contracts', () => {
  test('command palette keeps layout and selection affordances stable', () => {
    const commandPalette = CommandPalette({
      id: 'palette',
      actions: ACTIONS,
      width: 52,
      height: 12,
      borderColor: '#3b82f6',
      backgroundColor: '#0f172a',
      selectedBg: '#1d4ed8',
      inputFg: '#f8fafc',
    });
    commandPalette.positionInViewport(56, 14);

    const pilot = createTestPilot(root([commandPalette]), { cols: 56, rows: 14 });
    pilot.focusManager.focus(commandPalette);
    pilot.type('file');
    pilot.pressKey('down');

    assertUiContractSnapshot(
      createUiContractSnapshot({
        name: 'command-palette/filter-navigation',
        pilot,
        metadata: {
          query: commandPalette.query,
          selectedIndex: commandPalette.selectedIndex,
          filteredCount: commandPalette.filteredActions().length,
        },
      }),
    );
  });

  test('markdown block and inline semantics keep visual style stable', () => {
    const markdown = Markdown({
      id: 'markdown',
      flexGrow: 1,
      content: [
        '# Harness UI',
        '',
        'Mix **bold**, *italic*, and `code` text.',
        '',
        '- item one',
        '- item two',
        '',
        '> callout row',
        '',
        '---',
      ].join('\n'),
      colors: {
        text: '#e2e8f0',
        heading: '#38bdf8',
        bold: '#f59e0b',
        italic: '#fb7185',
        code: '#86efac',
        blockquote: '#cbd5e1',
        listMarker: '#22d3ee',
        horizontalRule: '#64748b',
      },
    });

    const pilot = createTestPilot(root([markdown]), { cols: 54, rows: 12 });

    assertUiContractSnapshot(
      createUiContractSnapshot({
        name: 'markdown/mixed-rich-content',
        pilot,
      }),
    );
  });

  test('terminal ANSI rendering keeps glyph/style projection stable', () => {
    const terminal = Terminal({ id: 'terminal', flexGrow: 1 });
    const pilot = createTestPilot(root([terminal]), { cols: 40, rows: 8 });
    terminal.write('plain\r\n');
    terminal.write('\u001b[1mbold\u001b[0m ');
    terminal.write('\u001b[38;2;255;0;0mred\u001b[0m ');
    terminal.write('你好');
    terminal.write('\r\nline-3');
    pilot.resize(pilot.cols, pilot.rows);

    const terminalSnapshot = terminal.snapshot();
    assertUiContractSnapshot(
      createUiContractSnapshot({
        name: 'terminal/ansi-color-and-wide-glyph',
        pilot,
        metadata: {
          cursorRow: terminalSnapshot.cursor.row,
          cursorCol: terminalSnapshot.cursor.col,
          cursorVisible: terminalSnapshot.cursor.visible,
        },
      }),
    );
  });
});

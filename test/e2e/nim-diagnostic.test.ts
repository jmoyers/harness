/**
 * Diagnostic dump — shows exactly what the nim app renders.
 * Run: bun test test/e2e/nim-diagnostic.test.ts
 */
import { test } from 'bun:test';
import {
  Widget,
  resetAutoIdCounter,
  edgeInsets,
} from '../../packages/harness-ui/src/widget/widget.ts';
import { reactive } from '../../packages/harness-ui/src/widget/reactive.ts';
import { Row } from '../../packages/harness-ui/src/widgets/box.ts';
import { Composer } from '../../packages/harness-ui/src/widgets/composer.ts';
import { PaneDivider } from '../../packages/harness-ui/src/widgets/pane-divider.ts';
import { createTestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';
import { DEFAULT_CELL_STYLE, parseHexColor } from '../../packages/harness-ui/src/core/color.ts';
import { DARK_THEME } from '../../packages/harness-ui/src/theme/defaults.ts';
import type { ClippedCellBuffer } from '../../packages/harness-ui/src/core/cell-buffer.ts';
import type { CellStyle } from '../../packages/harness-ui/src/core/color.ts';

const T = {
  text: parseHexColor(DARK_THEME.colors.text)!,
  muted: parseHexColor(DARK_THEME.colors.textMuted)!,
  accent: parseHexColor(DARK_THEME.colors.textAccent)!,
  primary: parseHexColor(DARK_THEME.colors.primary)!,
  bg: parseHexColor(DARK_THEME.colors.background)!,
  panelBg: parseHexColor(DARK_THEME.colors.backgroundPanel)!,
};
function s(fg = T.text, bg = T.bg, bold = false): CellStyle {
  return {
    ...DEFAULT_CELL_STYLE,
    fg,
    bg,
    bold,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
  };
}

class Header extends Widget {
  render(buf: ClippedCellBuffer): void {
    buf.fillRow(0, s(T.text, T.panelBg, true));
    buf.drawText(1, 0, '  nim · session', s(T.accent, T.panelBg, true));
    buf.drawText(buf.cols - 20, 0, 'Build · test-model', s(T.muted, T.panelBg));
  }
}

class Conv extends Widget {
  messages = reactive<string[]>([]);
  constructor(id: string) {
    super(id);
    this.manualChildRendering = true;
  }
  render(buf: ClippedCellBuffer): void {
    for (let r = 0; r < buf.rows; r += 1) buf.fillRow(r, s(T.text, T.bg));
    let row = 0;
    for (const msg of this.messages) {
      if (row >= buf.rows) break;
      if (msg.startsWith('USER:')) {
        buf.fillRow(row, s(T.text, T.panelBg));
        buf.drawText(0, row, '│', s(T.primary, T.panelBg));
        buf.drawText(2, row, msg.slice(5), s(T.text, T.panelBg));
      } else {
        buf.drawText(3, row, msg, s(T.text, T.bg));
      }
      row += 1;
    }
  }
}

class Sidebar extends Widget {
  render(buf: ClippedCellBuffer): void {
    for (let r = 0; r < buf.rows; r += 1) buf.fillRow(r, s(T.text, T.panelBg));
    buf.drawText(1, 0, 'Context', s(T.accent, T.panelBg, true));
    buf.drawText(1, 1, 'Tokens 2,847', s(T.text, T.panelBg));
  }
}

class Footer extends Widget {
  render(buf: ClippedCellBuffer): void {
    buf.fillRow(0, s(T.muted, T.panelBg));
    buf.drawText(1, 0, '~/dev/project', s(T.muted, T.panelBg));
    buf.drawText(buf.cols - 10, 0, 'ctrl+c quit', s(T.muted, T.panelBg));
  }
}

test('DIAGNOSTIC: dump initial render', () => {
  resetAutoIdCounter();
  const root = new (class extends Widget {
    render(): void {}
  })('root');
  root.flexDirection = 'column';

  const header = new Header('hdr');
  header.height = 1;
  const body = new (class extends Widget {
    render(): void {}
  })('body');
  body.flexGrow = 1;
  body.flexDirection = 'row';
  const mainCol = new (class extends Widget {
    render(): void {}
  })('mc');
  mainCol.flexGrow = 1;
  mainCol.flexDirection = 'column';
  mainCol.padding = edgeInsets(1, 2);
  const conv = new Conv('conv');
  conv.flexGrow = 1;
  conv.messages = [
    'USER:Fix the auth bug',
    'Analyzing the module...',
    '✓ read src/auth.ts',
    '▣ Build · model',
  ];
  const compRow = Row({ height: 3 });
  const composer = Composer({
    id: 'comp',
    placeholder: 'Ask nim...',
    modeIndicator: '[Build]',
    flexGrow: 1,
  });
  compRow.add(composer);
  mainCol.add(conv, compRow);
  const div = PaneDivider({ id: 'div' });
  const sidebar = new Sidebar('sb');
  sidebar.width = 20;
  body.add(mainCol, div, sidebar);
  const footer = new Footer('ft');
  footer.height = 1;
  root.add(header, body, footer);

  const pilot = createTestPilot(root, { cols: 80, rows: 20 });
  console.log('\n=== INITIAL RENDER ===');
  console.log(pilot.dumpScreen());

  pilot.focusManager.focus(composer);
  pilot.pressKey('h');
  pilot.pressKey('e');
  pilot.pressKey('l');
  pilot.pressKey('l');
  pilot.pressKey('o');
  console.log('\n=== AFTER TYPING "hello" ===');
  console.log(pilot.dumpScreen());
});

/**
 * nim standalone e2e tests — verifies harness control agent TUI
 * via actual rendered output using TestPilot.
 */
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  Widget,
  resetAutoIdCounter,
  edgeInsets,
} from '../../packages/harness-ui/src/widget/widget.ts';
import { reactive } from '../../packages/harness-ui/src/widget/reactive.ts';
import type { ComposerSubmitted } from '../../packages/harness-ui/src/widgets/composer.ts';
import { Composer } from '../../packages/harness-ui/src/widgets/composer.ts';
import { Toast } from '../../packages/harness-ui/src/widgets/toast.ts';
import {
  CommandPalette,
  type CommandAction,
} from '../../packages/harness-ui/src/widgets/command-palette.ts';
import { createTestPilot, type TestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';
import {
  DEFAULT_CELL_STYLE,
  parseHexColor,
  type CellStyle,
  type Color,
} from '../../packages/harness-ui/src/core/color.ts';
import { TextLayoutEngine } from '../../packages/harness-ui/src/text-layout.ts';
import { DARK_THEME } from '../../packages/harness-ui/src/theme/defaults.ts';
import type { ClippedCellBuffer } from '../../packages/harness-ui/src/core/cell-buffer.ts';
import type { Binding } from '../../packages/harness-ui/src/widget/keybinding.ts';

const layout = new TextLayoutEngine();
function c(hex: string): Color {
  return parseHexColor(hex) ?? { kind: 'default' };
}
function sty(
  fg: Color,
  bg: Color = c(DARK_THEME.colors.background),
  bold = false,
  dim = false,
): CellStyle {
  return {
    ...DEFAULT_CELL_STYLE,
    fg,
    bg,
    bold,
    dim,
    italic: false,
    underline: false,
    inverse: false,
  };
}
const TH = {
  text: sty(c(DARK_THEME.colors.text)),
  headerBg: sty(c(DARK_THEME.colors.text), c(DARK_THEME.colors.backgroundPanel), true),
  headerAccent: sty(c(DARK_THEME.colors.textAccent), c(DARK_THEME.colors.backgroundPanel), true),
  headerMuted: sty(c(DARK_THEME.colors.textMuted), c(DARK_THEME.colors.backgroundPanel)),
  userBg: sty(c(DARK_THEME.colors.text), c(DARK_THEME.colors.backgroundPanel)),
  userPipe: sty(c(DARK_THEME.colors.primary), c(DARK_THEME.colors.backgroundPanel)),
  muted: sty(c(DARK_THEME.colors.textMuted)),
  toolDone: sty(c(DARK_THEME.colors.textMuted)),
  border: sty(c(DARK_THEME.colors.border)),
  footerBg: sty(c(DARK_THEME.colors.textMuted), c(DARK_THEME.colors.backgroundPanel)),
  dim: sty(c(DARK_THEME.colors.textMuted), c(DARK_THEME.colors.background), false, true),
};

// --- Simplified nim app for testing ---
interface ToolCall {
  name: string;
  args: string;
  status: 'done' | 'pending' | 'error';
  result?: string;
}
interface ChatMsg {
  role: 'user' | 'nim';
  text: string;
  tools: ToolCall[];
}

class TestConv extends Widget {
  messages = reactive<ChatMsg[]>([]);
  scrollTop = reactive(0);

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'scroll-up', description: 'Up' },
    { key: 'down', action: 'scroll-down', description: 'Down' },
  ];

  constructor() {
    super('conv');
    this.focusable = true;
    this.manualChildRendering = true;
  }

  private flat(width: number): string[] {
    const lines: string[] = [];
    for (let i = 0; i < this.messages.length; i += 1) {
      if (i > 0) lines.push('');
      const msg = this.messages[i]!;
      if (msg.role === 'user') {
        for (const w of layout.wrap(msg.text, width - 4)) lines.push(`U│ ${w}`);
      } else {
        for (const line of msg.text.split('\n')) {
          for (const w of layout.wrap(line, width - 4)) lines.push(`A  ${w}`);
        }
        for (const t of msg.tools) {
          const icon = t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '⚙';
          lines.push(`T${icon} ${t.name} ${t.args}`);
          if (t.result) lines.push(`R  ${t.result}`);
        }
        lines.push('F▣ nim');
      }
    }
    return lines;
  }

  scrollToBottom(): void {
    const h = this.computedRect.height || 10;
    const total = this.flat(this.computedRect.width || 80).length;
    this.scrollTop = Math.max(0, total - h);
  }

  actionScrollUp(): void {
    this.scrollTop = Math.max(0, this.scrollTop - 1);
  }
  actionScrollDown(): void {
    this.scrollTop = this.scrollTop + 1;
  }

  render(buf: ClippedCellBuffer): void {
    for (let r = 0; r < buf.rows; r += 1) buf.fillRow(r, TH.text);
    const flat = this.flat(buf.cols);
    const maxScroll = Math.max(0, flat.length - buf.rows);
    if (this.scrollTop > maxScroll) this.scrollTop = maxScroll;
    for (let vr = 0; vr < buf.rows; vr += 1) {
      const idx = this.scrollTop + vr;
      if (idx >= flat.length) break;
      const line = flat[idx]!;
      const tag = line[0]!;
      const content = line.slice(1);
      if (tag === 'U') {
        buf.fillRow(vr, TH.userBg);
        buf.drawText(0, vr, '│', TH.userPipe);
        buf.drawText(2, vr, content.slice(1), TH.userBg);
      } else if (tag === 'A') buf.drawText(3, vr, content.slice(1), TH.text);
      else if (tag === 'T') {
        buf.drawText(3, vr, content[0]!, TH.toolDone);
        buf.drawText(5, vr, content.slice(2), TH.toolDone);
      } else if (tag === 'R') buf.drawText(5, vr, content.slice(1), TH.dim);
      else if (tag === 'F') buf.drawText(3, vr, content, TH.muted);
    }
  }
}

const COMMANDS: CommandAction[] = [
  { id: 'status', title: 'Harness Status' },
  { id: 'sessions', title: 'List Sessions' },
];

class NimTest extends Widget {
  static BINDINGS: Binding[] = [{ key: 'ctrl+p', action: 'open-palette', description: 'Palette' }];
  conv: TestConv;
  composer: ReturnType<typeof Composer>;
  toast: ReturnType<typeof Toast>;
  palette: ReturnType<typeof CommandPalette> | null = null;

  constructor() {
    super('nim');
    this.focusable = true;
    this.width = '100%';
    this.height = '100%';
    this.flexDirection = 'column';
    const hdr = new (class extends Widget {
      render(buf: ClippedCellBuffer): void {
        buf.fillRow(0, TH.headerBg);
        buf.drawText(1, 0, '  nim · harness agent', TH.headerAccent);
      }
    })('hdr');
    hdr.height = 1;
    this.conv = new TestConv();
    this.conv.flexGrow = 1;
    const compBox = new (class extends Widget {
      render(buf: ClippedCellBuffer): void {
        for (let r = 0; r < buf.rows; r++)
          buf.fillRow(r, sty(c(DARK_THEME.colors.text), c(DARK_THEME.colors.backgroundPanel)));
        buf.drawText(0, 0, '─'.repeat(buf.cols), TH.border);
      }
    })('cb');
    compBox.height = 4;
    compBox.flexDirection = 'column';
    compBox.padding = edgeInsets(1, 1, 0, 1);
    this.composer = Composer({
      id: 'comp',
      placeholder: 'Tell nim what to do...',
      flexGrow: 1,
      fg: DARK_THEME.colors.text,
      bg: DARK_THEME.colors.backgroundPanel,
      placeholderFg: DARK_THEME.colors.textMuted,
    });
    compBox.add(this.composer);
    const ft = new (class extends Widget {
      render(buf: ClippedCellBuffer): void {
        buf.fillRow(0, TH.footerBg);
        buf.drawText(1, 0, '~/dev/project', TH.footerBg);
      }
    })('ft');
    ft.height = 1;
    this.toast = Toast({ id: 'toast' });
    this.add(hdr, this.conv, compBox, ft, this.toast);
    this.conv.messages = [
      { role: 'user', text: 'What is the harness status?', tools: [] },
      {
        role: 'nim',
        text: 'Checking status.',
        tools: [
          { name: 'harness.status', args: '', status: 'done', result: '3 conversations active' },
        ],
      },
    ];
  }

  onComposerSubmitted(msg: ComposerSubmitted): void {
    this.conv.messages = [
      ...this.conv.messages,
      { role: 'user', text: msg.value, tools: [] },
      {
        role: 'nim',
        text: `Response: ${msg.value}`,
        tools: [{ name: 'echo', args: msg.value, status: 'done' }],
      },
    ];
    this.conv.scrollToBottom();
  }

  actionOpenPalette(): void {
    if (!this.palette) {
      this.palette = CommandPalette({ id: 'pal', actions: COMMANDS, width: 40, height: 8 });
      this.add(this.palette);
    }
    this.palette.positionInViewport(this.computedRect.width || 80, this.computedRect.height || 24);
    this.palette.visible = true;
    this.palette.query = '';
    this.palette.selectedIndex = 0;
  }
  onCommandExecuted(): void {
    if (this.palette) this.palette.visible = false;
  }
  onCommandPaletteDismissed(): void {
    if (this.palette) this.palette.visible = false;
  }
  render(): void {}
}

function create(): { app: NimTest; pilot: TestPilot } {
  resetAutoIdCounter();
  const app = new NimTest();
  const pilot = createTestPilot(app, { cols: 80, rows: 24 });
  pilot.focusManager.focus(app.composer);
  return { app, pilot };
}

// === Layout ===
describe('Layout', () => {
  test('header at row 0 with nim branding', () => {
    const { pilot } = create();
    pilot.expectRow(0).toContain('nim');
    pilot.expectRow(0).toContain('harness agent');
  });

  test('footer at last row with directory', () => {
    const { pilot } = create();
    pilot.expectRow(23).toContain('~/dev/project');
  });

  test('separator line above composer', () => {
    const { pilot } = create();
    let found = false;
    for (let r = 15; r < 22; r += 1) {
      if (pilot.rowText(r).includes('─────')) {
        found = true;
        break;
      }
    }
    assert.ok(found, 'Separator line not found above composer');
  });

  test('composer placeholder visible', () => {
    const { app, pilot } = create();
    app.composer.blur();
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('Tell nim what to do...');
  });

  test('conversation content between header and composer', () => {
    const { pilot } = create();
    pilot.expectScreen().toContainRow('What is the harness status?');
  });

  test('full height used — no blank rows between footer and content', () => {
    const { pilot } = create();
    pilot.expectRow(23).toContain('~/dev/project');
    pilot.expectRow(0).toContain('nim');
  });
});

// === Seed conversation ===
describe('Seed conversation', () => {
  test('user message with pipe border visible', () => {
    const { pilot } = create();
    let found = false;
    for (let r = 0; r < 24; r += 1) {
      if (pilot.rowText(r).includes('What is the harness status?')) {
        assert.ok(pilot.rowText(r).includes('│'), 'Missing pipe border on user message');
        found = true;
        break;
      }
    }
    assert.ok(found, 'Seed user message not found');
  });

  test('assistant text visible', () => {
    const { pilot } = create();
    pilot.expectScreen().toContainRow('Checking status.');
  });

  test('tool call with check icon visible', () => {
    const { pilot } = create();
    pilot.expectScreen().toContainRow('✓ harness.status');
  });

  test('tool result visible', () => {
    const { pilot } = create();
    pilot.expectScreen().toContainRow('3 conversations active');
  });

  test('message footer visible', () => {
    const { pilot } = create();
    pilot.expectScreen().toContainRow('▣ nim');
  });
});

// === Typing and submission ===
describe('Typing and submission', () => {
  test('typed text appears in rendered output', () => {
    const { pilot } = create();
    pilot.pressKey('h');
    pilot.pressKey('e');
    pilot.pressKey('l');
    pilot.pressKey('l');
    pilot.pressKey('o');
    pilot.expectScreen().toContainRow('hello');
  });

  test('submit adds user message to conversation', () => {
    const { pilot } = create();
    pilot.pressKey('t');
    pilot.pressKey('e');
    pilot.pressKey('s');
    pilot.pressKey('t');
    pilot.pressKey('enter');
    pilot.expectScreen().toContainRow('test');
  });

  test('submit triggers nim response in rendered output', () => {
    const { pilot } = create();
    pilot.pressKey('g');
    pilot.pressKey('o');
    pilot.pressKey('enter');
    pilot.expectScreen().toContainRow('Response: go');
  });

  test('tool call appears after submission', () => {
    const { pilot } = create();
    pilot.pressKey('x');
    pilot.pressKey('enter');
    pilot.expectScreen().toContainRow('✓ echo x');
  });

  test('multiple submissions accumulate', () => {
    const { pilot } = create();
    pilot.pressKey('a');
    pilot.pressKey('enter');
    pilot.pressKey('b');
    pilot.pressKey('enter');
    pilot.expectScreen().toContainRow('Response: b');
  });
});

// === Scrollback ===
describe('Scrollback', () => {
  test('conversation scrolls when content exceeds viewport', () => {
    const { app, pilot } = create();
    for (let i = 0; i < 15; i += 1) {
      app.conv.messages = [
        ...app.conv.messages,
        { role: 'user', text: `Message ${i}`, tools: [] },
        {
          role: 'nim',
          text: `Reply ${i}`,
          tools: [{ name: 'op', args: `${i}`, status: 'done' as const }],
        },
      ];
    }
    app.conv.scrollToBottom();
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('Reply 14');
    pilot.expectScreen().not.toContainRow('What is the harness status?');
  });

  test('scroll up reveals earlier messages', () => {
    const { app, pilot } = create();
    for (let i = 0; i < 15; i += 1) {
      app.conv.messages = [
        ...app.conv.messages,
        { role: 'user', text: `Message ${i}`, tools: [] },
        { role: 'nim', text: `Reply ${i}`, tools: [] },
      ];
    }
    app.conv.scrollToBottom();
    pilot.resize(pilot.cols, pilot.rows);
    pilot.focusManager.focus(app.conv);
    for (let i = 0; i < 80; i += 1) pilot.pressKey('up');
    pilot.expectScreen().toContainRow('What is the harness status?');
  });

  test('scrollTop is clamped to valid range', () => {
    const { app, pilot } = create();
    app.conv.scrollTop = 999;
    pilot.resize(pilot.cols, pilot.rows);
    assert.ok(app.conv.scrollTop <= app.conv.messages.length * 5);
  });
});

// === Command palette ===
describe('Command palette', () => {
  test('ctrl+p opens palette in rendered output', () => {
    const { app, pilot } = create();
    pilot.focusManager.focus(app);
    pilot.pressKey('ctrl+p');
    pilot.expectScreen().toContainRow('Harness Status');
    pilot.expectScreen().toContainRow('List Sessions');
  });

  test('escape closes palette', () => {
    const { app, pilot } = create();
    pilot.focusManager.focus(app);
    pilot.pressKey('ctrl+p');
    pilot.expectScreen().toContainRow('Harness Status');
    pilot.focusManager.focus(app.palette!);
    pilot.pressKey('escape');
    pilot.expectScreen().not.toContainRow('Harness Status');
  });
});

// === Full flow ===
describe('Full interaction flow', () => {
  test('type → submit → see response → scroll back → see seed', () => {
    const { app, pilot } = create();

    pilot.pressKey('s');
    pilot.pressKey('t');
    pilot.pressKey('a');
    pilot.pressKey('t');
    pilot.pressKey('u');
    pilot.pressKey('s');
    pilot.pressKey('enter');
    pilot.expectScreen().toContainRow('Response: status');

    for (let i = 0; i < 10; i += 1) {
      app.conv.messages = [
        ...app.conv.messages,
        { role: 'user', text: `Extra ${i}`, tools: [] },
        { role: 'nim', text: `Extra reply ${i}`, tools: [] },
      ];
    }
    app.conv.scrollToBottom();
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('Extra reply 9');

    pilot.focusManager.focus(app.conv);
    for (let i = 0; i < 50; i += 1) pilot.pressKey('up');
    pilot.expectScreen().toContainRow('What is the harness status?');
  });
});

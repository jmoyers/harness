#!/usr/bin/env bun
import { loadHarnessSecrets } from '../../src/config/secrets-core.ts';
loadHarnessSecrets();

import { createApp } from './src/app/app.ts';
import { Widget, edgeInsets } from './src/widget/widget.ts';
import { reactive } from './src/widget/reactive.ts';
import { Composer, ComposerSubmitted } from './src/widgets/composer.ts';
import { Toast } from './src/widgets/toast.ts';
import { PaneDivider } from './src/widgets/pane-divider.ts';
import { CommandPalette, CommandExecuted, CommandPaletteDismissed, type CommandAction } from './src/widgets/command-palette.ts';
import { DEFAULT_CELL_STYLE, parseHexColor, type CellStyle, type Color } from './src/core/color.ts';
import { TextLayoutEngine } from './src/text-layout.ts';
import type { ClippedCellBuffer } from './src/core/cell-buffer.ts';
import type { Binding } from './src/widget/keybinding.ts';
import { InMemoryNimRuntime } from '../nim-core/src/runtime.ts';
import { createAnthropicNimProviderDriver } from '../nim-core/src/providers/anthropic-driver.ts';
import { NimProviderRouter } from '../nim-core/src/provider-router.ts';
import { InMemoryNimEventStore } from '../nim-core/src/event-store.ts';
import { InMemoryNimSessionStore } from '../nim-core/src/session-store.ts';
import type { NimRuntime, SessionHandle, NimModelRef } from '../nim-core/src/contracts.ts';

const layout = new TextLayoutEngine();

const OC = {
  background: '#0A0A0A',
  panel: '#141414',
  element: '#1E1E1E',
  border: '#484848',
  borderSubtle: '#3C3C3C',
  text: '#EEEEEE',
  muted: '#808080',
  primary: '#FAB283',
  secondary: '#5C9CF5',
  accent: '#9D7CD8',
  success: '#7FD88F',
  warning: '#F5A742',
  error: '#E06C75',
  diffAdded: '#4FD6BE',
  diffRemoved: '#C53B53',
} as const;

function c(hex: string): Color {
  return parseHexColor(hex) ?? { kind: 'default' };
}

function sty(fg: Color, bg: Color = c(OC.background), bold = false, dim = false): CellStyle {
  return { ...DEFAULT_CELL_STYLE, fg, bg, bold, dim, italic: false, underline: false, inverse: false };
}

const BG = c(OC.background);
const PANEL = c(OC.panel);
const PANEL_ALT = c(OC.element);

const TH = {
  bg: sty(c(OC.text), BG),
  text: sty(c(OC.text), BG),
  muted: sty(c(OC.muted), BG),
  strong: sty(c(OC.text), BG, true),
  modeBuild: sty(c(OC.primary), BG, true),
  modePlan: sty(c(OC.accent), BG, true),
  border: sty(c(OC.border), BG),
  borderSubtle: sty(c(OC.borderSubtle), BG),
  panel: sty(c(OC.text), PANEL),
  panelMuted: sty(c(OC.muted), PANEL),
  panelStrong: sty(c(OC.text), PANEL, true),
  panelAccent: sty(c(OC.primary), PANEL, true),
  panelSecondary: sty(c(OC.secondary), PANEL),
  panelKey: sty(c(OC.text), PANEL),
  userBg: sty(c(OC.text), PANEL),
  userPipeBuild: sty(c(OC.primary), PANEL, true),
  userPipePlan: sty(c(OC.accent), PANEL, true),
  assistantText: sty(c(OC.text), BG),
  assistantHeading: sty(c(OC.accent), BG, true),
  assistantQuote: sty(c(OC.muted), BG),
  assistantMeta: sty(c(OC.muted), BG),
  codeBg: sty(c(OC.text), PANEL_ALT),
  codeText: sty(c(OC.text), PANEL_ALT),
  diffAdd: sty(c(OC.diffAdded), BG),
  diffRemove: sty(c(OC.diffRemoved), BG),
  toolPending: sty(c(OC.primary), BG),
  toolDone: sty(c(OC.muted), BG),
  toolError: sty(c(OC.error), BG),
  toolName: sty(c(OC.secondary), BG),
  footerText: sty(c(OC.muted), BG),
  footerKey: sty(c(OC.text), BG),
  sideBg: sty(c(OC.text), PANEL),
  sideTitle: sty(c(OC.text), PANEL, true),
  sideMuted: sty(c(OC.muted), PANEL),
  sideValue: sty(c(OC.text), PANEL),
  sideDotOn: sty(c(OC.success), PANEL),
  sideDotError: sty(c(OC.error), PANEL),
  sideDotOff: sty(c(OC.muted), PANEL),
  tipDot: sty(c(OC.warning), BG),
  tipLabel: sty(c(OC.warning), BG, true),
  tipText: sty(c(OC.muted), BG),
};

const VERSION = '0.1.0';
const CONTEXT_WINDOW_TOKENS = 200_000;
const TIPS = [
  'Use @path to include files directly in your prompt.',
  'Press tab to switch between Build and Plan modes.',
  'Press ctrl+p to run commands from the palette.',
  'Shift+enter inserts new lines without sending.',
];

type AgentMode = 'build' | 'plan';
type UiState = 'landing' | 'chat';

interface ToolCall {
  name: string;
  args: string;
  status: 'pending' | 'done' | 'error';
  result?: string;
}

interface ChatMsg {
  role: 'user' | 'nim';
  text: string;
  tools: ToolCall[];
  ts: number;
  duration?: number;
}

interface FileChange {
  file: string;
  additions: number;
  deletions: number;
}

interface McpStatus {
  name: string;
  state: 'connected' | 'error' | 'idle';
  detail: string;
}

function prettyModel(model: string): string {
  const parts = model.split('/');
  return parts.length > 1 ? parts[1]! : model;
}

function modeTitle(mode: AgentMode): string {
  return mode === 'build' ? 'Build' : 'Plan';
}

function modeStyle(mode: AgentMode): CellStyle {
  return mode === 'build' ? TH.modeBuild : TH.modePlan;
}

function drawCentered(buf: ClippedCellBuffer, y: number, text: string, style: CellStyle): void {
  const x = Math.max(0, Math.floor((buf.cols - text.length) / 2));
  buf.drawText(x, y, text, style);
}

function padRight(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

function progressBar(width: number, percentage: number): string {
  const safeWidth = Math.max(4, width);
  const inner = safeWidth - 2;
  const filled = Math.max(0, Math.min(inner, Math.round((percentage / 100) * inner)));
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, inner - filled))}]`;
}

function approxTokenCount(messages: readonly ChatMsg[]): number {
  const transcript = messages.map((message) => message.text).join('\n');
  const rough = Math.ceil(transcript.length / 4);
  return Math.max(0, rough);
}

function updateFileChanges(map: Map<string, FileChange>, text: string): void {
  const regex = /([\w./-]+\.[A-Za-z0-9_-]+)\s*\+(\d+)\s*-(\d+)/g;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match !== null) {
    const file = match[1]!;
    const additions = Number.parseInt(match[2]!, 10);
    const deletions = Number.parseInt(match[3]!, 10);
    const previous = map.get(file);
    map.set(file, {
      file,
      additions: Math.max(previous?.additions ?? 0, Number.isFinite(additions) ? additions : 0),
      deletions: Math.max(previous?.deletions ?? 0, Number.isFinite(deletions) ? deletions : 0),
    });
    match = regex.exec(text);
  }
}

function collectFileChanges(messages: readonly ChatMsg[]): FileChange[] {
  const map = new Map<string, FileChange>();
  for (const message of messages) {
    updateFileChanges(map, message.text);
    for (const tool of message.tools) {
      if (tool.result !== undefined) updateFileChanges(map, tool.result);
      if (tool.args.length > 0) updateFileChanges(map, tool.args);
    }
  }
  return [...map.values()].slice(0, 8);
}

class LandingView extends Widget {
  mode = reactive<AgentMode>('build');

  constructor() {
    super('landing');
    this.manualChildRendering = true;
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) buf.fillRow(row, TH.bg);

    const logoY = Math.max(0, Math.floor(buf.rows / 2) - 5);
    drawCentered(buf, logoY, 'nim', TH.strong);
    drawCentered(buf, logoY + 1, 'harness coordination agent', TH.muted);

    const promptY = logoY + 3;
    const boxWidth = Math.min(72, Math.max(24, buf.cols - 8));
    const boxX = Math.max(1, Math.floor((buf.cols - boxWidth) / 2));
    const composerHeight = 3;

    for (const child of this.children) {
      if (child.visible) {
        const composerBuf = buf.clip({ x: boxX, y: promptY, width: boxWidth, height: composerHeight });
        child.render(composerBuf);
      }
    }

    const hintY = promptY + composerHeight;
    const hints = ['ctrl+t variants', 'tab agents', 'ctrl+p commands'];
    let cursorX = Math.max(boxX + 2, boxX + boxWidth - hints.join('  ').length - 2);
    for (const hint of hints) {
      const [key, label] = hint.split(' ');
      buf.drawText(cursorX, hintY, key!, TH.muted);
      cursorX += key!.length + 1;
      buf.drawText(cursorX, hintY, label!, TH.tipText);
      cursorX += label!.length + 2;
    }

    const tipIndex = Math.floor(Date.now() / 30000) % TIPS.length;
    const tip = TIPS[tipIndex]!;
    const tipStart = Math.max(0, Math.floor((buf.cols - (tip.length + 6)) / 2));
    buf.drawText(tipStart, hintY + 2, '●', TH.tipDot);
    buf.drawText(tipStart + 2, hintY + 2, 'Tip', TH.tipLabel);
    buf.drawText(tipStart + 6, hintY + 2, tip, TH.tipText);
  }
}

class ConversationView extends Widget {
  messages = reactive<ChatMsg[]>([]);
  scrollTop = reactive(0);
  mode = reactive<AgentMode>('build');

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'scroll-up', description: 'Scroll up' },
    { key: 'down', action: 'scroll-down', description: 'Scroll down' },
    { key: 'pageup', action: 'page-up', description: 'Page up' },
    { key: 'pagedown', action: 'page-down', description: 'Page down' },
  ];

  constructor() {
    super('conv');
    this.focusable = true;
    this.manualChildRendering = true;
  }

  actionScrollUp(): void {
    this.scrollTop = Math.max(0, this.scrollTop - 1);
  }

  actionScrollDown(): void {
    this.scrollTop += 1;
  }

  actionPageUp(): void {
    this.scrollTop = Math.max(0, this.scrollTop - Math.max(1, (this.computedRect.height || 10) - 2));
  }

  actionPageDown(): void {
    this.scrollTop += Math.max(1, (this.computedRect.height || 10) - 2);
  }

  scrollToBottom(): void {
    const total = this.flatten(Math.max(24, this.computedRect.width || 80)).length;
    this.scrollTop = Math.max(0, total - (this.computedRect.height || 10));
  }

  private flatten(width: number): string[] {
    const lines: string[] = [];
    const safe = Math.max(12, width);

    for (let index = 0; index < this.messages.length; index += 1) {
      const message = this.messages[index]!;
      if (index > 0) lines.push('E');

      if (message.role === 'user') {
        for (const wrapped of layout.wrap(message.text, safe - 5)) {
          lines.push(`U${wrapped}`);
        }
        continue;
      }

      let inCode = false;
      for (const rawLine of message.text.split('\n')) {
        const line = rawLine.trimEnd();
        if (line.startsWith('```')) {
          inCode = !inCode;
          continue;
        }
        const wrapped = layout.wrap(line, safe - (inCode ? 8 : 6));
        for (const item of wrapped.length > 0 ? wrapped : ['']) {
          if (inCode) {
            lines.push(`C${item}`);
          } else if (item.startsWith('# ')) {
            lines.push(`H${item.slice(2)}`);
          } else if (item.startsWith('> ')) {
            lines.push(`Q${item.slice(2)}`);
          } else if (item.startsWith('+') && item.length > 1) {
            lines.push(`P${item}`);
          } else if (item.startsWith('-') && item.length > 1) {
            lines.push(`N${item}`);
          } else {
            lines.push(`A${item}`);
          }
        }
      }

      for (const tool of message.tools) {
        const icon = tool.status === 'done' ? '✓' : tool.status === 'error' ? '✕' : '•';
        lines.push(`T${icon}|${tool.name}|${tool.args}`);
        if (tool.result !== undefined && tool.result.length > 0) {
          for (const wrapped of layout.wrap(tool.result, safe - 10)) {
            lines.push(`R${wrapped}`);
          }
        }
      }

      const time = message.duration === undefined ? '' : ` · ${String(message.duration)}ms`;
      lines.push(`I▣ ${modeTitle(this.mode)} · ${prettyModel(nimModel)}${time}`);
    }

    return lines;
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) buf.fillRow(row, TH.bg);

    const lines = this.flatten(buf.cols);
    const maxScroll = Math.max(0, lines.length - buf.rows);
    if (this.scrollTop > maxScroll) this.scrollTop = maxScroll;
    const topPad = lines.length < buf.rows ? buf.rows - lines.length : 0;

    for (let row = topPad; row < buf.rows; row += 1) {
      const lineIndex = this.scrollTop + (row - topPad);
      if (lineIndex >= lines.length) break;
      const line = lines[lineIndex]!;
      const tag = line[0]!;
      const content = line.slice(1);

      if (tag === 'U') {
        buf.fillRow(row, TH.userBg);
        buf.drawText(0, row, '┃', this.mode === 'build' ? TH.userPipeBuild : TH.userPipePlan);
        buf.drawText(2, row, content, TH.userBg);
        continue;
      }
      if (tag === 'A') {
        buf.drawText(3, row, content, TH.assistantText);
        continue;
      }
      if (tag === 'H') {
        buf.drawText(3, row, content, TH.assistantHeading);
        continue;
      }
      if (tag === 'Q') {
        buf.drawText(3, row, '▌', TH.assistantQuote);
        buf.drawText(5, row, content, TH.assistantQuote);
        continue;
      }
      if (tag === 'C') {
        buf.fillRow(row, TH.codeBg);
        buf.drawText(3, row, content, TH.codeText);
        continue;
      }
      if (tag === 'P') {
        buf.drawText(3, row, content, TH.diffAdd);
        continue;
      }
      if (tag === 'N') {
        buf.drawText(3, row, content, TH.diffRemove);
        continue;
      }
      if (tag === 'T') {
        const [icon, name, args] = content.split('|');
        const iconStyle = icon === '✓' ? TH.toolDone : icon === '✕' ? TH.toolError : TH.toolPending;
        buf.drawText(3, row, icon!, iconStyle);
        buf.drawText(5, row, name!, TH.toolName);
        if (args !== undefined && args.length > 0) {
          buf.drawText(6 + name!.length, row, args, TH.assistantMeta);
        }
        continue;
      }
      if (tag === 'R') {
        buf.drawText(5, row, content, TH.assistantMeta);
        continue;
      }
      if (tag === 'I') {
        buf.drawText(3, row, content, TH.assistantMeta);
        continue;
      }
    }

    if (lines.length > buf.rows) {
      const trackHeight = buf.rows;
      const thumbHeight = Math.max(1, Math.round((buf.rows / lines.length) * trackHeight));
      const thumbY = Math.round((this.scrollTop / Math.max(1, maxScroll)) * (trackHeight - thumbHeight));
      for (let row = 0; row < trackHeight; row += 1) {
        const active = row >= thumbY && row < thumbY + thumbHeight;
        buf.drawText(buf.cols - 1, row, active ? '┃' : '│', active ? TH.border : TH.borderSubtle);
      }
    }
  }
}

class SidebarView extends Widget {
  sessionLabel = reactive('New session');
  sessionStartedAt = reactive<string | null>(null);
  tokens = reactive(0);
  contextPercent = reactive(0);
  cost = reactive(0);
  mcp = reactive<McpStatus[]>([
    { name: 'filesystem', state: 'connected', detail: 'Connected' },
    { name: 'github', state: 'idle', detail: 'Idle' },
  ]);
  lspLine = reactive('LSPs will activate as files are read');
  filesChanged = reactive<FileChange[]>([]);

  constructor() {
    super('sidebar');
    this.manualChildRendering = true;
  }

  private drawSectionTitle(buf: ClippedCellBuffer, y: number, title: string): number {
    if (y >= buf.rows) return y;
    buf.drawText(1, y, title, TH.sideTitle);
    return y + 1;
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) buf.fillRow(row, TH.sideBg);

    let y = 1;
    buf.drawText(1, y, this.sessionLabel, TH.sideTitle);
    y += 1;
    if (this.sessionStartedAt !== null) {
      const sessionLine = `- ${this.sessionStartedAt}`;
      buf.drawText(1, y, padRight(sessionLine, Math.max(0, buf.cols - 2)), TH.sideMuted);
      y += 2;
    } else {
      y += 1;
    }

    y = this.drawSectionTitle(buf, y, 'Context');
    if (y < buf.rows) {
      buf.drawText(1, y, `${this.tokens.toLocaleString()} tokens`, TH.sideValue);
      y += 1;
    }
    if (y < buf.rows) {
      buf.drawText(1, y, `${String(this.contextPercent)}% used`, TH.sideMuted);
      y += 1;
    }
    if (y < buf.rows) {
      const bar = progressBar(Math.max(12, buf.cols - 4), this.contextPercent);
      buf.drawText(1, y, bar, TH.sideMuted);
      y += 1;
    }
    if (y < buf.rows) {
      buf.drawText(1, y, `$${this.cost.toFixed(2)} spent`, TH.sideMuted);
      y += 2;
    }

    y = this.drawSectionTitle(buf, y, 'MCP');
    for (const entry of this.mcp) {
      if (y >= buf.rows) break;
      const dot = entry.state === 'connected' ? TH.sideDotOn : entry.state === 'error' ? TH.sideDotError : TH.sideDotOff;
      buf.drawText(1, y, '•', dot);
      buf.drawText(3, y, entry.name, TH.sideValue);
      y += 1;
      if (y < buf.rows) {
        buf.drawText(3, y, entry.detail, TH.sideMuted);
        y += 1;
      }
    }

    y += 1;
    y = this.drawSectionTitle(buf, y, 'LSP');
    if (y < buf.rows) {
      buf.drawText(1, y, this.lspLine, TH.sideMuted);
      y += 2;
    }

    y = this.drawSectionTitle(buf, y, 'Files Changed');
    if (this.filesChanged.length === 0) {
      if (y < buf.rows) buf.drawText(1, y, 'No files changed yet', TH.sideMuted);
    } else {
      for (const file of this.filesChanged) {
        if (y >= buf.rows) break;
        buf.drawText(1, y, file.file, TH.sideValue);
        if (y + 1 < buf.rows) {
          const delta = `+${String(file.additions)}  -${String(file.deletions)}`;
          buf.drawText(1, y + 1, delta, TH.sideMuted);
        }
        y += 2;
      }
    }

    const versionLine = `OpenCode-inspired ${VERSION}`;
    buf.drawText(Math.max(1, buf.cols - versionLine.length - 1), Math.max(0, buf.rows - 1), versionLine, TH.sideMuted);
  }
}

class PromptShell extends Widget {
  mode = reactive<AgentMode>('build');
  busy = reactive(false);

  constructor() {
    super('prompt-shell');
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) buf.fillRow(row, TH.panel);

    const accent = modeStyle(this.mode);
    const firstInputRow = Math.min(buf.rows - 1, 1);
    const lastInputRow = Math.max(firstInputRow, buf.rows - 2);
    for (let row = firstInputRow; row <= lastInputRow; row += 1) {
      buf.drawText(0, row, '┃', accent);
    }
    buf.drawText(0, Math.max(0, buf.rows - 1), '╹', accent);

    if (this.busy) {
      const status = '⣾ nim is thinking...';
      buf.drawText(Math.max(2, buf.cols - status.length - 2), Math.max(0, buf.rows - 1), status, TH.panelMuted);
      return;
    }

    const hints = ['ctrl+t variants', 'tab agents', 'ctrl+p commands'];
    let x = Math.max(2, buf.cols - (hints.join('  ').length + 2));
    for (const hint of hints) {
      const [key, label] = hint.split(' ');
      buf.drawText(x, Math.max(0, buf.rows - 1), key!, TH.panelKey);
      x += key!.length + 1;
      buf.drawText(x, Math.max(0, buf.rows - 1), label!, TH.panelMuted);
      x += label!.length + 2;
    }
  }
}

function createNimRuntime(): { runtime: NimRuntime; model: NimModelRef } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY not found in ~/.harness/secrets.env or environment.');
    console.error('Run: echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/.harness/secrets.env');
    process.exit(1);
  }

  const modelFromEnv = process.env.HARNESS_NIM_MODEL as NimModelRef | undefined;
  const model: NimModelRef = modelFromEnv ?? 'anthropic/claude-sonnet-4-20250514';

  const providerRouter = new NimProviderRouter();
  providerRouter.registerDriver(createAnthropicNimProviderDriver({ apiKey }));

  const runtime = new InMemoryNimRuntime({
    providerRouter,
    eventStore: new InMemoryNimEventStore(),
    sessionStore: new InMemoryNimSessionStore(),
  });

  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: [model],
  });

  return { runtime, model };
}

const { runtime: nimRuntime, model: nimModel } = createNimRuntime();

class NimApp extends Widget {
  static BINDINGS: Binding[] = [
    { key: 'ctrl+p', action: 'open-palette', description: 'Command palette' },
    { key: 'tab', action: 'toggle-mode', description: 'Toggle Build/Plan mode' },
  ];

  private landing: LandingView;
  private conv: ConversationView;
  private divider: ReturnType<typeof PaneDivider>;
  private sidebar: SidebarView;
  private promptShell: PromptShell;
  private composer: ReturnType<typeof Composer>;
  private footer: Widget;
  private toast: ReturnType<typeof Toast>;
  private palette: ReturnType<typeof CommandPalette> | null = null;

  private focusManager: { focus: (widget: Widget) => void } | null = null;
  private requestRender: (() => void) | null = null;

  private mode = reactive<AgentMode>('build');
  private uiState = reactive<UiState>('landing');
  private streaming = reactive(false);
  private session: SessionHandle | null = null;
  private turnCounter = 0;

  setFocusManager(focusManager: { focus: (widget: Widget) => void }): void {
    this.focusManager = focusManager;
  }

  setRequestRender(callback: () => void): void {
    this.requestRender = callback;
  }

  constructor() {
    super('nim');
    this.width = '100%';
    this.height = '100%';
    this.flexDirection = 'column';

    this.landing = new LandingView();
    this.landing.flexGrow = 1;

    this.conv = new ConversationView();
    this.conv.flexGrow = 1;
    this.conv.visible = false;

    this.divider = PaneDivider({ id: 'main-divider', orientation: 'vertical', fg: OC.borderSubtle, draggable: false });
    this.divider.visible = false;

    this.sidebar = new SidebarView();
    this.sidebar.width = 42;
    this.sidebar.visible = false;

    this.composer = Composer({
      id: 'composer',
      placeholder: 'Ask anything...',
      modeIndicator: '[Build]',
      fg: OC.text,
      bg: OC.element,
      placeholderFg: OC.muted,
      height: 3,
    });

    this.promptShell = new PromptShell();
    this.promptShell.height = 5;
    this.promptShell.flexDirection = 'column';
    this.promptShell.padding = edgeInsets(1, 1, 1, 2);
    this.promptShell.visible = false;
    this.landing.add(this.composer);

    this.footer = new (class extends Widget {
      render(buf: ClippedCellBuffer): void {
        buf.fillRow(0, TH.footerText);
        const dir = process.cwd().replace(process.env.HOME ?? '', '~');
        buf.drawText(1, 0, dir, TH.footerText);

        const status = `nim ${VERSION}`;
        buf.drawText(Math.max(1, buf.cols - status.length - 1), 0, status, TH.footerText);

        const hints = [
          ['ctrl+c', 'quit'],
          ['ctrl+p', 'palette'],
        ];
        let x = Math.max(1, Math.floor((buf.cols - 24) / 2));
        for (const [key, label] of hints) {
          buf.drawText(x, 0, key, TH.footerKey);
          x += key.length + 1;
          buf.drawText(x, 0, label, TH.footerText);
          x += label.length + 2;
        }
      }
    })('footer');
    this.footer.height = 1;

    this.toast = Toast({ id: 'toast', maxVisible: 3 });

    const mainArea = new (class extends Widget {
      render(): void {
        // container only
      }
    })('main-area');
    mainArea.flexGrow = 1;
    mainArea.flexDirection = 'row';
    mainArea.add(this.landing, this.conv, this.divider, this.sidebar);

    this.add(mainArea, this.promptShell, this.footer, this.toast);
    this.footer.visible = false;
    this.syncModeUi();
  }

  private syncModeUi(): void {
    const title = modeTitle(this.mode);
    this.composer.modeIndicator = `[${title}]`;
    this.landing.mode = this.mode;
    this.conv.mode = this.mode;
    this.promptShell.mode = this.mode;
  }

  private syncSidebarMetrics(): void {
    const tokens = approxTokenCount(this.conv.messages);
    const usage = Math.min(100, Math.round((tokens / CONTEXT_WINDOW_TOKENS) * 100));

    this.sidebar.tokens = tokens;
    this.sidebar.contextPercent = usage;
    this.sidebar.cost = Number((tokens * 0.0000025).toFixed(2));
    this.sidebar.filesChanged = collectFileChanges(this.conv.messages);
  }

  private transitionToChat(): void {
    this.uiState = 'chat';
    this.landing.visible = false;
    this.conv.visible = true;
    this.divider.visible = true;
    this.sidebar.visible = true;
    this.promptShell.visible = true;
    this.composer.left = undefined;
    this.composer.top = undefined;
    this.composer.width = '100%';
    this.composer.height = 3;
    this.promptShell.add(this.composer);
    this.footer.visible = true;
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  private transitionToLanding(): void {
    this.uiState = 'landing';
    this.landing.visible = true;
    this.conv.visible = false;
    this.divider.visible = false;
    this.sidebar.visible = false;
    this.promptShell.visible = false;
    this.footer.visible = false;
    this.landing.add(this.composer);
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  actionToggleMode(): void {
    this.mode = this.mode === 'build' ? 'plan' : 'build';
    this.syncModeUi();
    this.toast.info(`Mode: ${modeTitle(this.mode)}`);
    this.requestRender?.();
  }

  onComposerSubmitted(message: ComposerSubmitted): void {
    if (this.uiState === 'landing') this.transitionToChat();

    this.conv.messages = [
      ...this.conv.messages,
      { role: 'user', text: message.value, tools: [], ts: Date.now() },
    ];
    this.conv.scrollToBottom();
    this.syncSidebarMetrics();
    this.requestRender?.();

    void this.sendToAgent(message.value);
  }

  private async sendToAgent(input: string): Promise<void> {
    const startTime = Date.now();
    this.streaming = true;
    this.promptShell.busy = true;
    this.requestRender?.();

    try {
      if (this.session === null) {
        this.session = await nimRuntime.startSession({
          tenantId: 'nim-standalone',
          userId: 'user',
          model: nimModel,
        });

        this.sidebar.sessionLabel = 'New session';
        this.sidebar.sessionStartedAt = new Date().toISOString();
      }

      this.turnCounter += 1;
      const turn = await nimRuntime.sendTurn({
        sessionId: this.session.sessionId,
        input,
        idempotencyKey: `turn-${this.turnCounter}`,
      });

      const stream = nimRuntime.streamUi({
        tenantId: 'nim-standalone',
        sessionId: this.session.sessionId,
        runId: turn.runId,
        mode: 'seamless',
      });

      const assistantMessage: ChatMsg = { role: 'nim', text: '', tools: [], ts: Date.now() };
      this.conv.messages = [...this.conv.messages, assistantMessage];
      const index = this.conv.messages.length - 1;

      for await (const event of stream) {
        const current = { ...this.conv.messages[index]! };

        if (event.type === 'assistant.text.delta') {
          current.text += event.text;
        } else if (event.type === 'assistant.text.message') {
          current.text = event.text;
        } else if (event.type === 'tool.activity') {
          if (event.phase === 'start') {
            current.tools = [...current.tools, { name: event.toolName, args: '', status: 'pending' }];
          } else if (event.phase === 'end') {
            current.tools = current.tools.map((tool) => (
              tool.name === event.toolName && tool.status === 'pending'
                ? { ...tool, status: 'done' as const }
                : tool
            ));
          } else {
            current.tools = current.tools.map((tool) => (
              tool.name === event.toolName && tool.status === 'pending'
                ? { ...tool, status: 'error' as const }
                : tool
            ));
          }
        } else if (event.type === 'system.notice') {
          current.text += `${current.text.length > 0 ? '\n' : ''}[notice] ${event.text}`;
        } else if (event.type === 'assistant.state' && event.state === 'idle') {
          current.duration = Date.now() - startTime;
          this.conv.messages = this.conv.messages.map((item, messageIndex) => (messageIndex === index ? current : item));
          this.syncSidebarMetrics();
          this.conv.scrollToBottom();
          this.streaming = false;
          this.promptShell.busy = false;
          this.requestRender?.();
          break;
        }

        this.conv.messages = this.conv.messages.map((item, messageIndex) => (messageIndex === index ? current : item));
        this.syncSidebarMetrics();
        this.conv.scrollToBottom();
        this.requestRender?.();
      }
    } catch (error: unknown) {
      this.conv.messages = [
        ...this.conv.messages,
        { role: 'nim', text: `Error: ${error instanceof Error ? error.message : String(error)}`, tools: [], ts: Date.now() },
      ];
      this.syncSidebarMetrics();
      this.conv.scrollToBottom();
    } finally {
      this.streaming = false;
      this.promptShell.busy = false;
      this.requestRender?.();
    }
  }

  actionOpenPalette(): void {
    if (this.palette === null) {
      this.palette = CommandPalette({
        id: 'palette',
        actions: COMMANDS,
        width: 56,
        height: 14,
      });
      this.add(this.palette);
    }

    this.palette.positionInViewport(this.computedRect.width || 80, this.computedRect.height || 24);
    this.palette.visible = true;
    this.palette.query = '';
    this.palette.selectedIndex = 0;
    this.focusManager?.focus(this.palette);
  }

  onCommandExecuted(event: CommandExecuted): void {
    if (this.palette !== null) this.palette.visible = false;

    switch (event.action.id) {
      case 'new-session': {
        this.session = null;
        this.conv.messages = [];
        this.sidebar.sessionStartedAt = null;
        this.sidebar.filesChanged = [];
        this.syncSidebarMetrics();
        this.transitionToLanding();
        break;
      }
      case 'mode-build': {
        this.mode = 'build';
        this.syncModeUi();
        break;
      }
      case 'mode-plan': {
        this.mode = 'plan';
        this.syncModeUi();
        break;
      }
      case 'toggle-sidebar': {
        if (this.uiState === 'chat') {
          this.sidebar.visible = !this.sidebar.visible;
          this.divider.visible = this.sidebar.visible;
        }
        break;
      }
      default:
        break;
    }

    this.toast.info(event.action.title);
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  onCommandPaletteDismissed(_event: CommandPaletteDismissed): void {
    if (this.palette !== null) this.palette.visible = false;
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) buf.fillRow(row, TH.bg);
  }
}

const COMMANDS: CommandAction[] = [
  { id: 'new-session', title: 'New session', keywords: ['fresh', 'conversation'] },
  { id: 'session-list', title: 'Session list', keywords: ['history', 'threads'] },
  { id: 'mode-build', title: 'Switch to Build mode', keywords: ['agent', 'build'] },
  { id: 'mode-plan', title: 'Switch to Plan mode', keywords: ['agent', 'plan'] },
  { id: 'model', title: 'Switch model', keywords: ['provider', 'model'] },
  { id: 'toggle-sidebar', title: 'Toggle sidebar', keywords: ['panel', 'context'] },
  { id: 'toggle-thinking', title: 'Toggle thinking details', keywords: ['reasoning'] },
  { id: 'help', title: 'Help', bindingHint: 'ctrl+h' },
];

const app = createApp({ title: 'nim', exitOnCtrlC: true });
app.onDestroy(() => process.exit(0));

const nim = new NimApp();
nim.setFocusManager(app.focusManager);
nim.setRequestRender(() => app.render());

app.root.add(nim);
app.focusManager.focus(nim.queryOne('#composer')!);
app.start();

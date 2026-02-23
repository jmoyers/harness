/**
 * harness-ui v3 demo app.
 *
 * Run with: bun packages/harness-ui/demo.ts
 *
 * This exercises the full widget library in a live terminal.
 * Press ctrl+c to exit.
 */
import { createApp } from './src/app/app.ts';
import { Box, Row, Column, Spacer } from './src/widgets/box.ts';
import { Text } from './src/widgets/text.ts';
import { Markdown } from './src/widgets/markdown.ts';
import { DiffView, parseDiffText } from './src/widgets/diff-view.ts';
import { Composer } from './src/widgets/composer.ts';
import { TreeView, type TreeNode } from './src/widgets/tree-view.ts';
import { ListView, type ListItem } from './src/widgets/list-view.ts';
import { Select, type SelectOption } from './src/widgets/select.ts';
import { Spinner } from './src/widgets/spinner.ts';
import { StreamingText } from './src/widgets/streaming-text.ts';
import { Collapsible } from './src/widgets/collapsible.ts';
import { PaneDivider } from './src/widgets/pane-divider.ts';
import { Toast } from './src/widgets/toast.ts';
import { CommandPalette, type CommandAction, CommandExecuted, CommandPaletteDismissed } from './src/widgets/command-palette.ts';
import { ComposerSubmitted } from './src/widgets/composer.ts';
import { DARK_THEME } from './src/theme/defaults.ts';
import { Widget } from './src/widget/widget.ts';
import type { ClippedCellBuffer } from './src/core/cell-buffer.ts';
import type { Binding } from './src/widget/keybinding.ts';

const SAMPLE_MARKDOWN = `# harness-ui v3

A standalone TUI framework for TypeScript.

## Features

- **Widget tree** with flexbox layout
- *Reactive* attributes with watch/validate
- Typed \`Message\` bubbling
- \`Keybinding\` declarations

## Code Example

\`\`\`typescript
const app = createApp({ title: 'My App' });
app.root.add(
  Column({ gap: 1 },
    Text({ content: 'Hello!' }),
    Composer({ placeholder: 'Type here...' }),
  ),
);
\`\`\`

> Built for harness. Inspired by Textual and OpenTUI.

---

- DiffView with unified diff rendering
- Streaming markdown
- Toast notifications
- [Learn more](https://github.com/jmoyers/harness)`;

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,6 +1,8 @@
 import { createApp } from '@harness/ui';
+import { Markdown } from '@harness/ui';
 
 const app = createApp();
-app.root.add(Text({ content: 'old' }));
+app.root.add(Markdown({ content: '# New' }));
+app.root.add(Composer({}));
 app.start();`;

const TREE_NODES: TreeNode[] = [
  {
    id: 'src', label: 'src', icon: '📁',
    children: [
      { id: 'app', label: 'app.ts', icon: '📄' },
      { id: 'widgets', label: 'widgets/', icon: '📁', children: [
        { id: 'text', label: 'text.ts', icon: '📄' },
        { id: 'box', label: 'box.ts', icon: '📄' },
        { id: 'markdown', label: 'markdown.ts', icon: '📄' },
      ]},
    ],
  },
  { id: 'pkg', label: 'package.json', icon: '📄' },
  { id: 'readme', label: 'README.md', icon: '📄' },
];

const LIST_ITEMS: ListItem[] = [
  { id: 's1', label: 'Refactor auth module', badge: '● running', description: 'codex' },
  { id: 's2', label: 'Fix CSS layout bug', badge: '✓ done', description: 'claude' },
  { id: 's3', label: 'Write unit tests', badge: '! needs input', description: 'codex' },
  { id: 's4', label: 'Update dependencies', badge: '○ idle', description: 'cursor' },
];

const COMMANDS: CommandAction[] = [
  { id: 'new', title: 'New Session', bindingHint: 'ctrl+n' },
  { id: 'open', title: 'Open File', bindingHint: 'ctrl+o' },
  { id: 'save', title: 'Save', bindingHint: 'ctrl+s' },
  { id: 'theme', title: 'Change Theme', keywords: ['color', 'dark', 'light'] },
  { id: 'help', title: 'Show Help', bindingHint: 'ctrl+h' },
  { id: 'quit', title: 'Quit', bindingHint: 'ctrl+q' },
];

class DemoRoot extends Widget {
  static BINDINGS: Binding[] = [
    { key: 'ctrl+p', action: 'open-palette', description: 'Command Palette' },
  ];

  private palette: ReturnType<typeof CommandPalette> | null = null;
  private toast: ReturnType<typeof Toast> | null = null;

  constructor() {
    super('demo-root');
    this.flexDirection = 'column';
  }

  actionOpenPalette(): void {
    if (this.palette !== null && this.palette.visible) return;
    if (this.palette === null) {
      this.palette = CommandPalette({ id: 'palette', actions: COMMANDS, width: 50, height: 12 });
      this.add(this.palette);
    }
    this.palette.positionInViewport(
      this.computedRect.width || 80,
      this.computedRect.height || 24,
    );
    this.palette.visible = true;
    this.palette.query = '';
    this.palette.selectedIndex = 0;
  }

  onCommandExecuted(msg: CommandExecuted): void {
    if (this.palette !== null) this.palette.visible = false;
    this.toast?.success(`Executed: ${msg.action.title}`);
  }

  onCommandPaletteDismissed(): void {
    if (this.palette !== null) this.palette.visible = false;
  }

  onComposerSubmitted(msg: ComposerSubmitted): void {
    this.toast?.info(`Submitted: ${msg.value}`);
  }

  build(cols: number, rows: number): void {
    const sidebarWidth = 30;

    const header = Row(
      { id: 'header', height: 1, backgroundColor: '#1E293B' },
      Text({ content: ' harness-ui v3 demo', fg: '#38BDF8', bold: true }),
      Spacer(),
      Text({ content: 'ctrl+p: palette  ctrl+c: quit ', fg: '#64748B' }),
    );

    const sidebar = Column(
      { id: 'sidebar', width: sidebarWidth, gap: 1 },
      Box(
        { borderStyle: 'single', borderEdges: ['left'], borderColor: '#475569', flexGrow: 1 },
        Column({ padding: 1, gap: 1, flexGrow: 1 },
          Text({ content: ' Sessions', fg: '#38BDF8', bold: true, height: 1 }),
          ListView({ id: 'sessions', items: LIST_ITEMS, selectedId: 's1', flexGrow: 1 }),
        ),
      ),
      Box(
        { borderStyle: 'single', borderEdges: ['left'], borderColor: '#475569', height: 12 },
        Column({ padding: 1, flexGrow: 1 },
          Text({ content: ' Files', fg: '#38BDF8', bold: true, height: 1 }),
          TreeView({ id: 'files', nodes: TREE_NODES, selectedId: 'src', flexGrow: 1 }),
        ),
      ),
    );

    const diffFiles = parseDiffText(SAMPLE_DIFF);

    const mainContent = Column(
      { id: 'main', flexGrow: 1, gap: 1 },
      Markdown({
        id: 'md',
        content: SAMPLE_MARKDOWN,
        flexGrow: 1,
        colors: {
          text: DARK_THEME.markdown.text,
          heading: DARK_THEME.markdown.heading,
          code: DARK_THEME.markdown.code,
          bold: DARK_THEME.markdown.strong,
          italic: DARK_THEME.markdown.emphasis,
          link: DARK_THEME.markdown.link,
          blockquote: DARK_THEME.markdown.blockQuote,
          listMarker: DARK_THEME.markdown.listItem,
          horizontalRule: DARK_THEME.markdown.horizontalRule,
        },
      }),
    );

    const body = Row({ id: 'body', flexGrow: 1 },
      sidebar,
      PaneDivider({ id: 'divider', fg: '#475569' }),
      mainContent,
    );

    const composerRow = Row({ id: 'composer-row', height: 3, backgroundColor: '#1E293B' },
      Spinner({ id: 'spinner', label: '', fg: '#38BDF8' }),
      Composer({
        id: 'composer',
        placeholder: 'Ask me anything...',
        modeIndicator: '[Build]',
        flexGrow: 1,
        fg: '#E2E8F0',
        bg: '#1E293B',
        placeholderFg: '#64748B',
      }),
    );

    this.toast = Toast({ id: 'toast', maxVisible: 3 });
    this.toast.positionInViewport(cols, rows);

    this.add(header, body, composerRow, this.toast);
  }

  render(): void {}
}

const app = createApp({ title: 'harness-ui v3 demo', exitOnCtrlC: true });
const demo = new DemoRoot();
demo.build(app.cols, app.rows);
app.root.add(demo);
app.start();

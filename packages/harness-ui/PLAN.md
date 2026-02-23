# harness-ui v3 — Standalone TUI Framework

## Vision

A standalone, reusable terminal UI framework in TypeScript that:

- Powers harness but is not coupled to it.
- Provides a two-tier API: low-level cell primitives for performance-critical custom widgets, and declarative composition for app assembly.
- Embeds a first-party VTE (virtual terminal emulator) as a composable widget.
- Is compatible with OpenCode theming.
- Stays first-party, dependency-restricted on hot paths, bun-native.
- Lives in-repo as its own package with its own design guarantees.

End state: harness is ported to harness-ui v3. Other TUI apps can be built on it independently.

---

## Decided

- **Reactivity**: Initializer pattern (`count = reactive(0)`), not decorators.
- **Layout**: Full flexbox subset upfront.
- **VTE**: Two-layer split — VTE core (pure state machine, no widget dependency) + thin TerminalWidget adapter.
- **Package**: In-repo at `packages/harness-ui` with its own guarantees. Not a separate repo.
- **OpenTUI interop**: OpenCode theme compatibility only. No renderable hosting.

---

## Architecture

### Layer 0 — Terminal I/O

Primitives that touch the terminal directly.

| Module | Status | Notes |
|---|---|---|
| `CellBuffer` | evolve from `SurfaceBuffer` | Add `blit()` for compositing, `clip()` for sub-views. |
| `TextLayout` | keep | `measureDisplayWidth`, `wrapTextForColumns`, `TextLayoutEngine`. |
| `Screen` | keep | Diff-based flush with sync update protocol. |
| `frame-primitives` | keep | Row diffing, cursor style, ANSI integrity scan. |
| `Color` | new | RGBA value type, hex parsing, indexed/rgb/default union, palette. |

### Layer 1 — Widget System

The core abstraction. Every visual element is a `Widget`.

| Module | Responsibility |
|---|---|
| `Widget` | Base class: tree, lifecycle, layout props, render contract, dirty tracking. |
| `Layout` | First-party flexbox engine. Resolves `computedRect` on every widget. |
| `Reactive` | `reactive()` initializer with watch/validate/auto-dirty. |
| `Message` | Typed messages with tree bubbling and `stop()`. |
| `Focus` | Focus stack, tab order, focus trap for modals. |
| `Keybinding` | Binding declarations on widgets, bottom-up resolution. |
| `Input` | Terminal input parsing (keys, mouse, paste), handler chain. |
| `VNode` | Lightweight descriptors for declarative composition. Factory function support. |

### Layer 2 — VTE Core

A standalone terminal emulator. Pure state machine: bytes in, screen state out. Zero widget dependency. Usable headless for automation, testing, recording.

| Module | Responsibility |
|---|---|
| `Parser` | Escape sequence state machine (ESC, CSI, OSC, DCS). |
| `ScreenBuffer` | Cell grid, cursor, primary/alternate screen, scrollback. |
| `Modes` | DEC private mode tracking (mouse, bracketed paste, focus, etc.). |
| `Vte` | Facade combining parser + screen + modes. Public API surface. |
| `compat-matrix` | Documentation of implemented sequences and conformance level. |

Extracted from `src/terminal/snapshot-oracle.ts`. The parity test suite and differential checkpoints move with it — they test the VTE, not harness.

### Layer 3 — Built-in Widgets

Reusable widgets that ship with the framework.

| Widget | Description |
|---|---|
| `Text` | Styled text with markup. Wraps, truncates, aligns. |
| `Box` | Container with border, background, title. Primary layout container. |
| `Row` / `Column` | Shorthand for `Box` with `flexDirection` preset. |
| `Spacer` | `flexGrow: 1` empty widget for pushing siblings apart. |
| `TextInput` | Single-line input with cursor, placeholder, validation. |
| `TextArea` | Multi-line input with wrapping cursor. |
| `Select` | List selection with keyboard nav, filtering. |
| `ScrollView` | Scrollable viewport with content larger than view. |
| `Modal` | Overlay with z-index, dismiss-on-outside-click, focus trap. |
| `CommandPalette` | Fuzzy-search command menu. Generic. |
| `TerminalWidget` | Thin adapter wrapping VTE core for embedding in the widget tree. |

### Layer 4 — App Shell

The top-level entry point for running a TUI app.

| Module | Responsibility |
|---|---|
| `createApp` | Factory returning initialized `App` instance. |
| `App` | Root widget + lifecycle: alt screen, raw mode, input loop, render loop, cleanup. |
| `ThemeProvider` | Theme resolution, dark/light detection (DEC 2031), hot switching. |

---

## Widget Base Class

```typescript
abstract class Widget {
  readonly id: string
  parent: Widget | null
  children: Widget[]

  // Layout (flexbox subset)
  width: LayoutValue             // number | `${number}%` | 'auto'
  height: LayoutValue
  flexDirection: 'row' | 'column'
  flexGrow: number
  flexShrink: number
  gap: number
  padding: EdgeInsets
  margin: EdgeInsets
  alignItems: AlignItems
  justifyContent: JustifyContent
  position: 'relative' | 'absolute'
  left: number | undefined
  top: number | undefined
  zIndex: number
  visible: boolean
  overflow: 'hidden' | 'visible' | 'scroll'

  // Computed by layout pass
  readonly computedRect: Rect     // { x, y, width, height } in parent coords
  readonly absoluteRect: Rect     // resolved to screen coords

  // Lifecycle
  mount(): void
  unmount(): void

  // Rendering — subclasses implement
  abstract render(buffer: CellBuffer): void

  // Tree
  add(...children: Array<Widget | VNode>): void
  remove(child: Widget | string): void
  queryOne<T extends Widget>(selector: string): T | null
  queryAll<T extends Widget>(selector: string): T[]

  // Focus
  focusable: boolean
  focused: boolean
  focus(): void
  blur(): void

  // Events
  emit(message: Message): void
  on<T extends Message>(type: MessageType<T>, handler: (msg: T) => void): void

  // Theme
  readonly theme: ResolvedTheme

  // Dirty
  markDirty(): void
}
```

`Widget` is a class because it owns lifecycle, children, layout state, and invariants. `render(buffer)` receives a `CellBuffer` scoped to the widget's computed rect — the widget draws in local coordinates, the framework composites.

---

## Reactive Attributes

Initializer pattern (no decorator dependency):

```typescript
class Counter extends Widget {
  count = reactive(0)

  // Auto-called when count changes. markDirty() is automatic.
  watchCount(oldValue: number, newValue: number): void {
    // side effects
  }

  // Optional validator — called before set, return corrected value.
  validateCount(value: number): number {
    return Math.max(0, Math.min(100, value))
  }

  render(buffer: CellBuffer): void {
    buffer.drawText(0, 0, `Count: ${this.count}`, this.theme.colors.text)
  }
}
```

`reactive(defaultValue)` returns a property initializer that installs a getter/setter on the instance. The setter: validates -> compares -> stores -> watches -> marks dirty. Multiple reactive changes in one synchronous frame coalesce into a single re-render.

---

## Message System

Typed messages bubble up the widget tree:

```typescript
class DismissRequested extends Message {}

class ValueChanged extends Message {
  constructor(readonly value: string) { super() }
}

// Emitter
class MyModal extends Widget {
  handleKeypress(event: KeyEvent): boolean {
    if (event.key === 'escape') {
      this.emit(new DismissRequested())
      return true
    }
    return false
  }
}

// Handler — discovered by naming convention
class App extends Widget {
  onDismissRequested(msg: DismissRequested): void {
    this.queryOne('#my-modal')?.unmount()
  }
}
```

Handler discovery: `on${MessageClassName}` method on each ancestor. `msg.stop()` halts bubbling.

---

## Keybindings

Declared on widgets, resolved bottom-up from focused widget:

```typescript
class Editor extends Widget {
  static BINDINGS: Binding[] = [
    { key: 'ctrl+s', action: 'save', description: 'Save' },
    { key: 'ctrl+z', action: 'undo', description: 'Undo' },
  ]

  actionSave(): void { /* ... */ }
  actionUndo(): void { /* ... */ }
}
```

The keybinding resolver walks from focused widget to root. First match wins. The `description` field feeds `CommandPalette` and help screens.

---

## VTE Core

Pure state machine. No widget dependency. Usable headless.

```typescript
import { Vte } from '@harness/ui'

const vte = new Vte({ cols: 80, rows: 24, scrollback: 10000 })

// Feed bytes from a PTY
vte.write(data: Uint8Array): void

// Read state
vte.screen: ScreenBuffer          // cell grid, cursor, styles
vte.cursor: CursorState            // position, shape, visibility
vte.modes: ModeState               // bracketed paste, mouse tracking, etc.
vte.activeScreen: 'primary' | 'alternate'
vte.scrollbackLines: number

// Resize
vte.resize(cols: number, rows: number): void

// Events
vte.onTitle: (title: string) => void
vte.onBell: () => void
vte.onReply: (data: Uint8Array) => void  // DA, DSR responses
```

The VTE core owns:
- Escape sequence parser (ESC/CSI/OSC/DCS state machine).
- Screen buffer with cell grid, per-cell style, wrap flags.
- Primary and alternate screen with independent state.
- Cursor position, shape, blink, save/restore.
- DEC mode tracking (mouse, bracketed paste, focus events, alt screen, etc.).
- Scrollback ring buffer.
- SGR attribute parsing (bold, dim, italic, underline, inverse, fg/bg colors).
- Character set designation (G0/G1).

Extracted from `snapshot-oracle.ts` (~1980 LOC). The compat matrix and parity test suite move with it.

---

## TerminalWidget

Thin adapter (~200 LOC) wrapping VTE core for the widget tree:

```typescript
class TerminalWidget extends Widget {
  private vte: Vte

  // App wires a PTY to these
  write(data: Uint8Array): void        // feed PTY output to VTE
  onData: (data: Uint8Array) => void   // user input -> forward to PTY

  // Widget integration
  render(buffer: CellBuffer): void     // reads VTE cells, draws into buffer
  handleKeypress(event: KeyEvent): boolean
  handleMouse(event: MouseEvent): boolean
  scrollViewport(delta: number): void

  // Reactive state
  title = reactive('')                 // from OSC title changes
  cursorVisible = reactive(true)
}
```

The TerminalWidget:
- Creates and owns a VTE instance.
- On `write(data)`: feeds bytes to VTE, marks dirty.
- On `render(buffer)`: reads VTE screen cells, translates to CellBuffer cells.
- On keyboard: if VTE is the focused widget, converts key events to terminal escape sequences, emits via `onData` for PTY forwarding.
- On mouse: when VTE mouse tracking modes are active, translates mouse events to terminal mouse reports, emits via `onData`. Otherwise, handles scrollback viewport scrolling.
- Completely decoupled from PTY management. The app wires `pty.onData -> widget.write()` and `widget.onData -> pty.write()`.
- Multiple TerminalWidgets can coexist in one app (split panes, multiplexer).

---

## Theming — OpenCode Compatible

### Theme interface

```typescript
interface Theme {
  mode: 'dark' | 'light'

  colors: {
    text: string
    textMuted: string
    textAccent: string
    background: string
    backgroundPanel: string
    backgroundOverlay: string
    border: string
    borderFocused: string
    primary: string
    secondary: string
    success: string
    warning: string
    error: string
    selection: string
    cursor: string
  }

  input: {
    text: string
    placeholder: string
    background: string
    focusedBackground: string
    focusedBorder: string
    cursor: string
  }

  select: {
    text: string
    selectedText: string
    selectedBackground: string
    description: string
    selectedDescription: string
  }

  modal: {
    frame: string
    title: string
    body: string
    footer: string
    background: string
  }

  terminal: {
    palette: string[]        // 16 ANSI colors
    foreground: string
    background: string
    cursor: string
    selection: string
  }
}
```

### OpenCode compatibility

OpenTUI themes use hex color strings with dark/light mode maps. Our `Theme` tokens map directly to OpenTUI's `ExampleTheme` shape:

```typescript
// Adapting an OpenCode theme
function fromOpenCodeTheme(oc: OpenCodeTheme): Theme {
  return {
    mode: oc.mode,
    colors: {
      text: oc.selectTextColor,
      textMuted: oc.instructionsColor,
      border: oc.borderColor,
      borderFocused: oc.focusedBorderColor,
      // ...
    },
    input: {
      text: oc.inputTextColor,
      placeholder: oc.inputPlaceholderColor,
      cursor: oc.inputCursorColor,
      // ...
    },
    // ...
  }
}
```

Theme detection uses DEC mode 2031 where supported. Widgets access `this.theme` — an inherited resolved theme from the nearest `ThemeProvider` ancestor.

---

## Declarative Composition

Factory functions returning VNodes. No JSX, no reconciler.

```typescript
import { Box, Text, Input, Row, Column, Spacer } from '@harness/ui'

app.root.add(
  Column({ padding: 1, gap: 1 },
    Text({ content: 'My App', style: 'bold' }),
    Row({ gap: 2 },
      Box({ flexGrow: 1, border: true, title: 'Left' },
        Text({ content: 'Panel A' }),
      ),
      Box({ width: 30, border: true, title: 'Right' },
        Input({ placeholder: 'Search...' }),
      ),
    ),
    StatusBar({ left: 'Ready', right: 'Ln 1, Col 1' }),
  ),
)

// Custom constructs are plain functions
function StatusBar(props: { left: string; right: string }) {
  return Row({ width: '100%', height: 1, background: 'backgroundPanel' },
    Text({ content: props.left }),
    Spacer(),
    Text({ content: props.right, color: 'textMuted' }),
  )
}
```

VNodes are created once and materialized when added to the tree. Updates happen through reactive attributes on the materialized widgets, not by re-describing the tree.

---

## App Shell

```typescript
import { createApp, Column, Text, TerminalWidget } from '@harness/ui'

const app = await createApp({
  title: 'My Terminal App',
  theme: 'auto',
  mouse: true,
  alternateScreen: true,
})

const term = new TerminalWidget({ id: 'main-term', width: '100%', height: '100%' })

app.root.add(
  Column({ width: '100%', height: '100%' },
    Text({ content: 'My Terminal', height: 1 }),
    term,
  ),
)

// Wire a PTY
const pty = spawnPty('bash')
pty.onData((data) => term.write(data))
term.onData = (data) => pty.write(data)
```

`createApp` manages: alternate screen, raw mode, mouse protocol, input loop (stdin -> parse -> keybinding resolve -> focused widget), resize (SIGWINCH -> relayout), render loop (dirty check -> layout -> render -> composit -> diff flush), cleanup on exit.

---

## Test Pilot — E2E Testing Framework

The framework ships a headless test harness inspired by Playwright and Textual's pilot. It runs the full pipeline (layout -> render -> composit -> produce rows) without touching the real terminal, and provides input simulation + screen assertions.

### TestPilot API

```typescript
import { createTestPilot } from '@harness/ui/testing'

test('dual pane renders correctly', () => {
  const pilot = createTestPilot(MyApp, { cols: 80, rows: 24 })

  // Screen text assertions (ANSI-stripped)
  pilot.expectRow(0).toContain('My App')
  pilot.expectRow(0).toStartWith('┌')

  // Cell-level assertions
  pilot.expectCell(0, 0).toHaveGlyph('┌')
  pilot.expectCell(5, 1).toHaveStyle({ bold: true })

  // Widget state assertions
  pilot.expectWidget('#sidebar').toBeVisible()
  pilot.expectWidget('#input').toBeFocused()

  // Golden snapshot (text-based, not binary)
  pilot.expectScreen().toMatchSnapshot('dual-pane-initial')
})

test('ctrl+p opens command palette', () => {
  const pilot = createTestPilot(MyApp, { cols: 80, rows: 24 })

  pilot.pressKey('ctrl+p')
  pilot.expectWidget('#command-palette').toBeVisible()
  pilot.expectScreen().toMatchSnapshot('palette-open')

  pilot.type('open file')
  pilot.expectRow(3).toContain('open file')

  pilot.pressKey('escape')
  pilot.expectWidget('#command-palette').not.toBeVisible()
})

test('resize reflows layout', () => {
  const pilot = createTestPilot(MyApp, { cols: 80, rows: 24 })
  pilot.resize(40, 12)
  pilot.expectScreen().toMatchSnapshot('narrow-layout')
})

test('mouse click focuses input', () => {
  const pilot = createTestPilot(MyApp, { cols: 80, rows: 24 })
  pilot.click(10, 5)
  pilot.expectWidget('#search-input').toBeFocused()
})
```

### Components

| Component | Responsibility |
|---|---|
| `TestPilot` | Headless app runner. Creates widget tree, runs full pipeline, captures rendered CellBuffer. Never touches real stdin/stdout. |
| Input simulation | `pressKey(key)`, `type(text)`, `click(col, row)`, `scroll(col, row, delta)`, `resize(cols, rows)`. Feeds synthetic events through the real input/keybinding/focus pipeline. |
| Screen assertions | `expectRow(n)` with `.toContain()`, `.toStartWith()`, `.toEqual()`. `expectCell(col, row)` with `.toHaveGlyph()`, `.toHaveStyle()`. `expectScreen()` with `.toMatchSnapshot()`. |
| Widget assertions | `expectWidget('#id')` with `.toBeVisible()`, `.toBeFocused()`, `.toHaveText()`, `.toHaveRect()`. Supports `.not.*` negation. |
| Snapshot system | Golden file comparison of ANSI-stripped text rows. Stored as `.snap` files next to tests. Update via `UPDATE_SNAPSHOTS=1`. Diffs show character-level changes. |

### Design constraints

- No real terminal I/O. The pilot creates an in-memory CellBuffer and Screen, never calls `process.stdout.write`.
- Synchronous by default. `pressKey` immediately processes through the pipeline and re-renders so you can assert inline. Async variants available for timers/debounce.
- Snapshot format is plain text rows (one per line), not binary. Readable in diffs, reviewable in PRs.
- Every built-in widget ships with pilot-based e2e tests covering its visual output and interaction behavior.

### File structure

```
packages/harness-ui/
  src/
    testing/
      pilot.ts              # TestPilot class
      assertions.ts         # expectRow, expectCell, expectWidget, expectScreen
      snapshot.ts           # Golden file read/write/compare
      input-simulation.ts   # pressKey, type, click, scroll, resize
    testing.ts              # Public barrel for @harness/ui/testing
  test/
    e2e/
      text.e2e.test.ts
      box.e2e.test.ts
      text-input.e2e.test.ts
      select.e2e.test.ts
      modal.e2e.test.ts
      command-palette.e2e.test.ts
      terminal.e2e.test.ts
      layout.e2e.test.ts
      theme.e2e.test.ts
    snapshots/
      *.snap
```

---

## Build Order

Each step is a deliverable checkpoint with full test coverage.

| # | Deliverable | Depends on |
|---|---|---|
| 1 | `Color` — RGBA type, hex parse, indexed/rgb/default | — |
| 2 | `CellBuffer` — evolve SurfaceBuffer, add `blit()`, `clip()` | 1 |
| 3 | `Widget` base class — tree ops, lifecycle, dirty tracking | 2 |
| 4 | `Layout` engine — flexbox subset, `computedRect` resolution | 3 |
| 5 | Render pipeline — widget tree -> CellBuffer compositing -> Screen flush | 2, 3, 4 |
| 6 | `reactive()` — initializer with watch/validate/auto-dirty | 3 |
| 7 | `Message` system — typed messages, tree bubbling | 3 |
| 8 | `Input` parsing — key/mouse/paste event decoding | — |
| 9 | `Focus` manager — focus stack, tab order | 3 |
| 10 | `Keybinding` resolver — declarations + bottom-up dispatch | 3, 8, 9 |
| 11 | `Theme` system — interface, defaults, dark/light, OpenCode compat | 1 |
| 12 | `TestPilot` — headless runner, input sim, screen/widget assertions, snapshots | 5, 8, 9 |
| 13 | `Text` widget + e2e tests | 5, 6, 11, 12 |
| 14 | `Box` widget + e2e tests | 5, 6, 11, 12 |
| 15 | `TextInput` widget + e2e tests | 10, 12, 13 |
| 16 | `Select` widget + e2e tests | 10, 12, 14 |
| 17 | `ScrollView` widget + e2e tests | 5, 10, 12 |
| 18 | `Modal` widget + e2e tests | 7, 9, 12, 14 |
| 19 | VTE core — extract from snapshot-oracle, standalone module | 2 |
| 20 | `TerminalWidget` + e2e tests | 5, 10, 12, 17, 19 |
| 21 | `CommandPalette` widget + e2e tests | 12, 15, 16, 18 |
| 22 | VNode / factory functions — declarative composition | 3, 13-18 |
| 23 | App shell — `createApp`, lifecycle, input loop, render loop | 5, 8, 9, 10, 11 |
| 24 | App shell e2e tests — full lifecycle, resize, theme switch | 12, 22, 23 |
| 25 | Demo app — showcase exercising all widgets | all |
| 26 | Port harness to harness-ui v3 | all |

---

## What Moves Out of `packages/harness-ui`

All harness-app-specific types relocate to `src/mux/` or `src/services/`:

- `NewThreadPromptState`, `TaskEditorPromptState`, `ConversationTitleEditState`, `ApiKeyPromptState`
- `ThreadAgentType`, `CommandMenuScope`
- `InputRouter` and all strategy interfaces
- `InputTokenRouter`
- `ModalManager` with its 7 strategy methods
- `LeftNavInput`, `GlobalShortcutInput`
- All `Handle*InputOptions` interfaces

## What Stays / Evolves

- `SurfaceBuffer` -> `CellBuffer` (enhanced with `blit`, `clip`)
- `TextLayoutEngine` (keep)
- `Screen` (keep)
- `frame-primitives` (keep)
- `UiKit` drawing helpers -> folded into `Box`/`Text` widget implementations

## What Moves In

- `snapshot-oracle.ts` -> `src/vte/` (decomposed into parser, screen, modes, facade)
- `compat-matrix.ts` -> `src/vte/compat-matrix.ts`
- `differential-checkpoints.ts` -> test infrastructure for VTE
- `parity-suite.ts` -> test infrastructure for VTE

## File Structure

```
packages/harness-ui/
  src/
    core/
      cell-buffer.ts
      color.ts
      text-layout.ts
      screen.ts
      frame-primitives.ts
    widget/
      widget.ts
      layout.ts
      reactive.ts
      message.ts
      focus.ts
      keybinding.ts
      input.ts
      vnode.ts
    vte/
      parser.ts
      screen-buffer.ts
      modes.ts
      vte.ts
      compat-matrix.ts
    widgets/
      text.ts
      box.ts
      row.ts
      column.ts
      spacer.ts
      text-input.ts
      text-area.ts
      select.ts
      scroll-view.ts
      modal.ts
      command-palette.ts
      terminal.ts
    theme/
      theme.ts
      defaults.ts
      detect.ts
    app/
      app.ts
      lifecycle.ts
    testing/
      pilot.ts
      assertions.ts
      snapshot.ts
      input-simulation.ts
    index.ts
    testing.ts
  test/
    unit/
      core/
      widget/
      vte/
      widgets/
      theme/
      app/
    e2e/
      text.e2e.test.ts
      box.e2e.test.ts
      text-input.e2e.test.ts
      select.e2e.test.ts
      modal.e2e.test.ts
      command-palette.e2e.test.ts
      terminal.e2e.test.ts
      layout.e2e.test.ts
      theme.e2e.test.ts
    snapshots/
      *.snap
```

---

## Harness UI Component Requirements

Extracted from the harness mux/ui codebase. Every surface listed below needs an equivalent harness-ui v3 widget or composition of widgets to enable the port (step 26).

### Layout Shells

| Harness surface | Current implementation | v3 widget |
|---|---|---|
| Dual-pane layout (left rail + separator + right pane + status bar) | `dual-pane-core.ts`, `render-frame.ts`, `layout.ts` (v2) | `DualPane` — built from `Row(Rail, Separator, Column(MainPane, StatusBar))` using existing `Box`/`Row`/`Column`. No new widget needed. |
| Resizable pane separator | `pointer-routing.ts` pane divider drag | `PaneDivider` — draggable separator widget that emits `DividerMoved(position)` messages on drag. |
| Status bar (bottom row: perf, debug, notice) | `render-frame.ts` `buildRenderRows`, `debug-footer-notice.ts` | `StatusBar` — single-row widget with left/center/right slots. Built from `Row(Text, Spacer, Text)`. No new widget; composition pattern. |

### Left Rail

| Harness surface | Current implementation | v3 widget |
|---|---|---|
| Workspace rail (project/repo tree with fold/expand, status icons) | `workspace-rail-model.ts`, `workspace-rail.ts`, `rail-layout.ts` | `TreeView` — generic collapsible tree widget. Rows are selectable, can have icons/badges, support fold/expand. Needed for rail, project tree, and GitHub review threads. |
| Conversation rail (session list with status badges, active indicator) | `conversation-rail.ts` | `ListView` — generic styled list with per-row status badges, active indicator, and selection. Built on `ScrollView` + `Select`-like row rendering. |
| Left-nav keyboard cycling (up/down/tab across sections) | `left-nav-input.ts`, `left-nav-activation.ts` | Handled by `FocusManager` tab order + `TreeView`/`ListView` keybindings. |
| Rail row hit-testing (pointer click -> select conversation/project) | `rail-pointer-input.ts` | Built into `TreeView`/`ListView` mouse handling. |

### Right Pane Modes

| Harness surface | Current implementation | v3 widget |
|---|---|---|
| Conversation pane (VTE terminal output) | `conversation.ts`, `snapshot-oracle.ts` | `TerminalWidget` (already planned, step 20). |
| Project pane (directory tree, file listing, action buttons) | `project.ts`, `harness-core-ui.ts`, `project-tree.ts` | `TreeView` (shared with rail). Action buttons within rows use the `ListView` action cell pattern. |
| GitHub review pane (PR summary, thread list, comment bodies) | `project-pane-github-review.ts` | `TreeView` + `Text` composition. Thread bodies rendered as `Text` inside `ScrollView`. |
| Home pane (animated background, task planning, repository dropdown) | `home.ts`, `home-gridfire.ts`, `task-focused-pane.ts` | `Canvas` — custom rendering widget for the gridfire animation. Task planning uses `TreeView` + `TextArea` + `Dropdown`. |
| Task planning pane (task list, composer, repository dropdown) | `task-focused-pane.ts`, `task-composer.ts` | Composition of `ListView`, `TextArea`, `Dropdown`. |
| Nim pane (header band, transcript viewport, composer) | `nim.ts` | Composition of `Box`(header), `ScrollView`(transcript), `TextInput`(composer). No new widget. |

### Modals (overlays)

| Harness surface | Current implementation | v3 widget |
|---|---|---|
| Command palette (fuzzy search, ranked results, keyboard nav) | `command-menu.ts`, `modal-command-menu-handler.ts`, `modal-overlays.ts` | `CommandPalette` (already planned, step 21). |
| New thread prompt (agent type selection) | `new-thread-prompt.ts`, `modal-overlays.ts` | `Modal` + `Select`. Composition only, no new widget. |
| Conversation title edit | `modal-conversation-handlers.ts`, `modal-overlays.ts` | `Modal` + `TextInput`. Composition only. |
| Task editor prompt (title/body/repository fields) | `modal-task-editor-handler.ts`, `modal-overlays.ts` | `Modal` + `Column(TextInput, TextArea, Dropdown)`. |
| Add directory prompt | `modal-prompt-handlers.ts` | `Modal` + `TextInput`. |
| API key prompt | `modal-prompt-handlers.ts` | `Modal` + `TextInput` (with password masking). |
| Repository prompt (add/edit remote URL) | `modal-prompt-handlers.ts` | `Modal` + `TextInput`. |
| Release notes overlay | `release-notes.ts`, `modal-release-notes-handler.ts` | `Modal` + `ScrollView` + `Text`. |
| Keybinding table (shortcuts catalog) | `keybinding-catalog.ts` | `Modal` + `Table` (new widget). |

### Interactive Patterns

| Harness pattern | Current implementation | v3 widget |
|---|---|---|
| Text selection (drag select + clipboard copy) | `selection.ts`, `conversation-selection-input.ts` | `TextSelection` — mixin or behavior attached to `TerminalWidget` and `ScrollView`. Manages anchor/focus drag, highlight rendering, clipboard write. |
| Pane divider drag (resize left/right panes) | `pointer-routing.ts` | `PaneDivider` widget (see Layout Shells). |
| Double-click (word select) | `double-click.ts` | Built into `TextSelection` behavior. |
| Link click (cmd+click URLs and file paths) | `link-click.ts` | Built into `TerminalWidget` — emits `LinkClicked(url)` message. |
| Mouse wheel scroll (viewport scroll, modal scroll) | `pointer-routing-input.ts` | Built into `ScrollView` and `TerminalWidget` mouse handling. |
| Repository folding (expand/collapse in rail) | `repository-folding.ts` | Built into `TreeView` fold/expand behavior. |

### New Widgets Needed (not yet in plan)

| Widget | Description | Priority |
|---|---|---|
| `TreeView` | Collapsible hierarchical list. Selectable rows with icons, badges, indent. Fold/expand. Keyboard nav (up/down/left/right to collapse/expand). Used by: workspace rail, project tree, GitHub review, task list. | High — used by 4+ surfaces |
| `ListView` | Flat styled list with per-row badges, status icons, active indicator. Essentially `TreeView` without nesting. Might be a flat mode of `TreeView`. | High — used by conversation rail, task list |
| `TextArea` | Multi-line text input with cursor, wrapping, vertical navigation. Currently `task-composer.ts` + `WrappingInputRenderer`. | High — used by task editor, nim composer |
| `Dropdown` | Single-value selector that opens a popup `Select` on click/enter. Used by task planning repository picker. | Medium |
| `Table` | Columnar data display with headers, alignment, optional row selection. Used by keybinding catalog display. | Medium |
| `PaneDivider` | Draggable vertical/horizontal separator. Emits position change messages. | Medium |
| `Canvas` | Custom render callback widget for freeform drawing (gridfire animation, ASCII art). Takes a `render(buffer)` callback, no children. | Low — only used by home background |
| `TextSelection` | Behavior/mixin for drag-select text across rows. Manages anchor/focus, highlight overlay, clipboard. | Medium — shared by terminal and home pane |

### Updated Build Order (steps 19+)

| # | Deliverable | Depends on |
|---|---|---|
| 19 | VTE core — extract from snapshot-oracle | 2 |
| 20 | `TerminalWidget` + e2e | 5, 10, 12, 17, 19 |
| 21 | `TextArea` widget + e2e | 10, 12, 13 |
| 22 | `TreeView` widget + e2e | 10, 12, 13, 17 |
| 23 | `ListView` widget + e2e (flat mode of TreeView or standalone) | 10, 12, 13 |
| 24 | `Dropdown` widget + e2e | 12, 15, 16 |
| 25 | `Table` widget + e2e | 12, 13 |
| 26 | `PaneDivider` widget + e2e | 5, 7, 12 |
| 27 | `Canvas` widget + e2e | 5, 12 |
| 28 | `CommandPalette` widget + e2e | 12, 15, 16, 18 |
| 29 | `TextSelection` behavior + e2e | 12, 17, 20 |
| 30 | VNode / factory functions — declarative composition | 3, 13-28 |
| 31 | App shell — `createApp`, lifecycle, input loop, render loop | 5, 8, 9, 10, 11 |
| 32 | App shell e2e tests | 12, 30, 31 |
| 33 | Demo app — showcase exercising all widgets | all |
| 34 | Port harness to harness-ui v3 | all |

---

## Non-Goals

- React/Solid reconcilers.
- Native rendering core (Zig).
- CSS file loading. Themes are programmatic.
- Web target.
- OpenTUI renderable hosting. Theme interop only.

# harness-ui v3 Feature Audit

## Part 1: Harness TUI Feature Audit

### Features with v3 widget coverage (ready)

| Harness Feature | v3 Widget(s) | Status |
|---|---|---|
| Dual-pane layout (left rail + separator + right pane) | `Row`, `Column`, `PaneDivider` | covered |
| Resizable pane divider drag | `PaneDivider` + `DividerMoved` message | covered |
| Status bar (bottom row, perf, debug notice) | `Row` + `Text` + `Spacer` composition | covered |
| Workspace rail (project/repo tree, fold/expand, status icons, badges) | `TreeView` | covered |
| Conversation rail (session list, status badges, active indicator) | `ListView` | covered |
| Left-nav keyboard cycling (up/down across sections) | `FocusManager` + widget keybindings | covered |
| Rail row hit-testing (pointer click -> select) | `TreeView`/`ListView` mouse (needs wiring) | covered |
| Conversation pane (VTE terminal) | `TerminalWidget` | covered |
| Project pane (directory tree, file listing) | `TreeView` | covered |
| Home pane animated background (gridfire) | `Canvas` | covered |
| Task planning (task list, composer, repository dropdown) | `ListView` + `TextArea` + `Dropdown` | covered |
| Nim pane (header, transcript, composer) | `Box` + `ScrollView` + `TextInput` | covered |
| Command palette (fuzzy search, ranked results) | `CommandPalette` | covered |
| New thread prompt (agent type selection modal) | `Modal` + `Select` | covered |
| Conversation title edit | `Modal` + `TextInput` | covered |
| Task editor prompt (title/body/repository fields) | `Modal` + `TextInput` + `TextArea` + `Dropdown` | covered |
| Add directory / API key / Repository prompts | `Modal` + `TextInput` | covered |
| Release notes overlay | `Modal` + `ScrollView` + `Text` | covered |
| Keybinding table (shortcuts catalog) | `Modal` + `Table` | covered |
| GitHub review pane (PR summary, thread tree, comments) | `TreeView` + `ScrollView` + `Text` | covered |
| OpenCode theme compatibility | `Theme` + `fromOpenCodeTheme()` | covered |
| Dark/light mode switching | `Theme` system | covered |
| VTE terminal emulator (full parser, DEC modes, scrollback) | `Vte` + `ScreenBuffer` | covered |
| ANSI integrity validation | `frame-primitives` (kept from v2) | covered |
| Diff-based screen flush with sync update | `Screen` (kept from v2) | covered |
| Wide character / CJK support | `TextLayout` + `CellBuffer` + `Vte` | covered |
| Combining mark support | `TextLayout` + `Vte` | covered |
| Reactive state -> auto re-render | `reactive()` | covered |
| Typed message bubbling | `Message` system | covered |
| Declarative keybindings | `Binding` declarations + bottom-up resolver | covered |
| Headless e2e testing | `TestPilot` + assertions | covered |

### Features needing additional v3 work (gaps)

| Harness Feature | What's Missing | Priority |
|---|---|---|
| Text selection (drag select + clipboard copy) | `TextSelection` behavior not built yet. Need: anchor/focus drag tracking, highlight overlay rendering, clipboard write (`pbcopy`/`xclip`). Required on `TerminalWidget`, `ScrollView`, and home pane. | High |
| Double-click word select | Built into `TextSelection` behavior. `double-click.ts` has the detection logic; needs port into the text selection system. | High |
| Link click (cmd+click URLs/files) | `TerminalWidget` doesn't emit `LinkClicked` yet. Need: token-under-pointer resolution, URL vs file-path classification, browser/editor open dispatch. `link-click.ts` has the logic. | High |
| Drag-and-drop reorder (task/repository in home pane) | No drag-and-drop behavior in v3 yet. `home-pane-drop.ts` has the pattern: track drag start/move/release on rows, reorder on drop. Needs a `DragReorder` behavior or mixin for `ListView`/`TreeView`. | Medium |
| Scroll acceleration (macOS-style) | Mouse wheel events parsed but no acceleration curve. Harness has simple fixed-step scroll. OpenCode has configurable acceleration. | Low |
| Selection overlay rendering (ANSI highlight rows) | `selection.ts` builds overlay ANSI rows for selected text regions. Needs integration into `TerminalWidget` and `ScrollView` render paths. | High |
| Conversation pane selection + scrollback copy | `conversation-selection-input.ts` manages selection across VTE scrollback. Selection state needs to coordinate with `TerminalWidget.scrollViewport`. | High |
| Home pane entity click (double-click to edit task/repo) | `home-pane-entity-click.ts` tracks click state per entity for double-click-to-edit. Needs to be a reusable behavior pattern. | Medium |
| Critique review (git diff review agent) | App-layer feature using `critique-review.ts`. Not a framework concern — will use `TerminalWidget` or `ScrollView` for display. | N/A (app layer) |
| Render trace analysis / Gateway profiler / Status timeline | Debug features in `live-mux/`. Not framework concerns — will use `ScrollView` + `Text` or `Canvas`. | N/A (app layer) |
| Input mode management (kitty keyboard protocol, focus tracking) | `terminal-input-modes.ts` handles enable/disable of advanced terminal protocols. `App.lifecycle.ts` covers basic mouse/alt-screen but not kitty keyboard protocol (`CSI > 1 u`). | Medium |
| ANSI integrity scan on rendered frames | `ansi-integrity.ts` validates rendered output. Available in `frame-primitives.ts` (kept from v2) but not wired into the v3 render pipeline validation path. | Low |

---

## Part 2: OpenCode TUI Feature Audit

### Features OpenCode has that harness-ui v3 needs for nim agent parity

| OpenCode Feature | Description | v3 Status | Gap |
|---|---|---|---|
| **Conversation view with markdown rendering** | Chat messages rendered as styled markdown (headings, code blocks, lists, links, emphasis, blockquotes). | Missing | Need `MarkdownRenderer` widget — renders markdown AST to styled `Text` nodes in a `ScrollView`. |
| **Syntax-highlighted code blocks** | Inline code and fenced code blocks with language-aware syntax highlighting (treesitter/HAST-based in OpenTUI). | Missing | Need `CodeBlock` widget with syntax theme integration. Can use `Canvas` for custom rendering or a dedicated `SyntaxHighlight` module. |
| **Diff view (unified + split)** | File changes displayed as syntax-highlighted diffs with added/removed lines, line numbers. | Missing | Need `DiffView` widget. Theme already has `diffAdded`, `diffRemoved` etc. tokens from OpenCode theme spec. |
| **Multi-session management** | List/switch/fork/rename sessions. Session sidebar with session list. | Partially covered | `ListView` covers the session list UI. Session lifecycle (fork, rename, share) is app-layer. |
| **Session sidebar toggle** | Collapsible left sidebar showing session history. | Covered | `TreeView`/`ListView` + `PaneDivider` + show/hide toggle. |
| **Agent mode switching (Plan/Build/Tab)** | Tab key cycles between agent modes (plan, build). Visual indicator in bottom-right. | Missing (behavior) | Need mode indicator widget and mode-switch behavior. Simple `Text` reactive + keybinding. |
| **Input composer with multi-line, history, selection** | Rich text input with: shift+enter for newlines, up/down history recall, word-level movement (alt+left/right), kill-line (ctrl+k/u), word delete (alt+d, ctrl+w), text selection (shift+arrows), undo/redo. | Partially covered | `TextArea` has basic multi-line + cursor. **Missing**: word movement, kill-line, text selection within input, undo/redo, history recall. Need to enhance `TextArea`. |
| **File reference autocomplete (`@`)** | Typing `@` triggers fuzzy file search popup inline in the input. | Missing | Need `AutocompletePopup` widget that attaches to `TextArea`, shows filtered results, inserts on select. |
| **Slash command input (`/`)** | Typing `/` triggers command list popup. | Partially covered | `CommandPalette` is close but is a full-screen overlay. Need inline command popup variant triggered from input. |
| **Bash command shortcut (`!`)** | Starting input with `!` runs as shell command. | N/A (app layer) | Input prefix detection is app-layer logic, not a widget. |
| **Image drag-and-drop into terminal** | Dragging an image file into the terminal adds it to the prompt. | Missing | Need terminal image protocol support or file drop detection. Complex. Low priority for initial port. |
| **Tool execution details toggle** | Toggle visibility of tool call details (file writes, shell commands) inline in conversation. | Missing (behavior) | Collapsible sections within `ScrollView`. Could use `TreeView` with expandable tool-call nodes. |
| **Thinking/reasoning block toggle** | Toggle visibility of model's reasoning/thinking blocks. | Missing (behavior) | Same collapsible section pattern. |
| **Undo/redo with git integration** | `/undo` reverts message + file changes via git. `/redo` restores. | N/A (app layer) | Git integration is app-layer. UI just needs undo/redo buttons/commands. |
| **Session sharing (create link, copy URL)** | `/share` generates a shareable link for the conversation. | N/A (app layer) | App-layer feature. UI needs copy-to-clipboard support. |
| **Scroll acceleration** | macOS-style smooth scroll acceleration that increases speed with rapid gestures. | Missing | Need configurable scroll acceleration curve in `ScrollView` and `TerminalWidget`. |
| **Rich theme system (40+ tokens, defs, dark/light variants)** | Themes with `defs` (reusable color aliases), per-surface tokens (diff, markdown, syntax), dark/light variants, `"none"` for terminal-default. | Partially covered | Our `Theme` has core + widget tokens. **Missing**: markdown tokens, syntax tokens, diff tokens, `defs` aliasing, `"none"` terminal-default support, theme file loading from disk. |
| **Built-in theme presets** | 11+ named themes (tokyonight, catppuccin, gruvbox, nord, etc.). | Missing | Need theme preset files. The `fromOpenCodeTheme()` adapter handles the mapping, but we don't ship preset definitions. |
| **Command palette (ctrl+p)** | Fuzzy-search command list. | Covered | `CommandPalette` widget. |
| **Model selector** | List/switch between LLM models. | Covered (UI) | `Select` or `ListView` in a `Modal`. App-layer model management. |
| **Configurable keybindings with leader key** | Leader key pattern (`ctrl+x` then action key), full keybind customization via config. | Partially covered | `Keybinding` system supports declarations but not leader-key sequences or config-file loading. **Missing**: leader key (two-step key sequence), keybind config file loading. |
| **Clipboard integration** | Copy selected text, copy session share link. | Missing | Need clipboard write utility (`pbcopy`, `xclip`, `xsel` detection + subprocess). |
| **External editor integration** | `/editor` opens `$EDITOR` for composing long messages. | N/A (app layer) | App-layer `$EDITOR` subprocess spawn. Widget: `App.suspend()` + `App.resume()`. |
| **Suspend/resume (ctrl+z)** | Suspend TUI to shell, resume later. | Partially covered | `lifecycle.ts` has setup/restore. **Missing**: SIGTSTP signal handling for ctrl+z suspend. |

---

## Part 3: New Widgets/Features Needed

### Priority 1 — Required for nim agent v1

Confirmed by OpenCode source analysis (`packages/opencode/src/cli/cmd/tui/`).

| Widget/Feature | LOC Estimate | Description | OpenCode implementation reference |
|---|---|---|---|
| `MarkdownRenderer` | ~300 | Renders markdown to styled text in a scroll container. Headings, code blocks, lists, links, emphasis, blockquotes. OpenCode uses `<code filetype="markdown">` and `<markdown>` OpenTUI components with `syntaxStyle` and `conceal` props. | `routes/session/index.tsx` lines 1390-1419 (TextPart). Uses OpenTUI's `code` renderable with `filetype="markdown"`. |
| `CodeBlock` | ~200 | Syntax-highlighted code display with line numbers, language label. OpenCode uses `<code>` with `filetype`, `syntaxStyle`, `streaming` props. Also uses `<diff>` for diff views. | `routes/session/index.tsx` tool renderers (Write, Edit, ApplyPatch) all use `<diff>` component. |
| `DiffView` | ~250 | Unified diff display with added/removed highlighting, line numbers, hunk headers. OpenCode has a `<diff>` OpenTUI component with `content`, `syntaxStyle`, `wrapMode` props. | `routes/session/index.tsx` Write/Edit/ApplyPatch tools, theme has `diffAdded`, `diffRemoved`, `diffContext`, `diffHunkHeader`, `diffAddedBg`, `diffRemovedBg` tokens. |
| `TextArea` enhancements | ~150 | Word movement (alt+left/right), kill-line (ctrl+k/u), word delete (alt+d, ctrl+w), text selection (shift+arrows), undo/redo stack, paste. OpenCode's prompt is a full `TextareaRenderable` with 80+ keybindings. | `component/textarea-keybindings.ts` + `component/prompt/index.tsx` (~1150 LOC). Keybindings: word forward/backward, kill-line, word delete, select, undo/redo, paste, history up/down. |
| `AutocompletePopup` | ~200 | Inline popup for `@` file references and `/` slash commands. Uses `fuzzysort` for fuzzy matching, shows file tree results with icons, line range support (`@file.ts#10-20`). Separate modes for `@` (files) and `/` (commands). | `component/prompt/autocomplete.tsx` (~670 LOC). Uses `ScrollBoxRenderable`, frecency tracking, file icons. |
| `TextSelection` behavior | ~250 | Drag-select text across rows. OpenCode delegates to OpenTUI renderer's `getSelection()` / `clearSelection()` / `getSelectedText()`. | `util/selection.ts` (26 LOC — very thin wrapper over OpenTUI's built-in selection). `util/clipboard.ts` handles the clipboard side. |
| Clipboard utility | ~100 | Platform-detect clipboard: macOS (`osascript`), Linux (`wl-copy`/`xclip`/`xsel`), Windows (`powershell`). Also supports OSC 52 for SSH remotes and `clipboardy` fallback. Reads images too (PNG from clipboard). | `util/clipboard.ts` (160 LOC). Full platform matrix with image support. |
| `Toast` notification | ~80 | Transient notification bar. Shows success/error/info/warning messages with auto-dismiss. OpenCode uses a toast overlay for clipboard copy confirmation, errors, etc. | `ui/toast.tsx`. |
| `Spinner` animation | ~50 | Inline animated spinner for pending tool calls and loading states. | `ui/spinner.ts` + `component/spinner.tsx`. |

### Additional OpenCode TUI patterns discovered in source

| Pattern | Description | Priority |
|---|---|---|
| **SolidJS reactive rendering** | OpenCode uses `@opentui/solid` — a SolidJS reconciler for OpenTUI. All UI is reactive JSX with `createSignal`, `createMemo`, `createEffect`. Our `reactive()` system is the equivalent. | N/A (architecture) |
| **Part-based message rendering** | Messages are rendered as typed parts (`text`, `tool`, `reasoning`). Each part type has its own component. Tool parts have specific renderers per tool (Bash, Read, Write, Edit, etc.). | App-layer |
| **Collapsible tool output** | Tool results (bash output, file reads) are collapsible with click-to-expand. Overflow detection limits display to N lines with "Click to expand". | Medium — need expandable/collapsible section in `ScrollView` or a `Collapsible` widget. |
| **Hover states on message blocks** | User messages highlight background on mouse hover (`onMouseOver`/`onMouseOut`). Click opens message action dialog. | Medium — need mouse hover tracking on widgets. |
| **Left border accent on messages** | Messages use `border={["left"]}` with `customBorderChars` for the distinctive left-pipe style. User messages colored by agent, assistant reasoning uses muted border. | Low — compositional styling |
| **Sidebar with collapsible sections** | Right sidebar shows MCP servers, file diffs, TODOs, cost/token stats. Each section is independently collapsible. | Medium — `TreeView` with section headers |
| **Responsive sidebar (auto/manual)** | Sidebar auto-shows when terminal width > 120, overlay mode on narrow terminals with semi-transparent backdrop (`RGBA.fromInts(0,0,0,70)`). | Medium — need alpha-blend overlay support |
| **Session fork/child navigation** | Child sessions (sub-agents) navigable with `ctrl+x right/left`. Parent session accessible with `ctrl+x up`. | App-layer |
| **Scroll acceleration** | Configurable: `MacOSScrollAccel` or fixed speed `CustomSpeedScroll`. Config-driven via `tui.scroll_acceleration`. | Low |
| **Custom border chars** | `SplitBorder.customBorderChars` for half-border (left pipe only) styling on message blocks. | Low — can be added to Box border options |
| **Streaming markdown** | `streaming={true}` prop on markdown/code renderables for incremental rendering as tokens arrive. | Medium |
| **Conceal mode** | `conceal` prop hides markdown syntax characters (showing rendered output only). Toggle via keybind. | Medium |
| **Frecency-based autocomplete ranking** | File autocomplete uses frecency (frequency + recency) scoring for recently used files. | Low |
| **Prompt history** | Up/down arrow recalls previous prompts. Separate from text cursor movement. | Medium |
| **Permission prompt** | Inline permission request UI for tool execution approval. | App-layer |
| **Revert/undo UI** | Reverted messages shown as collapsed block with redo option. Diff file summary inline. | App-layer |

### Priority 2 — Required for full OpenCode feature parity

| Widget/Feature | LOC Estimate | Description |
|---|---|---|
| Theme enhancements | ~150 | Add markdown tokens, syntax tokens, diff tokens, `defs` aliasing, `"none"` terminal-default, theme file loading. |
| Built-in theme presets | ~200 | Ship tokyonight, catppuccin, gruvbox, nord, etc. as theme definitions. |
| Leader key support | ~100 | Two-step key sequence in keybinding resolver (press leader, then action key). |
| Keybind config loading | ~100 | Load keybinding overrides from config file. |
| Scroll acceleration | ~80 | Configurable acceleration curve for `ScrollView`/`TerminalWidget`. |
| Suspend/resume (SIGTSTP) | ~30 | Handle ctrl+z to suspend TUI, restore on fg. |
| Drag-and-drop reorder | ~150 | Row-level drag state tracking for `ListView`/`TreeView` reordering. |

### Priority 3 — Nice to have

| Widget/Feature | LOC Estimate | Description |
|---|---|---|
| Image protocol support | ~200 | Kitty/iTerm2 image protocol for inline images in terminal. |
| Kitty keyboard protocol | ~100 | Enhanced keyboard input parsing (`CSI > 1 u`). |
| ANSI integrity pipeline validation | ~50 | Wire `findAnsiIntegrityIssues` into render pipeline as debug assertion. |

---

## Updated Build Order (remaining steps)

| # | Deliverable | Priority |
|---|---|---|
| 29 | `TextSelection` behavior + clipboard | P1 |
| 32 | `TextArea` enhancements (word nav, kill-line, selection, undo) | P1 |
| 33 | `MarkdownRenderer` widget + e2e | P1 |
| 34 | `CodeBlock` widget + e2e | P1 |
| 35 | `DiffView` widget + e2e | P1 |
| 36 | `AutocompletePopup` widget + e2e | P1 |
| 37 | Theme enhancements (markdown/syntax/diff tokens, defs, none) | P2 |
| 38 | Built-in theme presets | P2 |
| 39 | Leader key support in keybinding resolver | P2 |
| 40 | Keybind config loading | P2 |
| 41 | Scroll acceleration | P2 |
| 42 | Suspend/resume (SIGTSTP) | P2 |
| 43 | Drag-and-drop reorder behavior | P2 |
| 44 | Demo app | — |
| 45 | Port harness to harness-ui v3 | — |

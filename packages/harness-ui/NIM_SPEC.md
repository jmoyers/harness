# nim standalone — Functional Specification

## Purpose

A standalone terminal AI agent interface built on harness-ui v3. Matches OpenCode's visual language and interaction patterns. Serves as the reference implementation for the harness-ui widget library and the foundation for nim's production TUI.

## Layout

```
┌─ Header ───────────────────────────────────────────────────────┐
│   nim · session title                    Build · claude-4-opus │
├────────────────────────────────────────────────────────────────┤
│ Main conversation area                                         │
│                                                                │
│ │ User message (left-pipe border)                              │
│                                                                │
│   _Thinking:_ reasoning text (dimmed)                          │
│                                                                │
│   # Heading (accent bold)                                      │
│   paragraph text                                               │
│   `code span`                                                  │
│   > blockquote (dimmed, ▌ marker)                              │
│                                                                │
│   ⚙ 6 actions · 2 edits · 1 test · 4.1s [expanded]            │
│     ✓ read src/auth/session.ts                                 │
│     ✓ edit src/auth/session.ts +15 -3                          │
│     ✓ bash bun test test/auth/ (exit 0)                        │
│       preview: 3 passed, 0 failed                              │
│                                                                │
│   ▣ Build · claude-4-opus                                      │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ > Ask nim anything...                                 [Build]  │
├────────────────────────────────────────────────────────────────┤
│ ~/dev/project  MCP 2/2  2,847 tok  12%  $0.04  ctrl+p details │
└────────────────────────────────────────────────────────────────┘
```

## Components Used

| Area | Widget(s) |
|------|-----------|
| Header | Custom `NimHeader` widget (1 row) |
| Conversation | Custom `ConversationView` with message rendering |
| User messages | Left-pipe `│` border in primary color, panel background |
| Assistant text | Inline markdown: headings, bold, code, blockquotes, diff lines |
| Tool calls | `ActionGroup` summary row + expandable detail rows |
| Thinking | Dimmed italic text with border accent |
| Prompt | `Composer` with placeholder, mode indicator, history, word nav |
| Footer/status strip | Custom `NimFooter`: directory path, context and MCP chips, keybind hints |
| Details overlay | `Modal` + `ScrollView`: expanded context details and full tool output |
| Notifications | `Toast` overlay (bottom center) |
| Commands | `CommandPalette` overlay (ctrl+p) |
| Loading | `Spinner` (visible during response generation) |

## Functional Requirements

### FR-1: Session Display

- Conversation renders chronologically with user and assistant messages.
- User messages display with left-pipe border in primary color and panel background.
- Assistant messages render markdown: headings, code blocks, blockquotes, bold, diff lines.
- Tool activity renders as action groups per assistant turn. Each group supports collapsed summary and expanded detail.
- Thinking/reasoning blocks render dimmed with border.
- Message footer shows agent mode and model name: `▣ Build · claude-4-opus`.

### FR-2: Prompt Composer

- Multi-line input with shift+enter for newlines, enter to submit.
- Placeholder text when empty and unfocused: "Ask nim anything..."
- Mode indicator in bottom-right: `[Build]` or `[Plan]`.
- Word-level navigation (alt+arrows), kill-line (ctrl+k/u), undo (ctrl+z).
- History recall with up/down arrows when input is empty.
- ctrl+c clears input.
- Submit appends user message to conversation and triggers response.

### FR-3: Agent Mode Toggle

- Tab key toggles between Build and Plan modes.
- Header and composer mode indicator update immediately.
- Toast notification confirms mode switch.

### FR-4: Command Palette

- ctrl+p opens fuzzy-search command palette.
- Commands: New Session, Session List, Switch Model, Compact, Share, Theme, Details, Thinking, Help, Export, Quit.
- Up/down navigation, enter to execute, escape to dismiss.
- Typing filters results by title and keywords.
- Execution triggers toast notification.

### FR-5: Action Transparency and Grouping

- Every tool call is represented in the transcript timeline; no action may be hidden.
- Completed action groups default to collapsed summary.
- `running`, `warning`, and `failed` action groups default to expanded.
- Expanded view includes command/tool name, target files, result/exit status, and output preview.
- Full raw output is available via `show full output` from expanded action rows.
- Expand/collapse state is user-controlled and persisted for the current session.

### FR-6: Header

- Left: nim logo + session title.
- Right: current agent mode + model name.
- Updates when mode toggles or session changes.

### FR-7: Footer/Status Strip

- Left: working directory path.
- Center/right: compact chips for MCP status, token usage, context percent, and session cost.
- Includes keybind hints for palette/details access.

### FR-8: Details Overlay

- `ctrl+p` includes a `details` action that opens an on-demand overlay.
- Overlay contains full context metrics, MCP server list, and full tool-output logs.
- Overlay is dismissible via `escape` and does not replace transcript history.

### FR-9: Toast Notifications

- Transient messages for: mode switch, message sent, command executed.
- Auto-dismiss after 3 seconds.
- Variants: info, success, warning, error.

### FR-10: Loading State

- Spinner visible while waiting for response.
- Label: "nim is thinking..."
- Hidden when response arrives.

### FR-11: Spacing and Density

- Global spacing tokens:
  - `space-0 = 0`
  - `space-1 = 1`
  - `space-2 = 2`
- Transcript:
  - Message outer gap: `space-1`.
  - Message inner padding: horizontal `space-2`, vertical `space-1`.
- Action groups:
  - Header padding: horizontal `space-1`, vertical `space-0`.
  - Expanded rows inset: `2` columns.
  - Expanded row gap: `space-0` (dense log readability).
- Composer:
  - Top margin from transcript: `space-1`.
  - Inner padding: horizontal `space-1`, vertical `space-0`.

### FR-12: Seed Conversation

- App starts with a pre-populated conversation demonstrating all message types:
  user message, thinking block, markdown text, grouped tool calls, diff lines, code block.
- Footer chips show initial context stats matching the seed data.

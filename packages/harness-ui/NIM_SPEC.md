# nim standalone — Functional Specification

## Purpose

A standalone terminal AI agent interface built on harness-ui v3. Matches OpenCode's visual language and interaction patterns. Serves as the reference implementation for the harness-ui widget library and the foundation for nim's production TUI.

## Layout

```
┌─ Header ───────────────────────────────────────────────────────┐
│   nim · session title                    Build · claude-4-opus │
├────────────────────────────────────────────┬───────────────────┤
│ Main conversation area                     │ Sidebar           │
│                                            │                   │
│ │ User message (left-pipe border)          │ Context           │
│                                            │ Tokens  2,847     │
│   _Thinking:_ reasoning text (dimmed)      │ ████░░░░░░ 12%    │
│                                            │ Cost    $0.04     │
│   # Heading (accent bold)                  │                   │
│   paragraph text                           │ MCP               │
│   `code span`                              │ ● filesystem      │
│   > blockquote (dimmed, ▌ marker)          │ ● github          │
│                                            │                   │
│   ```typescript                            │ Files Changed     │
│   code block (panel bg)                    │ session.ts +15 -3 │
│   ```                                      │                   │
│                                            │                   │
│   ✓ read src/auth/session.ts               │                   │
│   ✓ edit src/auth/session.ts +15 -3        │                   │
│   ✓ bash bun test test/auth/               │                   │
│                                            │                   │
│   +  added line (green)                    │                   │
│   -  removed line (red)                    │                   │
│                                            │                   │
│   ▣ Build · claude-4-opus                  │                   │
│                                            │                   │
├────────────────────────────────────────────┴───────────────────┤
│ > Ask nim anything...                                 [Build]  │
├────────────────────────────────────────────────────────────────┤
│ ~/dev/project                          ctrl+p palette · ctrl+c │
└────────────────────────────────────────────────────────────────┘
```

## Components Used

| Area | Widget(s) |
|------|-----------|
| Header | Custom `NimHeader` widget (1 row) |
| Conversation | Custom `ConversationView` with message rendering |
| User messages | Left-pipe `│` border in primary color, panel background |
| Assistant text | Inline markdown: headings, bold, code, blockquotes, diff lines |
| Tool calls | Inline: icon (`✓`/`✗`/`⚙`) + tool name + args |
| Thinking | Dimmed italic text with border accent |
| Sidebar | Custom `Sidebar`: context stats, MCP status, file diffs |
| Prompt | `Composer` with placeholder, mode indicator, history, word nav |
| Footer | Custom `NimFooter`: directory path, keybind hints |
| Notifications | `Toast` overlay (bottom center) |
| Commands | `CommandPalette` overlay (ctrl+p) |
| Loading | `Spinner` (visible during response generation) |
| Divider | `PaneDivider` between main and sidebar |

## Functional Requirements

### FR-1: Session Display

- Conversation renders chronologically with user and assistant messages.
- User messages display with left-pipe border in primary color and panel background.
- Assistant messages render markdown: headings, code blocks, blockquotes, bold, diff lines.
- Tool calls show inline with status icon: `✓` complete (muted), `✗` error (red), `⚙` pending (warning).
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

### FR-5: Sidebar

- Shows context stats: token count, context usage bar, cost.
- Shows MCP server status: green dot = connected, hollow dot = disconnected.
- Shows file diff summary: filename with +additions -deletions.
- Updates reactively as conversation progresses.

### FR-6: Header

- Left: nim logo + session title.
- Right: current agent mode + model name.
- Updates when mode toggles or session changes.

### FR-7: Footer

- Left: working directory path.
- Right: keybind hints.

### FR-8: Toast Notifications

- Transient messages for: mode switch, message sent, command executed.
- Auto-dismiss after 3 seconds.
- Variants: info, success, warning, error.

### FR-9: Loading State

- Spinner visible while waiting for response.
- Label: "nim is thinking..."
- Hidden when response arrives.

### FR-10: Seed Conversation

- App starts with a pre-populated conversation demonstrating all message types:
  user message, thinking block, markdown text, tool calls, diff lines, code block.
- Sidebar shows initial context stats matching the seed data.

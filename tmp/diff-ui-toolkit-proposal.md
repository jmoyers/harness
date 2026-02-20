# diff UI Toolkit Proposal (Temporary)

## Status

- Branch: `jm/diff`
- Date: 2026-02-20
- Scope: UI toolkit + standalone process design for rendering first-party diff data
- Artifact type: proposal only (no runtime implementation in this doc)

## Context

We now have a first-party diff substrate in `src/diff/*`.

This proposal defines a first-party terminal UI toolkit extension and standalone runner that can present large diffs with critique-like ergonomics while remaining fully programmable.

Reference UX patterns (from critique public docs/screenshots):

- side-by-side split diff on wide terminals
- unified diff on narrower widths
- fuzzy file switcher
- keyboard-first navigation and fast scroll
- syntax-highlighted code with diff semantics overlaid

## Product Goals

1. Render very large diffs without runaway memory/cpu.
2. Keep keyboard navigation and finder speed comparable to critique.
3. Support syntax highlighting and theme control as first-party concerns.
4. Run as a standalone process with CLI options.
5. Expose the same operations programmatically (no TUI-only behavior).

## Non-Goals (Phase 1)

- AI review/finding generation in this process.
- GitHub publishing/review-thread actions.
- Web renderer parity.

## UX Surface

## Layout Modes

- `split` mode:
  - left column old side, right column new side
  - inline word-change emphasis for modified lines
  - synchronized vertical scrolling
- `unified` mode:
  - single column with `+/-/ ` gutter semantics
  - compact for narrow terminals and mobile-style widths
- `auto` mode:
  - chooses split/unified from terminal width threshold

## Persistent Regions

- Header:
  - repo context, diff mode (`unstaged`/`staged`/`range`), file stats
- Main viewport:
  - virtualized diff rows
- Footer:
  - key hints, file/hunk position, coverage/truncation notices
- Overlay slots:
  - file finder
  - inline search prompt
  - help/legend

## Navigation and Interaction

Default key profile (initial target):

- `left/right`: previous/next file
- `up/down`: scroll line
- `pageup/pagedown`: scroll page
- `home/end`: top/bottom
- `[` `]` hunk jumps (`[h` / `]h` equivalent)
- `ctrl+p`: file finder (fuzzy)
- `/`: in-file search
- `n`/`shift+n`: next/previous search hit
- `enter`: focus/jump selection in finder
- `esc`: close overlay
- `q`: quit
- `alt` hold: accelerated scroll multiplier

Mouse support (phase 2):

- wheel scroll
- click file in finder
- click hunk header to jump/fold

## Diff Presentation Model

## Row Types

Introduce explicit row model for rendering:

- `file-header`
- `hunk-header`
- `code-context`
- `code-add`
- `code-del`
- `spacer`
- `notice` (coverage/truncation/errors)

Each row carries:

- stable anchor (`fileId`, optional `hunkId`, line indices)
- left/right logical text cells (split mode)
- style roles (not raw ANSI)

## Word-Level Diff

For modified lines:

- compute intraline tokens only for visible/near-visible line pairs
- overlay word spans on top of add/del line backgrounds
- bounded tokenization budget per frame

Fallback:

- if budgets exceed, show line-level diff only
- surface explicit "word diff degraded" status in footer

## Syntax Highlighting Strategy

## Design

Add first-party highlighting abstraction independent of renderer:

- `HighlightEngine` interface:
  - language detection input (`path`, optional shebang)
  - `tokenizeLine(line, language, theme)`
- `DiffSyntaxRenderer` composes:
  - syntax token style
  - diff semantic background (`add/del/context`)
  - selection/focus overlay

## Performance Constraints

- tokenize only visible rows + prefetch window
- LRU cache keyed by:
  - `themeId`
  - `language`
  - `lineHash`
  - `diffSide` (`old`/`new`)
- cap highlight work per frame (`maxLinesPerFrame`)
- degrade to plain diff colors when budget is exhausted

## Theming Model

Extend current mux theme system (`src/ui/mux-theme.ts`) with diff roles.

## New Theme Roles

Core:

- `diff.bg`
- `diff.fg`
- `diff.gutter`
- `diff.border`
- `diff.header`
- `diff.footer`

Semantic rows:

- `diff.context`
- `diff.add`
- `diff.delete`
- `diff.hunkHeader`
- `diff.fileHeader`

Syntax classes:

- `syntax.keyword`
- `syntax.string`
- `syntax.comment`
- `syntax.type`
- `syntax.function`
- `syntax.variable`
- `syntax.number`

State overlays:

- `diff.active`
- `diff.selection`
- `diff.searchHit`
- `diff.wordChanged`

## Theme Resolution

- inherit from configured mux preset/custom theme where possible
- resolve missing roles via deterministic fallbacks
- support truecolor and indexed color terminals

## UI Toolkit Extensions Needed

Current `src/ui/surface.ts` is cell-based and sufficient as a base. We need reusable higher-level primitives.

## New Generic Primitives (first-party)

- `src/ui/attributed-text.ts`
  - span model (`text + styleRole`) and wrapping helpers
- `src/ui/virtual-viewport.ts`
  - row-windowing + scroll math + anchor mapping
- `src/ui/components/list.ts`
  - selectable/virtualized list for file finder
- `src/ui/components/scrollbar.ts`
  - vertical/horizontal scrollbar painter
- `src/ui/components/statusbar.ts`
  - compact, role-styled footer hints/diagnostics
- `src/ui/components/prompt.ts`
  - inline input prompt for finder/search/filter

## Rendering Contracts

- renderer consumes `style roles`, not final ANSI codes
- role -> `UiStyle` mapping happens once per frame/theme
- all panes return `rows + interactive hit map` (same pattern used in existing UI surfaces)

## diff UI Package Boundaries

Proposed first-party layout:

- `src/diff-ui/model/*`
  - view model derived from `NormalizedDiff`
  - row indexing, anchors, hunk/file navigation
- `src/diff-ui/state/*`
  - reducer-based UI state (mode, selection, scroll, overlays)
- `src/diff-ui/highlight/*`
  - highlight engine + caches + token merge
- `src/diff-ui/render/*`
  - split/unified row builders + themed paint
- `src/diff-ui/input/*`
  - keymaps, actions, overlay routing
- `src/diff-ui/runtime/*`
  - event loop, watch integration, process wiring
- `src/diff-ui/protocol/*`
  - programmatic command/event protocol
- `scripts/harness-diff.ts`
  - standalone process entrypoint

## Standalone Process Design

Executable: `harness diff` (or `harness-diff` alias)

## CLI Inputs

Diff source options:

- `--staged`
- `--base <ref>`
- `--head <ref>`
- `--filter <glob>` (repeatable)
- `--watch`

Display options:

- `--view <auto|split|unified>`
- `--theme <name|path>`
- `--syntax <auto|on|off>`
- `--word-diff <auto|on|off>`
- `--no-color`

Performance options:

- `--max-lines <n>`
- `--max-files <n>`
- `--max-highlight-lines-per-frame <n>`
- `--max-runtime-ms <n>`

Automation options:

- `--json-events` (emit state/events as NDJSON)
- `--rpc-stdio` (accept commands on stdin, emit events on stdout)
- `--snapshot` (render one frame and exit; for tests/automation)

## Programmatic Control Contract

TUI uses the same internal command bus as automation adapters.

Command examples:

- `diff.open`
- `view.setMode`
- `nav.scroll`
- `nav.gotoFile`
- `nav.gotoHunk`
- `finder.open`
- `finder.query`
- `search.set`
- `search.next`
- `theme.set`
- `session.quit`

Event examples:

- `state.changed`
- `selection.changed`
- `coverage.changed`
- `finder.results`
- `render.stats`

This keeps human and agent parity and avoids privileged UI-only paths.

## Large-Diff Performance Model

## Core Rules

- never materialize full rendered text for all rows
- maintain row index + anchor maps, not full row buffers
- render only viewport window + small overscan
- keep highlight and word-diff caches bounded by memory budget

## Data Structures

- `DiffViewIndex`
  - maps file/hunk/line anchors to virtual row offsets
- `VisibleWindow`
  - start/end rows + overscan
- `RenderCache`
  - row fragments keyed by `(theme, mode, rowAnchor, widthBucket)`

## Degrade Paths

1. disable word-level diff first
2. reduce syntax tokens to minimal class set
3. collapse hidden files/hunks by default
4. force unified mode if split mode exceeds frame budget

## Integration with Existing Harness UI Stack

- Reuse:
  - `src/ui/surface.ts`
  - `src/ui/screen.ts`
  - key decoding patterns from `src/mux/task-screen-keybindings.ts`
  - theme resolution patterns from `src/ui/mux-theme.ts`
- Extend:
  - generic attributed text and viewport primitives
  - diff-specific roles in theme config
  - diff-oriented pane renderers and reducers

## Testing and Verification Plan

Unit:

- row indexing, scroll math, finder ranking, keymap routing, style role mapping

Integration:

- split/unified rendering snapshots
- search/finder behavior under large synthetic diffs
- theme fallback and syntax degrade behavior

E2E:

- standalone process keyboard flows (file finder, hunk nav, scroll)
- watch-mode update stability
- rpc-stdio parity with interactive actions

Performance harness:

- large file-count diff
- large hunk-count diff
- long-line pathological diff
- syntax-heavy mixed-language repo

## Phased Delivery

1. Phase 1: read-only diff TUI (split/unified, file/hunk nav, footer, theme roles)
2. Phase 2: finder/search overlays + word-diff + syntax cache
3. Phase 3: watch mode + rpc-stdio command/event protocol
4. Phase 4: AI stream hooks that consume `diff` chunks without coupling review logic into renderer

## Open Questions

1. Should `diff-ui` share mux theme config directly, or use a dedicated `diffTheme` block with inheritance?
2. Do we want word-level diff on by default for huge files, or opt-in behind adaptive threshold?
3. Should rpc transport default to stdio only in phase 1, with socket transport in phase 2?
4. Should finder rank by path tokens only, or include hunk content search results in the same overlay?

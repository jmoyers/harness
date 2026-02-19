export type TerminalCompatLevelStatus = 'complete' | 'in-progress' | 'planned';

export type TerminalCompatEntryStatus = 'implemented' | 'passthrough' | 'unsupported';

export type TerminalCompatPriority = 'p0-codex-vim' | 'p1-important' | 'p2-optional';

export type TerminalCompatLevelId =
  | 'l0-grammar-core'
  | 'l1-screen-state'
  | 'l2-dec-modes'
  | 'l3-query-reply'
  | 'l4-unicode-fidelity'
  | 'l5-external-diff'
  | 'l6-modern-extensions';

export interface TerminalCompatLevel {
  readonly id: TerminalCompatLevelId;
  readonly title: string;
  readonly gate: string;
  readonly status: TerminalCompatLevelStatus;
}

export interface TerminalCompatEntry {
  readonly id: string;
  readonly levelId: TerminalCompatLevelId;
  readonly feature: string;
  readonly sequences: readonly string[];
  readonly status: TerminalCompatEntryStatus;
  readonly priority: TerminalCompatPriority;
  readonly ownerTests: readonly string[];
  readonly notes: string;
}

export const TERMINAL_COMPAT_CHECKPOINT_DATE = '2026-02-19';

export const TERMINAL_COMPAT_LEVELS: readonly TerminalCompatLevel[] = [
  {
    id: 'l0-grammar-core',
    title: 'Grammar + Core Controls',
    gate: 'Stable parser framing for ESC/CSI/OSC/DCS plus core control-flow semantics.',
    status: 'complete',
  },
  {
    id: 'l1-screen-state',
    title: 'Screen State Model',
    gate: 'Deterministic snapshots for cursor, viewport, color/style, wrap, and scrollback.',
    status: 'complete',
  },
  {
    id: 'l2-dec-modes',
    title: 'DEC TUI Modes',
    gate: 'Codex/Vim-critical DEC private modes are implemented and parity tested.',
    status: 'in-progress',
  },
  {
    id: 'l3-query-reply',
    title: 'Query + Reply Engine',
    gate: 'Deterministic DA/DSR/OSC/keyboard replies for runtime negotiation and probing.',
    status: 'in-progress',
  },
  {
    id: 'l4-unicode-fidelity',
    title: 'Unicode Fidelity',
    gate: 'Display width, combining, and grapheme behavior stay stable under resize/wrap/edit.',
    status: 'in-progress',
  },
  {
    id: 'l5-external-diff',
    title: 'External + Differential Conformance',
    gate: 'vttest and direct-terminal differential checkpoints are automated and blocking.',
    status: 'planned',
  },
  {
    id: 'l6-modern-extensions',
    title: 'Modern Extensions',
    gate: 'Intentional extension set (hyperlinks/graphics/sync output) is explicit and tested.',
    status: 'planned',
  },
] as const;

export const TERMINAL_COMPAT_MATRIX: readonly TerminalCompatEntry[] = [
  {
    id: 'c0-basic-controls',
    levelId: 'l0-grammar-core',
    feature: 'C0 handling for LF/CR/BS/TAB and print filtering',
    sequences: ['LF', 'CR', 'BS', 'TAB'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts', 'test/terminal-parity-suite.test.ts'],
    notes: 'Core movement and wrapping behavior is covered in snapshot/parity tests.',
  },
  {
    id: 'esc-csi-framing',
    levelId: 'l0-grammar-core',
    feature: 'ESC and CSI parser state machine framing',
    sequences: ['ESC', 'CSI ... final-byte'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts'],
    notes: 'Supports interrupted CSI streams and state resets.',
  },
  {
    id: 'osc-framing-bel-st',
    levelId: 'l0-grammar-core',
    feature: 'OSC parsing with BEL and ST terminators',
    sequences: ['OSC ... BEL', 'OSC ... ST'],
    status: 'passthrough',
    priority: 'p1-important',
    ownerTests: ['test/codex-live-session.test.ts'],
    notes: 'Parsed and routed to query hooks; display-state effects are intentionally minimal.',
  },
  {
    id: 'dcs-framing-st',
    levelId: 'l0-grammar-core',
    feature: 'DCS parsing with ST terminator',
    sequences: ['DCS ... ST'],
    status: 'passthrough',
    priority: 'p1-important',
    ownerTests: ['test/codex-live-session.test.ts'],
    notes: 'Observed for telemetry/query handling; not interpreted into render-state changes.',
  },
  {
    id: 'cursor-erase-moves',
    levelId: 'l1-screen-state',
    feature: 'Cursor addressing and erase semantics',
    sequences: ['CSI A/B/C/D', 'CSI G', 'CSI H/f', 'CSI J', 'CSI K'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts'],
    notes: 'Cursor and clear operations are part of canonical snapshot hashing.',
  },
  {
    id: 'line-char-editing',
    levelId: 'l1-screen-state',
    feature: 'Line/char insert-delete and regional scroll operations',
    sequences: ['CSI L', 'CSI M', 'CSI @', 'CSI P', 'CSI S', 'CSI T'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts', 'test/terminal-parity-suite.test.ts'],
    notes: 'Hot-path edit operations are validated with parity scenes.',
  },
  {
    id: 'sgr-color-style',
    levelId: 'l1-screen-state',
    feature: 'SGR color/style for default, indexed, and truecolor',
    sequences: ['CSI ... m', '38;5;n', '48;5;n', '38;2;r;g;b', '48;2;r;g;b'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts', 'test/terminal-parity-suite.test.ts'],
    notes: 'Style diff and terminal GIF rendering consume this snapshot model directly.',
  },
  {
    id: 'wrap-scrollback-viewport',
    levelId: 'l1-screen-state',
    feature: 'Pending-wrap, scrollback retention, and viewport follow behavior',
    sequences: ['autowrap', 'linefeed at margins', 'viewport scroll controls'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: [
      'test/terminal-snapshot-oracle.test.ts',
      'test/ui-selection-copy-scrollback.integration.test.ts',
    ],
    notes: 'Selection and copy behavior depend on deterministic buffer indexing.',
  },
  {
    id: 'dec-origin-scroll-region',
    levelId: 'l2-dec-modes',
    feature: 'DEC origin mode + scroll region correctness',
    sequences: ['CSI ? 6 h/l', 'CSI r', 'ESC M'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts', 'test/terminal-parity-suite.test.ts'],
    notes: 'Pinned footer + Vim reverse-index flows rely on this behavior.',
  },
  {
    id: 'dec-alt-screen-save-restore',
    levelId: 'l2-dec-modes',
    feature: 'Alternate screen and cursor save/restore',
    sequences: ['CSI ? 1047 h/l', 'CSI ? 1048 h/l', 'CSI ? 1049 h/l', 'ESC 7', 'ESC 8'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts'],
    notes: 'Codex/Vim mode switches depend on stable alt-screen transitions.',
  },
  {
    id: 'dec-bracketed-paste',
    levelId: 'l2-dec-modes',
    feature: 'Bracketed paste mode tracking',
    sequences: ['CSI ? 2004 h/l'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts'],
    notes: 'Mode state is included in snapshot diff diagnostics.',
  },
  {
    id: 'dec-mouse-focus-tracking',
    levelId: 'l2-dec-modes',
    feature: 'Mouse + focus tracking modes',
    sequences: [
      'CSI ? 1000 h/l',
      'CSI ? 1002 h/l',
      'CSI ? 1003 h/l',
      'CSI ? 1004 h/l',
      'CSI ? 1006 h/l',
    ],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts'],
    notes: 'Tracks DEC mouse/focus reporting and SGR encoding mode state through reset.',
  },
  {
    id: 'cursor-visibility-style-control',
    levelId: 'l2-dec-modes',
    feature: 'Cursor visibility and DECSCUSR style controls',
    sequences: ['CSI ? 25 h/l', 'CSI Ps SP q'],
    status: 'implemented',
    priority: 'p1-important',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts', 'test/terminal-gif-e2e.test.ts'],
    notes: 'Cursor style stability matters for pseudo-screenshot and GIF tooling.',
  },
  {
    id: 'csi-device-status-replies',
    levelId: 'l3-query-reply',
    feature: 'Device/status query replies',
    sequences: ['CSI c', 'CSI > c', 'CSI 5 n', 'CSI 6 n', 'CSI 14 t', 'CSI 16 t', 'CSI 18 t'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/codex-live-session.test.ts'],
    notes: 'Handled via terminal query responder with deterministic replies.',
  },
  {
    id: 'keyboard-query-reply-csi-u',
    levelId: 'l3-query-reply',
    feature: 'Keyboard capability query reply surface',
    sequences: ['CSI ? u'],
    status: 'implemented',
    priority: 'p1-important',
    ownerTests: ['test/codex-live-session.test.ts'],
    notes: 'Query path is implemented; full negotiate/enable matrix remains open.',
  },
  {
    id: 'osc-color-queries',
    levelId: 'l3-query-reply',
    feature: 'OSC terminal color query replies',
    sequences: ['OSC 10 ; ?', 'OSC 11 ; ?', 'OSC 4 ; index ; ?'],
    status: 'implemented',
    priority: 'p1-important',
    ownerTests: ['test/codex-live-session.test.ts', 'test/mux-live-mux-terminal-palette.test.ts'],
    notes: 'Palette replies are deterministic and mapped from config/theme colors.',
  },
  {
    id: 'modifyotherkeys-negotiation',
    levelId: 'l3-query-reply',
    feature: 'modifyOtherKeys and CSI-u negotiation/enable flows',
    sequences: ['CSI > 4 ; ... m', 'CSI > u', 'CSI u protocol enable'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/codex-live-session.test.ts', 'test/terminal-snapshot-oracle.test.ts'],
    notes:
      'Negotiation/query state is tracked in the reply engine and ignored by render-state parser paths.',
  },
  {
    id: 'unicode-wide-combining',
    levelId: 'l4-unicode-fidelity',
    feature: 'Wide glyph placement and combining mark attachment',
    sequences: ['double-width glyphs', 'combining code points'],
    status: 'implemented',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-snapshot-oracle.test.ts', 'test/terminal-gif-e2e.test.ts'],
    notes: 'Current width policy is deterministic and used by snapshot hash generation.',
  },
  {
    id: 'unicode-grapheme-clusters',
    levelId: 'l4-unicode-fidelity',
    feature: 'Extended grapheme cluster width behavior',
    sequences: ['ZWJ emoji sequences', 'variation selectors'],
    status: 'unsupported',
    priority: 'p1-important',
    ownerTests: [],
    notes: 'Needs explicit UAX #29 driven tests to avoid width regressions.',
  },
  {
    id: 'vttest-automation',
    levelId: 'l5-external-diff',
    feature: 'Automated vttest conformance suite integration',
    sequences: ['VT100/VT220/xterm selected cases'],
    status: 'unsupported',
    priority: 'p1-important',
    ownerTests: [],
    notes: 'Must be run in CI for the declared supported behavior subset.',
  },
  {
    id: 'differential-terminal-checkpoints',
    levelId: 'l5-external-diff',
    feature: 'Direct-terminal vs harness snapshot differential checks',
    sequences: ['Codex traces', 'Vim traces', 'fixture corpus replay'],
    status: 'unsupported',
    priority: 'p0-codex-vim',
    ownerTests: ['test/terminal-differential-checkpoints.test.ts'],
    notes:
      'Runner exists, but direct-terminal captured fixtures are not wired as a blocking parity corpus yet.',
  },
  {
    id: 'osc-title-cwd-hyperlink',
    levelId: 'l6-modern-extensions',
    feature: 'OSC title/cwd/hyperlink handling',
    sequences: ['OSC 0', 'OSC 1', 'OSC 2', 'OSC 7', 'OSC 8'],
    status: 'unsupported',
    priority: 'p1-important',
    ownerTests: [],
    notes: 'Useful for modern CLI UX; not required for base render-state correctness.',
  },
  {
    id: 'sync-output-mode',
    levelId: 'l6-modern-extensions',
    feature: 'Synchronized output mode',
    sequences: ['CSI ? 2026 h/l'],
    status: 'unsupported',
    priority: 'p2-optional',
    ownerTests: [],
    notes: 'Optional performance/stability enhancement for bursty render workloads.',
  },
  {
    id: 'graphics-protocols',
    levelId: 'l6-modern-extensions',
    feature: 'Inline graphics protocols',
    sequences: ['SIXEL', 'kitty graphics'],
    status: 'unsupported',
    priority: 'p2-optional',
    ownerTests: [],
    notes: 'Out of current scope; keep explicit as intentionally unsupported.',
  },
  {
    id: 'keyboard-encoding-ingress',
    levelId: 'l6-modern-extensions',
    feature: 'Kitty/modifyOtherKeys input decoding for client hotkeys',
    sequences: ['CSI ... u', 'CSI 27 ; ... ~'],
    status: 'implemented',
    priority: 'p1-important',
    ownerTests: ['test/mux-input-shortcuts.test.ts', 'test/task-screen-keybindings.test.ts'],
    notes:
      'Ingress decode parity is implemented for shortcuts; terminal-side negotiation is separate.',
  },
] as const;

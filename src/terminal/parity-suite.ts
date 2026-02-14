import { TerminalSnapshotOracle, type TerminalSnapshotFrame } from './snapshot-oracle.ts';

type ActiveScreen = TerminalSnapshotFrame['activeScreen'];
type SnapshotLine = TerminalSnapshotFrame['richLines'][number];
type SnapshotCell = SnapshotLine['cells'][number];
type SnapshotStyle = SnapshotCell['style'];
type SnapshotColor = SnapshotStyle['fg'];

type TerminalParityProfile = 'codex' | 'vim' | 'core';

type TerminalParityStep =
  | {
      kind: 'output';
      chunk: string;
    }
  | {
      kind: 'resize';
      cols: number;
      rows: number;
    };

interface TerminalParityColorExpectation {
  kind: SnapshotColor['kind'];
  index?: number;
  r?: number;
  g?: number;
  b?: number;
}

interface TerminalParityStyleExpectation {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  fg?: TerminalParityColorExpectation;
  bg?: TerminalParityColorExpectation;
}

interface TerminalParityLineExpectation {
  row: number;
  equals?: string;
  includes?: string;
  wrapped?: boolean;
}

interface TerminalParityCellExpectation {
  row: number;
  col: number;
  glyph?: string;
  width?: number;
  continued?: boolean;
  style?: TerminalParityStyleExpectation;
}

interface TerminalParityExpectations {
  activeScreen?: ActiveScreen;
  cursor?: {
    row?: number;
    col?: number;
    visible?: boolean;
  };
  viewport?: {
    followOutput?: boolean;
    topMin?: number;
    topMax?: number;
  };
  lines?: readonly TerminalParityLineExpectation[];
  cells?: readonly TerminalParityCellExpectation[];
}

export interface TerminalParityScene {
  id: string;
  profile: TerminalParityProfile;
  description: string;
  cols: number;
  rows: number;
  steps: readonly TerminalParityStep[];
  expectations: TerminalParityExpectations;
}

interface TerminalParitySceneResult {
  sceneId: string;
  profile: TerminalParityProfile;
  pass: boolean;
  failures: string[];
  frameHash: string;
  finalFrame: TerminalSnapshotFrame;
}

interface TerminalParityMatrixResult {
  pass: boolean;
  totalScenes: number;
  passedScenes: number;
  failedScenes: number;
  results: TerminalParitySceneResult[];
}

function colorMatches(actual: SnapshotColor, expected: TerminalParityColorExpectation): boolean {
  if (actual.kind !== expected.kind) {
    return false;
  }
  switch (actual.kind) {
    case 'default':
      return true;
    case 'indexed':
      return actual.index === expected.index;
    case 'rgb':
      return actual.r === expected.r && actual.g === expected.g && actual.b === expected.b;
  }
}

function styleMatches(actual: SnapshotStyle, expected: TerminalParityStyleExpectation): string[] {
  const failures: string[] = [];
  if (expected.bold !== undefined && actual.bold !== expected.bold) {
    failures.push('style.bold');
  }
  if (expected.dim !== undefined && actual.dim !== expected.dim) {
    failures.push('style.dim');
  }
  if (expected.italic !== undefined && actual.italic !== expected.italic) {
    failures.push('style.italic');
  }
  if (expected.underline !== undefined && actual.underline !== expected.underline) {
    failures.push('style.underline');
  }
  if (expected.inverse !== undefined && actual.inverse !== expected.inverse) {
    failures.push('style.inverse');
  }
  if (expected.fg !== undefined && !colorMatches(actual.fg, expected.fg)) {
    failures.push('style.fg');
  }
  if (expected.bg !== undefined && !colorMatches(actual.bg, expected.bg)) {
    failures.push('style.bg');
  }
  return failures;
}

export function runTerminalParityScene(scene: TerminalParityScene): TerminalParitySceneResult {
  const oracle = new TerminalSnapshotOracle(scene.cols, scene.rows);
  for (const step of scene.steps) {
    if (step.kind === 'output') {
      oracle.ingest(step.chunk);
      continue;
    }
    oracle.resize(step.cols, step.rows);
  }

  const finalFrame = oracle.snapshot();
  const failures: string[] = [];
  const expectations = scene.expectations;

  if (expectations.activeScreen !== undefined && finalFrame.activeScreen !== expectations.activeScreen) {
    failures.push('active-screen');
  }
  if (expectations.cursor?.row !== undefined && finalFrame.cursor.row !== expectations.cursor.row) {
    failures.push('cursor-row');
  }
  if (expectations.cursor?.col !== undefined && finalFrame.cursor.col !== expectations.cursor.col) {
    failures.push('cursor-col');
  }
  if (expectations.cursor?.visible !== undefined && finalFrame.cursor.visible !== expectations.cursor.visible) {
    failures.push('cursor-visible');
  }
  if (
    expectations.viewport?.followOutput !== undefined &&
    finalFrame.viewport.followOutput !== expectations.viewport.followOutput
  ) {
    failures.push('viewport-follow-output');
  }
  if (expectations.viewport?.topMin !== undefined && finalFrame.viewport.top < expectations.viewport.topMin) {
    failures.push('viewport-top-min');
  }
  if (expectations.viewport?.topMax !== undefined && finalFrame.viewport.top > expectations.viewport.topMax) {
    failures.push('viewport-top-max');
  }

  for (const expectedLine of expectations.lines ?? []) {
    const line = finalFrame.richLines[expectedLine.row];
    if (line === undefined) {
      failures.push(`line-${String(expectedLine.row)}-missing`);
      continue;
    }
    if (expectedLine.equals !== undefined && line.text !== expectedLine.equals) {
      failures.push(`line-${String(expectedLine.row)}-equals`);
    }
    if (expectedLine.includes !== undefined && !line.text.includes(expectedLine.includes)) {
      failures.push(`line-${String(expectedLine.row)}-includes`);
    }
    if (expectedLine.wrapped !== undefined && line.wrapped !== expectedLine.wrapped) {
      failures.push(`line-${String(expectedLine.row)}-wrapped`);
    }
  }

  for (const expectedCell of expectations.cells ?? []) {
    const line = finalFrame.richLines[expectedCell.row];
    const cell = line?.cells[expectedCell.col];
    if (cell === undefined) {
      failures.push(`cell-${String(expectedCell.row)}-${String(expectedCell.col)}-missing`);
      continue;
    }
    if (expectedCell.glyph !== undefined && cell.glyph !== expectedCell.glyph) {
      failures.push(`cell-${String(expectedCell.row)}-${String(expectedCell.col)}-glyph`);
    }
    if (expectedCell.width !== undefined && cell.width !== expectedCell.width) {
      failures.push(`cell-${String(expectedCell.row)}-${String(expectedCell.col)}-width`);
    }
    if (expectedCell.continued !== undefined && cell.continued !== expectedCell.continued) {
      failures.push(`cell-${String(expectedCell.row)}-${String(expectedCell.col)}-continued`);
    }
    if (expectedCell.style !== undefined) {
      for (const styleFailure of styleMatches(cell.style, expectedCell.style)) {
        failures.push(`cell-${String(expectedCell.row)}-${String(expectedCell.col)}-${styleFailure}`);
      }
    }
  }

  return {
    sceneId: scene.id,
    profile: scene.profile,
    pass: failures.length === 0,
    failures,
    frameHash: finalFrame.frameHash,
    finalFrame
  };
}

export function runTerminalParityMatrix(scenes: readonly TerminalParityScene[]): TerminalParityMatrixResult {
  const results = scenes.map((scene) => runTerminalParityScene(scene));
  const passedScenes = results.filter((result) => result.pass).length;
  return {
    pass: passedScenes === scenes.length,
    totalScenes: scenes.length,
    passedScenes,
    failedScenes: scenes.length - passedScenes,
    results
  };
}

export const TERMINAL_PARITY_SCENES: readonly TerminalParityScene[] = [
  {
    id: 'codex-pinned-footer-scroll-region',
    profile: 'codex',
    description: 'Footer/status rows remain pinned while output scrolls above.',
    cols: 40,
    rows: 8,
    steps: [
      { kind: 'output', chunk: '\u001b[1;6r' },
      { kind: 'output', chunk: '\u001b[7;1H> chat bar' },
      { kind: 'output', chunk: '\u001b[8;1H? status bar' },
      { kind: 'output', chunk: '\u001b[6;1Hline-1\nline-2\nline-3\nline-4\nline-5\nline-6' }
    ],
    expectations: {
      lines: [
        { row: 6, includes: '> chat bar' },
        { row: 7, includes: '? status bar' }
      ]
    }
  },
  {
    id: 'codex-footer-background-persistence',
    profile: 'codex',
    description: 'Footer prompt row keeps truecolor background while scroll region churns above.',
    cols: 36,
    rows: 8,
    steps: [
      { kind: 'output', chunk: '\u001b[1;6r' },
      { kind: 'output', chunk: '\u001b[7;1H\u001b[48;2;25;30;36m> prompt\u001b[0m' },
      { kind: 'output', chunk: '\u001b[8;1H\u001b[48;5;236mstatus\u001b[0m' },
      { kind: 'output', chunk: '\u001b[6;1Hline-1\nline-2\nline-3\nline-4\nline-5\nline-6' }
    ],
    expectations: {
      lines: [
        { row: 6, includes: '> prompt' },
        { row: 7, includes: 'status' }
      ],
      cells: [
        {
          row: 6,
          col: 0,
          glyph: '>',
          style: {
            bg: {
              kind: 'rgb',
              r: 25,
              g: 30,
              b: 36
            }
          }
        },
        {
          row: 7,
          col: 0,
          glyph: 's',
          style: {
            bg: {
              kind: 'indexed',
              index: 236
            }
          }
        }
      ]
    }
  },
  {
    id: 'codex-origin-and-background',
    profile: 'codex',
    description: 'Origin mode addresses relative to scroll region and true background color is retained.',
    cols: 20,
    rows: 6,
    steps: [
      { kind: 'output', chunk: '\u001b[2;5r' },
      { kind: 'output', chunk: '\u001b[?6h\u001b[1;1H' },
      { kind: 'output', chunk: '\u001b[48;2;10;20;30mX' },
      { kind: 'output', chunk: '\u001b[?6l\u001b[1;1HY' }
    ],
    expectations: {
      cells: [
        {
          row: 1,
          col: 0,
          glyph: 'X',
          style: {
            bg: {
              kind: 'rgb',
              r: 10,
              g: 20,
              b: 30
            }
          }
        },
        {
          row: 0,
          col: 0,
          glyph: 'Y'
        }
      ]
    }
  },
  {
    id: 'vim-scroll-reverse-index',
    profile: 'vim',
    description: 'Reverse index at top margin scrolls region down, preserving bottom status row.',
    cols: 24,
    rows: 6,
    steps: [
      { kind: 'output', chunk: '\u001b[1;5r' },
      { kind: 'output', chunk: 'a\nb\nc\nd\n' },
      { kind: 'output', chunk: '\u001b[6;1Hstatus' },
      { kind: 'output', chunk: '\u001b[1;1H\u001bMtop' }
    ],
    expectations: {
      lines: [
        { row: 0, includes: 'top' },
        { row: 5, includes: 'status' }
      ]
    }
  },
  {
    id: 'core-pending-wrap',
    profile: 'core',
    description: 'Glyph at right margin wraps only when next printable glyph arrives.',
    cols: 5,
    rows: 3,
    steps: [
      { kind: 'output', chunk: 'abcde' },
      { kind: 'output', chunk: '\u001b[31m' },
      { kind: 'output', chunk: 'f' }
    ],
    expectations: {
      lines: [
        { row: 0, equals: 'abcde' },
        { row: 1, equals: 'f' }
      ],
      cells: [
        {
          row: 1,
          col: 0,
          style: {
            fg: { kind: 'indexed', index: 1 }
          }
        }
      ]
    }
  },
  {
    id: 'core-wrap-tab-insert-delete-char',
    profile: 'core',
    description: 'Pending wrap, default tab stops, and insert/delete character semantics.',
    cols: 16,
    rows: 4,
    steps: [
      { kind: 'output', chunk: 'abcde' },
      { kind: 'output', chunk: '\u001b[31m' },
      { kind: 'output', chunk: 'Z' },
      { kind: 'output', chunk: '\r\tX' },
      { kind: 'output', chunk: '\u001b[2;1Habcdef' },
      { kind: 'output', chunk: '\u001b[2;3H\u001b[2@\u001b[1P' }
    ],
    expectations: {
      lines: [
        { row: 0, equals: 'abcdeZ  X' },
        { row: 1, includes: 'ab cdef' }
      ],
      cells: [
        {
          row: 0,
          col: 8,
          glyph: 'X'
        },
        {
          row: 1,
          col: 0,
          glyph: 'a'
        },
        {
          row: 1,
          col: 2,
          glyph: ' '
        }
      ]
    }
  }
];

import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  TERMINAL_PARITY_SCENES,
  runTerminalParityMatrix,
  runTerminalParityScene,
  type TerminalParityScene
} from '../src/terminal/parity-suite.ts';

void test('terminal parity scenes execute and matrix summarizes pass/fail', () => {
  const matrix = runTerminalParityMatrix(TERMINAL_PARITY_SCENES);
  assert.equal(matrix.pass, true);
  assert.equal(matrix.totalScenes, TERMINAL_PARITY_SCENES.length);
  assert.equal(matrix.failedScenes, 0);
  assert.equal(matrix.passedScenes, TERMINAL_PARITY_SCENES.length);
  assert.equal(matrix.results.every((result) => result.pass), true);
});

void test('terminal parity scene supports resize steps and viewport/cursor expectations', () => {
  const scene: TerminalParityScene = {
    id: 'core-resize-viewport',
    profile: 'core',
    description: 'resize and scrollback',
    cols: 4,
    rows: 2,
    steps: [
      { kind: 'output', chunk: '1\n2\n3\n' },
      { kind: 'resize', cols: 5, rows: 2 },
      { kind: 'output', chunk: '\u001b[?25l' }
    ],
    expectations: {
      activeScreen: 'primary',
      cursor: {
        visible: false
      },
      viewport: {
        followOutput: true,
        topMin: 1,
        topMax: 3
      },
      lines: [
        {
          row: 0,
          includes: '3'
        }
      ]
    }
  };

  const result = runTerminalParityScene(scene);
  assert.equal(result.pass, true);
  assert.equal(result.finalFrame.cols, 5);
});

void test('terminal parity scene surfaces failures across line/cell/style checks', () => {
  const failingScene: TerminalParityScene = {
    id: 'core-failing-checks',
    profile: 'core',
    description: 'intentional failures',
    cols: 3,
    rows: 2,
    steps: [{ kind: 'output', chunk: '\u001b[31;44mA' }],
    expectations: {
      activeScreen: 'alternate',
      cursor: {
        row: 1,
        col: 0,
        visible: false
      },
      viewport: {
        followOutput: false,
        topMin: 1,
        topMax: -1
      },
      lines: [
        { row: 0, equals: 'zzz' },
        { row: 0, includes: 'x' },
        { row: 0, wrapped: true },
        { row: 3, equals: '' }
      ],
      cells: [
        {
          row: 0,
          col: 0,
          glyph: 'B',
          width: 2,
          continued: true,
          style: {
            bold: true,
            dim: true,
            italic: true,
            underline: true,
            inverse: true,
            fg: { kind: 'default' },
            bg: { kind: 'rgb', r: 1, g: 2, b: 3 }
          }
        },
        {
          row: 0,
          col: 1,
          style: {
            fg: { kind: 'indexed', index: 1 },
            bg: { kind: 'indexed', index: 2 }
          }
        },
        {
          row: 5,
          col: 5,
          glyph: '?'
        }
      ]
    }
  };

  const failed = runTerminalParityScene(failingScene);
  assert.equal(failed.pass, false);
  assert.equal(failed.failures.includes('active-screen'), true);
  assert.equal(failed.failures.includes('cursor-col'), true);
  assert.equal(failed.failures.includes('cursor-visible'), true);
  assert.equal(failed.failures.includes('viewport-follow-output'), true);
  assert.equal(failed.failures.includes('viewport-top-min'), true);
  assert.equal(failed.failures.includes('viewport-top-max'), true);
  assert.equal(failed.failures.includes('line-0-equals'), true);
  assert.equal(failed.failures.includes('line-0-includes'), true);
  assert.equal(failed.failures.includes('line-0-wrapped'), true);
  assert.equal(failed.failures.includes('line-3-missing'), true);
  assert.equal(failed.failures.includes('cell-0-0-glyph'), true);
  assert.equal(failed.failures.includes('cell-0-0-width'), true);
  assert.equal(failed.failures.includes('cell-0-0-continued'), true);
  assert.equal(failed.failures.includes('cell-0-0-style.bold'), true);
  assert.equal(failed.failures.includes('cell-0-0-style.dim'), true);
  assert.equal(failed.failures.includes('cell-0-0-style.italic'), true);
  assert.equal(failed.failures.includes('cell-0-0-style.underline'), true);
  assert.equal(failed.failures.includes('cell-0-0-style.inverse'), true);
  assert.equal(failed.failures.includes('cell-0-0-style.fg'), true);
  assert.equal(failed.failures.includes('cell-0-0-style.bg'), true);
  assert.equal(failed.failures.includes('cell-0-1-style.fg'), true);
  assert.equal(failed.failures.includes('cell-0-1-style.bg'), true);
  assert.equal(failed.failures.includes('cell-5-5-missing'), true);
});

void test('terminal parity color expectations cover indexed and rgb matches', () => {
  const scene: TerminalParityScene = {
    id: 'core-color-matches',
    profile: 'core',
    description: 'indexed and rgb matching',
    cols: 4,
    rows: 2,
    steps: [{ kind: 'output', chunk: '\u001b[38;5;3;48;2;9;8;7mA' }],
    expectations: {
      cells: [
        {
          row: 0,
          col: 0,
          style: {
            fg: { kind: 'indexed', index: 3 },
            bg: { kind: 'rgb', r: 9, g: 8, b: 7 }
          }
        }
      ]
    }
  };

  const result = runTerminalParityScene(scene);
  assert.equal(result.pass, true);
});

void test('terminal parity color expectations support default color matches', () => {
  const scene: TerminalParityScene = {
    id: 'core-default-color-matches',
    profile: 'core',
    description: 'default color matching',
    cols: 4,
    rows: 2,
    steps: [{ kind: 'output', chunk: 'A' }],
    expectations: {
      cells: [
        {
          row: 0,
          col: 0,
          style: {
            fg: { kind: 'default' },
            bg: { kind: 'default' }
          }
        }
      ]
    }
  };

  const result = runTerminalParityScene(scene);
  assert.equal(result.pass, true);
});

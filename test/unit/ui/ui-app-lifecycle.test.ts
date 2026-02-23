import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import {
  setupTerminal,
  restoreTerminal,
  enterAlternateScreen,
  exitAlternateScreen,
  enableMouse,
  disableMouse,
  hideCursor,
  showCursor,
  clearScreen,
} from '../../../packages/harness-ui/src/app/lifecycle.ts';

function captureWrite(): { output: string[]; write: (data: string) => void } {
  const output: string[] = [];
  return {
    output,
    write: (data: string) => {
      output.push(data);
    },
  };
}

describe('lifecycle escape sequences', () => {
  test('enterAlternateScreen writes correct sequence', () => {
    const { output, write } = captureWrite();
    enterAlternateScreen(write);
    assert.equal(output.length, 1);
    assert.ok(output[0]!.includes('1049h'));
  });

  test('exitAlternateScreen writes correct sequence', () => {
    const { output, write } = captureWrite();
    exitAlternateScreen(write);
    assert.ok(output[0]!.includes('1049l'));
  });

  test('enableMouse writes mouse tracking sequences', () => {
    const { output, write } = captureWrite();
    enableMouse(write);
    assert.ok(output[0]!.includes('1000h'));
    assert.ok(output[0]!.includes('1006h'));
  });

  test('disableMouse writes disable sequences', () => {
    const { output, write } = captureWrite();
    disableMouse(write);
    assert.ok(output[0]!.includes('1000l'));
  });

  test('hideCursor writes hide sequence', () => {
    const { output, write } = captureWrite();
    hideCursor(write);
    assert.ok(output[0]!.includes('25l'));
  });

  test('showCursor writes show sequence', () => {
    const { output, write } = captureWrite();
    showCursor(write);
    assert.ok(output[0]!.includes('25h'));
  });

  test('clearScreen writes clear and home', () => {
    const { output, write } = captureWrite();
    clearScreen(write);
    assert.ok(output[0]!.includes('2J'));
  });
});

describe('setupTerminal', () => {
  test('sets alternateScreen and mouse', () => {
    const { output, write } = captureWrite();
    const mockStdin = { setRawMode: (_: boolean) => {} };
    const state = setupTerminal(write, mockStdin, { alternateScreen: true, mouse: true });
    assert.equal(state.alternateScreen, true);
    assert.equal(state.mouse, true);
    assert.equal(state.rawMode, true);
    assert.ok(output.some((o) => o.includes('1049h')));
    assert.ok(output.some((o) => o.includes('1000h')));
  });

  test('skips alternateScreen when false', () => {
    const { output, write } = captureWrite();
    const mockStdin = {};
    const state = setupTerminal(write, mockStdin, { alternateScreen: false, mouse: false });
    assert.equal(state.alternateScreen, false);
    assert.equal(state.rawMode, false);
    assert.ok(!output.some((o) => o.includes('1049h')));
  });
});

describe('restoreTerminal', () => {
  test('restores all state', () => {
    const { output, write } = captureWrite();
    let rawModeSet = true;
    const mockStdin = {
      setRawMode: (mode: boolean) => {
        rawModeSet = mode;
      },
    };
    restoreTerminal(write, mockStdin, { alternateScreen: true, mouse: true, rawMode: true });
    assert.equal(rawModeSet, false);
    assert.ok(output.some((o) => o.includes('1049l')));
    assert.ok(output.some((o) => o.includes('1000l')));
    assert.ok(output.some((o) => o.includes('25h')));
  });
});

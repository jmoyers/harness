import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import { Vte, replayTerminalSteps } from '../../../packages/harness-ui/src/vte/vte.ts';
import {
  renderSnapshotAnsiRow,
  diffTerminalFrames,
} from '../../../packages/harness-ui/src/vte/render.ts';
import { applySgrParams } from '../../../packages/harness-ui/src/vte/sgr.ts';
import { defaultCellStyle } from '../../../packages/harness-ui/src/vte/types.ts';

function textLines(vte: Vte): string[] {
  const snap = vte.snapshot();
  return snap.lines;
}

function cursorPos(vte: Vte): { row: number; col: number } {
  const snap = vte.snapshot();
  return { row: snap.cursor.row, col: snap.cursor.col };
}

describe('Vte basic output', () => {
  test('plain text renders to first line', () => {
    const vte = new Vte(20, 5);
    vte.ingest('hello');
    assert.equal(textLines(vte)[0], 'hello');
  });

  test('newline advances to next row', () => {
    const vte = new Vte(20, 5);
    vte.ingest('line1\r\nline2');
    assert.equal(textLines(vte)[0], 'line1');
    assert.equal(textLines(vte)[1], 'line2');
  });

  test('carriage return resets column', () => {
    const vte = new Vte(20, 5);
    vte.ingest('abc\rxy');
    assert.equal(textLines(vte)[0], 'xyc');
  });

  test('cursor position after text', () => {
    const vte = new Vte(20, 5);
    vte.ingest('abc');
    assert.deepEqual(cursorPos(vte), { row: 0, col: 3 });
  });

  test('tab advances to next tab stop', () => {
    const vte = new Vte(20, 5);
    vte.ingest('a\tb');
    const pos = cursorPos(vte);
    assert.ok(pos.col > 1);
  });

  test('backspace moves cursor left', () => {
    const vte = new Vte(20, 5);
    vte.ingest('abc\b');
    assert.deepEqual(cursorPos(vte), { row: 0, col: 2 });
  });
});

describe('Vte cursor movement (CSI)', () => {
  test('CUP sets cursor position', () => {
    const vte = new Vte(20, 10);
    vte.ingest('\x1b[3;5H');
    assert.deepEqual(cursorPos(vte), { row: 2, col: 4 });
  });

  test('CUU moves cursor up', () => {
    const vte = new Vte(20, 10);
    vte.ingest('\x1b[5;1H\x1b[2A');
    assert.deepEqual(cursorPos(vte), { row: 2, col: 0 });
  });

  test('CUD moves cursor down', () => {
    const vte = new Vte(20, 10);
    vte.ingest('\x1b[1;1H\x1b[3B');
    assert.deepEqual(cursorPos(vte), { row: 3, col: 0 });
  });

  test('CUF moves cursor right', () => {
    const vte = new Vte(20, 10);
    vte.ingest('\x1b[1;1H\x1b[5C');
    assert.deepEqual(cursorPos(vte), { row: 0, col: 5 });
  });

  test('CUB moves cursor left', () => {
    const vte = new Vte(20, 10);
    vte.ingest('\x1b[1;10H\x1b[3D');
    assert.deepEqual(cursorPos(vte), { row: 0, col: 6 });
  });
});

describe('Vte clear screen (CSI J)', () => {
  test('clear screen below cursor', () => {
    const vte = new Vte(10, 3);
    vte.ingest('aaa\nbbb\nccc');
    vte.ingest('\x1b[2;1H\x1b[J');
    assert.equal(textLines(vte)[0], 'aaa');
    assert.equal(textLines(vte)[1], '');
    assert.equal(textLines(vte)[2], '');
  });

  test('clear entire screen', () => {
    const vte = new Vte(10, 3);
    vte.ingest('aaa\nbbb\nccc');
    vte.ingest('\x1b[2J');
    for (const line of textLines(vte)) assert.equal(line, '');
  });
});

describe('Vte clear line (CSI K)', () => {
  test('clear to end of line', () => {
    const vte = new Vte(10, 3);
    vte.ingest('abcdefgh');
    vte.ingest('\x1b[1;4H\x1b[K');
    assert.equal(textLines(vte)[0], 'abc');
  });

  test('clear entire line', () => {
    const vte = new Vte(10, 3);
    vte.ingest('abcdefgh');
    vte.ingest('\x1b[2K');
    assert.equal(textLines(vte)[0], '');
  });
});

describe('Vte SGR styling', () => {
  test('bold via SGR', () => {
    const vte = new Vte(10, 3);
    vte.ingest('\x1b[1mhello\x1b[0m');
    const snap = vte.snapshot();
    assert.equal(snap.richLines[0]!.cells[0]!.style.bold, true);
  });

  test('fg color via SGR', () => {
    const vte = new Vte(10, 3);
    vte.ingest('\x1b[31mred\x1b[0m');
    const snap = vte.snapshot();
    assert.equal(snap.richLines[0]!.cells[0]!.style.fg.kind, 'indexed');
  });

  test('rgb fg via SGR', () => {
    const vte = new Vte(20, 3);
    vte.ingest('\x1b[38;2;255;128;0mtest\x1b[0m');
    const snap = vte.snapshot();
    const fg = snap.richLines[0]!.cells[0]!.style.fg;
    assert.equal(fg.kind, 'rgb');
    if (fg.kind === 'rgb') {
      assert.equal(fg.r, 255);
      assert.equal(fg.g, 128);
      assert.equal(fg.b, 0);
    }
  });

  test('reset SGR', () => {
    const vte = new Vte(10, 3);
    vte.ingest('\x1b[1m\x1b[0mnormal');
    const snap = vte.snapshot();
    assert.equal(snap.richLines[0]!.cells[0]!.style.bold, false);
  });
});

describe('Vte DEC modes', () => {
  test('cursor visibility', () => {
    const vte = new Vte(10, 3);
    assert.equal(vte.snapshot().cursor.visible, true);
    vte.ingest('\x1b[?25l');
    assert.equal(vte.snapshot().cursor.visible, false);
    vte.ingest('\x1b[?25h');
    assert.equal(vte.snapshot().cursor.visible, true);
  });

  test('alternate screen', () => {
    const vte = new Vte(10, 3);
    vte.ingest('primary');
    assert.equal(vte.snapshot().activeScreen, 'primary');
    vte.ingest('\x1b[?1049h');
    assert.equal(vte.snapshot().activeScreen, 'alternate');
    assert.equal(textLines(vte)[0], '');
    vte.ingest('\x1b[?1049l');
    assert.equal(vte.snapshot().activeScreen, 'primary');
    assert.equal(textLines(vte)[0], 'primary');
  });

  test('bracketed paste mode', () => {
    const vte = new Vte(10, 3);
    assert.equal(vte.snapshot().modes.bracketedPaste, false);
    vte.ingest('\x1b[?2004h');
    assert.equal(vte.snapshot().modes.bracketedPaste, true);
  });

  test('mouse tracking', () => {
    const vte = new Vte(10, 3);
    assert.equal(vte.isMouseTrackingEnabled(), false);
    vte.ingest('\x1b[?1000h');
    assert.equal(vte.isMouseTrackingEnabled(), true);
    vte.ingest('\x1b[?1000l');
    assert.equal(vte.isMouseTrackingEnabled(), false);
  });
});

describe('Vte cursor style', () => {
  test('bar cursor', () => {
    const vte = new Vte(10, 3);
    vte.ingest('\x1b[6 q');
    assert.equal(vte.snapshot().cursor.style.shape, 'bar');
    assert.equal(vte.snapshot().cursor.style.blinking, false);
  });

  test('underline blinking cursor', () => {
    const vte = new Vte(10, 3);
    vte.ingest('\x1b[3 q');
    assert.equal(vte.snapshot().cursor.style.shape, 'underline');
    assert.equal(vte.snapshot().cursor.style.blinking, true);
  });
});

describe('Vte scroll regions', () => {
  test('set scroll region and scroll up', () => {
    const vte = new Vte(10, 5);
    vte.ingest('a\r\nb\r\nc\r\nd\r\ne');
    vte.ingest('\x1b[2;4r');
    vte.ingest('\x1b[2;1H');
    vte.ingest('\r\n\r\n\r\n');
    const lines = textLines(vte);
    assert.equal(lines[0], 'a');
    assert.equal(lines[4], 'e');
  });
});

describe('Vte resize', () => {
  test('resize preserves existing content', () => {
    const vte = new Vte(10, 3);
    vte.ingest('hello');
    vte.resize(20, 5);
    assert.equal(textLines(vte)[0], 'hello');
  });

  test('resize clamps cursor', () => {
    const vte = new Vte(20, 10);
    vte.ingest('\x1b[10;20H');
    vte.resize(5, 3);
    const pos = cursorPos(vte);
    assert.ok(pos.row < 3);
    assert.ok(pos.col < 5);
  });
});

describe('Vte wide characters', () => {
  test('CJK character occupies two cells', () => {
    const vte = new Vte(10, 3);
    vte.ingest('你好');
    const snap = vte.snapshot();
    assert.equal(snap.richLines[0]!.cells[0]!.glyph, '你');
    assert.equal(snap.richLines[0]!.cells[0]!.width, 2);
    assert.equal(snap.richLines[0]!.cells[1]!.continued, true);
    assert.equal(snap.richLines[0]!.cells[2]!.glyph, '好');
  });
});

describe('Vte ESC sequences', () => {
  test('save/restore cursor', () => {
    const vte = new Vte(20, 10);
    vte.ingest('\x1b[5;10H\x1b7\x1b[1;1H\x1b8');
    assert.deepEqual(cursorPos(vte), { row: 4, col: 9 });
  });

  test('hard reset', () => {
    const vte = new Vte(10, 3);
    vte.ingest('\x1b[1mhello\x1bc');
    const snap = vte.snapshot();
    assert.equal(snap.richLines[0]!.cells[0]!.style.bold, false);
    assert.equal(snap.activeScreen, 'primary');
  });
});

describe('renderSnapshotAnsiRow', () => {
  test('produces ANSI string with reset', () => {
    const vte = new Vte(10, 3);
    vte.ingest('hello');
    const row = renderSnapshotAnsiRow(vte.snapshot(), 0, 10);
    assert.ok(row.endsWith('\x1b[0m'));
    assert.ok(row.includes('hello'));
  });
});

describe('diffTerminalFrames', () => {
  test('identical frames are equal', () => {
    const vte = new Vte(10, 3);
    vte.ingest('test');
    const a = vte.snapshot();
    const b = vte.snapshot();
    const diff = diffTerminalFrames(a, b);
    assert.equal(diff.equal, true);
    assert.equal(diff.reasons.length, 0);
  });

  test('different content is not equal', () => {
    const vte = new Vte(10, 3);
    vte.ingest('aaa');
    const a = vte.snapshot();
    vte.ingest('\x1b[2Jbbb');
    const b = vte.snapshot();
    const diff = diffTerminalFrames(a, b);
    assert.equal(diff.equal, false);
    assert.ok(diff.reasons.length > 0);
  });
});

describe('replayTerminalSteps', () => {
  test('replays output steps', () => {
    const snaps = replayTerminalSteps(
      [
        { kind: 'output', chunk: 'hello' },
        { kind: 'output', chunk: ' world' },
      ],
      20,
      5,
    );
    assert.equal(snaps.length, 2);
    assert.equal(snaps[0]!.lines[0], 'hello');
    assert.equal(snaps[1]!.lines[0], 'hello world');
  });

  test('replays resize steps', () => {
    const snaps = replayTerminalSteps(
      [
        { kind: 'output', chunk: 'test' },
        { kind: 'resize', cols: 5, rows: 3 },
      ],
      20,
      5,
    );
    assert.equal(snaps.length, 2);
    assert.equal(snaps[1]!.cols, 5);
    assert.equal(snaps[1]!.rows, 3);
  });
});

describe('applySgrParams', () => {
  test('reset to default', () => {
    const s = applySgrParams({ ...defaultCellStyle(), bold: true }, [0], new Map());
    assert.equal(s.bold, false);
  });

  test('indexed 256 color', () => {
    const s = applySgrParams(defaultCellStyle(), [38, 5, 196], new Map());
    assert.equal(s.fg.kind, 'indexed');
    if (s.fg.kind === 'indexed') assert.equal(s.fg.index, 196);
  });
});

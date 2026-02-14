import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TerminalSnapshotOracle,
  diffTerminalFrames,
  measureDisplayWidth,
  renderSnapshotAnsiRow,
  renderSnapshotText,
  replayTerminalSteps,
  wrapTextForColumns,
  type TerminalSnapshotFrame
} from '../src/terminal/snapshot-oracle.ts';

void test('snapshot oracle captures SGR styles and renders ANSI rows', () => {
  const oracle = new TerminalSnapshotOracle(12, 3);
  oracle.ingest('\u001b[31;44mA');
  oracle.ingest('\u001b[38;5;202;48;2;1;2;3mB');
  oracle.ingest('\u001b[1;2;3;4;7mC');
  oracle.ingest('\u001b[21;23;24;27mD');
  oracle.ingest('\u001b[39;49mE');
  oracle.ingest('\u001b[90;100mF');
  oracle.ingest('\u001b[0mG');
  oracle.ingest('\u001b[mH');
  oracle.ingest('\u001b[59mI');
  oracle.ingest('\u001b[38;5mJ');
  oracle.ingest('\u001b[48;2;1;2mK');

  const frame = oracle.snapshot();
  assert.equal(frame.lines[0], 'ABCDEFGHIJK');

  const first = frame.richLines[0]!.cells[0]!;
  assert.deepEqual(first.style.fg, { kind: 'indexed', index: 1 });
  assert.deepEqual(first.style.bg, { kind: 'indexed', index: 4 });

  const second = frame.richLines[0]!.cells[1]!;
  assert.deepEqual(second.style.fg, { kind: 'indexed', index: 202 });
  assert.deepEqual(second.style.bg, { kind: 'rgb', r: 1, g: 2, b: 3 });

  const third = frame.richLines[0]!.cells[2]!;
  assert.equal(third.style.bold, true);
  assert.equal(third.style.dim, true);
  assert.equal(third.style.italic, true);
  assert.equal(third.style.underline, true);
  assert.equal(third.style.inverse, true);

  const sixth = frame.richLines[0]!.cells[5]!;
  assert.deepEqual(sixth.style.fg, { kind: 'indexed', index: 8 });
  assert.deepEqual(sixth.style.bg, { kind: 'indexed', index: 8 });

  const ansi = renderSnapshotAnsiRow(frame, 0, frame.cols);
  assert.equal(ansi.includes('\u001b[0;31;44m'), true);
  assert.equal(ansi.includes('\u001b[0;38;5;202;48;2;1;2;3m'), true);
  assert.equal(ansi.endsWith('\u001b[0m'), true);

  const blankAnsi = renderSnapshotAnsiRow(frame, 9, 5);
  assert.equal(blankAnsi.includes('     '), true);
  assert.equal(blankAnsi.endsWith('\u001b[0m'), true);
});

void test('snapshot row renderer handles wide glyph continuation cells', () => {
  const oracle = new TerminalSnapshotOracle(4, 1);
  oracle.ingest('界a');
  const frame = oracle.snapshot();
  const ansi = renderSnapshotAnsiRow(frame, 0, 4);
  assert.equal(ansi.includes('界'), true);
  assert.equal(ansi.includes('a'), true);
});

void test('snapshot trimming handles trailing continuation cells', () => {
  const oracle = new TerminalSnapshotOracle(2, 2);
  oracle.ingest('界');
  const frame = oracle.snapshot();
  assert.equal(frame.lines[0], '界');
});

void test('wide glyph at final column advances line before paint', () => {
  const oracle = new TerminalSnapshotOracle(3, 2);
  oracle.ingest('ab');
  oracle.ingest('界');
  const frame = oracle.snapshot();
  assert.equal(frame.lines[0], 'ab');
  assert.equal((frame.lines[1] ?? '').startsWith('界'), true);
});

void test('snapshot oracle handles terminal controls, alternate screen, and viewport state', () => {
  const oracle = new TerminalSnapshotOracle(6, 3, 16);

  oracle.resize(0, 3);
  oracle.resize(6, 0);

  oracle.ingest('ab');
  oracle.ingest('\u0301');
  oracle.ingest('\rZ');
  oracle.ingest('\n12');
  oracle.ingest('\b3');
  oracle.ingest('\u0001');
  oracle.ingest('\u007f');

  oracle.ingest('\u001b[s');
  oracle.ingest('\u001b[1;6H');
  oracle.ingest('X');
  oracle.ingest('\u001b[u');
  oracle.ingest('\u001b[2A');
  oracle.ingest('\u001b[2B');
  oracle.ingest('\u001b[2C');
  oracle.ingest('\u001b[1D');
  oracle.ingest('\u001b[4G');
  oracle.ingest('\u001b[f');
  oracle.ingest('\u001b[2;2f');
  oracle.ingest('!');
  oracle.ingest('\u001b[1S');
  oracle.ingest('\u001b[1T');

  oracle.ingest('\u001b[31m');
  oracle.ingest('\u001b[2J');
  oracle.ingest('p');
  oracle.ingest('\u001b[1J');
  oracle.ingest('q');
  oracle.ingest('\u001b[J');
  oracle.ingest('r');
  oracle.ingest('\u001b[2K');
  oracle.ingest('\u001b[1K');
  oracle.ingest('\u001b[K');

  oracle.ingest('\u001b]2;title\u0007');
  oracle.ingest('\u001b]10;?\u001b\\');
  oracle.ingest('\u001b]11;?\u001bx');
  oracle.ingest('\u001b\\');

  oracle.ingest('A');
  oracle.ingest('\u001b[1;2H');
  oracle.ingest('界');
  oracle.ingest('\u001b[1;3H');
  oracle.ingest('X');

  oracle.ingest('\u001b7');
  oracle.ingest('\u001b8');
  oracle.ingest('\u001b[?25l');
  oracle.ingest('\u001b[?;25h');
  oracle.ingest('\u001b[?1049h');
  oracle.ingest('alt');
  oracle.ingest('\u001b[?1048h');
  oracle.ingest('\u001b[3;3H');
  oracle.ingest('\u001b[?1048l');
  oracle.ingest('\u001b[?1049l');
  oracle.ingest('\u001b[?1047h');
  oracle.ingest('z');
  oracle.ingest('\u001b[?1047l');

  oracle.ingest('1\n2\n3\n4\n5\n');
  const followFrame = oracle.snapshot();
  assert.equal(followFrame.viewport.followOutput, true);
  assert.equal(followFrame.viewport.top > 0, true);

  oracle.scrollViewport(0);
  oracle.scrollViewport(-1);
  const scrolledFrame = oracle.snapshot();
  assert.equal(scrolledFrame.viewport.followOutput, false);
  oracle.scrollViewport(1);
  const repinnedByScroll = oracle.snapshot();
  assert.equal(repinnedByScroll.viewport.followOutput, true);

  oracle.setFollowOutput(true);
  const repinned = oracle.snapshot();
  assert.equal(repinned.viewport.followOutput, true);
  assert.equal(repinned.viewport.top >= scrolledFrame.viewport.top, true);

  assert.equal(repinned.activeScreen, 'primary');
  assert.equal(typeof renderSnapshotText(repinned), 'string');
  assert.equal(repinned.frameHash.length, 64);
});

void test('text width and wrapping helpers support unicode and edge widths', () => {
  assert.equal(measureDisplayWidth('abc'), 3);
  assert.equal(measureDisplayWidth('a\u0301'), 1);
  assert.equal(measureDisplayWidth('界'), 2);

  assert.deepEqual(wrapTextForColumns('abcdef', 3), ['abc', 'def']);
  assert.deepEqual(wrapTextForColumns('ab\ncd', 2), ['ab', 'cd']);
  assert.deepEqual(wrapTextForColumns('x', 0), ['']);
});

void test('replay and frame diff provide deterministic conformance artifacts', () => {
  const frames = replayTerminalSteps(
    [
      { kind: 'output', chunk: 'abc' },
      { kind: 'resize', cols: 5, rows: 2 },
      { kind: 'output', chunk: '\u001b[31mR' },
      { kind: 'resize' },
      { kind: 'output' }
    ],
    4,
    2
  );

  assert.equal(frames.length, 5);
  const last = frames[frames.length - 1]!;
  assert.equal(last.cols, 4);
  assert.equal(last.rows, 2);

  const equal = diffTerminalFrames(last, last);
  assert.deepEqual(equal, { equal: true, reasons: [] });

  const changed: TerminalSnapshotFrame = {
    ...last,
    cols: last.cols + 1,
    activeScreen: 'alternate',
    cursor: {
      ...last.cursor,
      col: last.cursor.col + 1,
      visible: !last.cursor.visible,
      style: {
        shape: last.cursor.style.shape === 'block' ? 'underline' : 'block',
        blinking: !last.cursor.style.blinking
      }
    },
    richLines: last.richLines.slice(0, 1),
    lines: last.lines.slice(0, 1)
  };

  const diff = diffTerminalFrames(last, changed);
  assert.equal(diff.equal, false);
  assert.equal(diff.reasons.includes('dimensions-mismatch'), true);
  assert.equal(diff.reasons.includes('active-screen-mismatch'), true);
  assert.equal(diff.reasons.includes('cursor-position-mismatch'), true);
  assert.equal(diff.reasons.includes('cursor-visibility-mismatch'), true);
  assert.equal(diff.reasons.includes('cursor-style-mismatch'), true);
  assert.equal(diff.reasons.some((reason) => reason.includes('-missing')), true);

  const changedText: TerminalSnapshotFrame = {
    ...last,
    richLines: last.richLines.map((line, lineIdx) => {
      if (lineIdx !== 0) {
        return line;
      }
      return {
        ...line,
        text: `${line.text}-x`,
        cells: line.cells.map((cell, cellIdx) => {
          if (cellIdx !== 0) {
            return cell;
          }
          return {
            ...cell,
            glyph: cell.glyph === ' ' ? 'z' : ' ',
            style: {
              ...cell.style,
              bold: !cell.style.bold
            }
          };
        })
      };
    })
  };
  const diffText = diffTerminalFrames(last, changedText);
  assert.equal(diffText.reasons.some((reason) => reason.includes('text-mismatch')), true);
  assert.equal(diffText.reasons.some((reason) => reason.includes('cell-0-0-mismatch')), true);
});

void test('snapshot oracle branch coverage on edge cases', () => {
  const oracle = new TerminalSnapshotOracle(3, 2, 1);
  oracle.setFollowOutput(false);
  oracle.ingest('\u0301');
  oracle.ingest(Buffer.from('b', 'utf8'));
  oracle.ingest('\u001bX');
  oracle.ingest('\u001b[48;5;100m');
  oracle.ingest('\u001b[38;2;9;8;7m');
  oracle.ingest('ab');
  oracle.ingest('界');
  oracle.ingest('\u001b[3J');
  oracle.ingest('1\n2\n3\n4\n');
  oracle.ingest('\u001b[1;1H');
  oracle.ingest('界');
  oracle.ingest('\u001b[3G');
  oracle.ingest('\u0301');
  oracle.ingest('\n');
  oracle.ingest('\u001b[1J');

  const frame = oracle.snapshot();
  const equal = diffTerminalFrames(frame, frame);
  assert.equal(equal.equal, true);
  assert.equal(measureDisplayWidth('\u0001'), 0);

  const mutatedContinued: TerminalSnapshotFrame = {
    ...frame,
    richLines: frame.richLines.map((line, idx) => {
      if (idx !== 0) {
        return line;
      }
      return {
        ...line,
        cells: line.cells.map((cell, col) => {
          if (col !== 1) {
            return cell;
          }
          return {
            ...cell,
            continued: true,
            width: 0,
            glyph: ''
          };
        })
      };
    })
  };
  const rendered = renderSnapshotAnsiRow(mutatedContinued, 0, mutatedContinued.cols);
  assert.equal(rendered.endsWith('\u001b[0m'), true);

  const changedCells: TerminalSnapshotFrame = {
    ...frame,
    richLines: frame.richLines.map((line, idx) => {
      if (idx !== 0) {
        return line;
      }
      return {
        ...line,
        cells: line.cells.slice(0, Math.max(0, line.cells.length - 1))
      };
    })
  };
  const diff = diffTerminalFrames(frame, changedCells);
  assert.equal(diff.reasons.some((reason) => reason.includes('-missing')), true);
});

void test('snapshot oracle supports scroll regions, origin mode, and insert/delete line controls', () => {
  const oracle = new TerminalSnapshotOracle(16, 8, 4);

  oracle.ingest('\u001b[1;6r');
  oracle.ingest('\u001b[7;1H> chat');
  oracle.ingest('\u001b[8;1H? status');
  oracle.ingest('\u001b[6;1Hone\ntwo\nthree\nfour\nfive\nsix');

  let frame = oracle.snapshot();
  assert.equal(frame.lines[6]!.includes('> chat'), true);
  assert.equal(frame.lines[7]!.includes('? status'), true);

  oracle.ingest('\u001b[2;5r');
  oracle.ingest('\u001b[?6h');
  oracle.ingest('\u001b[1;1H');
  oracle.ingest('\u001b[48;2;1;2;3mX');
  oracle.ingest('\u001b[?6l');
  oracle.ingest('\u001b[1;1HY');
  frame = oracle.snapshot();
  assert.equal(frame.richLines[1]!.cells[0]!.glyph, 'X');
  assert.deepEqual(frame.richLines[1]!.cells[0]!.style.bg, { kind: 'rgb', r: 1, g: 2, b: 3 });
  assert.equal(frame.richLines[0]!.cells[0]!.glyph, 'Y');

  oracle.ingest('\u001b[3;1Halpha');
  oracle.ingest('\u001b[3;1H\u001b[1L');
  frame = oracle.snapshot();
  assert.equal(frame.lines[2]!.trim(), '');
  oracle.ingest('\u001b[3;1H\u001b[1M');
  frame = oracle.snapshot();
  assert.equal(frame.lines[2]!.includes('alpha'), true);

  oracle.ingest('\u001b[6;2r');
  oracle.ingest('\u001b[2;1H\u001bD');
  oracle.ingest('\u001bE');
  oracle.ingest('\u001bM');
  oracle.ingest('\u001b[4;4r');
  oracle.resize(16, 3);
  frame = oracle.snapshot();
  assert.equal(frame.rows, 3);
});

void test('snapshot oracle retains scrollback when top-anchored scroll region is active', () => {
  const oracle = new TerminalSnapshotOracle(16, 6);
  oracle.ingest('\u001b[1;4r');
  oracle.ingest('\u001b[5;1H> chat');
  oracle.ingest('\u001b[6;1H? status');
  oracle.ingest('\u001b[4;1Hline-1\nline-2\nline-3\nline-4\nline-5\nline-6\nline-7');

  const followFrame = oracle.snapshot();
  assert.equal(followFrame.viewport.totalRows > 6, true);
  const followTop = followFrame.viewport.top;

  oracle.scrollViewport(-2);
  const scrolledFrame = oracle.snapshot();
  assert.equal(scrolledFrame.viewport.followOutput, false);
  assert.equal(scrolledFrame.viewport.top < followTop, true);
});

void test('snapshot oracle covers control-flow guards for scroll region operations', () => {
  const singleRow = new TerminalSnapshotOracle(5, 1);
  singleRow.ingest('\n');
  singleRow.ingest('\u001bM');
  const singleRowFrame = singleRow.snapshot();
  assert.equal(singleRowFrame.rows, 1);

  const multiRow = new TerminalSnapshotOracle(5, 3);
  multiRow.ingest('\n');
  multiRow.ingest('\u001bM');
  const multiRowFrame = multiRow.snapshot();
  assert.equal(multiRowFrame.cursor.row, 0);

  const oracle = new TerminalSnapshotOracle(10, 4, 2);
  oracle.ingest('A');
  oracle.ingest('\u001bD');
  oracle.ingest('B');
  oracle.ingest('\u001bE');
  oracle.ingest('C');
  oracle.ingest('\u001b[2;3r');
  oracle.ingest('\u001b[r');
  oracle.ingest('\u001b[2r');
  oracle.ingest('\u001b[1;1H\u001b[1L');
  oracle.ingest('\u001b[1;1H\u001b[1M');
  oracle.ingest('\u001b[2;1Hrow2');
  oracle.ingest('\u001b[2;1H\u001b[1M');
  oracle.ingest('\u001b[3;3r');
  oracle.resize(10, 2);
  const frame = oracle.snapshot();
  assert.equal(frame.rows, 2);
  assert.equal(frame.lines[0]!.includes('A'), true);
});

void test('snapshot oracle tolerates restore sequences without prior saved cursor state', () => {
  const oracle = new TerminalSnapshotOracle(6, 3);
  oracle.ingest('\u001b[?1048l');
  oracle.ingest('\u001b[u');
  oracle.ingest('\u001b[?1049l');
  const frame = oracle.snapshot();
  assert.equal(frame.activeScreen, 'primary');
  assert.equal(frame.cursor.row, 0);
});

void test('snapshot oracle applies pending-wrap semantics before next printable glyph', () => {
  const oracle = new TerminalSnapshotOracle(5, 3);
  oracle.ingest('abcde');
  let frame = oracle.snapshot();
  assert.equal(frame.lines[0], 'abcde');
  assert.equal(frame.cursor.row, 0);
  assert.equal(frame.cursor.col, 4);

  oracle.ingest('f');
  frame = oracle.snapshot();
  assert.equal(frame.lines[0], 'abcde');
  assert.equal(frame.lines[1], 'f');
  assert.equal(frame.cursor.row, 1);
  assert.equal(frame.cursor.col, 1);

  const styledWrap = new TerminalSnapshotOracle(5, 3);
  styledWrap.ingest('abcde');
  styledWrap.ingest('\u001b[31m');
  styledWrap.ingest('Z');
  const styledFrame = styledWrap.snapshot();
  assert.equal(styledFrame.lines[0], 'abcde');
  assert.equal(styledFrame.lines[1], 'Z');
  assert.deepEqual(styledFrame.richLines[1]!.cells[0]!.style.fg, { kind: 'indexed', index: 1 });
});

void test('snapshot oracle supports tab stops and tab clear operations', () => {
  const oracle = new TerminalSnapshotOracle(16, 3);
  oracle.ingest('a\tb');
  let frame = oracle.snapshot();
  assert.equal(frame.lines[0], 'a       b');

  oracle.ingest('\rxy\u001bH\r\tq');
  frame = oracle.snapshot();
  assert.equal(frame.lines[0]!.startsWith('xyq'), true);

  oracle.ingest('\r\u001b[0g\tm');
  frame = oracle.snapshot();
  assert.equal(frame.lines[0]!.startsWith('xym'), true);

  oracle.ingest('\r\u001b[1g\tn');
  frame = oracle.snapshot();
  assert.equal(frame.lines[0]!.startsWith('xyn'), true);

  oracle.ingest('\r\u001b[3g\tz');
  frame = oracle.snapshot();
  assert.equal(frame.lines[0]!.endsWith('z'), true);
  assert.equal(frame.cursor.col, 15);
});

void test('snapshot oracle supports insert/delete character control sequences', () => {
  const oracle = new TerminalSnapshotOracle(8, 2);
  oracle.ingest('abcdef');
  oracle.ingest('\u001b[1;3H');
  oracle.ingest('\u001b[2@');
  let frame = oracle.snapshot();
  assert.equal(frame.lines[0], 'ab  cdef');

  oracle.ingest('\u001b[1P');
  frame = oracle.snapshot();
  assert.equal(frame.lines[0], 'ab cdef');
});

void test('snapshot oracle applies cursor style controls and resets on RIS', () => {
  const oracle = new TerminalSnapshotOracle(8, 2);
  let frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'block', blinking: true });
  assert.equal(frame.cursor.visible, true);

  oracle.ingest('\u001b[ q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'block', blinking: true });

  oracle.ingest('\u001b[1 q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'block', blinking: true });

  oracle.ingest('\u001b[2 q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'block', blinking: false });

  oracle.ingest('\u001b[3 q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'underline', blinking: true });

  oracle.ingest('\u001b[4 q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'underline', blinking: false });

  oracle.ingest('\u001b[5 q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'bar', blinking: true });

  oracle.ingest('\u001b[6 q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'bar', blinking: false });

  oracle.ingest('\u001b[99 q');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'bar', blinking: false });

  oracle.ingest('\u001b[?25l');
  oracle.ingest('abc');
  oracle.ingest('\u001bc');
  frame = oracle.snapshot();
  assert.deepEqual(frame.cursor.style, { shape: 'block', blinking: true });
  assert.equal(frame.cursor.visible, true);
  assert.equal(frame.activeScreen, 'primary');
  assert.equal(frame.lines[0], '');
});

void test('snapshot oracle clears pending-wrap state when resized off right margin', () => {
  const oracle = new TerminalSnapshotOracle(5, 2);
  oracle.ingest('abcde');
  let frame = oracle.snapshot();
  assert.equal(frame.cursor.col, 4);

  oracle.resize(9, 2);
  oracle.ingest('x');
  frame = oracle.snapshot();
  assert.equal(frame.lines[0]!.startsWith('abcdx'), true);
});

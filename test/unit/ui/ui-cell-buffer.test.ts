import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import { CellBuffer } from '../../../packages/harness-ui/src/core/cell-buffer.ts';
import {
  DEFAULT_CELL_STYLE,
  rgbColor,
  type CellStyle,
} from '../../../packages/harness-ui/src/core/color.ts';

const RED_STYLE: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };
const BLUE_STYLE: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(0, 0, 255) };
const BOLD_STYLE: CellStyle = { ...DEFAULT_CELL_STYLE, bold: true };

function glyphRow(buf: CellBuffer, row: number): string {
  let out = '';
  for (let col = 0; col < buf.cols; col += 1) {
    const cell = buf.getCell(col, row);
    if (cell === null || cell.continued) continue;
    out += cell.glyph;
  }
  return out;
}

describe('CellBuffer construction', () => {
  test('creates buffer with given dimensions', () => {
    const buf = new CellBuffer(10, 5);
    assert.equal(buf.cols, 10);
    assert.equal(buf.rows, 5);
  });

  test('clamps to minimum 1x1', () => {
    const buf = new CellBuffer(0, -3);
    assert.equal(buf.cols, 1);
    assert.equal(buf.rows, 1);
  });

  test('cells initialized to spaces with base style', () => {
    const buf = new CellBuffer(3, 2, RED_STYLE);
    for (let r = 0; r < 2; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const cell = buf.getCell(c, r);
        assert.notEqual(cell, null);
        assert.equal(cell!.glyph, ' ');
        assert.equal(cell!.continued, false);
        assert.equal(cell!.style.fg.kind, 'rgb');
      }
    }
  });
});

describe('CellBuffer.getCell', () => {
  test('returns null for out-of-bounds', () => {
    const buf = new CellBuffer(5, 5);
    assert.equal(buf.getCell(-1, 0), null);
    assert.equal(buf.getCell(0, -1), null);
    assert.equal(buf.getCell(5, 0), null);
    assert.equal(buf.getCell(0, 5), null);
  });
});

describe('CellBuffer.drawText', () => {
  test('draws ASCII text', () => {
    const buf = new CellBuffer(10, 1);
    buf.drawText(0, 0, 'hello', RED_STYLE);
    assert.equal(glyphRow(buf, 0), 'hello     ');
    assert.equal(buf.getCell(0, 0)!.style, RED_STYLE);
  });

  test('clips text at buffer edge', () => {
    const buf = new CellBuffer(5, 1);
    buf.drawText(3, 0, 'abcdef', RED_STYLE);
    assert.equal(glyphRow(buf, 0), '   ab');
  });

  test('skips out-of-bounds row', () => {
    const buf = new CellBuffer(5, 1);
    buf.drawText(0, 1, 'test', RED_STYLE);
    assert.equal(glyphRow(buf, 0), '     ');
  });

  test('handles wide characters', () => {
    const buf = new CellBuffer(10, 1);
    buf.drawText(0, 0, '你好', RED_STYLE);
    const c0 = buf.getCell(0, 0)!;
    const c1 = buf.getCell(1, 0)!;
    const c2 = buf.getCell(2, 0)!;
    const c3 = buf.getCell(3, 0)!;
    assert.equal(c0.glyph, '你');
    assert.equal(c0.continued, false);
    assert.equal(c1.glyph, '');
    assert.equal(c1.continued, true);
    assert.equal(c2.glyph, '好');
    assert.equal(c2.continued, false);
    assert.equal(c3.continued, true);
  });

  test('wide char that would overflow is not drawn', () => {
    const buf = new CellBuffer(3, 1);
    buf.drawText(2, 0, '你', RED_STYLE);
    assert.equal(buf.getCell(2, 0)!.glyph, ' ');
  });

  test('combining marks attach to previous glyph', () => {
    const buf = new CellBuffer(10, 1);
    buf.drawText(0, 0, 'e\u0301x', RED_STYLE);
    assert.equal(buf.getCell(0, 0)!.glyph, 'e\u0301');
    assert.equal(buf.getCell(1, 0)!.glyph, 'x');
  });
});

describe('CellBuffer.fillRow', () => {
  test('fills entire row with style', () => {
    const buf = new CellBuffer(5, 2);
    buf.drawText(0, 0, 'abcde', RED_STYLE);
    buf.fillRow(0, BLUE_STYLE);
    for (let c = 0; c < 5; c += 1) {
      assert.equal(buf.getCell(c, 0)!.glyph, ' ');
      assert.equal(buf.getCell(c, 0)!.style, BLUE_STYLE);
    }
  });

  test('ignores out-of-bounds row', () => {
    const buf = new CellBuffer(3, 1);
    buf.fillRow(-1, RED_STYLE);
    buf.fillRow(1, RED_STYLE);
    assert.equal(buf.getCell(0, 0)!.style, DEFAULT_CELL_STYLE);
  });
});

describe('CellBuffer.fillRect', () => {
  test('fills a rectangular region', () => {
    const buf = new CellBuffer(5, 5);
    buf.fillRect({ x: 1, y: 1, width: 3, height: 2 }, RED_STYLE);
    assert.equal(buf.getCell(0, 0)!.style, DEFAULT_CELL_STYLE);
    assert.equal(buf.getCell(1, 1)!.style, RED_STYLE);
    assert.equal(buf.getCell(3, 2)!.style, RED_STYLE);
    assert.equal(buf.getCell(4, 1)!.style, DEFAULT_CELL_STYLE);
    assert.equal(buf.getCell(1, 3)!.style, DEFAULT_CELL_STYLE);
  });

  test('clips to buffer bounds', () => {
    const buf = new CellBuffer(3, 3);
    buf.fillRect({ x: -1, y: -1, width: 10, height: 10 }, RED_STYLE);
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        assert.equal(buf.getCell(c, r)!.style, RED_STYLE);
      }
    }
  });
});

describe('CellBuffer.blit', () => {
  test('copies source into destination', () => {
    const dst = new CellBuffer(10, 5);
    const src = new CellBuffer(3, 2);
    src.drawText(0, 0, 'abc', RED_STYLE);
    src.drawText(0, 1, 'def', BLUE_STYLE);
    dst.blit(src, 2, 1);
    assert.equal(dst.getCell(2, 1)!.glyph, 'a');
    assert.equal(dst.getCell(3, 1)!.glyph, 'b');
    assert.equal(dst.getCell(4, 1)!.glyph, 'c');
    assert.equal(dst.getCell(2, 2)!.glyph, 'd');
    assert.equal(dst.getCell(4, 2)!.style, BLUE_STYLE);
  });

  test('clips source when dest is partially off-screen (negative offset)', () => {
    const dst = new CellBuffer(5, 3);
    const src = new CellBuffer(4, 2);
    src.drawText(0, 0, 'abcd', RED_STYLE);
    src.drawText(0, 1, 'efgh', RED_STYLE);
    dst.blit(src, -2, -1);
    assert.equal(dst.getCell(0, 0)!.glyph, 'g');
    assert.equal(dst.getCell(1, 0)!.glyph, 'h');
    assert.equal(dst.getCell(2, 0)!.glyph, ' ');
  });

  test('clips source when dest extends beyond right/bottom', () => {
    const dst = new CellBuffer(3, 2);
    const src = new CellBuffer(5, 5);
    src.drawText(0, 0, '12345', RED_STYLE);
    dst.blit(src, 1, 0);
    assert.equal(dst.getCell(1, 0)!.glyph, '1');
    assert.equal(dst.getCell(2, 0)!.glyph, '2');
  });

  test('no-op when completely off-screen', () => {
    const dst = new CellBuffer(3, 3);
    const src = new CellBuffer(2, 2);
    src.drawText(0, 0, 'xy', RED_STYLE);
    dst.blit(src, 10, 10);
    assert.equal(dst.getCell(0, 0)!.glyph, ' ');
  });
});

describe('CellBuffer.renderAnsiRows', () => {
  test('renders correct number of rows', () => {
    const buf = new CellBuffer(5, 3);
    const rows = buf.renderAnsiRows();
    assert.equal(rows.length, 3);
  });

  test('rows end with reset sequence', () => {
    const buf = new CellBuffer(3, 1);
    const rows = buf.renderAnsiRows();
    assert.ok(rows[0]!.endsWith('\u001b[0m'));
  });

  test('styled text produces SGR sequences', () => {
    const buf = new CellBuffer(5, 1);
    buf.drawText(0, 0, 'hi', { ...DEFAULT_CELL_STYLE, bold: true });
    const row = buf.renderAnsiRows()[0]!;
    assert.ok(row.includes(';1;'));
    assert.ok(row.includes('hi'));
  });
});

describe('ClippedCellBuffer', () => {
  test('drawText writes to clipped region of target', () => {
    const buf = new CellBuffer(10, 5);
    const clip = buf.clip({ x: 2, y: 1, width: 5, height: 3 });
    assert.equal(clip.cols, 5);
    assert.equal(clip.rows, 3);
    clip.drawText(0, 0, 'abc', RED_STYLE);
    assert.equal(buf.getCell(2, 1)!.glyph, 'a');
    assert.equal(buf.getCell(3, 1)!.glyph, 'b');
    assert.equal(buf.getCell(4, 1)!.glyph, 'c');
    assert.equal(buf.getCell(1, 1)!.glyph, ' ');
  });

  test('clips drawText at clip boundary', () => {
    const buf = new CellBuffer(10, 5);
    const clip = buf.clip({ x: 7, y: 0, width: 3, height: 1 });
    clip.drawText(0, 0, 'abcdef', RED_STYLE);
    assert.equal(buf.getCell(7, 0)!.glyph, 'a');
    assert.equal(buf.getCell(8, 0)!.glyph, 'b');
    assert.equal(buf.getCell(9, 0)!.glyph, 'c');
  });

  test('fillRow fills clipped row', () => {
    const buf = new CellBuffer(10, 3);
    const clip = buf.clip({ x: 2, y: 1, width: 4, height: 1 });
    clip.fillRow(0, RED_STYLE);
    assert.equal(buf.getCell(1, 1)!.style, DEFAULT_CELL_STYLE);
    assert.equal(buf.getCell(2, 1)!.style, RED_STYLE);
    assert.equal(buf.getCell(5, 1)!.style, RED_STYLE);
    assert.equal(buf.getCell(6, 1)!.style, DEFAULT_CELL_STYLE);
  });

  test('getCell returns null for out-of-clip-bounds', () => {
    const buf = new CellBuffer(10, 5);
    const clip = buf.clip({ x: 2, y: 2, width: 3, height: 3 });
    assert.equal(clip.getCell(-1, 0), null);
    assert.equal(clip.getCell(3, 0), null);
    assert.equal(clip.getCell(0, 3), null);
    assert.notEqual(clip.getCell(0, 0), null);
  });

  test('clip clamps to target bounds', () => {
    const buf = new CellBuffer(5, 5);
    const clip = buf.clip({ x: 3, y: 3, width: 10, height: 10 });
    assert.equal(clip.cols, 2);
    assert.equal(clip.rows, 2);
  });

  test('blit through clip writes to correct target cells', () => {
    const buf = new CellBuffer(10, 5);
    const clip = buf.clip({ x: 3, y: 1, width: 4, height: 3 });
    const src = new CellBuffer(2, 1);
    src.drawText(0, 0, 'xy', BOLD_STYLE);
    clip.blit(src, 1, 0);
    assert.equal(buf.getCell(4, 1)!.glyph, 'x');
    assert.equal(buf.getCell(5, 1)!.glyph, 'y');
    assert.equal(buf.getCell(3, 1)!.glyph, ' ');
  });

  test('blit through clip clips source at clip boundary', () => {
    const buf = new CellBuffer(10, 5);
    const clip = buf.clip({ x: 8, y: 0, width: 2, height: 1 });
    const src = new CellBuffer(5, 1);
    src.drawText(0, 0, 'abcde', RED_STYLE);
    clip.blit(src, 0, 0);
    assert.equal(buf.getCell(8, 0)!.glyph, 'a');
    assert.equal(buf.getCell(9, 0)!.glyph, 'b');
  });
});

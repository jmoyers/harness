import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import { Canvas, CanvasWidget } from '../../packages/harness-ui/src/widgets/canvas.ts';
import { createTestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';
import {
  DEFAULT_CELL_STYLE,
  rgbColor,
  type CellStyle,
} from '../../packages/harness-ui/src/core/color.ts';

class RootWidget extends Widget {
  render(): void {}
}
function root(children: Widget[]): RootWidget {
  const r = new RootWidget('root');
  r.flexDirection = 'column';
  r.add(...children);
  return r;
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Canvas rendering', () => {
  test('calls onRender callback with buffer dimensions', () => {
    let calledWith: { w: number; h: number } | null = null;
    const c = Canvas({
      id: 'c',
      flexGrow: 1,
      onRender: (_buf, w, h) => {
        calledWith = { w, h };
      },
    });
    createTestPilot(root([c]), { cols: 20, rows: 10 });
    assert.notEqual(calledWith, null);
    assert.equal(calledWith!.w, 20);
    assert.equal(calledWith!.h, 10);
  });

  test('renders custom content via callback', () => {
    const c = Canvas({
      id: 'c',
      flexGrow: 1,
      onRender: (buf, w, h) => {
        for (let r = 0; r < h; r += 1) {
          buf.drawText(0, r, '#'.repeat(w), DEFAULT_CELL_STYLE);
        }
      },
    });
    const pilot = createTestPilot(root([c]), { cols: 5, rows: 3 });
    pilot.expectRow(0).toEqual('#####');
    pilot.expectRow(1).toEqual('#####');
    pilot.expectRow(2).toEqual('#####');
  });

  test('renders styled content', () => {
    const red: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };
    const c = Canvas({
      id: 'c',
      flexGrow: 1,
      onRender: (buf) => {
        buf.drawText(0, 0, 'RED', red);
      },
    });
    const pilot = createTestPilot(root([c]), { cols: 10, rows: 1 });
    pilot.expectRow(0).toContain('RED');
    pilot.expectCell(0, 0).toHaveStyle({ fg: rgbColor(255, 0, 0) });
  });

  test('no callback renders blank', () => {
    const c = Canvas({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 5, rows: 1 });
    pilot.expectRow(0).toEqual('     ');
  });

  test('setRenderCallback changes rendering', () => {
    const c = Canvas({
      id: 'c',
      flexGrow: 1,
      onRender: (buf) => buf.drawText(0, 0, 'OLD', DEFAULT_CELL_STYLE),
    });
    const pilot = createTestPilot(root([c]), { cols: 10, rows: 1 });
    pilot.expectRow(0).toContain('OLD');
    c.setRenderCallback((buf) => buf.drawText(0, 0, 'NEW', DEFAULT_CELL_STYLE));
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('NEW');
    pilot.expectRow(0).not.toContain('OLD');
  });

  test('setRenderCallback to null renders blank', () => {
    const c = Canvas({
      id: 'c',
      flexGrow: 1,
      onRender: (buf) => buf.drawText(0, 0, 'TEXT', DEFAULT_CELL_STYLE),
    });
    const pilot = createTestPilot(root([c]), { cols: 10, rows: 1 });
    pilot.expectRow(0).toContain('TEXT');
    c.setRenderCallback(null);
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).not.toContain('TEXT');
  });
});

describe('Canvas factory', () => {
  test('returns CanvasWidget', () => {
    const c = Canvas({ id: 'test' });
    if (!(c instanceof CanvasWidget)) throw new Error('should be CanvasWidget');
    if (!(c instanceof Widget)) throw new Error('should be Widget');
  });
});

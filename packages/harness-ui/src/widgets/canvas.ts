import { Widget, type LayoutValue } from '../widget/widget.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

export type CanvasRenderCallback = (
  buffer: ClippedCellBuffer,
  width: number,
  height: number,
) => void;

export interface CanvasProps {
  readonly id?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly onRender?: CanvasRenderCallback;
}

export class CanvasWidget extends Widget {
  private _onRender: CanvasRenderCallback | null = null;

  constructor(props: CanvasProps = {}) {
    super(props.id);
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
    if (props.onRender !== undefined) this._onRender = props.onRender;
  }

  setRenderCallback(callback: CanvasRenderCallback | null): void {
    this._onRender = callback;
    this.markDirty();
  }

  render(buffer: ClippedCellBuffer): void {
    if (this._onRender !== null) {
      this._onRender(buffer, buffer.cols, buffer.rows);
    }
  }
}

export function Canvas(props: CanvasProps = {}): CanvasWidget {
  return new CanvasWidget(props);
}

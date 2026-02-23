import { CellBuffer } from '../core/cell-buffer.ts';
import { DEFAULT_CELL_STYLE } from '../core/color.ts';
import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { computeLayout } from '../widget/layout.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { Binding } from '../widget/keybinding.ts';

export interface ScrollViewProps {
  readonly id?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly contentHeight?: number;
  readonly scrollStep?: number;
}

export class ScrollViewWidget extends Widget {
  scrollTop = reactive(0);
  contentHeight = reactive(0);
  scrollStep = reactive(3);

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'scroll-up', description: 'Scroll up' },
    { key: 'down', action: 'scroll-down', description: 'Scroll down' },
    { key: 'pageup', action: 'page-up', description: 'Page up' },
    { key: 'pagedown', action: 'page-down', description: 'Page down' },
    { key: 'home', action: 'scroll-top', description: 'Scroll to top' },
    { key: 'end', action: 'scroll-bottom', description: 'Scroll to bottom' },
  ];

  constructor(props: ScrollViewProps = {}) {
    super(props.id);
    this.focusable = true;
    this.overflow = 'scroll';
    this.manualChildRendering = true;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
    if (props.contentHeight !== undefined) this.contentHeight = props.contentHeight;
    if (props.scrollStep !== undefined) this.scrollStep = props.scrollStep;
  }

  maxScrollTop(viewHeight: number): number {
    const totalHeight = this.resolvedContentHeight();
    return Math.max(0, totalHeight - viewHeight);
  }

  private clampScroll(viewHeight: number): void {
    const max = this.maxScrollTop(viewHeight);
    const clamped = Math.max(0, Math.min(max, Math.floor(this.scrollTop)));
    if (clamped !== this.scrollTop) {
      this.scrollTop = clamped;
    }
  }

  scrollBy(delta: number): void {
    this.scrollTop = Math.max(0, this.scrollTop + delta);
  }

  scrollToTop(): void {
    this.scrollTop = 0;
  }

  scrollToBottom(viewHeight: number): void {
    this.scrollTop = this.maxScrollTop(viewHeight);
  }

  actionScrollUp(): void {
    this.scrollBy(-this.scrollStep);
  }

  actionScrollDown(): void {
    this.scrollBy(this.scrollStep);
  }

  actionPageUp(): void {
    const pageSize = Math.max(1, this.computedRect.height - 1);
    this.scrollBy(-pageSize);
  }

  actionPageDown(): void {
    const pageSize = Math.max(1, this.computedRect.height - 1);
    this.scrollBy(pageSize);
  }

  actionScrollTop(): void {
    this.scrollToTop();
  }

  actionScrollBottom(): void {
    this.scrollToBottom(this.computedRect.height);
  }

  private resolvedContentHeight(): number {
    if (this.contentHeight > 0) return this.contentHeight;
    let total = 0;
    for (const child of this.children) {
      if (!child.visible) continue;
      const h = child.computedRect.height;
      total += h;
    }
    return Math.max(total, this.computedRect.height);
  }

  render(buffer: ClippedCellBuffer): void {
    const viewWidth = buffer.cols;
    const viewHeight = buffer.rows;
    if (viewWidth <= 0 || viewHeight <= 0) return;

    this.clampScroll(viewHeight);

    const totalHeight = this.resolvedContentHeight();
    const virtualBuffer = new CellBuffer(viewWidth, totalHeight, DEFAULT_CELL_STYLE);

    const savedRect = this.computedRect;
    const savedAbsRect = this.absoluteRect;
    computeLayout(this, viewWidth, totalHeight);
    this.computedRect = savedRect;
    this.absoluteRect = savedAbsRect;

    for (const child of this.children) {
      if (!child.visible) continue;
      const rect = child.computedRect;
      if (rect.width <= 0 || rect.height <= 0) continue;
      const clipped = virtualBuffer.clip({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      child.render(clipped);
    }

    const srcStartRow = Math.max(0, Math.min(this.scrollTop, totalHeight - 1));
    for (let viewRow = 0; viewRow < viewHeight; viewRow += 1) {
      const srcRow = srcStartRow + viewRow;
      if (srcRow >= totalHeight) break;
      for (let col = 0; col < viewWidth; col += 1) {
        const src = virtualBuffer.getCell(col, srcRow);
        const dst = buffer.getCell(col, viewRow);
        if (src === null || dst === null) continue;
        dst.glyph = src.glyph;
        dst.continued = src.continued;
        dst.style = src.style;
      }
    }
  }
}

export function ScrollView(props: ScrollViewProps = {}, ...children: Widget[]): ScrollViewWidget {
  const sv = new ScrollViewWidget(props);
  if (children.length > 0) sv.add(...children);
  return sv;
}

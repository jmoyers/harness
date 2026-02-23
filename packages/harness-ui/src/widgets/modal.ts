import { Widget, edgeInsets } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { Message } from '../widget/message.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import { CellBuffer, type ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { Binding } from '../widget/keybinding.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export class ModalDismissed extends Message {}

export type ModalAnchor = 'center' | 'top' | 'bottom';

export interface ModalProps {
  readonly id?: string;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly anchor?: ModalAnchor;
  readonly borderColor?: string;
  readonly backgroundColor?: string;
  readonly titleColor?: string;
  readonly dismissOnEscape?: boolean;
}

export class ModalWidget extends Widget {
  title = reactive('');
  modalWidth = reactive(40);
  modalHeight = reactive(10);
  anchor = reactive<ModalAnchor>('center');
  borderColor = reactive<string | undefined>(undefined);
  backgroundColor = reactive<string | undefined>(undefined);
  titleColor = reactive<string | undefined>(undefined);
  dismissOnEscape = reactive(true);

  static BINDINGS: Binding[] = [{ key: 'escape', action: 'dismiss', description: 'Close' }];

  constructor(props: ModalProps = {}) {
    super(props.id);
    this.position = 'absolute';
    this.zIndex = 100;
    this.focusable = true;
    this.manualChildRendering = true;
    if (props.title !== undefined) this.title = props.title;
    if (props.width !== undefined) this.modalWidth = props.width;
    if (props.height !== undefined) this.modalHeight = props.height;
    if (props.anchor !== undefined) this.anchor = props.anchor;
    if (props.borderColor !== undefined) this.borderColor = props.borderColor;
    if (props.backgroundColor !== undefined) this.backgroundColor = props.backgroundColor;
    if (props.titleColor !== undefined) this.titleColor = props.titleColor;
    if (props.dismissOnEscape !== undefined) this.dismissOnEscape = props.dismissOnEscape;
  }

  positionInViewport(viewportCols: number, viewportRows: number): void {
    const w = Math.min(this.modalWidth, viewportCols);
    const h = Math.min(this.modalHeight, viewportRows);
    this.width = w;
    this.height = h;
    this.left = Math.max(0, Math.floor((viewportCols - w) / 2));

    if (this.anchor === 'top') {
      this.top = 1;
    } else if (this.anchor === 'bottom') {
      this.top = Math.max(0, viewportRows - h - 1);
    } else {
      this.top = Math.max(0, Math.floor((viewportRows - h) / 2));
    }
  }

  actionDismiss(): void {
    if (!this.dismissOnEscape) return;
    this.emit(new ModalDismissed());
  }

  render(buffer: ClippedCellBuffer): void {
    const bgColor = resolveColor(this.backgroundColor);
    const brdColor = resolveColor(this.borderColor);
    const bgStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      bg: bgColor.kind !== 'default' ? bgColor : { kind: 'indexed', index: 236 },
    };
    const borderStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: brdColor.kind !== 'default' ? brdColor : { kind: 'indexed', index: 252 },
      bg: bgStyle.bg,
    };

    for (let r = 0; r < buffer.rows; r += 1) {
      buffer.fillRow(r, bgStyle);
    }

    if (buffer.cols < 2 || buffer.rows < 2) return;

    const hBar = '─'.repeat(Math.max(0, buffer.cols - 2));
    buffer.drawText(0, 0, `┌${hBar}┐`, borderStyle);
    if (buffer.rows > 1) {
      buffer.drawText(0, buffer.rows - 1, `└${hBar}┘`, borderStyle);
    }
    for (let r = 1; r < buffer.rows - 1; r += 1) {
      buffer.drawText(0, r, '│', borderStyle);
      buffer.drawText(buffer.cols - 1, r, '│', borderStyle);
    }

    if (this.title.length > 0 && buffer.cols > 4) {
      const maxTitleWidth = buffer.cols - 4;
      const truncated = layout.truncate(this.title, maxTitleWidth);
      const titleWidth = measureDisplayWidth(truncated);
      const titleText = ` ${truncated} `;
      const col = Math.max(1, Math.floor((buffer.cols - titleWidth - 2) / 2));

      const tColor = resolveColor(this.titleColor);
      const titleStyle: CellStyle = {
        ...DEFAULT_CELL_STYLE,
        fg: tColor.kind !== 'default' ? tColor : { kind: 'indexed', index: 231 },
        bg: bgStyle.bg,
        bold: true,
      };
      buffer.drawText(col, 0, titleText, titleStyle);
    }

    const innerWidth = Math.max(0, buffer.cols - 2);
    const innerHeight = Math.max(0, buffer.rows - 2);
    if (innerWidth <= 0 || innerHeight <= 0 || this.children.length === 0) return;

    const innerBuffer = new CellBuffer(innerWidth, innerHeight, bgStyle);
    for (const child of this.children) {
      if (!child.visible) continue;
      const rect = child.computedRect;
      if (rect.width <= 0 || rect.height <= 0) continue;
      const clipped = innerBuffer.clip({
        x: rect.x - 1,
        y: rect.y - 1,
        width: rect.width,
        height: rect.height,
      });
      child.render(clipped);
    }

    buffer.blit(innerBuffer, 1, 1);
  }
}

export function Modal(props: ModalProps = {}, ...children: Widget[]): ModalWidget {
  const modal = new ModalWidget(props);
  modal.padding = edgeInsets(1);
  if (children.length > 0) modal.add(...children);
  return modal;
}

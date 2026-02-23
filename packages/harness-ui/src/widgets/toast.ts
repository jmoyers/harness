import { Widget } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastEntry {
  readonly message: string;
  readonly variant: ToastVariant;
  readonly expiresAt: number;
}

const VARIANT_ICONS: Record<ToastVariant, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✗',
};

const VARIANT_COLORS: Record<ToastVariant, string> = {
  info: '#60A5FA',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
};

export interface ToastManagerProps {
  readonly id?: string;
  readonly defaultDurationMs?: number;
  readonly maxVisible?: number;
}

export class ToastManager extends Widget {
  entries = reactive<readonly ToastEntry[]>([]);
  defaultDurationMs = reactive(3000);
  maxVisible = reactive(3);

  constructor(props: ToastManagerProps = {}) {
    super(props.id);
    this.position = 'absolute';
    this.zIndex = 300;
    this.width = 'auto';
    this.height = 'auto';
    if (props.defaultDurationMs !== undefined) this.defaultDurationMs = props.defaultDurationMs;
    if (props.maxVisible !== undefined) this.maxVisible = props.maxVisible;
  }

  show(message: string, variant: ToastVariant = 'info', durationMs?: number): void {
    const duration = durationMs ?? this.defaultDurationMs;
    const expiresAt = Date.now() + duration;
    const next = [...this.entries, { message, variant, expiresAt }];
    this.entries = next.slice(-this.maxVisible);
  }

  info(message: string): void {
    this.show(message, 'info');
  }
  success(message: string): void {
    this.show(message, 'success');
  }
  warning(message: string): void {
    this.show(message, 'warning');
  }
  error(message: string): void {
    this.show(message, 'error');
  }

  prune(): void {
    const now = Date.now();
    const active = this.entries.filter((e) => e.expiresAt > now);
    if (active.length !== this.entries.length) {
      this.entries = active;
    }
  }

  clear(): void {
    this.entries = [];
  }

  positionInViewport(viewportCols: number, viewportRows: number): void {
    const w = Math.min(50, viewportCols - 4);
    this.width = w;
    this.height = this.maxVisible + 1;
    this.left = Math.max(0, Math.floor((viewportCols - w) / 2));
    this.top = Math.max(0, viewportRows - this.maxVisible - 2);
  }

  render(buffer: ClippedCellBuffer): void {
    const now = Date.now();
    const active = this.entries.filter((e) => e.expiresAt > now);

    for (let i = 0; i < active.length && i < buffer.rows; i += 1) {
      const entry = active[i]!;
      const icon = VARIANT_ICONS[entry.variant];
      const colorHex = VARIANT_COLORS[entry.variant];
      const fg = resolveColor(colorHex);
      const style: CellStyle = { ...DEFAULT_CELL_STYLE, fg };
      const textStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: { kind: 'indexed', index: 252 } };

      const text = ` ${icon} ${entry.message}`;
      const truncated = layout.truncate(text, buffer.cols);
      buffer.drawText(0, i, truncated.slice(0, 3), style);
      buffer.drawText(3, i, truncated.slice(3), textStyle);
    }
  }
}

export function Toast(props: ToastManagerProps = {}): ToastManager {
  return new ToastManager(props);
}

import { TextLayoutEngine } from './text-layout.ts';
import { DEFAULT_UI_STYLE, SurfaceBuffer, type UiColor, type UiStyle } from './surface.ts';

export interface UiRect {
  readonly col: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
}

export type UiTextAlign = 'left' | 'center' | 'right';

export interface UiBoxGlyphs {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
}

export const SINGLE_LINE_UI_BOX_GLYPHS: UiBoxGlyphs = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
};

export interface UiModalTheme {
  readonly frameStyle: UiStyle;
  readonly titleStyle: UiStyle;
  readonly bodyStyle: UiStyle;
  readonly footerStyle: UiStyle;
}

export interface UiModalContent {
  readonly title?: string;
  readonly bodyLines?: readonly string[];
  readonly footer?: string;
  readonly paddingX?: number;
}

export type UiModalAnchor = 'center' | 'bottom';

export interface UiModalOverlayOptions extends UiModalContent {
  readonly viewportCols: number;
  readonly viewportRows: number;
  readonly width: number;
  readonly height: number;
  readonly anchor?: UiModalAnchor;
  readonly marginRows?: number;
  readonly theme?: Partial<UiModalTheme>;
}

export interface UiModalOverlay {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}

export interface UiButtonContent {
  readonly label: string;
  readonly prefixIcon?: string;
  readonly suffixIcon?: string;
  readonly paddingX?: number;
}

export interface UiTrailingLabelRowOptions {
  readonly col?: number;
  readonly width?: number;
  readonly gap?: number;
}

const MODAL_FRAME_FG: UiColor = { kind: 'indexed', index: 252 };
const MODAL_TITLE_FG: UiColor = { kind: 'indexed', index: 231 };
const MODAL_BODY_FG: UiColor = { kind: 'indexed', index: 253 };
const MODAL_FOOTER_FG: UiColor = { kind: 'indexed', index: 247 };
const MODAL_BG: UiColor = { kind: 'indexed', index: 236 };

export const DEFAULT_UI_MODAL_THEME: UiModalTheme = {
  frameStyle: {
    fg: MODAL_FRAME_FG,
    bg: MODAL_BG,
    bold: true,
  },
  titleStyle: {
    fg: MODAL_TITLE_FG,
    bg: MODAL_BG,
    bold: true,
  },
  bodyStyle: {
    fg: MODAL_BODY_FG,
    bg: MODAL_BG,
    bold: false,
  },
  footerStyle: {
    fg: MODAL_FOOTER_FG,
    bg: MODAL_BG,
    bold: false,
  },
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeRect(surface: SurfaceBuffer, rect: UiRect): UiRect | null {
  const colStart = Math.max(0, Math.floor(rect.col));
  const rowStart = Math.max(0, Math.floor(rect.row));
  const colEnd = Math.min(surface.cols, Math.ceil(rect.col + rect.width));
  const rowEnd = Math.min(surface.rows, Math.ceil(rect.row + rect.height));
  const width = colEnd - colStart;
  const height = rowEnd - rowStart;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    col: colStart,
    row: rowStart,
    width,
    height,
  };
}

function mergeModalTheme(theme: Partial<UiModalTheme> | undefined): UiModalTheme {
  if (theme === undefined) {
    return DEFAULT_UI_MODAL_THEME;
  }
  return {
    frameStyle: theme.frameStyle ?? DEFAULT_UI_MODAL_THEME.frameStyle,
    titleStyle: theme.titleStyle ?? DEFAULT_UI_MODAL_THEME.titleStyle,
    bodyStyle: theme.bodyStyle ?? DEFAULT_UI_MODAL_THEME.bodyStyle,
    footerStyle: theme.footerStyle ?? DEFAULT_UI_MODAL_THEME.footerStyle,
  };
}

export class UiKit {
  constructor(private readonly layout: TextLayoutEngine = new TextLayoutEngine()) {}

  public truncateText(text: string, width: number): string {
    return this.layout.truncate(text, width);
  }

  public formatButton(content: UiButtonContent): string {
    const label = content.label.trim();
    const prefixIcon = content.prefixIcon?.trim();
    const suffixIcon = content.suffixIcon?.trim();
    const paddingX = clamp(Math.floor(content.paddingX ?? 1), 0, 8);

    const segments: string[] = [];
    if (prefixIcon !== undefined && prefixIcon.length > 0) {
      segments.push(prefixIcon);
    }
    segments.push(label.length > 0 ? label : 'button');
    if (suffixIcon !== undefined && suffixIcon.length > 0) {
      segments.push(suffixIcon);
    }

    const padded = `${' '.repeat(paddingX)}${segments.join(' ')}${' '.repeat(paddingX)}`;
    return `[${padded}]`;
  }

  public drawAlignedText(
    surface: SurfaceBuffer,
    col: number,
    row: number,
    width: number,
    text: string,
    style: UiStyle,
    align: UiTextAlign = 'left',
  ): void {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0) {
      return;
    }

    const clipped = this.truncateText(text, safeWidth);
    const clippedWidth = Math.max(0, this.layout.measure(clipped));
    let offset = 0;
    if (align === 'center') {
      offset = Math.max(0, Math.floor((safeWidth - clippedWidth) / 2));
    } else if (align === 'right') {
      offset = Math.max(0, safeWidth - clippedWidth);
    }
    surface.drawText(col + offset, row, clipped, style);
  }

  public paintRow(
    surface: SurfaceBuffer,
    row: number,
    text: string,
    textStyle: UiStyle,
    fillStyle: UiStyle = textStyle,
    col = 0,
  ): void {
    surface.fillRow(row, fillStyle);
    surface.drawText(col, row, text, textStyle);
  }

  public paintRowWithTrailingLabel(
    surface: SurfaceBuffer,
    row: number,
    leftText: string,
    trailingLabel: string,
    leftStyle: UiStyle,
    trailingStyle: UiStyle,
    fillStyle: UiStyle = leftStyle,
    options: UiTrailingLabelRowOptions = {},
  ): void {
    const col = Math.max(0, Math.floor(options.col ?? 0));
    const width = Math.max(0, Math.floor(options.width ?? surface.cols - col));
    const gap = clamp(Math.floor(options.gap ?? 1), 0, width);
    surface.fillRow(row, fillStyle);
    if (width === 0) {
      return;
    }

    const clippedTrailing = this.truncateText(trailingLabel, width);
    const trailingWidth = Math.max(0, this.layout.measure(clippedTrailing));
    const reservedGap = trailingWidth > 0 ? gap : 0;
    const leftWidth = Math.max(0, width - trailingWidth - reservedGap);
    const clippedLeft = this.truncateText(leftText, leftWidth);
    if (clippedLeft.length > 0) {
      surface.drawText(col, row, clippedLeft, leftStyle);
    }
    if (clippedTrailing.length > 0) {
      surface.drawText(col + width - trailingWidth, row, clippedTrailing, trailingStyle);
    }
  }

  public fillRect(surface: SurfaceBuffer, rect: UiRect, style: UiStyle): void {
    const normalized = normalizeRect(surface, rect);
    if (normalized === null) {
      return;
    }
    const blank = ' '.repeat(normalized.width);
    for (let row = normalized.row; row < normalized.row + normalized.height; row += 1) {
      surface.drawText(normalized.col, row, blank, style);
    }
  }

  public strokeRect(
    surface: SurfaceBuffer,
    rect: UiRect,
    style: UiStyle,
    glyphs: UiBoxGlyphs = SINGLE_LINE_UI_BOX_GLYPHS,
  ): void {
    const normalized = normalizeRect(surface, rect);
    if (normalized === null) {
      return;
    }

    if (normalized.width === 1 && normalized.height === 1) {
      surface.drawText(normalized.col, normalized.row, glyphs.topLeft, style);
      return;
    }

    if (normalized.height === 1) {
      surface.drawText(
        normalized.col,
        normalized.row,
        glyphs.horizontal.repeat(normalized.width),
        style,
      );
      return;
    }

    if (normalized.width === 1) {
      for (let row = normalized.row; row < normalized.row + normalized.height; row += 1) {
        surface.drawText(normalized.col, row, glyphs.vertical, style);
      }
      return;
    }

    const horizontal = glyphs.horizontal.repeat(Math.max(0, normalized.width - 2));
    surface.drawText(
      normalized.col,
      normalized.row,
      `${glyphs.topLeft}${horizontal}${glyphs.topRight}`,
      style,
    );

    const bottomRow = normalized.row + normalized.height - 1;
    surface.drawText(
      normalized.col,
      bottomRow,
      `${glyphs.bottomLeft}${horizontal}${glyphs.bottomRight}`,
      style,
    );

    for (let row = normalized.row + 1; row < bottomRow; row += 1) {
      surface.drawText(normalized.col, row, glyphs.vertical, style);
      surface.drawText(normalized.col + normalized.width - 1, row, glyphs.vertical, style);
    }
  }

  public layoutModalRect(
    viewportCols: number,
    viewportRows: number,
    width: number,
    height: number,
    anchor: UiModalAnchor = 'center',
    marginRows = 1,
  ): UiRect {
    const safeViewportCols = Math.max(1, Math.floor(viewportCols));
    const safeViewportRows = Math.max(1, Math.floor(viewportRows));
    const safeWidth = clamp(Math.floor(width), 1, safeViewportCols);
    const safeHeight = clamp(Math.floor(height), 1, safeViewportRows);

    const left = Math.floor((safeViewportCols - safeWidth) / 2);
    const top =
      anchor === 'bottom'
        ? Math.max(0, safeViewportRows - safeHeight - Math.max(0, Math.floor(marginRows)))
        : Math.floor((safeViewportRows - safeHeight) / 2);

    return {
      col: left,
      row: top,
      width: safeWidth,
      height: safeHeight,
    };
  }

  public drawModal(
    surface: SurfaceBuffer,
    rect: UiRect,
    content: UiModalContent,
    theme: Partial<UiModalTheme> | undefined = undefined,
  ): UiRect | null {
    const normalized = normalizeRect(surface, rect);
    if (normalized === null) {
      return null;
    }

    const resolvedTheme = mergeModalTheme(theme);
    this.fillRect(surface, normalized, resolvedTheme.bodyStyle);
    this.strokeRect(surface, normalized, resolvedTheme.frameStyle);

    const inner: UiRect = {
      col: normalized.col + 1,
      row: normalized.row + 1,
      width: Math.max(0, normalized.width - 2),
      height: Math.max(0, normalized.height - 2),
    };
    const normalizedInner = normalizeRect(surface, inner);
    if (normalizedInner === null) {
      return normalized;
    }

    const paddingX = clamp(
      Math.floor(content.paddingX ?? 1),
      0,
      Math.floor(normalizedInner.width / 2),
    );
    const textCol = normalizedInner.col + paddingX;
    const textWidth = Math.max(0, normalizedInner.width - paddingX * 2);
    if (textWidth === 0) {
      return normalized;
    }

    let nextRow = normalizedInner.row;
    const innerBottom = normalizedInner.row + normalizedInner.height - 1;

    if (content.title !== undefined && content.title.length > 0 && nextRow <= innerBottom) {
      this.drawAlignedText(
        surface,
        textCol,
        nextRow,
        textWidth,
        content.title,
        resolvedTheme.titleStyle,
        'center',
      );
      nextRow += 1;
    }

    const footerRow =
      content.footer !== undefined && content.footer.length > 0 && nextRow <= innerBottom
        ? innerBottom
        : null;
    const footerText = content.footer;
    const bodyBottom = footerRow === null ? innerBottom : footerRow - 1;

    const bodyLines = content.bodyLines ?? [];
    for (const line of bodyLines) {
      if (nextRow > bodyBottom) {
        break;
      }
      this.drawAlignedText(
        surface,
        textCol,
        nextRow,
        textWidth,
        line,
        resolvedTheme.bodyStyle,
        'left',
      );
      nextRow += 1;
    }

    if (footerRow !== null && footerText !== undefined) {
      this.drawAlignedText(
        surface,
        textCol,
        footerRow,
        textWidth,
        footerText,
        resolvedTheme.footerStyle,
        'right',
      );
    }
    return normalized;
  }

  public buildModalOverlay(options: UiModalOverlayOptions): UiModalOverlay {
    const rect = this.layoutModalRect(
      options.viewportCols,
      options.viewportRows,
      options.width,
      options.height,
      options.anchor ?? 'center',
      options.marginRows ?? 1,
    );

    const surface = new SurfaceBuffer(rect.width, rect.height, DEFAULT_UI_STYLE);
    const content: UiModalContent = {
      bodyLines: options.bodyLines ?? [],
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.footer !== undefined ? { footer: options.footer } : {}),
      ...(options.paddingX !== undefined ? { paddingX: options.paddingX } : {}),
    };
    this.drawModal(
      surface,
      {
        col: 0,
        row: 0,
        width: rect.width,
        height: rect.height,
      },
      content,
      options.theme,
    );

    return {
      left: rect.col,
      top: rect.row,
      width: rect.width,
      height: rect.height,
      rows: surface.renderAnsiRows(),
    };
  }

  public isModalOverlayHit(overlay: UiModalOverlay, col: number, row: number): boolean {
    if (col < 1 || row < 1) {
      return false;
    }
    const colZero = col - 1;
    const rowZero = row - 1;
    return (
      colZero >= overlay.left &&
      colZero < overlay.left + overlay.width &&
      rowZero >= overlay.top &&
      rowZero < overlay.top + overlay.height
    );
  }
}

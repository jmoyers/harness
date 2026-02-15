import { measureDisplayWidth } from '../terminal/snapshot-oracle.ts';
import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  drawUiText,
  fillUiRow,
  renderUiSurfaceAnsiRows,
  type UiColor,
  type UiStyle,
  type UiSurface
} from './surface.ts';

interface UiRect {
  readonly col: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
}

type UiTextAlign = 'left' | 'center' | 'right';

interface UiBoxGlyphs {
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
  vertical: '│'
};

interface UiModalTheme {
  readonly frameStyle: UiStyle;
  readonly titleStyle: UiStyle;
  readonly bodyStyle: UiStyle;
  readonly footerStyle: UiStyle;
}

interface UiModalContent {
  readonly title?: string;
  readonly bodyLines?: readonly string[];
  readonly footer?: string;
  readonly paddingX?: number;
}

type UiModalAnchor = 'center' | 'bottom';

interface UiModalOverlayOptions extends UiModalContent {
  readonly viewportCols: number;
  readonly viewportRows: number;
  readonly width: number;
  readonly height: number;
  readonly anchor?: UiModalAnchor;
  readonly marginRows?: number;
  readonly theme?: Partial<UiModalTheme>;
}

interface UiModalOverlay {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
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
    bold: true
  },
  titleStyle: {
    fg: MODAL_TITLE_FG,
    bg: MODAL_BG,
    bold: true
  },
  bodyStyle: {
    fg: MODAL_BODY_FG,
    bg: MODAL_BG,
    bold: false
  },
  footerStyle: {
    fg: MODAL_FOOTER_FG,
    bg: MODAL_BG,
    bold: false
  }
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

function normalizeRect(surface: UiSurface, rect: UiRect): UiRect | null {
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
    height
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
    footerStyle: theme.footerStyle ?? DEFAULT_UI_MODAL_THEME.footerStyle
  };
}

export function truncateUiText(text: string, width: number): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0 || text.length === 0) {
    return '';
  }

  const consumed: Array<{ glyph: string; width: number }> = [];
  let consumedWidth = 0;
  let truncated = false;

  for (const glyph of text) {
    const glyphWidth = Math.max(1, measureDisplayWidth(glyph));
    if (consumedWidth + glyphWidth > safeWidth) {
      truncated = true;
      break;
    }
    consumed.push({ glyph, width: glyphWidth });
    consumedWidth += glyphWidth;
  }

  if (!truncated) {
    return consumed.map((entry) => entry.glyph).join('');
  }

  if (safeWidth === 1) {
    return '…';
  }

  while (consumed.length > 0 && consumedWidth + 1 > safeWidth) {
    const removed = consumed.pop()!;
    consumedWidth -= removed.width;
  }

  return `${consumed.map((entry) => entry.glyph).join('')}…`;
}

export function drawUiAlignedText(
  surface: UiSurface,
  col: number,
  row: number,
  width: number,
  text: string,
  style: UiStyle,
  align: UiTextAlign = 'left'
): void {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) {
    return;
  }

  const clipped = truncateUiText(text, safeWidth);
  const clippedWidth = Math.max(0, measureDisplayWidth(clipped));
  let offset = 0;
  if (align === 'center') {
    offset = Math.max(0, Math.floor((safeWidth - clippedWidth) / 2));
  } else if (align === 'right') {
    offset = Math.max(0, safeWidth - clippedWidth);
  }
  drawUiText(surface, col + offset, row, clipped, style);
}

export function paintUiRow(
  surface: UiSurface,
  row: number,
  text: string,
  textStyle: UiStyle,
  fillStyle: UiStyle = textStyle,
  col = 0
): void {
  fillUiRow(surface, row, fillStyle);
  drawUiText(surface, col, row, text, textStyle);
}

export function fillUiRect(surface: UiSurface, rect: UiRect, style: UiStyle): void {
  const normalized = normalizeRect(surface, rect);
  if (normalized === null) {
    return;
  }
  const blank = ' '.repeat(normalized.width);
  for (let row = normalized.row; row < normalized.row + normalized.height; row += 1) {
    drawUiText(surface, normalized.col, row, blank, style);
  }
}

export function strokeUiRect(
  surface: UiSurface,
  rect: UiRect,
  style: UiStyle,
  glyphs: UiBoxGlyphs = SINGLE_LINE_UI_BOX_GLYPHS
): void {
  const normalized = normalizeRect(surface, rect);
  if (normalized === null) {
    return;
  }

  if (normalized.width === 1 && normalized.height === 1) {
    drawUiText(surface, normalized.col, normalized.row, glyphs.topLeft, style);
    return;
  }

  if (normalized.height === 1) {
    drawUiText(surface, normalized.col, normalized.row, glyphs.horizontal.repeat(normalized.width), style);
    return;
  }

  if (normalized.width === 1) {
    for (let row = normalized.row; row < normalized.row + normalized.height; row += 1) {
      drawUiText(surface, normalized.col, row, glyphs.vertical, style);
    }
    return;
  }

  const horizontal = glyphs.horizontal.repeat(Math.max(0, normalized.width - 2));
  drawUiText(surface, normalized.col, normalized.row, `${glyphs.topLeft}${horizontal}${glyphs.topRight}`, style);

  const bottomRow = normalized.row + normalized.height - 1;
  drawUiText(
    surface,
    normalized.col,
    bottomRow,
    `${glyphs.bottomLeft}${horizontal}${glyphs.bottomRight}`,
    style
  );

  for (let row = normalized.row + 1; row < bottomRow; row += 1) {
    drawUiText(surface, normalized.col, row, glyphs.vertical, style);
    drawUiText(surface, normalized.col + normalized.width - 1, row, glyphs.vertical, style);
  }
}

export function layoutUiModalRect(
  viewportCols: number,
  viewportRows: number,
  width: number,
  height: number,
  anchor: UiModalAnchor = 'center',
  marginRows = 1
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
    height: safeHeight
  };
}

export function drawUiModal(
  surface: UiSurface,
  rect: UiRect,
  content: UiModalContent,
  theme: Partial<UiModalTheme> | undefined = undefined
): UiRect | null {
  const normalized = normalizeRect(surface, rect);
  if (normalized === null) {
    return null;
  }

  const resolvedTheme = mergeModalTheme(theme);
  fillUiRect(surface, normalized, resolvedTheme.bodyStyle);
  strokeUiRect(surface, normalized, resolvedTheme.frameStyle);

  const inner: UiRect = {
    col: normalized.col + 1,
    row: normalized.row + 1,
    width: Math.max(0, normalized.width - 2),
    height: Math.max(0, normalized.height - 2)
  };
  const normalizedInner = normalizeRect(surface, inner);
  if (normalizedInner === null) {
    return normalized;
  }

  const paddingX = clamp(Math.floor(content.paddingX ?? 1), 0, Math.floor(normalizedInner.width / 2));
  const textCol = normalizedInner.col + paddingX;
  const textWidth = Math.max(0, normalizedInner.width - paddingX * 2);
  if (textWidth === 0) {
    return normalized;
  }

  let nextRow = normalizedInner.row;
  const innerBottom = normalizedInner.row + normalizedInner.height - 1;

  if (content.title !== undefined && content.title.length > 0 && nextRow <= innerBottom) {
    drawUiAlignedText(
      surface,
      textCol,
      nextRow,
      textWidth,
      content.title,
      resolvedTheme.titleStyle,
      'center'
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
    drawUiAlignedText(surface, textCol, nextRow, textWidth, line, resolvedTheme.bodyStyle, 'left');
    nextRow += 1;
  }

  if (footerRow !== null && footerText !== undefined) {
    drawUiAlignedText(
      surface,
      textCol,
      footerRow,
      textWidth,
      footerText,
      resolvedTheme.footerStyle,
      'right'
    );
  }

  return normalized;
}

export function buildUiModalOverlay(options: UiModalOverlayOptions): UiModalOverlay {
  const rect = layoutUiModalRect(
    options.viewportCols,
    options.viewportRows,
    options.width,
    options.height,
    options.anchor ?? 'center',
    options.marginRows ?? 1
  );

  const surface = createUiSurface(rect.width, rect.height, DEFAULT_UI_STYLE);
  const content: UiModalContent = {
    bodyLines: options.bodyLines ?? [],
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.footer !== undefined ? { footer: options.footer } : {}),
    ...(options.paddingX !== undefined ? { paddingX: options.paddingX } : {})
  };
  drawUiModal(
    surface,
    {
      col: 0,
      row: 0,
      width: rect.width,
      height: rect.height
    },
    content,
    options.theme
  );

  return {
    left: rect.col,
    top: rect.row,
    width: rect.width,
    height: rect.height,
    rows: renderUiSurfaceAnsiRows(surface)
  };
}

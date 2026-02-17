import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  drawUiText,
  fillUiRow,
  renderUiSurfaceAnsiRows,
  type UiStyle
} from '../ui/surface.ts';
import {
  paintUiRow
} from '../ui/kit.ts';
import { measureDisplayWidth } from '../terminal/snapshot-oracle.ts';
import {
  buildWorkspaceRailViewRows
} from './workspace-rail-model.ts';

type WorkspaceRailModel = Parameters<typeof buildWorkspaceRailViewRows>[0];
type WorkspaceRailViewRow = ReturnType<typeof buildWorkspaceRailViewRows>[number];

const NORMAL_STYLE = DEFAULT_UI_STYLE;
const HEADER_STYLE = {
  fg: { kind: 'indexed', index: 254 },
  bg: { kind: 'default' },
  bold: true
} as const;
const ACTIVE_ROW_STYLE = {
  fg: { kind: 'indexed', index: 254 },
  bg: { kind: 'indexed', index: 237 },
  bold: false
} as const;
const META_STYLE = {
  fg: { kind: 'indexed', index: 151 },
  bg: { kind: 'default' },
  bold: false
} as const;
const CONVERSATION_BODY_STYLE = {
  fg: { kind: 'indexed', index: 151 },
  bg: { kind: 'default' },
  bold: false
} as const;
const PROCESS_STYLE = {
  fg: { kind: 'indexed', index: 223 },
  bg: { kind: 'default' },
  bold: false
} as const;
const REPOSITORY_ROW_STYLE = {
  fg: { kind: 'indexed', index: 181 },
  bg: { kind: 'default' },
  bold: false
} as const;
const MUTED_STYLE = {
  fg: { kind: 'indexed', index: 245 },
  bg: { kind: 'default' },
  bold: false
} as const;
const SHORTCUT_STYLE = {
  fg: { kind: 'indexed', index: 250 },
  bg: { kind: 'default' },
  bold: false
} as const;
const ACTION_STYLE = {
  fg: { kind: 'indexed', index: 230 },
  bg: { kind: 'indexed', index: 237 },
  bold: false
} as const;
const INLINE_THREAD_BUTTON_LABEL = '[+ thread]';

function conversationStatusIconStyle(
  status: WorkspaceRailViewRow['conversationStatus'],
  active: boolean
): UiStyle {
  return {
    fg: {
      kind: 'indexed',
      index:
        status === 'working'
          ? 45
          : status === 'exited'
            ? 196
            : status === 'needs-action'
              ? 220
              : status === 'starting'
                ? 110
                : 245
    },
    bg: active ? { kind: 'indexed', index: 237 } : { kind: 'default' },
    bold: status === 'working'
  };
}

function treeTextStartColumn(text: string): number {
  let index = 0;
  while (index < text.length) {
    const token = text[index]!;
    if (token === '│' || token === '├' || token === '└' || token === '─' || token === ' ') {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function drawTreeRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow,
  contentStyle: UiStyle,
  activeContentStyle: UiStyle | null,
  options: {
    buttonLabel?: string;
    buttonStyle?: UiStyle;
    alignButtonRight?: boolean;
  } = {}
): void {
  fillUiRow(surface, rowIndex, NORMAL_STYLE);
  const buttonLabel = options.buttonLabel;
  const buttonStyle = options.buttonStyle;
  const alignButtonRight = options.alignButtonRight ?? false;
  const buttonTextStart =
    buttonLabel === undefined ? -1 : row.text.lastIndexOf(buttonLabel);
  const baseRowText =
    alignButtonRight && buttonLabel !== undefined && buttonTextStart >= 0
      ? row.text.slice(0, buttonTextStart).trimEnd()
      : row.text;
  const contentStart = treeTextStartColumn(baseRowText);
  const treePrefix = baseRowText.slice(0, contentStart);
  const content = baseRowText.slice(contentStart);
  drawUiText(surface, 0, rowIndex, treePrefix, MUTED_STYLE);
  drawUiText(
    surface,
    contentStart,
    rowIndex,
    content,
    row.active && activeContentStyle !== null ? activeContentStyle : contentStyle
  );
  if (buttonLabel === undefined || buttonStyle === undefined) {
    return;
  }
  if (buttonTextStart < 0) {
    return;
  }
  const buttonWidth = Math.max(1, measureDisplayWidth(buttonLabel));
  const buttonStart = alignButtonRight
    ? Math.max(0, surface.cols - buttonWidth)
    : buttonTextStart;
  drawUiText(surface, buttonStart, rowIndex, buttonLabel, buttonStyle);
}

function drawActionRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow
): void {
  fillUiRow(surface, rowIndex, NORMAL_STYLE);
  if (row.railAction === 'project.add') {
    const buttonStart = Math.max(0, Math.floor((surface.cols - row.text.length) / 2));
    drawUiText(surface, buttonStart, rowIndex, row.text, ACTION_STYLE);
    return;
  }
  drawUiText(surface, 0, rowIndex, row.text, MUTED_STYLE);
  const buttonStart = row.text.indexOf('[');
  const buttonEnd = row.text.lastIndexOf(']');
  const safeButtonStart = Math.max(0, buttonStart);
  drawUiText(
    surface,
    safeButtonStart,
    rowIndex,
    row.text.slice(safeButtonStart, Math.max(safeButtonStart, buttonEnd + 1)),
    ACTION_STYLE
  );
}

function drawDirectoryHeaderRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow
): void {
  drawTreeRow(surface, rowIndex, row, HEADER_STYLE, ACTIVE_ROW_STYLE, {
    buttonLabel: INLINE_THREAD_BUTTON_LABEL,
    buttonStyle: ACTION_STYLE,
    alignButtonRight: true
  });
}

function drawConversationRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow
): void {
  const rowStyle = row.kind === 'conversation-body' ? CONVERSATION_BODY_STYLE : NORMAL_STYLE;
  drawTreeRow(surface, rowIndex, row, rowStyle, ACTIVE_ROW_STYLE);
  if (row.kind !== 'conversation-title') {
    return;
  }
  const statusStyle = conversationStatusIconStyle(row.conversationStatus, row.active);
  const statusMatch = row.text.match(/[▲◔◆○■]/u);
  if (statusMatch === null || statusMatch.index === undefined) {
    return;
  }
  drawUiText(surface, statusMatch.index, rowIndex, statusMatch[0], statusStyle);
}

function paintWorkspaceRailRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow
): void {
  if (row.kind === 'dir-header') {
    drawDirectoryHeaderRow(surface, rowIndex, row);
    return;
  }
  if (row.kind === 'dir-meta') {
    drawTreeRow(surface, rowIndex, row, META_STYLE, ACTIVE_ROW_STYLE);
    return;
  }
  if (row.kind === 'conversation-title' || row.kind === 'conversation-body') {
    drawConversationRow(surface, rowIndex, row);
    return;
  }
  if (row.kind === 'process-title' || row.kind === 'process-meta') {
    paintUiRow(surface, rowIndex, row.text, PROCESS_STYLE, NORMAL_STYLE);
    return;
  }
  if (row.kind === 'repository-header') {
    const buttonLabel = row.text.endsWith('[+]') ? '[+]' : row.text.endsWith('[-]') ? '[-]' : null;
    if (buttonLabel === null) {
      drawTreeRow(surface, rowIndex, row, HEADER_STYLE, ACTIVE_ROW_STYLE);
    } else {
      drawTreeRow(surface, rowIndex, row, HEADER_STYLE, ACTIVE_ROW_STYLE, {
        buttonLabel,
        buttonStyle: ACTION_STYLE
      });
    }
    return;
  }
  if (row.kind === 'repository-row') {
    paintUiRow(surface, rowIndex, row.text, REPOSITORY_ROW_STYLE, NORMAL_STYLE);
    return;
  }
  if (row.kind === 'shortcut-header') {
    const buttonLabel = row.text.endsWith('[+]') ? '[+]' : row.text.endsWith('[-]') ? '[-]' : null;
    if (buttonLabel === null) {
      drawTreeRow(surface, rowIndex, row, HEADER_STYLE, ACTIVE_ROW_STYLE);
    } else {
      drawTreeRow(surface, rowIndex, row, HEADER_STYLE, ACTIVE_ROW_STYLE, {
        buttonLabel,
        buttonStyle: ACTION_STYLE
      });
    }
    return;
  }
  if (row.kind === 'shortcut-body') {
    paintUiRow(surface, rowIndex, row.text, SHORTCUT_STYLE);
    return;
  }
  if (row.kind === 'action') {
    drawActionRow(surface, rowIndex, row);
    return;
  }
  if (row.kind === 'muted') {
    paintUiRow(surface, rowIndex, row.text, MUTED_STYLE, NORMAL_STYLE);
  }
}

export function renderWorkspaceRailRowAnsiForTest(
  row: WorkspaceRailViewRow,
  width: number
): string {
  const safeWidth = Math.max(1, width);
  const surface = createUiSurface(safeWidth, 1, DEFAULT_UI_STYLE);
  paintWorkspaceRailRow(surface, 0, row);
  return renderUiSurfaceAnsiRows(surface)[0]!;
}

export function renderWorkspaceRailAnsiRows(
  model: WorkspaceRailModel,
  width: number,
  maxRows: number
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const safeRows = Math.max(1, maxRows);
  const rows = buildWorkspaceRailViewRows(model, safeRows);
  const surface = createUiSurface(safeWidth, safeRows, DEFAULT_UI_STYLE);

  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const row = rows[rowIndex]!;
    paintWorkspaceRailRow(surface, rowIndex, row);
  }

  return renderUiSurfaceAnsiRows(surface);
}

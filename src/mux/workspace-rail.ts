import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  drawUiText,
  fillUiRow,
  renderUiSurfaceAnsiRows,
  type UiStyle
} from '../ui/surface.ts';
import {
  paintUiRow,
  paintUiRowWithTrailingLabel
} from '../ui/kit.ts';
import {
  buildWorkspaceRailViewRows
} from './workspace-rail-model.ts';

type WorkspaceRailModel = Parameters<typeof buildWorkspaceRailViewRows>[0];
type WorkspaceRailViewRow = ReturnType<typeof buildWorkspaceRailViewRows>[number];

const NORMAL_STYLE = DEFAULT_UI_STYLE;
const HEADER_STYLE = {
  fg: { kind: 'indexed', index: 254 },
  bg: { kind: 'indexed', index: 236 },
  bold: true
} as const;
const ACTIVE_DIR_HEADER_STYLE = {
  fg: { kind: 'indexed', index: 254 },
  bg: { kind: 'indexed', index: 238 },
  bold: true
} as const;
const META_STYLE = {
  fg: { kind: 'indexed', index: 151 },
  bg: { kind: 'default' },
  bold: false
} as const;
const ACTIVE_DIR_META_STYLE = {
  fg: { kind: 'indexed', index: 153 },
  bg: { kind: 'indexed', index: 238 },
  bold: false
} as const;
const ACTIVE_CONVERSATION_TITLE_STYLE = {
  fg: { kind: 'indexed', index: 254 },
  bg: { kind: 'indexed', index: 237 },
  bold: false
} as const;
const CONVERSATION_BODY_STYLE = {
  fg: { kind: 'indexed', index: 151 },
  bg: { kind: 'default' },
  bold: false
} as const;
const ACTIVE_CONVERSATION_BODY_STYLE = {
  fg: { kind: 'indexed', index: 153 },
  bg: { kind: 'indexed', index: 237 },
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
const ACTIVE_CONVERSATION_PREFIX_STYLE = {
  fg: { kind: 'indexed', index: 245 },
  bg: { kind: 'indexed', index: 237 },
  bold: false
} as const;
const SHORTCUT_STYLE = {
  fg: { kind: 'indexed', index: 250 },
  bg: { kind: 'indexed', index: 236 },
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

function drawActionRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow
): void {
  fillUiRow(surface, rowIndex, NORMAL_STYLE);
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
  const style = row.active ? ACTIVE_DIR_HEADER_STYLE : HEADER_STYLE;
  const buttonStart = row.text.lastIndexOf(INLINE_THREAD_BUTTON_LABEL);
  if (buttonStart < 0) {
    paintUiRow(surface, rowIndex, row.text, style);
    return;
  }
  paintUiRowWithTrailingLabel(
    surface,
    rowIndex,
    row.text.slice(0, buttonStart).trimEnd(),
    INLINE_THREAD_BUTTON_LABEL,
    style,
    ACTION_STYLE,
    style
  );
}

function drawConversationRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow
): void {
  const rowStyle = row.active
    ? row.kind === 'conversation-body'
      ? ACTIVE_CONVERSATION_BODY_STYLE
      : ACTIVE_CONVERSATION_TITLE_STYLE
    : row.kind === 'conversation-body'
      ? CONVERSATION_BODY_STYLE
      : NORMAL_STYLE;
  fillUiRow(surface, rowIndex, rowStyle);
  const prefixStyle = row.active ? ACTIVE_CONVERSATION_PREFIX_STYLE : MUTED_STYLE;
  drawUiText(surface, 0, rowIndex, '│ ', prefixStyle);
  const text = row.text.slice(2);
  const statusStyle = conversationStatusIconStyle(row.conversationStatus, row.active);
  drawUiText(surface, 2, rowIndex, text, rowStyle);
  if (row.kind !== 'conversation-title') {
    return;
  }
  drawUiText(surface, 5, rowIndex, row.text.slice(5, 6), statusStyle);
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
    const textStyle = row.active ? ACTIVE_DIR_META_STYLE : META_STYLE;
    const fillStyle = row.active ? ACTIVE_DIR_META_STYLE : NORMAL_STYLE;
    paintUiRow(surface, rowIndex, row.text, textStyle, fillStyle);
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
    paintUiRow(surface, rowIndex, row.text, HEADER_STYLE);
    return;
  }
  if (row.kind === 'repository-row') {
    paintUiRow(surface, rowIndex, row.text, REPOSITORY_ROW_STYLE, NORMAL_STYLE);
    return;
  }
  if (row.kind === 'shortcut-header') {
    paintUiRow(surface, rowIndex, row.text, HEADER_STYLE);
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

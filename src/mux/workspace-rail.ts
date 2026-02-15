import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  drawUiText,
  fillUiRow,
  renderUiSurfaceAnsiRows
} from '../ui/surface.ts';
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
const META_STYLE = {
  fg: { kind: 'indexed', index: 151 },
  bg: { kind: 'default' },
  bold: false
} as const;
const ACTIVE_TITLE_STYLE = {
  fg: { kind: 'indexed', index: 254 },
  bg: { kind: 'indexed', index: 238 },
  bold: false
} as const;
const ACTIVE_META_STYLE = {
  fg: { kind: 'indexed', index: 153 },
  bg: { kind: 'indexed', index: 238 },
  bold: false
} as const;
const PROCESS_STYLE = {
  fg: { kind: 'indexed', index: 223 },
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
  bg: { kind: 'indexed', index: 236 },
  bold: false
} as const;
const ACTION_STYLE = {
  fg: { kind: 'indexed', index: 230 },
  bg: { kind: 'indexed', index: 237 },
  bold: false
} as const;

function drawConversationRow(
  surface: ReturnType<typeof createUiSurface>,
  rowIndex: number,
  row: WorkspaceRailViewRow
): void {
  if (row.active) {
    fillUiRow(surface, rowIndex, row.kind === 'conversation-meta' ? ACTIVE_META_STYLE : ACTIVE_TITLE_STYLE);
  } else {
    fillUiRow(surface, rowIndex, NORMAL_STYLE);
  }
  drawUiText(surface, 0, rowIndex, '│ ', MUTED_STYLE);
  const text = row.text.slice(2);
  if (row.active) {
    const style = row.kind === 'conversation-meta' ? ACTIVE_META_STYLE : ACTIVE_TITLE_STYLE;
    drawUiText(surface, 2, rowIndex, text, style);
    return;
  }
  const style = row.kind === 'conversation-meta' ? META_STYLE : NORMAL_STYLE;
  drawUiText(surface, 2, rowIndex, text, style);
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
    if (row.kind === 'dir-header') {
      fillUiRow(surface, rowIndex, HEADER_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, HEADER_STYLE);
      continue;
    }
    if (row.kind === 'dir-meta') {
      fillUiRow(surface, rowIndex, NORMAL_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, META_STYLE);
      continue;
    }
    if (row.kind === 'conversation-title' || row.kind === 'conversation-meta') {
      drawConversationRow(surface, rowIndex, row);
      continue;
    }
    if (row.kind === 'process-title' || row.kind === 'process-meta') {
      fillUiRow(surface, rowIndex, NORMAL_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, PROCESS_STYLE);
      continue;
    }
    if (row.kind === 'shortcut-header') {
      fillUiRow(surface, rowIndex, HEADER_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, HEADER_STYLE);
      continue;
    }
    if (row.kind === 'shortcut-body') {
      fillUiRow(surface, rowIndex, SHORTCUT_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, SHORTCUT_STYLE);
      continue;
    }
    if (row.kind === 'action') {
      fillUiRow(surface, rowIndex, ACTION_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, ACTION_STYLE);
      continue;
    }
    if (row.kind === 'muted') {
      fillUiRow(surface, rowIndex, NORMAL_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, MUTED_STYLE);
      continue;
    }
  }

  return renderUiSurfaceAnsiRows(surface);
}

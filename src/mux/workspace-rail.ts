import { UiKit } from '../../packages/harness-ui/src/kit.ts';
import {
  DEFAULT_UI_STYLE,
  SurfaceBuffer,
  type UiStyle,
} from '../../packages/harness-ui/src/surface.ts';
import { measureDisplayWidth } from '../terminal/snapshot-oracle.ts';
import { buildWorkspaceRailViewRows } from './workspace-rail-model.ts';
import { getActiveMuxTheme, type MuxWorkspaceRailTheme } from '../ui/mux-theme.ts';

type WorkspaceRailModel = Parameters<typeof buildWorkspaceRailViewRows>[0];
type WorkspaceRailViewRow = ReturnType<typeof buildWorkspaceRailViewRows>[number];

const INLINE_THREAD_BUTTON_LABEL = '[+ thread]';
const UI_KIT = new UiKit();

function conversationStatusIconStyle(
  status: WorkspaceRailViewRow['conversationStatus'],
  active: boolean,
  theme: MuxWorkspaceRailTheme,
): UiStyle {
  return {
    fg:
      status === 'working'
        ? theme.statusColors.working
        : status === 'exited'
          ? theme.statusColors.exited
          : status === 'needs-action'
            ? theme.statusColors.needsAction
            : status === 'starting'
              ? theme.statusColors.starting
              : theme.statusColors.idle,
    bg: active ? theme.activeRowStyle.bg : { kind: 'default' },
    bold: status === 'working',
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
  surface: SurfaceBuffer,
  rowIndex: number,
  row: WorkspaceRailViewRow,
  theme: MuxWorkspaceRailTheme,
  contentStyle: UiStyle,
  activeContentStyle: UiStyle | null,
  options: {
    buttonLabel?: string;
    buttonStyle?: UiStyle;
    alignButtonRight?: boolean;
  } = {},
): void {
  surface.fillRow(rowIndex, theme.normalStyle);
  const buttonLabel = options.buttonLabel;
  const buttonStyle = options.buttonStyle;
  const alignButtonRight = options.alignButtonRight ?? false;
  const buttonTextStart = buttonLabel === undefined ? -1 : row.text.lastIndexOf(buttonLabel);
  const baseRowText =
    alignButtonRight && buttonLabel !== undefined && buttonTextStart >= 0
      ? row.text.slice(0, buttonTextStart).trimEnd()
      : row.text;
  const contentStart = treeTextStartColumn(baseRowText);
  const treePrefix = baseRowText.slice(0, contentStart);
  const content = baseRowText.slice(contentStart);
  surface.drawText(0, rowIndex, treePrefix, theme.mutedStyle);
  surface.drawText(
    contentStart,
    rowIndex,
    content,
    row.active && activeContentStyle !== null ? activeContentStyle : contentStyle,
  );
  if (buttonLabel === undefined || buttonStyle === undefined) {
    return;
  }
  if (buttonTextStart < 0) {
    return;
  }
  const buttonWidth = Math.max(1, measureDisplayWidth(buttonLabel));
  const buttonStart = alignButtonRight ? Math.max(0, surface.cols - buttonWidth) : buttonTextStart;
  surface.drawText(buttonStart, rowIndex, buttonLabel, buttonStyle);
}

function drawActionRow(
  surface: SurfaceBuffer,
  rowIndex: number,
  row: WorkspaceRailViewRow,
  theme: MuxWorkspaceRailTheme,
): void {
  surface.fillRow(rowIndex, theme.normalStyle);
  if (row.railAction === 'project.add') {
    surface.drawText(0, rowIndex, '│', theme.mutedStyle);
    const buttonStart = Math.max(0, Math.floor((surface.cols - row.text.length) / 2));
    surface.drawText(buttonStart, rowIndex, row.text, theme.actionStyle);
    return;
  }
  surface.drawText(0, rowIndex, row.text, theme.mutedStyle);
  const buttonStart = row.text.indexOf('[');
  const buttonEnd = row.text.lastIndexOf(']');
  const safeButtonStart = Math.max(0, buttonStart);
  surface.drawText(
    safeButtonStart,
    rowIndex,
    row.text.slice(safeButtonStart, Math.max(safeButtonStart, buttonEnd + 1)),
    theme.actionStyle,
  );
}

function drawDirectoryHeaderRow(
  surface: SurfaceBuffer,
  rowIndex: number,
  row: WorkspaceRailViewRow,
  theme: MuxWorkspaceRailTheme,
): void {
  drawTreeRow(surface, rowIndex, row, theme, theme.headerStyle, theme.activeRowStyle, {
    buttonLabel: INLINE_THREAD_BUTTON_LABEL,
    buttonStyle: theme.actionStyle,
    alignButtonRight: true,
  });
}

function drawConversationRow(
  surface: SurfaceBuffer,
  rowIndex: number,
  row: WorkspaceRailViewRow,
  theme: MuxWorkspaceRailTheme,
): void {
  const rowStyle =
    row.kind === 'conversation-body' ? theme.conversationBodyStyle : theme.normalStyle;
  drawTreeRow(surface, rowIndex, row, theme, rowStyle, theme.activeRowStyle);
  if (row.kind !== 'conversation-title') {
    return;
  }
  const statusStyle = conversationStatusIconStyle(row.conversationStatus, row.active, theme);
  const statusMatch = row.text.match(/[▲◔◆○■]/u);
  if (statusMatch === null || statusMatch.index === undefined) {
    return;
  }
  surface.drawText(statusMatch.index, rowIndex, statusMatch[0], statusStyle);
}

function paintWorkspaceRailRow(
  surface: SurfaceBuffer,
  rowIndex: number,
  row: WorkspaceRailViewRow,
  theme: MuxWorkspaceRailTheme,
): void {
  if (row.kind === 'dir-header') {
    drawDirectoryHeaderRow(surface, rowIndex, row, theme);
    return;
  }
  if (row.kind === 'dir-meta') {
    drawTreeRow(surface, rowIndex, row, theme, theme.metaStyle, theme.activeRowStyle);
    return;
  }
  if (row.kind === 'conversation-title' || row.kind === 'conversation-body') {
    drawConversationRow(surface, rowIndex, row, theme);
    return;
  }
  if (row.kind === 'process-title' || row.kind === 'process-meta') {
    UI_KIT.paintRow(surface, rowIndex, row.text, theme.processStyle, theme.normalStyle);
    return;
  }
  if (row.kind === 'repository-header') {
    const buttonLabel = row.text.endsWith('[+]') ? '[+]' : row.text.endsWith('[-]') ? '[-]' : null;
    if (buttonLabel === null) {
      drawTreeRow(surface, rowIndex, row, theme, theme.headerStyle, theme.activeRowStyle);
    } else {
      drawTreeRow(surface, rowIndex, row, theme, theme.headerStyle, theme.activeRowStyle, {
        buttonLabel,
        buttonStyle: theme.actionStyle,
      });
    }
    return;
  }
  if (row.kind === 'repository-row') {
    UI_KIT.paintRow(surface, rowIndex, row.text, theme.repositoryRowStyle, theme.normalStyle);
    return;
  }
  if (row.kind === 'shortcut-header') {
    const buttonLabel = row.text.endsWith('[+]') ? '[+]' : row.text.endsWith('[-]') ? '[-]' : null;
    if (buttonLabel === null) {
      drawTreeRow(surface, rowIndex, row, theme, theme.headerStyle, theme.activeRowStyle);
    } else {
      drawTreeRow(surface, rowIndex, row, theme, theme.headerStyle, theme.activeRowStyle, {
        buttonLabel,
        buttonStyle: theme.actionStyle,
      });
    }
    return;
  }
  if (row.kind === 'shortcut-body') {
    UI_KIT.paintRow(surface, rowIndex, row.text, theme.shortcutStyle);
    return;
  }
  if (row.kind === 'action') {
    drawActionRow(surface, rowIndex, row, theme);
    return;
  }
  if (row.kind === 'muted') {
    UI_KIT.paintRow(surface, rowIndex, row.text, theme.mutedStyle, theme.normalStyle);
  }
}

export function renderWorkspaceRailRowAnsiForTest(
  row: WorkspaceRailViewRow,
  width: number,
): string {
  const safeWidth = Math.max(1, width);
  const theme = getActiveMuxTheme().workspaceRail;
  const surface = new SurfaceBuffer(safeWidth, 1, DEFAULT_UI_STYLE);
  paintWorkspaceRailRow(surface, 0, row, theme);
  return surface.renderAnsiRows()[0]!;
}

export function renderWorkspaceRailAnsiRows(
  model: WorkspaceRailModel,
  width: number,
  maxRows: number,
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const safeRows = Math.max(1, maxRows);
  const theme = getActiveMuxTheme().workspaceRail;
  const rows = buildWorkspaceRailViewRows(model, safeRows);
  const surface = new SurfaceBuffer(safeWidth, safeRows, DEFAULT_UI_STYLE);

  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const row = rows[rowIndex]!;
    paintWorkspaceRailRow(surface, rowIndex, row, theme);
  }

  return surface.renderAnsiRows();
}

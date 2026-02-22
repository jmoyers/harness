import {
  DEFAULT_UI_STYLE,
  SurfaceBuffer,
  type UiColor,
  type UiStyle,
} from '../../../packages/harness-ui/src/surface.ts';
import { UiKit } from '../../../packages/harness-ui/src/kit.ts';
import { measureDisplayWidth } from '../../terminal/snapshot-oracle.ts';
import { getActiveMuxTheme } from '../mux-theme.ts';

interface NimPaneLayout {
  readonly rightCols: number;
  readonly paneRows: number;
}

interface NimPaneRenderInput {
  readonly layout: NimPaneLayout;
  readonly viewModel: NimPaneViewModel;
}

interface NimPaneRenderResult {
  readonly rows: readonly string[];
}

const HEADER = 'nim';
const COMPOSER_PROMPT = 'nim> ';
const USER_TRANSCRIPT_PREFIX = 'you> ';
const ASSISTANT_TRANSCRIPT_PREFIX = 'nim> ';
const uiKit = new UiKit();

export interface NimPaneViewModel {
  readonly sessionId: string | null;
  readonly status: 'thinking' | 'tool-calling' | 'responding' | 'idle';
  readonly uiMode: 'debug' | 'user';
  readonly composerText: string;
  readonly queuedCount: number;
  readonly transcriptLines: readonly string[];
  readonly assistantDraftText: string;
}

export class NimPane {
  render(input: NimPaneRenderInput): NimPaneRenderResult {
    const viewModel = input.viewModel;
    const safeRows = Math.max(0, input.layout.paneRows);
    const safeCols = Math.max(1, input.layout.rightCols);
    if (safeRows === 0) {
      return { rows: [] };
    }
    const theme = getActiveMuxTheme();
    const railTheme = theme.workspaceRail;
    const conversationTheme = theme.conversationRail;
    const surface = new SurfaceBuffer(safeCols, safeRows, DEFAULT_UI_STYLE);
    const backgroundStyle = withStyle(railTheme.normalStyle, {
      bg: resolveDefaultBackgroundColor(theme),
    });
    for (let row = 0; row < safeRows; row += 1) {
      surface.fillRow(row, backgroundStyle);
    }
    const topBandFill = withStyle(conversationTheme.headerStyle, {
      bg: resolveTopBandBackgroundColor(theme),
      dim: false,
    });
    const topBandText = withStyle(railTheme.headerStyle, {
      bg: topBandFill.bg,
      bold: true,
    });
    const bodyText = withStyle(railTheme.normalStyle, {
      bg: backgroundStyle.bg,
    });
    const mutedText = withStyle(railTheme.mutedStyle, {
      bg: backgroundStyle.bg,
      dim: true,
    });
    const actionText = withStyle(railTheme.actionStyle, {
      bg: backgroundStyle.bg,
      bold: true,
    });
    const statusBadge = statusBadgeStyle(viewModel.status, railTheme.statusColors);

    paintRow(surface, 0, ` ${HEADER}`, topBandText, topBandFill);
    drawStatusChip(surface, 0, safeCols, viewModel.status, statusBadge);
    if (safeRows > 1) {
      const sessionLabel =
        viewModel.sessionId === null ? 'no-session' : viewModel.sessionId.slice(0, 8);
      paintRow(
        surface,
        1,
        ` session:${sessionLabel}  mode:${viewModel.uiMode}  queued:${String(viewModel.queuedCount)}`,
        withStyle(railTheme.metaStyle, {
          bg: topBandFill.bg,
        }),
        topBandFill,
      );
    }
    if (safeRows > 2) {
      paintRow(
        surface,
        2,
        ' enter=send/steer  tab=queue  esc=abort  /mode debug|user',
        mutedText,
        topBandFill,
      );
    }
    if (safeRows > 3) {
      paintSectionDivider(surface, 3, 'transcript', mutedText, backgroundStyle);
    }

    const composerDividerRow = Math.max(0, safeRows - 2);
    const composerRow = Math.max(0, safeRows - 1);
    const composerFill = withStyle(railTheme.activeRowStyle, {
      bg: resolveComposerBackgroundColor(theme),
    });
    paintSectionDivider(surface, composerDividerRow, 'composer', mutedText, composerFill);
    surface.fillRow(composerRow, composerFill);
    const promptWidth = measureDisplayWidth(COMPOSER_PROMPT);
    surface.drawText(0, composerRow, COMPOSER_PROMPT, actionText);
    surface.drawText(promptWidth, composerRow, viewModel.composerText, bodyText);

    const transcriptStartRow = Math.min(4, safeRows - 1);
    const transcriptEndRow = Math.max(transcriptStartRow - 1, composerDividerRow - 1);
    const transcriptCapacity = Math.max(0, transcriptEndRow - transcriptStartRow + 1);
    const assistantDraftRow =
      viewModel.assistantDraftText.length > 0 ? [`nim> ${viewModel.assistantDraftText}`] : [];
    const transcriptRows = [...viewModel.transcriptLines, ...assistantDraftRow];
    const visibleRows =
      transcriptCapacity === 0
        ? []
        : transcriptRows.slice(Math.max(0, transcriptRows.length - transcriptCapacity));
    for (let index = 0; index < visibleRows.length; index += 1) {
      const row = visibleRows[index];
      if (row === undefined) {
        continue;
      }
      const rowIndex = transcriptStartRow + index;
      const formatted = formatTranscriptLine(row);
      surface.fillRow(rowIndex, backgroundStyle);
      surface.drawText(1, rowIndex, formatted.symbol, formatted.symbolStyle);
      uiKit.paintRow(
        surface,
        rowIndex,
        `  ${formatted.text}`,
        formatted.textStyle,
        backgroundStyle,
      );
    }

    return {
      rows: surface.renderAnsiRows(),
    };
  }
}

function formatTranscriptLine(line: string): {
  readonly symbol: string;
  readonly symbolStyle: UiStyle;
  readonly text: string;
  readonly textStyle: UiStyle;
} {
  const theme = getActiveMuxTheme();
  const railTheme = theme.workspaceRail;
  const bodyText = withStyle(railTheme.normalStyle, {
    bg: resolveDefaultBackgroundColor(theme),
  });
  const mutedText = withStyle(railTheme.mutedStyle, {
    bg: resolveDefaultBackgroundColor(theme),
    dim: true,
  });
  const accentText = withStyle(railTheme.actionStyle, {
    bg: resolveDefaultBackgroundColor(theme),
    bold: false,
  });
  if (line.startsWith(USER_TRANSCRIPT_PREFIX)) {
    return {
      symbol: '›',
      symbolStyle: accentText,
      text: line,
      textStyle: accentText,
    };
  }
  if (line.startsWith(ASSISTANT_TRANSCRIPT_PREFIX)) {
    return {
      symbol: '•',
      symbolStyle: bodyText,
      text: line,
      textStyle: bodyText,
    };
  }
  if (line.startsWith('[error]')) {
    return {
      symbol: '!',
      symbolStyle: withStyle(railTheme.actionStyle, {
        fg: railTheme.statusColors.exited,
        bg: resolveDefaultBackgroundColor(theme),
        bold: true,
      }),
      text: line,
      textStyle: withStyle(railTheme.metaStyle, {
        fg: railTheme.statusColors.exited,
        bg: resolveDefaultBackgroundColor(theme),
      }),
    };
  }
  if (line.startsWith('[tool:')) {
    return {
      symbol: '↳',
      symbolStyle: withStyle(railTheme.metaStyle, {
        fg: railTheme.statusColors.starting,
        bg: resolveDefaultBackgroundColor(theme),
      }),
      text: line,
      textStyle: mutedText,
    };
  }
  return {
    symbol: '•',
    symbolStyle: mutedText,
    text: line,
    textStyle: mutedText,
  };
}

function paintRow(
  surface: SurfaceBuffer,
  row: number,
  text: string,
  textStyle: UiStyle,
  fillStyle: UiStyle,
): void {
  surface.fillRow(row, fillStyle);
  uiKit.paintRow(surface, row, text, textStyle, fillStyle);
}

function paintSectionDivider(
  surface: SurfaceBuffer,
  row: number,
  label: string,
  textStyle: UiStyle,
  fillStyle: UiStyle,
): void {
  const divider = ` ${'-'.repeat(Math.max(0, surface.cols - label.length - 3))} ${label}`;
  paintRow(surface, row, divider, textStyle, fillStyle);
}

function withStyle(base: UiStyle, overrides: Partial<UiStyle>): UiStyle {
  return {
    fg: overrides.fg ?? base.fg,
    bg: overrides.bg ?? base.bg,
    bold: overrides.bold ?? base.bold,
    ...(resolveStyleFlag(base.dim, overrides.dim) ? { dim: true } : {}),
    ...(resolveStyleFlag(base.italic, overrides.italic) ? { italic: true } : {}),
    ...(resolveStyleFlag(base.underline, overrides.underline) ? { underline: true } : {}),
    ...(resolveStyleFlag(base.inverse, overrides.inverse) ? { inverse: true } : {}),
  };
}

function resolveStyleFlag(base: boolean | undefined, override: boolean | undefined): boolean {
  if (override === undefined) {
    return base === true;
  }
  return override;
}

function resolveDefaultBackgroundColor(theme: ReturnType<typeof getActiveMuxTheme>): UiColor {
  const bg = theme.conversationRail.normalRowStyle.bg;
  return bg.kind === 'default' ? theme.workspaceRail.normalStyle.bg : bg;
}

function resolveTopBandBackgroundColor(theme: ReturnType<typeof getActiveMuxTheme>): UiColor {
  const bg = theme.conversationRail.headerStyle.bg;
  return bg.kind === 'default' ? resolveDefaultBackgroundColor(theme) : bg;
}

function resolveComposerBackgroundColor(theme: ReturnType<typeof getActiveMuxTheme>): UiColor {
  const bg = theme.workspaceRail.activeRowStyle.bg;
  return bg.kind === 'default' ? resolveTopBandBackgroundColor(theme) : bg;
}

function statusBadgeStyle(
  status: NimPaneViewModel['status'],
  colors: {
    readonly working: UiColor;
    readonly exited: UiColor;
    readonly needsAction: UiColor;
    readonly starting: UiColor;
    readonly idle: UiColor;
  },
): UiStyle {
  const color =
    status === 'thinking'
      ? colors.starting
      : status === 'tool-calling'
        ? colors.needsAction
        : status === 'responding'
          ? colors.working
          : colors.idle;
  return {
    fg: color,
    bg: { kind: 'default' },
    bold: true,
    inverse: true,
  };
}

function drawStatusChip(
  surface: SurfaceBuffer,
  row: number,
  cols: number,
  status: NimPaneViewModel['status'],
  style: UiStyle,
): void {
  const label = ` ${status} `;
  const width = measureDisplayWidth(label);
  const col = Math.max(0, cols - width - 1);
  surface.drawText(col, row, label, style);
}

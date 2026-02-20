import { padOrTrimDisplay } from '../mux/dual-pane-core.ts';
import { renderSyntaxAnsiLine } from './highlight.ts';
import type {
  DiffUiModel,
  DiffUiRenderOutput,
  DiffUiRenderTheme,
  DiffUiState,
  DiffUiSyntaxMode,
  DiffUiViewMode,
  DiffUiVirtualRow,
  DiffUiWordDiffMode,
} from './types.ts';

const RESET_ANSI = '\u001b[0m';

function fg(index: number): string {
  return `\u001b[38;5;${String(index)}m`;
}

function fgBg(fgIndex: number, bgIndex: number, bold = false): string {
  const boldCode = bold ? '1;' : '';
  return `\u001b[${boldCode}38;5;${String(fgIndex)};48;5;${String(bgIndex)}m`;
}

export const DEFAULT_DIFF_UI_THEME: DiffUiRenderTheme = {
  headerAnsi: fgBg(231, 24, true),
  footerAnsi: fgBg(252, 236),
  fileHeaderAnsi: fgBg(230, 238, true),
  hunkHeaderAnsi: fgBg(159, 237, true),
  contextAnsi: fg(252),
  addAnsi: fgBg(120, 22),
  delAnsi: fgBg(224, 52),
  noticeAnsi: fgBg(230, 94, true),
  gutterAnsi: fg(244),
  resetAnsi: RESET_ANSI,
  syntaxKeywordAnsi: fg(81),
  syntaxStringAnsi: fg(114),
  syntaxCommentAnsi: fg(245),
  syntaxNumberAnsi: fg(221),
};

export function resolveDiffUiTheme(theme: string | null): DiffUiRenderTheme {
  if (theme === null || theme === 'default') {
    return DEFAULT_DIFF_UI_THEME;
  }
  if (theme === 'plain') {
    return {
      ...DEFAULT_DIFF_UI_THEME,
      headerAnsi: '',
      footerAnsi: '',
      fileHeaderAnsi: '',
      hunkHeaderAnsi: '',
      contextAnsi: '',
      addAnsi: '',
      delAnsi: '',
      noticeAnsi: '',
      gutterAnsi: '',
      syntaxKeywordAnsi: '',
      syntaxStringAnsi: '',
      syntaxCommentAnsi: '',
      syntaxNumberAnsi: '',
    };
  }
  throw new Error(`unknown theme: ${theme}`);
}

function syntaxEnabled(color: boolean, syntaxMode: DiffUiSyntaxMode): boolean {
  if (!color) {
    return false;
  }
  if (syntaxMode === 'on') {
    return true;
  }
  if (syntaxMode === 'off') {
    return false;
  }
  return true;
}

function wordDiffEnabled(color: boolean, wordDiffMode: DiffUiWordDiffMode): boolean {
  if (!color) {
    return false;
  }
  if (wordDiffMode === 'on') {
    return true;
  }
  if (wordDiffMode === 'off') {
    return false;
  }
  return true;
}

function formatLineNumber(value: number | null): string {
  if (value === null) {
    return '    ';
  }
  const text = String(value);
  return padOrTrimDisplay(text.length > 4 ? text.slice(-4) : text.padStart(4, ' '), 4);
}

function renderUnifiedRow(row: DiffUiVirtualRow, width: number): string {
  if (row.kind === 'code-add' || row.kind === 'code-del' || row.kind === 'code-context') {
    const oldCol = formatLineNumber(row.oldLine);
    const newCol = formatLineNumber(row.newLine);
    return padOrTrimDisplay(`${oldCol} ${newCol} ${row.unified}`, width);
  }
  return padOrTrimDisplay(row.unified, width);
}

function renderSplitRow(row: DiffUiVirtualRow, width: number): string {
  if (row.kind !== 'code-add' && row.kind !== 'code-del' && row.kind !== 'code-context') {
    return padOrTrimDisplay(row.unified, width);
  }

  const divider = ' │ ';
  const half = Math.max(1, Math.floor((width - divider.length) / 2));
  const left = padOrTrimDisplay(`${formatLineNumber(row.oldLine)} ${row.left}`, half);
  const right = padOrTrimDisplay(`${formatLineNumber(row.newLine)} ${row.right}`, half);
  return `${left}${divider}${right}`;
}

function baseAnsiForRow(row: DiffUiVirtualRow, theme: DiffUiRenderTheme): string {
  if (row.kind === 'file-header') {
    return theme.fileHeaderAnsi;
  }
  if (row.kind === 'hunk-header') {
    return theme.hunkHeaderAnsi;
  }
  if (row.kind === 'code-add') {
    return theme.addAnsi;
  }
  if (row.kind === 'code-del') {
    return theme.delAnsi;
  }
  if (row.kind === 'notice') {
    return theme.noticeAnsi;
  }
  return theme.contextAnsi;
}

function applyWordDiffHint(text: string, enabled: boolean): string {
  if (!enabled) {
    return text;
  }
  return text.replaceAll('\t', '  ');
}

function decorateRow(input: {
  readonly row: DiffUiVirtualRow;
  readonly plainText: string;
  readonly theme: DiffUiRenderTheme;
  readonly color: boolean;
  readonly syntaxMode: DiffUiSyntaxMode;
  readonly wordDiffMode: DiffUiWordDiffMode;
}): string {
  const baseAnsi = baseAnsiForRow(input.row, input.theme);
  const syntaxOn = syntaxEnabled(input.color, input.syntaxMode);
  const wordDiffOn = wordDiffEnabled(input.color, input.wordDiffMode);
  const withWordHint = applyWordDiffHint(input.plainText, wordDiffOn);

  let body = withWordHint;
  if (
    syntaxOn &&
    (input.row.kind === 'code-add' ||
      input.row.kind === 'code-del' ||
      input.row.kind === 'code-context')
  ) {
    body = renderSyntaxAnsiLine({
      line: body,
      language: input.row.language,
      theme: input.theme,
      colorEnabled: input.color,
      baseAnsi,
    });
  }

  if (!input.color || baseAnsi.length === 0) {
    return body;
  }
  return `${baseAnsi}${body}${input.theme.resetAnsi}`;
}

function renderHeader(input: {
  readonly model: DiffUiModel;
  readonly state: DiffUiState;
  readonly width: number;
  readonly color: boolean;
  readonly theme: DiffUiRenderTheme;
}): string {
  const files = input.model.diff.totals.filesChanged;
  const hunks = input.model.diff.totals.hunks;
  const lines = input.model.diff.totals.lines;
  const text = padOrTrimDisplay(
    `[diff] mode=${input.model.diff.spec.mode} view=${input.state.effectiveViewMode} files=${files} hunks=${hunks} lines=${lines}`,
    input.width,
  );
  if (!input.color || input.theme.headerAnsi.length === 0) {
    return text;
  }
  return `${input.theme.headerAnsi}${text}${input.theme.resetAnsi}`;
}

function renderFooter(input: {
  readonly model: DiffUiModel;
  readonly state: DiffUiState;
  readonly width: number;
  readonly height: number;
  readonly color: boolean;
  readonly theme: DiffUiRenderTheme;
}): string {
  const maxTop = Math.max(0, input.model.rows.length - Math.max(1, input.height - 2));
  const text = padOrTrimDisplay(
    `row=${input.state.topRow + 1}/${Math.max(1, input.model.rows.length)} maxTop~${maxTop} file=${input.state.activeFileIndex + 1}/${Math.max(1, input.model.diff.files.length)} finder=${input.state.finderOpen ? 'open' : 'closed'}`,
    input.width,
  );
  if (!input.color || input.theme.footerAnsi.length === 0) {
    return text;
  }
  return `${input.theme.footerAnsi}${text}${input.theme.resetAnsi}`;
}

function overlayFinderLines(
  renderedBodyLines: string[],
  state: DiffUiState,
  width: number,
  color: boolean,
  theme: DiffUiRenderTheme,
): void {
  if (!state.finderOpen || renderedBodyLines.length === 0) {
    return;
  }

  const lines: string[] = [];
  lines.push(padOrTrimDisplay(`find: ${state.finderQuery}`, width));
  const maxRows = Math.max(0, renderedBodyLines.length - 1);
  for (let index = 0; index < Math.min(maxRows, state.finderResults.length); index += 1) {
    const row = state.finderResults[index]!;
    const marker = index === state.finderSelectedIndex ? '>' : ' ';
    lines.push(padOrTrimDisplay(`${marker} ${row.path}`, width));
  }

  for (let index = 0; index < lines.length && index < renderedBodyLines.length; index += 1) {
    const base = lines[index]!;
    if (!color || theme.hunkHeaderAnsi.length === 0) {
      renderedBodyLines[index] = base;
      continue;
    }
    renderedBodyLines[index] = `${theme.hunkHeaderAnsi}${base}${theme.resetAnsi}`;
  }
}

export function renderDiffUiViewport(input: {
  readonly model: DiffUiModel;
  readonly state: DiffUiState;
  readonly width: number;
  readonly height: number;
  readonly viewMode: DiffUiViewMode;
  readonly syntaxMode: DiffUiSyntaxMode;
  readonly wordDiffMode: DiffUiWordDiffMode;
  readonly color: boolean;
  readonly theme: DiffUiRenderTheme;
}): DiffUiRenderOutput {
  const safeWidth = Math.max(40, Math.floor(input.width));
  const safeHeight = Math.max(6, Math.floor(input.height));
  const header = renderHeader({
    model: input.model,
    state: input.state,
    width: safeWidth,
    color: input.color,
    theme: input.theme,
  });
  const footer = renderFooter({
    model: input.model,
    state: input.state,
    width: safeWidth,
    height: safeHeight,
    color: input.color,
    theme: input.theme,
  });

  const bodyRows = Math.max(1, safeHeight - 2);
  const start = Math.max(0, input.state.topRow);
  const end = Math.min(input.model.rows.length, start + bodyRows);
  const bodyLines: string[] = [];

  for (let index = start; index < end; index += 1) {
    const row = input.model.rows[index]!;
    const plainText =
      input.state.effectiveViewMode === 'split'
        ? renderSplitRow(row, safeWidth)
        : renderUnifiedRow(row, safeWidth);
    bodyLines.push(
      decorateRow({
        row,
        plainText,
        theme: input.theme,
        color: input.color,
        syntaxMode: input.syntaxMode,
        wordDiffMode: input.wordDiffMode,
      }),
    );
  }

  while (bodyLines.length < bodyRows) {
    bodyLines.push(padOrTrimDisplay('', safeWidth));
  }

  overlayFinderLines(bodyLines, input.state, safeWidth, input.color, input.theme);

  return {
    state: input.state,
    lines: [header, ...bodyLines, footer],
  };
}

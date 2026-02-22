import { padOrTrimDisplay } from '../../mux/dual-pane-core.ts';

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
    const rows = Array.from({ length: input.layout.paneRows }, () =>
      ' '.repeat(input.layout.rightCols),
    );
    if (rows.length === 0) {
      return { rows };
    }

    rows[0] = padOrTrimDisplay(` ${HEADER}`, input.layout.rightCols);
    if (rows.length > 1) {
      const sessionLabel =
        viewModel.sessionId === null ? 'no-session' : viewModel.sessionId.slice(0, 8);
      rows[1] = padOrTrimDisplay(
        ` status:${viewModel.status} mode:${viewModel.uiMode} queued:${String(viewModel.queuedCount)} session:${sessionLabel}`,
        input.layout.rightCols,
      );
    }
    if (rows.length > 2) {
      rows[2] = padOrTrimDisplay(' enter=send/steer tab=queue esc=abort /mode debug|user', input.layout.rightCols);
    }
    if (rows.length > 3) {
      rows[3] = padOrTrimDisplay(' ─ transcript ─', input.layout.rightCols);
    }

    const composerDividerRow = Math.max(0, rows.length - 2);
    rows[composerDividerRow] = padOrTrimDisplay(' ─ composer ─', input.layout.rightCols);
    const composerRow = Math.max(0, rows.length - 1);
    rows[composerRow] = padOrTrimDisplay(
      `${COMPOSER_PROMPT}${viewModel.composerText}`,
      input.layout.rightCols,
    );

    const transcriptStartRow = Math.min(4, rows.length - 1);
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
      rows[transcriptStartRow + index] = padOrTrimDisplay(` ${row}`, input.layout.rightCols);
    }

    return {
      rows,
    };
  }
}

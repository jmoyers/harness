import { padOrTrimDisplay } from '../../mux/dual-pane-core.ts';

interface NimPaneLayout {
  readonly rightCols: number;
  readonly paneRows: number;
}

interface NimPaneRenderInput {
  readonly layout: NimPaneLayout;
}

interface NimPaneRenderResult {
  readonly rows: readonly string[];
}

const HEADER = 'NIM';
const SUBTITLE = 'Pinned agent pane (Phase 1 shell)';
const COMPOSER_PROMPT = 'nim> ';

export class NimPane {
  render(input: NimPaneRenderInput): NimPaneRenderResult {
    const rows = Array.from({ length: input.layout.paneRows }, () =>
      ' '.repeat(input.layout.rightCols),
    );
    if (rows.length === 0) {
      return { rows };
    }

    rows[0] = padOrTrimDisplay(` ${HEADER}`, input.layout.rightCols);
    if (rows.length > 1) {
      rows[1] = padOrTrimDisplay(` ${SUBTITLE}`, input.layout.rightCols);
    }
    if (rows.length > 3) {
      rows[3] = padOrTrimDisplay(' ─ transcript ─', input.layout.rightCols);
    }

    const composerDividerRow = Math.max(0, rows.length - 2);
    rows[composerDividerRow] = padOrTrimDisplay(' ─ composer ─', input.layout.rightCols);
    const composerRow = Math.max(0, rows.length - 1);
    rows[composerRow] = padOrTrimDisplay(COMPOSER_PROMPT, input.layout.rightCols);

    return {
      rows,
    };
  }
}

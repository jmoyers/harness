import type { DiffCoverageReason, DiffMode, NormalizedDiff } from '../diff/types.ts';

export type DiffUiViewMode = 'auto' | 'split' | 'unified';
type DiffUiEffectiveViewMode = 'split' | 'unified';
export type DiffUiSyntaxMode = 'auto' | 'on' | 'off';
export type DiffUiWordDiffMode = 'auto' | 'on' | 'off';

interface DiffUiBudget {
  readonly maxFiles: number;
  readonly maxHunks: number;
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly maxRuntimeMs: number;
}

export interface DiffUiCliOptions {
  readonly cwd: string;
  readonly mode: DiffMode;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly includeGenerated: boolean;
  readonly includeBinary: boolean;
  readonly noRenames: boolean;
  readonly renameLimit: number | null;
  readonly viewMode: DiffUiViewMode;
  readonly syntaxMode: DiffUiSyntaxMode;
  readonly wordDiffMode: DiffUiWordDiffMode;
  readonly color: boolean;
  readonly pager: boolean;
  readonly watch: boolean;
  readonly jsonEvents: boolean;
  readonly rpcStdio: boolean;
  readonly snapshot: boolean;
  readonly width: number | null;
  readonly height: number | null;
  readonly theme: string | null;
  readonly budget: DiffUiBudget;
}

export type DiffUiRowKind =
  | 'file-header'
  | 'hunk-header'
  | 'code-context'
  | 'code-add'
  | 'code-del'
  | 'notice';

export interface DiffUiVirtualRow {
  readonly kind: DiffUiRowKind;
  readonly unified: string;
  readonly left: string;
  readonly right: string;
  readonly fileId: string | null;
  readonly hunkId: string | null;
  readonly fileIndex: number | null;
  readonly hunkIndex: number | null;
  readonly language: string | null;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface DiffUiModel {
  readonly diff: NormalizedDiff;
  readonly rows: readonly DiffUiVirtualRow[];
  readonly fileStartRows: readonly number[];
  readonly hunkStartRows: readonly number[];
}

export interface DiffUiFinderResult {
  readonly fileIndex: number;
  readonly fileId: string;
  readonly path: string;
  readonly score: number;
}

export interface DiffUiState {
  readonly viewMode: DiffUiViewMode;
  readonly effectiveViewMode: DiffUiEffectiveViewMode;
  readonly topRow: number;
  readonly activeFileIndex: number;
  readonly activeHunkIndex: number;
  readonly finderOpen: boolean;
  readonly finderQuery: string;
  readonly finderSelectedIndex: number;
  readonly finderResults: readonly DiffUiFinderResult[];
  readonly searchQuery: string;
}

export type DiffUiStateAction =
  | {
      readonly type: 'viewport.changed';
      readonly width: number;
    }
  | {
      readonly type: 'view.setMode';
      readonly mode: DiffUiViewMode;
    }
  | {
      readonly type: 'nav.scroll';
      readonly delta: number;
    }
  | {
      readonly type: 'nav.page';
      readonly delta: number;
      readonly pageSize: number;
    }
  | {
      readonly type: 'nav.gotoFile';
      readonly fileIndex: number;
    }
  | {
      readonly type: 'nav.gotoHunk';
      readonly hunkIndex: number;
    }
  | {
      readonly type: 'finder.open';
    }
  | {
      readonly type: 'finder.close';
    }
  | {
      readonly type: 'finder.query';
      readonly query: string;
    }
  | {
      readonly type: 'finder.move';
      readonly delta: number;
    }
  | {
      readonly type: 'finder.accept';
    }
  | {
      readonly type: 'search.set';
      readonly query: string;
    };

export type DiffUiCommand =
  | {
      readonly type: 'view.setMode';
      readonly mode: DiffUiViewMode;
    }
  | {
      readonly type: 'nav.scroll';
      readonly delta: number;
    }
  | {
      readonly type: 'nav.page';
      readonly delta: number;
    }
  | {
      readonly type: 'nav.gotoFile';
      readonly index: number;
    }
  | {
      readonly type: 'nav.gotoHunk';
      readonly index: number;
    }
  | {
      readonly type: 'finder.open';
    }
  | {
      readonly type: 'finder.close';
    }
  | {
      readonly type: 'finder.query';
      readonly query: string;
    }
  | {
      readonly type: 'finder.move';
      readonly delta: number;
    }
  | {
      readonly type: 'finder.accept';
    }
  | {
      readonly type: 'search.set';
      readonly query: string;
    }
  | {
      readonly type: 'session.quit';
    };

export type DiffUiEvent =
  | {
      readonly type: 'diff.loaded';
      readonly files: number;
      readonly hunks: number;
      readonly lines: number;
      readonly coverageReason: DiffCoverageReason;
    }
  | {
      readonly type: 'state.changed';
      readonly state: DiffUiState;
    }
  | {
      readonly type: 'render.completed';
      readonly rows: number;
      readonly width: number;
      readonly height: number;
      readonly view: DiffUiEffectiveViewMode;
    }
  | {
      readonly type: 'warning';
      readonly message: string;
    }
  | {
      readonly type: 'session.quit';
    };

export interface DiffUiRenderTheme {
  readonly headerAnsi: string;
  readonly footerAnsi: string;
  readonly fileHeaderAnsi: string;
  readonly hunkHeaderAnsi: string;
  readonly contextAnsi: string;
  readonly addAnsi: string;
  readonly delAnsi: string;
  readonly noticeAnsi: string;
  readonly gutterAnsi: string;
  readonly resetAnsi: string;
  readonly syntaxKeywordAnsi: string;
  readonly syntaxStringAnsi: string;
  readonly syntaxCommentAnsi: string;
  readonly syntaxNumberAnsi: string;
}

export interface DiffUiRenderOutput {
  readonly lines: readonly string[];
  readonly state: DiffUiState;
}

export interface DiffUiRunOutput {
  readonly exitCode: number;
  readonly events: readonly DiffUiEvent[];
  readonly renderedLines: readonly string[];
}

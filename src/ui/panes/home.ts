import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTaskFocusedPaneView,
  type TaskFocusedPaneEditorTarget,
  type TaskFocusedPaneRepositoryRecord,
  type TaskFocusedPaneTaskRecord,
  type TaskFocusedPaneView,
} from '../../mux/task-focused-pane.ts';
import type { TaskComposerBuffer } from '../../mux/task-composer.ts';
import { renderHomeGridfireAnsiRows } from './home-gridfire.ts';

const HOME_PACKAGE_JSON_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../package.json',
);
const HOME_PACKAGE_VERSION = String(
  (JSON.parse(readFileSync(HOME_PACKAGE_JSON_PATH, 'utf8')) as { version: unknown }).version,
);
const HOME_OVERLAY_SUBTITLE = `- harness v${HOME_PACKAGE_VERSION} -`;

interface HomePaneLayout {
  readonly rightCols: number;
  readonly paneRows: number;
}

interface HomePaneRenderInput {
  readonly layout: HomePaneLayout;
  readonly repositories: ReadonlyMap<string, TaskFocusedPaneRepositoryRecord>;
  readonly tasks: ReadonlyMap<string, TaskFocusedPaneTaskRecord>;
  readonly selectedRepositoryId: string | null;
  readonly repositoryDropdownOpen: boolean;
  readonly editorTarget: TaskFocusedPaneEditorTarget;
  readonly draftBuffer: TaskComposerBuffer;
  readonly taskBufferById: ReadonlyMap<string, TaskComposerBuffer>;
  readonly notice: string | null;
  readonly scrollTop: number;
}

interface HomePaneOptions {
  readonly showTaskPlanningUi?: boolean;
  readonly animateBackground?: boolean;
  readonly overlaySubtitle?: string;
}

export class HomePane {
  private readonly showTaskPlanningUi: boolean;
  private readonly animateBackground: boolean;
  private readonly staticBackgroundTimeMs: number;
  private readonly overlaySubtitle: string;

  constructor(
    private readonly renderTaskFocusedPaneView: typeof buildTaskFocusedPaneView = buildTaskFocusedPaneView,
    private readonly renderBackgroundRows: typeof renderHomeGridfireAnsiRows = renderHomeGridfireAnsiRows,
    private readonly nowMs: () => number = Date.now,
    options: HomePaneOptions = {},
  ) {
    this.showTaskPlanningUi = options.showTaskPlanningUi ?? false;
    this.animateBackground = options.animateBackground ?? true;
    this.staticBackgroundTimeMs = this.nowMs();
    this.overlaySubtitle = options.overlaySubtitle ?? HOME_OVERLAY_SUBTITLE;
  }

  private hiddenTaskPlanningView(layout: HomePaneLayout): TaskFocusedPaneView {
    const safeCols = Math.max(1, layout.rightCols);
    const safeRows = Math.max(1, layout.paneRows);
    const blankRow = ' '.repeat(safeCols);
    const rows = Array.from({ length: safeRows }, () => blankRow);
    return {
      rows,
      taskIds: Array.from({ length: safeRows }, () => null),
      repositoryIds: Array.from({ length: safeRows }, () => null),
      actions: Array.from({ length: safeRows }, () => null),
      actionCells: Array.from({ length: safeRows }, () => null),
      top: 0,
      selectedRepositoryId: null,
    };
  }

  render(input: HomePaneRenderInput): TaskFocusedPaneView {
    const view = this.showTaskPlanningUi
      ? this.renderTaskFocusedPaneView({
          repositories: input.repositories,
          tasks: input.tasks,
          selectedRepositoryId: input.selectedRepositoryId,
          repositoryDropdownOpen: input.repositoryDropdownOpen,
          editorTarget: input.editorTarget,
          draftBuffer: input.draftBuffer,
          taskBufferById: input.taskBufferById,
          notice: input.notice,
          cols: input.layout.rightCols,
          rows: input.layout.paneRows,
          scrollTop: input.scrollTop,
        })
      : this.hiddenTaskPlanningView(input.layout);
    return {
      ...view,
      rows: this.renderBackgroundRows({
        cols: input.layout.rightCols,
        rows: input.layout.paneRows,
        contentRows: view.rows,
        timeMs: this.animateBackground ? this.nowMs() : this.staticBackgroundTimeMs,
        overlayTitle: 'GSV Sleeper Service',
        overlaySubtitle: this.overlaySubtitle,
      }),
    };
  }
}

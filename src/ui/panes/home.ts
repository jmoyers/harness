import {
  buildTaskFocusedPaneView,
  type TaskFocusedPaneEditorTarget,
  type TaskFocusedPaneRepositoryRecord,
  type TaskFocusedPaneTaskRecord,
  type TaskFocusedPaneView,
} from '../../mux/task-focused-pane.ts';
import type { TaskComposerBuffer } from '../../mux/task-composer.ts';
import { renderHomeGridfireAnsiRows } from './home-gridfire.ts';

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

export class HomePane {
  constructor(
    private readonly renderTaskFocusedPaneView: typeof buildTaskFocusedPaneView = buildTaskFocusedPaneView,
    private readonly renderBackgroundRows: typeof renderHomeGridfireAnsiRows = renderHomeGridfireAnsiRows,
    private readonly nowMs: () => number = Date.now,
  ) {}

  render(input: HomePaneRenderInput): TaskFocusedPaneView {
    const view = this.renderTaskFocusedPaneView({
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
    });
    const startupOverlayEnabled = input.repositories.size === 0 && input.tasks.size === 0;
    return {
      ...view,
      rows: this.renderBackgroundRows({
        cols: input.layout.rightCols,
        rows: input.layout.paneRows,
        contentRows: view.rows,
        timeMs: this.nowMs(),
        overlayTitle: startupOverlayEnabled ? 'GSV Just Read The Instructions' : null,
        overlaySubtitle: startupOverlayEnabled ? '- harness v0.1.0 -' : null,
      }),
    };
  }
}

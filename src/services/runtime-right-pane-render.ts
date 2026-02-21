import type { WorkspaceModel } from '../domain/workspace.ts';
import type { TaskManager } from '../domain/tasks.ts';
import type { ProjectPaneSnapshot } from '../mux/harness-core-ui.ts';
import type { TaskComposerBuffer } from '../mux/task-composer.ts';
import type { NimPaneViewModel } from '../ui/panes/nim.ts';
import type {
  TaskFocusedPaneRepositoryRecord,
  TaskFocusedPaneTaskRecord,
  TaskFocusedPaneView,
} from '../mux/task-focused-pane.ts';
import type { TerminalSnapshotFrameCore } from '../terminal/snapshot-oracle.ts';

interface RuntimeRightPaneLayout {
  readonly rightCols: number;
  readonly paneRows: number;
}

interface ConversationPaneLike {
  render(frame: TerminalSnapshotFrameCore, layout: RuntimeRightPaneLayout): readonly string[];
}

interface HomePaneRenderInput<
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
> {
  readonly layout: RuntimeRightPaneLayout;
  readonly repositories: ReadonlyMap<string, TRepositoryRecord>;
  readonly tasks: ReadonlyMap<string, TTaskRecord>;
  readonly showTaskPlanningUi?: boolean;
  readonly selectedRepositoryId: string | null;
  readonly repositoryDropdownOpen: boolean;
  readonly editorTarget: WorkspaceModel['taskEditorTarget'];
  readonly draftBuffer: TaskComposerBuffer;
  readonly taskBufferById: ReadonlyMap<string, TaskComposerBuffer>;
  readonly notice: string | null;
  readonly scrollTop: number;
}

interface HomePaneLike<
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
> {
  render(input: HomePaneRenderInput<TRepositoryRecord, TTaskRecord>): TaskFocusedPaneView;
}

interface ProjectPaneLike {
  render(input: {
    layout: RuntimeRightPaneLayout;
    snapshot: ProjectPaneSnapshot | null;
    scrollTop: number;
  }): {
    readonly rows: readonly string[];
    readonly scrollTop: number;
  };
}

interface NimPaneLike {
  render(input: { layout: RuntimeRightPaneLayout; viewModel: NimPaneViewModel }): {
    readonly rows: readonly string[];
  };
}

interface RuntimeRightPaneRenderInput {
  readonly layout: RuntimeRightPaneLayout;
  readonly rightFrame: TerminalSnapshotFrameCore | null;
  readonly homePaneActive: boolean;
  readonly nimPaneActive: boolean;
  readonly projectPaneActive: boolean;
  readonly activeDirectoryId: string | null;
}

interface RuntimeRightPaneRenderOptions<
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
> {
  readonly workspace: WorkspaceModel;
  readonly showTasks?: boolean;
  readonly repositories: ReadonlyMap<string, TRepositoryRecord>;
  readonly taskManager: TaskManager<TTaskRecord, TaskComposerBuffer, NodeJS.Timeout>;
  readonly conversationPane: ConversationPaneLike;
  readonly homePane: HomePaneLike<TRepositoryRecord, TTaskRecord>;
  readonly projectPane: ProjectPaneLike;
  readonly nimPane: NimPaneLike;
  readonly getNimViewModel: () => NimPaneViewModel;
  readonly refreshProjectPaneSnapshot: (directoryId: string) => ProjectPaneSnapshot | null;
  readonly emptyTaskPaneView: () => TaskFocusedPaneView;
}

export class RuntimeRightPaneRender<
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
> {
  constructor(
    private readonly options: RuntimeRightPaneRenderOptions<TRepositoryRecord, TTaskRecord>,
  ) {}

  renderRightRows(input: RuntimeRightPaneRenderInput): readonly string[] {
    const workspace = this.options.workspace;
    workspace.latestTaskPaneView = this.options.emptyTaskPaneView();

    if (input.rightFrame !== null) {
      return this.options.conversationPane.render(input.rightFrame, input.layout);
    }

    if (input.homePaneActive) {
      const view = this.options.homePane.render({
        layout: input.layout,
        repositories: this.options.repositories,
        tasks: this.options.taskManager.readonlyTasks(),
        showTaskPlanningUi:
          (this.options.showTasks ?? true) && workspace.leftNavSelection.kind === 'tasks',
        selectedRepositoryId: workspace.taskPaneSelectedRepositoryId,
        repositoryDropdownOpen: workspace.taskRepositoryDropdownOpen,
        editorTarget: workspace.taskEditorTarget,
        draftBuffer: workspace.taskDraftComposer,
        taskBufferById: this.options.taskManager.readonlyTaskComposers(),
        notice: workspace.taskPaneNotice,
        scrollTop: workspace.taskPaneScrollTop,
      });
      workspace.taskPaneSelectedRepositoryId = view.selectedRepositoryId;
      workspace.taskPaneScrollTop = view.top;
      workspace.latestTaskPaneView = view;
      return view.rows;
    }

    if (input.nimPaneActive) {
      const view = this.options.nimPane.render({
        layout: input.layout,
        viewModel: this.options.getNimViewModel(),
      });
      return view.rows;
    }

    if (input.projectPaneActive && input.activeDirectoryId !== null) {
      const needsSnapshotRefresh =
        workspace.projectPaneSnapshot === null ||
        workspace.projectPaneSnapshot.directoryId !== input.activeDirectoryId;
      if (needsSnapshotRefresh) {
        workspace.projectPaneSnapshot = this.options.refreshProjectPaneSnapshot(
          input.activeDirectoryId,
        );
      }
      const view = this.options.projectPane.render({
        layout: input.layout,
        snapshot: workspace.projectPaneSnapshot,
        scrollTop: workspace.projectPaneScrollTop,
      });
      workspace.projectPaneScrollTop = view.scrollTop;
      return view.rows;
    }

    return Array.from({ length: input.layout.paneRows }, () => ' '.repeat(input.layout.rightCols));
  }
}

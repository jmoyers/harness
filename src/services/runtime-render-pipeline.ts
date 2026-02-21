import type { computeDualPaneLayout } from '../mux/dual-pane-core.ts';
import type { PaneSelection, PaneSelectionDrag } from '../mux/live-mux/selection.ts';
import type {
  TaskFocusedPaneRepositoryRecord,
  TaskFocusedPaneTaskRecord,
} from '../mux/task-focused-pane.ts';
import type { TerminalSnapshotFrameCore } from '../terminal/snapshot-oracle.ts';
import { RuntimeLeftRailRender } from './runtime-left-rail-render.ts';
import { RuntimeRenderFlush } from './runtime-render-flush.ts';
import { RuntimeRenderOrchestrator } from './runtime-render-orchestrator.ts';
import { RuntimeRenderState } from './runtime-render-state.ts';
import { RuntimeRightPaneRender } from './runtime-right-pane-render.ts';

type RuntimeLayout = ReturnType<typeof computeDualPaneLayout>;

type RuntimeRenderFlushOptions<TConversation, TModalOverlay, TStatusRow> = ConstructorParameters<
  typeof RuntimeRenderFlush<
    TConversation,
    TerminalSnapshotFrameCore,
    PaneSelection,
    RuntimeLayout,
    TModalOverlay,
    TStatusRow
  >
>[0];

type RuntimeRightPaneRenderOptions<
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
> = ConstructorParameters<typeof RuntimeRightPaneRender<TRepositoryRecord, TTaskRecord>>[0];

type RuntimeLeftRailRenderOptions<
  TDirectoryRecord,
  TConversation,
  TRepositoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
  TRailViewRows,
> = ConstructorParameters<
  typeof RuntimeLeftRailRender<
    TDirectoryRecord,
    TConversation,
    TRepositoryRecord,
    TRepositorySnapshot,
    TGitSummary,
    TProcessUsage,
    TRailViewRows
  >
>[0];

type RuntimeRenderStateOptions<TConversation> = ConstructorParameters<
  typeof RuntimeRenderState<TConversation, TerminalSnapshotFrameCore>
>[0];

interface RuntimeRenderPipelineOptions<
  TConversation,
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
  TDirectoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
  TRailViewRows,
  TModalOverlay,
  TStatusRow,
> {
  readonly renderFlush: RuntimeRenderFlushOptions<TConversation, TModalOverlay, TStatusRow>;
  readonly rightPaneRender: RuntimeRightPaneRenderOptions<TRepositoryRecord, TTaskRecord>;
  readonly leftRailRender: RuntimeLeftRailRenderOptions<
    TDirectoryRecord,
    TConversation,
    TRepositoryRecord,
    TRepositorySnapshot,
    TGitSummary,
    TProcessUsage,
    TRailViewRows
  >;
  readonly renderState: RuntimeRenderStateOptions<TConversation>;
  readonly isScreenDirty: () => boolean;
  readonly clearDirty: () => void;
  readonly setLatestRailViewRows: (rows: TRailViewRows) => void;
  readonly activeDirectoryId: () => string | null;
}

type RuntimeRenderPipelineInput = Parameters<
  RuntimeRenderOrchestrator<
    RuntimeLayout,
    unknown,
    TerminalSnapshotFrameCore,
    PaneSelection,
    PaneSelectionDrag,
    unknown
  >['render']
>[0];

export class RuntimeRenderPipeline<
  TConversation,
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
  TDirectoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
  TRailViewRows,
  TModalOverlay,
  TStatusRow,
> {
  private readonly renderOrchestrator: RuntimeRenderOrchestrator<
    RuntimeLayout,
    TConversation,
    TerminalSnapshotFrameCore,
    PaneSelection,
    PaneSelectionDrag,
    TRailViewRows
  >;

  constructor(
    options: RuntimeRenderPipelineOptions<
      TConversation,
      TRepositoryRecord,
      TTaskRecord,
      TDirectoryRecord,
      TRepositorySnapshot,
      TGitSummary,
      TProcessUsage,
      TRailViewRows,
      TModalOverlay,
      TStatusRow
    >,
  ) {
    const renderFlush = new RuntimeRenderFlush(options.renderFlush);
    const rightPaneRender = new RuntimeRightPaneRender(options.rightPaneRender);
    const leftRailRender = new RuntimeLeftRailRender(options.leftRailRender);
    const renderState = new RuntimeRenderState(options.renderState);
    this.renderOrchestrator = new RuntimeRenderOrchestrator({
      isScreenDirty: options.isScreenDirty,
      clearDirty: options.clearDirty,
      prepareRenderState: (selection, selectionDrag) =>
        renderState.prepareRenderState(selection, selectionDrag),
      renderLeftRail: (layout) => leftRailRender.render(layout),
      setLatestRailViewRows: options.setLatestRailViewRows,
      renderRightRows: (input) =>
        rightPaneRender.renderRightRows({
          layout: input.layout,
          rightFrame: input.rightFrame,
          homePaneActive: input.homePaneActive,
          nimPaneActive: input.nimPaneActive,
          projectPaneActive: input.projectPaneActive,
          activeDirectoryId: input.activeDirectoryId,
        }),
      flushRender: (input) => {
        renderFlush.flushRender(input);
      },
      activeDirectoryId: options.activeDirectoryId,
    });
  }

  render(input: RuntimeRenderPipelineInput): void {
    this.renderOrchestrator.render(input);
  }
}

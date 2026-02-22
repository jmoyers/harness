import type { computeDualPaneLayout } from '../mux/dual-pane-core.ts';
import type { PaneSelection, PaneSelectionDrag } from '../mux/live-mux/selection.ts';
import type {
  TaskFocusedPaneRepositoryRecord,
  TaskFocusedPaneTaskRecord,
} from '../mux/task-focused-pane.ts';
import type { TerminalSnapshotFrameCore } from '../terminal/snapshot-oracle.ts';
import {
  RuntimeLeftRailRender,
  type RuntimeLeftRailRenderOptions,
  type RuntimeLeftRailRenderSnapshot,
} from './runtime-left-rail-render.ts';
import {
  RuntimeRenderFlush,
  type RuntimeRenderFlushOptions,
} from './runtime-render-flush.ts';
import { RuntimeRenderOrchestrator } from './runtime-render-orchestrator.ts';
import {
  RuntimeRenderState,
  type RuntimeRenderStateOptions,
} from './runtime-render-state.ts';
import {
  RuntimeRightPaneRender,
  type RuntimeRightPaneRenderOptions,
  type RuntimeRightPaneRenderSnapshot,
} from './runtime-right-pane-render.ts';

type RuntimeLayout = ReturnType<typeof computeDualPaneLayout>;

export interface RuntimeRenderPipelineSnapshot<
  TDirectoryRecord,
  TConversation,
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
  TProcessUsage,
> {
  readonly leftRail: RuntimeLeftRailRenderSnapshot<
    TDirectoryRecord,
    TConversation,
    TRepositoryRecord,
    TProcessUsage
  >;
  readonly rightPane: RuntimeRightPaneRenderSnapshot<TRepositoryRecord, TTaskRecord>;
}

export interface RuntimeRenderPipelineOptions<
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
  readonly renderFlush: RuntimeRenderFlushOptions<
    TConversation,
    TerminalSnapshotFrameCore,
    PaneSelection,
    RuntimeLayout,
    TModalOverlay,
    TStatusRow
  >;
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
  readonly renderState: RuntimeRenderStateOptions<TConversation, TerminalSnapshotFrameCore>;
  readonly isScreenDirty: () => boolean;
  readonly clearDirty: () => void;
  // Frame-local TUI snapshot read. React/web adapters should consume store selectors directly.
  readonly readRenderSnapshot: () => RuntimeRenderPipelineSnapshot<
    TDirectoryRecord,
    TConversation,
    TRepositoryRecord,
    TTaskRecord,
    TProcessUsage
  >;
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
    unknown,
    unknown
  >['render']
>[0];

export function createRuntimeRenderPipeline<
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
>(
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
): (input: RuntimeRenderPipelineInput) => void {
  const renderFlush = new RuntimeRenderFlush(options.renderFlush);
  const rightPaneRender = new RuntimeRightPaneRender(options.rightPaneRender);
  const leftRailRender = new RuntimeLeftRailRender(options.leftRailRender);
  const renderState = new RuntimeRenderState(options.renderState);
  const renderOrchestrator = new RuntimeRenderOrchestrator<
    RuntimeLayout,
    TConversation,
    TerminalSnapshotFrameCore,
    PaneSelection,
    PaneSelectionDrag,
    TRailViewRows,
    RuntimeRenderPipelineSnapshot<
      TDirectoryRecord,
      TConversation,
      TRepositoryRecord,
      TTaskRecord,
      TProcessUsage
    >
  >({
    isScreenDirty: options.isScreenDirty,
    clearDirty: options.clearDirty,
    readRenderSnapshot: options.readRenderSnapshot,
    prepareRenderState: (selection, selectionDrag) =>
      renderState.prepareRenderState(selection, selectionDrag),
    renderLeftRail: (layout, snapshot) =>
      leftRailRender.render({
        layout,
        snapshot: snapshot.leftRail,
      }),
    setLatestRailViewRows: options.setLatestRailViewRows,
    renderRightRows: (input) =>
      rightPaneRender.renderRightRows({
        layout: input.layout,
        rightFrame: input.rightFrame,
        homePaneActive: input.homePaneActive,
        projectPaneActive: input.projectPaneActive,
        activeDirectoryId: input.activeDirectoryId,
        snapshot: input.snapshot.rightPane,
      }),
    flushRender: (input) => {
      renderFlush.flushRender(input);
    },
    activeDirectoryId: options.activeDirectoryId,
  });
  return (input: RuntimeRenderPipelineInput): void => {
    renderOrchestrator.render(input);
  };
}

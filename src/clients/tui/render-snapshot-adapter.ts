import type { TaskComposerBuffer } from '../../mux/task-composer.ts';
import type {
  TaskFocusedPaneRepositoryRecord,
  TaskFocusedPaneTaskRecord,
} from '../../mux/task-focused-pane.ts';
import type { RuntimeRenderPipelineSnapshot } from '../../services/runtime-render-pipeline.ts';
import { snapshotTaskComposerBuffers } from '../../services/runtime-task-composer-snapshot.ts';

interface TuiRenderSnapshotConversationLookup<TConversation> {
  readonlyConversations(): ReadonlyMap<string, TConversation>;
  orderedIds(): readonly string[];
  readonly activeConversationId: string | null;
}

interface TuiRenderSnapshotDirectoryLookup<TDirectoryRecord> {
  readonlyDirectories(): ReadonlyMap<string, TDirectoryRecord>;
}

interface TuiRenderSnapshotRepositoryLookup<
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
> {
  readonlyRepositories(): ReadonlyMap<string, TRepositoryRecord>;
}

interface TuiRenderSnapshotTaskLookup<
  TTaskRecord extends TaskFocusedPaneTaskRecord,
> {
  readonlyTasks(): ReadonlyMap<string, TTaskRecord>;
  readonlyTaskComposers(): ReadonlyMap<string, TaskComposerBuffer>;
}

interface TuiRenderSnapshotProcessUsageLookup<TProcessUsage> {
  readonlyUsage(): ReadonlyMap<string, TProcessUsage>;
}

export interface TuiRenderSnapshotAdapterOptions<
  TDirectoryRecord,
  TConversation,
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
  TProcessUsage,
> {
  readonly directories: TuiRenderSnapshotDirectoryLookup<TDirectoryRecord>;
  readonly conversations: TuiRenderSnapshotConversationLookup<TConversation>;
  readonly repositories: TuiRenderSnapshotRepositoryLookup<TRepositoryRecord>;
  readonly tasks: TuiRenderSnapshotTaskLookup<TTaskRecord>;
  readonly processUsage: TuiRenderSnapshotProcessUsageLookup<TProcessUsage>;
  readonly snapshotTaskComposers?: (
    taskComposers: ReadonlyMap<string, TaskComposerBuffer>,
  ) => ReadonlyMap<string, TaskComposerBuffer>;
}

export function readTuiRenderSnapshot<
  TDirectoryRecord,
  TConversation,
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
  TProcessUsage,
>(
  options: TuiRenderSnapshotAdapterOptions<
    TDirectoryRecord,
    TConversation,
    TRepositoryRecord,
    TTaskRecord,
    TProcessUsage
  >,
): RuntimeRenderPipelineSnapshot<
  TDirectoryRecord,
  TConversation,
  TRepositoryRecord,
  TTaskRecord,
  TProcessUsage
> {
  const snapshotTaskComposers = options.snapshotTaskComposers ?? snapshotTaskComposerBuffers;
  return {
    leftRail: {
      repositories: options.repositories.readonlyRepositories(),
      directories: options.directories.readonlyDirectories(),
      conversations: options.conversations.readonlyConversations(),
      orderedConversationIds: options.conversations.orderedIds(),
      processUsageBySessionId: options.processUsage.readonlyUsage(),
      activeConversationId: options.conversations.activeConversationId,
    },
    rightPane: {
      repositories: options.repositories.readonlyRepositories(),
      tasks: options.tasks.readonlyTasks(),
      taskComposers: snapshotTaskComposers(options.tasks.readonlyTaskComposers()),
    },
  };
}

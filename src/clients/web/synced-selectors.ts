import type {
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneTaskRecord,
} from '../../core/contracts/records.ts';
import type {
  HarnessSyncedStore,
  HarnessSyncedStoreState,
} from '../../core/store/harness-synced-store.ts';

export interface WebConversationListItem {
  readonly conversationId: string;
  readonly directoryId: string;
  readonly title: string;
  readonly agentType: string;
  readonly runtimeStatus: ControlPlaneConversationRecord['runtimeStatus'];
  readonly phase: NonNullable<ControlPlaneConversationRecord['runtimeStatusModel']>['phase'] | null;
  readonly activityHint:
    | NonNullable<ControlPlaneConversationRecord['runtimeStatusModel']>['activityHint']
    | null;
}

export interface WebTaskListItem {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly status: ControlPlaneTaskRecord['status'];
  readonly orderIndex: number;
}

interface MemoizedProjection<TResult> {
  readonly read: (state: HarnessSyncedStoreState) => TResult;
}

function createMemoizedProjection<TById extends Readonly<Record<string, unknown>>, TResult>(
  selectById: (state: HarnessSyncedStoreState) => TById,
  project: (byId: TById) => TResult,
): MemoizedProjection<TResult> {
  let previousById: TById | null = null;
  let previousResult: TResult | null = null;
  return {
    read: (state) => {
      const currentById = selectById(state);
      if (previousById === currentById && previousResult !== null) {
        return previousResult;
      }
      const nextResult = project(currentById);
      previousById = currentById;
      previousResult = nextResult;
      return nextResult;
    },
  };
}

export function createWebConversationListSelector(): (
  state: HarnessSyncedStoreState,
) => readonly WebConversationListItem[] {
  const memoized = createMemoizedProjection(
    (state) => state.synced.conversationsById,
    (conversationsById) =>
      Object.values(conversationsById)
        .sort((left, right) => left.conversationId.localeCompare(right.conversationId))
        .map((conversation) => ({
          conversationId: conversation.conversationId,
          directoryId: conversation.directoryId,
          title: conversation.title,
          agentType: conversation.agentType,
          runtimeStatus: conversation.runtimeStatus,
          phase: conversation.runtimeStatusModel?.phase ?? null,
          activityHint: conversation.runtimeStatusModel?.activityHint ?? null,
        })),
  );
  return (state) => memoized.read(state);
}

export function createWebTaskListSelector(): (
  state: HarnessSyncedStoreState,
) => readonly WebTaskListItem[] {
  const memoized = createMemoizedProjection(
    (state) => state.synced.tasksById,
    (tasksById) =>
      Object.values(tasksById)
        .sort((left, right) => left.taskId.localeCompare(right.taskId))
        .sort((left, right) => {
          if (left.orderIndex !== right.orderIndex) {
            return left.orderIndex - right.orderIndex;
          }
          return left.taskId.localeCompare(right.taskId);
        })
        .map((task) => ({
          taskId: task.taskId,
          repositoryId: task.repositoryId,
          title: task.title,
          status: task.status,
          orderIndex: task.orderIndex,
        })),
  );
  return (state) => memoized.read(state);
}

export function selectWebDirectoryList(
  state: HarnessSyncedStoreState,
): readonly ControlPlaneDirectoryRecord[] {
  return Object.values(state.synced.directoriesById).sort((left, right) =>
    left.directoryId.localeCompare(right.directoryId),
  );
}

export function selectWebConversationById(
  state: HarnessSyncedStoreState,
  conversationId: string,
): ControlPlaneConversationRecord | null {
  return state.synced.conversationsById[conversationId] ?? null;
}

export function subscribeStoreSelector<TSelected>(
  store: HarnessSyncedStore,
  select: (state: HarnessSyncedStoreState) => TSelected,
  onChange: (selected: TSelected, previous: TSelected) => void,
  equals: (left: TSelected, right: TSelected) => boolean = Object.is,
): () => void {
  let previousSelected = select(store.getState());
  return store.subscribe((state) => {
    const nextSelected = select(state);
    if (equals(nextSelected, previousSelected)) {
      return;
    }
    const before = previousSelected;
    previousSelected = nextSelected;
    onChange(nextSelected, before);
  });
}

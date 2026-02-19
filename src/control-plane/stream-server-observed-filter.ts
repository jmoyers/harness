import type { StreamObservedEvent } from './stream-protocol.ts';

interface StreamSubscriptionFilter {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  taskId?: string;
  directoryId?: string;
  conversationId?: string;
  includeOutput: boolean;
}

interface StreamObservedScope {
  tenantId: string;
  userId: string;
  workspaceId: string;
  directoryId: string | null;
  conversationId: string | null;
}

interface FilterContext {
  eventIncludesRepositoryId(event: StreamObservedEvent, repositoryId: string): boolean;
  eventIncludesTaskId(event: StreamObservedEvent, taskId: string): boolean;
}

export function eventIncludesRepositoryId(
  event: StreamObservedEvent,
  repositoryId: string,
): boolean {
  if (event.type === 'directory-git-updated') {
    return event.repositoryId === repositoryId;
  }
  if (event.type === 'repository-upserted' || event.type === 'repository-updated') {
    return event.repository['repositoryId'] === repositoryId;
  }
  if (event.type === 'repository-archived') {
    return event.repositoryId === repositoryId;
  }
  if (event.type === 'task-created' || event.type === 'task-updated') {
    return event.task['repositoryId'] === repositoryId;
  }
  if (event.type === 'task-reordered') {
    for (const task of event.tasks) {
      if (task['repositoryId'] === repositoryId) {
        return true;
      }
    }
    return false;
  }
  if (event.type === 'github-pr-upserted') {
    return event.pr['repositoryId'] === repositoryId;
  }
  if (event.type === 'github-pr-closed' || event.type === 'github-pr-jobs-updated') {
    return event.repositoryId === repositoryId;
  }
  return false;
}

export function eventIncludesTaskId(event: StreamObservedEvent, taskId: string): boolean {
  if (event.type === 'task-created' || event.type === 'task-updated') {
    return event.task['taskId'] === taskId;
  }
  if (event.type === 'task-deleted') {
    return event.taskId === taskId;
  }
  if (event.type === 'task-reordered') {
    for (const task of event.tasks) {
      if (task['taskId'] === taskId) {
        return true;
      }
    }
    return false;
  }
  return false;
}

export function matchesObservedFilter(
  ctx: FilterContext,
  scope: StreamObservedScope,
  event: StreamObservedEvent,
  filter: StreamSubscriptionFilter,
): boolean {
  if (!filter.includeOutput && event.type === 'session-output') {
    return false;
  }
  if (filter.tenantId !== undefined && scope.tenantId !== filter.tenantId) {
    return false;
  }
  if (filter.userId !== undefined && scope.userId !== filter.userId) {
    return false;
  }
  if (filter.workspaceId !== undefined && scope.workspaceId !== filter.workspaceId) {
    return false;
  }
  if (
    filter.repositoryId !== undefined &&
    !ctx.eventIncludesRepositoryId(event, filter.repositoryId)
  ) {
    return false;
  }
  if (filter.taskId !== undefined && !ctx.eventIncludesTaskId(event, filter.taskId)) {
    return false;
  }
  if (filter.directoryId !== undefined && scope.directoryId !== filter.directoryId) {
    return false;
  }
  if (filter.conversationId !== undefined && scope.conversationId !== filter.conversationId) {
    return false;
  }
  return true;
}

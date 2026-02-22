import { basename } from 'node:path';
import { padOrTrimDisplay } from './dual-pane-core.ts';
import { buildProjectTreeLines } from './project-tree.ts';
import { wrapTextForColumns } from '../terminal/snapshot-oracle.ts';
import { UiKit } from '../../packages/harness-ui/src/kit.ts';
import {
  buildProjectPaneGitHubReviewLines,
  type ProjectPaneGitHubReviewComment,
  type ProjectPaneGitHubReviewSummary,
  type ProjectPaneGitHubReviewThread,
  type ProjectPaneGitHubToggleAction,
} from './project-pane-github-review.ts';

const UI_KIT = new UiKit();

export type ProjectPaneAction =
  | 'conversation.new'
  | 'project.close'
  | 'project.github.refresh'
  | ProjectPaneGitHubToggleAction;
export type TaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';
export type TaskPaneAction =
  | 'task.create'
  | 'repository.create'
  | 'repository.edit'
  | 'repository.archive'
  | 'task.edit'
  | 'task.delete'
  | 'task.ready'
  | 'task.draft'
  | 'task.complete'
  | 'task.reorder-up'
  | 'task.reorder-down';

export interface ProjectPaneSnapshot {
  readonly directoryId: string;
  readonly path: string;
  readonly lines: readonly string[];
  readonly actionBySourceLineIndex: Readonly<Record<number, ProjectPaneAction>>;
  readonly actionLineIndexByKind: {
    readonly conversationNew: number;
    readonly projectClose: number;
  };
}

interface ProjectPaneWrappedLine {
  readonly text: string;
  readonly sourceLineIndex: number;
}

export interface TaskPaneRepositoryRecord {
  readonly repositoryId: string;
  readonly name: string;
  readonly remoteUrl?: string;
  readonly defaultBranch?: string;
  readonly metadata?: Record<string, unknown>;
  readonly archivedAt: string | null;
}

export interface TaskPaneTaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: TaskStatus;
  readonly orderIndex: number;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskPaneSnapshotLine {
  readonly text: string;
  readonly taskId: string | null;
  readonly repositoryId: string | null;
  readonly action: TaskPaneAction | null;
}

export interface TaskPaneSnapshot {
  readonly lines: readonly TaskPaneSnapshotLine[];
}

interface TaskPaneActionCell {
  readonly startCol: number;
  readonly endCol: number;
  readonly action: TaskPaneAction;
}

export interface TaskPaneView {
  readonly rows: readonly string[];
  readonly taskIds: readonly (string | null)[];
  readonly repositoryIds: readonly (string | null)[];
  readonly actions: readonly (TaskPaneAction | null)[];
  readonly actionCells: readonly (readonly TaskPaneActionCell[] | null)[];
  readonly top: number;
}

export const PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'new thread',
  prefixIcon: '+',
});
export const PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'close project',
  prefixIcon: '<',
});
const PROJECT_PANE_REFRESH_GITHUB_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'refresh review',
  prefixIcon: 'R',
});
export const TASKS_PANE_ADD_TASK_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'add task',
  prefixIcon: '+',
});
export const TASKS_PANE_ADD_REPOSITORY_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'add repository',
  prefixIcon: '+',
});
export const TASKS_PANE_EDIT_REPOSITORY_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'edit repository',
  prefixIcon: 'e',
});
export const TASKS_PANE_ARCHIVE_REPOSITORY_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'archive repository',
  prefixIcon: 'x',
});
export const TASKS_PANE_EDIT_TASK_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'edit task',
  prefixIcon: 'e',
});
export const TASKS_PANE_DELETE_TASK_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'delete task',
  prefixIcon: 'x',
});
export const TASKS_PANE_READY_TASK_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'mark ready',
  prefixIcon: 'r',
});
export const TASKS_PANE_DRAFT_TASK_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'mark draft',
  prefixIcon: 'd',
});
export const TASKS_PANE_COMPLETE_TASK_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'mark complete',
  prefixIcon: 'c',
});
export const TASKS_PANE_REORDER_UP_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'move up',
  prefixIcon: '^',
});
export const TASKS_PANE_REORDER_DOWN_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'move down',
  prefixIcon: 'v',
});
export const TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'edit ^E',
  prefixIcon: '✎',
});
export const TASKS_PANE_FOOTER_DELETE_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'delete ^?',
  prefixIcon: '⌫',
});
export const TASKS_PANE_FOOTER_COMPLETE_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'complete ^S',
  prefixIcon: '✓',
});
export const TASKS_PANE_FOOTER_DRAFT_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'draft ^R',
  prefixIcon: '◇',
});
export const TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'repo edit E',
  prefixIcon: '✎',
});
export const TASKS_PANE_FOOTER_REPOSITORY_ARCHIVE_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'repo archive X',
  prefixIcon: '⌫',
});
export const CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL = UI_KIT.formatButton({
  label: 'archive thread',
  prefixIcon: 'x',
});
export const NEW_THREAD_MODAL_CODEX_BUTTON = UI_KIT.formatButton({
  label: 'codex',
  prefixIcon: '◆',
});
export const NEW_THREAD_MODAL_CLAUDE_BUTTON = UI_KIT.formatButton({
  label: 'claude',
  prefixIcon: '◇',
});
export const NEW_THREAD_MODAL_CURSOR_BUTTON = UI_KIT.formatButton({
  label: 'cursor',
  prefixIcon: '◈',
});
export const NEW_THREAD_MODAL_TERMINAL_BUTTON = UI_KIT.formatButton({
  label: 'terminal',
  prefixIcon: '▣',
});
export const NEW_THREAD_MODAL_CRITIQUE_BUTTON = UI_KIT.formatButton({
  label: 'critique',
  prefixIcon: '▤',
});

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

function parseIsoTimestampMs(value: string | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function formatRelativeIsoTime(nowMs: number, value: string | null | undefined): string {
  const ts = parseIsoTimestampMs(value);
  if (!Number.isFinite(ts)) {
    return 'unknown';
  }
  const deltaSeconds = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (deltaSeconds < 60) {
    return `${String(deltaSeconds)}s ago`;
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${String(deltaMinutes)}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${String(deltaHours)}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${String(deltaDays)}d ago`;
}

export function sortedRepositoryList<T extends TaskPaneRepositoryRecord>(
  repositories: ReadonlyMap<string, T>,
): readonly T[] {
  return [...repositories.values()]
    .filter((repository) => repository.archivedAt === null)
    .sort((left, right) => {
      const leftPriority = repositoryHomePriority(left);
      const rightPriority = repositoryHomePriority(right);
      if (leftPriority !== null && rightPriority !== null && leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      if (leftPriority !== null && rightPriority === null) {
        return -1;
      }
      if (leftPriority === null && rightPriority !== null) {
        return 1;
      }
      const nameCompare = left.name.localeCompare(right.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return left.repositoryId.localeCompare(right.repositoryId);
    });
}

export function sortTasksByOrder<T extends TaskPaneTaskRecord>(tasks: readonly T[]): readonly T[] {
  return [...tasks].sort((left, right) => {
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }
    const leftCreatedAt = parseIsoTimestampMs(left.createdAt);
    const rightCreatedAt = parseIsoTimestampMs(right.createdAt);
    if (
      Number.isFinite(leftCreatedAt) &&
      Number.isFinite(rightCreatedAt) &&
      leftCreatedAt !== rightCreatedAt
    ) {
      return leftCreatedAt - rightCreatedAt;
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

function taskStatusSortRank(status: TaskStatus): number {
  if (status === 'in-progress') {
    return 0;
  }
  if (status === 'ready') {
    return 1;
  }
  if (status === 'draft') {
    return 2;
  }
  return 3;
}

function taskStatusGlyph(status: TaskStatus): string {
  if (status === 'in-progress') {
    return '▶';
  }
  if (status === 'ready') {
    return '◆';
  }
  if (status === 'draft') {
    return '◇';
  }
  return '✓';
}

function repositoryRemoteLabel(remoteUrl: string | undefined): string {
  const normalized = (remoteUrl ?? '').trim();
  if (normalized.length === 0) {
    return '(no remote)';
  }
  const match = /github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?(?:\/)?$/iu.exec(normalized);
  if (match !== null) {
    return `github.com/${match[1] as string}`;
  }
  return normalized.replace(/^https?:\/\//iu, '').replace(/\.git$/iu, '');
}

export function sortTasksForHomePane<T extends TaskPaneTaskRecord>(
  tasks: readonly T[],
): readonly T[] {
  return [...tasks].sort((left, right) => {
    const statusCompare = taskStatusSortRank(left.status) - taskStatusSortRank(right.status);
    if (statusCompare !== 0) {
      return statusCompare;
    }
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }
    const leftCreatedAt = parseIsoTimestampMs(left.createdAt);
    const rightCreatedAt = parseIsoTimestampMs(right.createdAt);
    if (
      Number.isFinite(leftCreatedAt) &&
      Number.isFinite(rightCreatedAt) &&
      leftCreatedAt !== rightCreatedAt
    ) {
      return leftCreatedAt - rightCreatedAt;
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

function buildProjectPaneWrappedLines(
  snapshot: ProjectPaneSnapshot,
  cols: number,
): readonly ProjectPaneWrappedLine[] {
  const safeCols = Math.max(1, cols);
  const wrapped: ProjectPaneWrappedLine[] = [];
  for (let lineIndex = 0; lineIndex < snapshot.lines.length; lineIndex += 1) {
    const line = snapshot.lines[lineIndex]!;
    const segments = wrapTextForColumns(line, safeCols);
    for (const segment of segments) {
      wrapped.push({
        text: segment,
        sourceLineIndex: lineIndex,
      });
    }
  }
  if (wrapped.length === 0) {
    wrapped.push({
      text: '',
      sourceLineIndex: -1,
    });
  }
  return wrapped;
}

function truncateLabel(value: string, maxChars: number): string {
  const normalized = value.trim();
  const safeMaxChars = Math.max(2, Math.floor(maxChars));
  if (normalized.length <= safeMaxChars) {
    return normalized;
  }
  return `${normalized.slice(0, safeMaxChars - 1)}…`;
}

function parseMetadataNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function parseMetadataTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function repositoryHomePriority(repository: TaskPaneRepositoryRecord): number | null {
  const metadata = repository.metadata;
  if (metadata === undefined) {
    return null;
  }
  const raw = metadata['homePriority'];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return null;
  }
  if (!Number.isInteger(raw) || raw < 0) {
    return null;
  }
  return raw;
}

function repositoryCommitCountLabel(repository: TaskPaneRepositoryRecord): string {
  const metadata = repository.metadata;
  if (metadata === undefined) {
    return '?c';
  }
  const commitCount = parseMetadataNumber(metadata['commitCount']);
  if (commitCount === null) {
    return '?c';
  }
  return `${String(commitCount)}c`;
}

function formatCompactRelativeIsoTime(nowMs: number, value: string | null): string {
  const ts = parseIsoTimestampMs(value);
  if (!Number.isFinite(ts)) {
    return '?';
  }
  const deltaSeconds = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (deltaSeconds < 60) {
    return `${String(deltaSeconds)}s`;
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${String(deltaMinutes)}m`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${String(deltaHours)}h`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${String(deltaDays)}d`;
}

function repositoryLastCommitAgeLabel(repository: TaskPaneRepositoryRecord, nowMs: number): string {
  const metadata = repository.metadata;
  if (metadata === undefined) {
    return '?';
  }
  const lastCommitAt = parseMetadataTimestamp(metadata['lastCommitAt']);
  return formatCompactRelativeIsoTime(nowMs, lastCommitAt);
}

function fillLine(width: number, glyph: string): string {
  if (width <= 0) {
    return '';
  }
  return glyph.repeat(width);
}

function normalizeTaskPaneRow(text: string, cols: number): string {
  const innerCols = Math.max(1, cols - 2);
  return `│${padOrTrimDisplay(text, innerCols)}│`;
}

function sanitizeInlineText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function formatGitHubAuthor(login: string | null): string {
  const normalized = login?.trim() ?? '';
  return normalized.length > 0 ? `@${normalized}` : '@unknown';
}

function githubPrStateLabel(review: NonNullable<ProjectPaneGitHubReviewSummary['pr']>): string {
  if (review.isDraft || review.state === 'draft') {
    return 'draft';
  }
  if (review.state === 'merged') {
    return 'merged';
  }
  if (review.state === 'closed') {
    return 'closed';
  }
  return 'open';
}

function threadCommentCount(threads: readonly ProjectPaneGitHubReviewThread[]): number {
  let count = 0;
  for (const thread of threads) {
    count += thread.comments.length;
  }
  return count;
}

function appendCommentDetails(
  pushLine: (line: string, action?: ProjectPaneAction | null) => void,
  comment: ProjectPaneGitHubReviewComment,
  index: number,
): void {
  pushLine(
    `  comment ${String(index + 1)} (${comment.commentId}) by ${formatGitHubAuthor(comment.authorLogin)}`,
  );
  pushLine(`    created ${comment.createdAt}`);
  if (comment.updatedAt !== comment.createdAt) {
    pushLine(`    updated ${comment.updatedAt}`);
  }
  if (comment.url !== null) {
    pushLine(`    url ${comment.url}`);
  }
  const bodyLines = comment.body.split(/\r?\n/gu);
  pushLine('    body');
  let wroteBodyLine = false;
  for (const bodyLine of bodyLines) {
    const trimmedEnd = bodyLine.trimEnd();
    if (trimmedEnd.length === 0) {
      continue;
    }
    pushLine(`      ${trimmedEnd}`);
    wroteBodyLine = true;
  }
  if (!wroteBodyLine) {
    pushLine('      (empty)');
  }
}

function appendThreadDetails(
  pushLine: (line: string, action?: ProjectPaneAction | null) => void,
  label: string,
  threads: readonly ProjectPaneGitHubReviewThread[],
): void {
  pushLine(`${label} (${String(threads.length)})`);
  if (threads.length === 0) {
    pushLine('  (none)');
    return;
  }
  for (const thread of threads) {
    const parts = [
      thread.isResolved ? 'resolved' : 'open',
      ...(thread.isOutdated ? ['outdated'] : []),
      ...(thread.resolvedByLogin === null
        ? []
        : [`resolved by ${formatGitHubAuthor(thread.resolvedByLogin)}`]),
    ];
    pushLine(`[thread ${thread.threadId}] ${parts.join(', ')}`);
    if (thread.comments.length === 0) {
      pushLine('  (no comments)');
      continue;
    }
    for (let commentIndex = 0; commentIndex < thread.comments.length; commentIndex += 1) {
      appendCommentDetails(pushLine, thread.comments[commentIndex]!, commentIndex);
    }
  }
}

export function resolveGoldenModalSize(
  viewportCols: number,
  viewportRows: number,
  options: {
    readonly preferredHeight: number;
    readonly minWidth: number;
    readonly maxWidth: number;
  },
): { width: number; height: number } {
  const safeViewportCols = Math.max(1, Math.floor(viewportCols));
  const safeViewportRows = Math.max(1, Math.floor(viewportRows));
  const maxHeight = Math.max(1, safeViewportRows - 2);
  const height = Math.max(1, Math.min(Math.floor(options.preferredHeight), maxHeight));
  const maxWidth = Math.max(
    options.minWidth,
    Math.min(Math.floor(options.maxWidth), Math.max(1, safeViewportCols - 2)),
  );
  const targetWidth = Math.round(height * GOLDEN_RATIO);
  const width = Math.max(Math.floor(options.minWidth), Math.min(targetWidth, maxWidth));
  return {
    width,
    height,
  };
}

export function buildProjectPaneSnapshot(directoryId: string, path: string): ProjectPaneSnapshot {
  const projectName = basename(path) || path;
  const lines: string[] = [];
  const actionBySourceLineIndex: Record<number, ProjectPaneAction> = {};
  const pushLine = (line: string, action: ProjectPaneAction | null = null): number => {
    const index = lines.length;
    lines.push(line);
    if (action !== null) {
      actionBySourceLineIndex[index] = action;
    }
    return index;
  };
  pushLine(`project ${projectName}`);
  pushLine(`path ${path}`);
  pushLine('');
  const conversationNewLineIndex = pushLine(
    PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL,
    'conversation.new',
  );
  const projectCloseLineIndex = pushLine(PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL, 'project.close');
  pushLine(PROJECT_PANE_REFRESH_GITHUB_BUTTON_LABEL, 'project.github.refresh');
  pushLine('');
  for (const line of buildProjectTreeLines(path)) {
    pushLine(line);
  }
  return {
    directoryId,
    path,
    lines,
    actionBySourceLineIndex,
    actionLineIndexByKind: {
      conversationNew: conversationNewLineIndex,
      projectClose: projectCloseLineIndex,
    },
  };
}

interface BuildProjectPaneSnapshotOptions {
  readonly githubReview?: ProjectPaneGitHubReviewSummary | null;
  readonly expandedNodeIds?: ReadonlySet<string>;
}

export function buildProjectPaneSnapshotWithOptions(
  directoryId: string,
  path: string,
  options: BuildProjectPaneSnapshotOptions = {},
): ProjectPaneSnapshot {
  const base = buildProjectPaneSnapshot(directoryId, path);
  if (options.githubReview === undefined || options.githubReview === null) {
    return base;
  }
  const lines: string[] = [];
  const actionBySourceLineIndex: Record<number, ProjectPaneAction> = {};
  const pushBaseLine = (line: string, action: ProjectPaneAction | null = null): number => {
    const index = lines.length;
    lines.push(line);
    if (action !== null) {
      actionBySourceLineIndex[index] = action;
    }
    return index;
  };
  const lineCountBeforeTree = Math.min(
    base.lines.length,
    base.actionLineIndexByKind.projectClose + 2,
  );
  for (let index = 0; index < lineCountBeforeTree; index += 1) {
    const action = base.actionBySourceLineIndex[index] ?? null;
    pushBaseLine(base.lines[index]!, action);
  }
  const reviewLines = buildProjectPaneGitHubReviewLines({
    review: options.githubReview,
    expandedNodeIds: options.expandedNodeIds ?? new Set<string>(),
  });
  for (let index = 0; index < reviewLines.lines.length; index += 1) {
    const action = reviewLines.actionByRelativeLineIndex[index] ?? null;
    pushBaseLine(reviewLines.lines[index]!, action);
  }
  pushBaseLine('');
  const treeStartIndex = lineCountBeforeTree;
  for (let index = treeStartIndex; index < base.lines.length; index += 1) {
    pushBaseLine(base.lines[index]!);
  }
  return {
    directoryId: base.directoryId,
    path: base.path,
    lines,
    actionBySourceLineIndex,
    actionLineIndexByKind: {
      conversationNew: base.actionLineIndexByKind.conversationNew,
      projectClose: base.actionLineIndexByKind.projectClose,
    },
  };
}

export function buildGitHubReviewPaneSnapshot(
  directoryId: string,
  path: string,
  review: ProjectPaneGitHubReviewSummary | null,
): ProjectPaneSnapshot {
  const base = buildProjectPaneSnapshot(directoryId, path);
  const lines: string[] = [];
  const actionBySourceLineIndex: Record<number, ProjectPaneAction> = {};
  const pushLine = (line: string, action: ProjectPaneAction | null = null): void => {
    const index = lines.length;
    lines.push(line);
    if (action !== null) {
      actionBySourceLineIndex[index] = action;
    }
  };
  const lineCountBeforeTree = Math.min(
    base.lines.length,
    base.actionLineIndexByKind.projectClose + 2,
  );
  for (let index = 0; index < lineCountBeforeTree; index += 1) {
    const action = base.actionBySourceLineIndex[index] ?? null;
    pushLine(base.lines[index]!, action);
  }
  pushLine('github pull request');
  pushLine(PROJECT_PANE_REFRESH_GITHUB_BUTTON_LABEL, 'project.github.refresh');
  pushLine('');

  if (review === null) {
    pushLine('status not loaded');
    pushLine('select refresh review to load latest state');
  } else if (review.status === 'loading') {
    pushLine('status loading GitHub review data…');
  } else if (review.status === 'error') {
    const message =
      review.errorMessage === null ? 'unknown error' : sanitizeInlineText(review.errorMessage);
    pushLine(`status error ${message}`);
  } else {
    const branchName = review.branchName?.trim() ?? '';
    const branchSource = review.branchSource === null ? '' : ` (${review.branchSource})`;
    pushLine(`branch ${branchName.length > 0 ? branchName : '(none)'}${branchSource}`);
    if (review.pr === null) {
      pushLine('pr none for tracked branch');
    } else {
      const pr = review.pr;
      const openCommentCount = threadCommentCount(review.openThreads);
      const resolvedCommentCount = threadCommentCount(review.resolvedThreads);
      pushLine(
        `pr #${String(pr.number)} ${githubPrStateLabel(pr)} ${sanitizeInlineText(pr.title)}`,
      );
      pushLine(`url ${pr.url}`);
      pushLine(`author ${formatGitHubAuthor(pr.authorLogin)}`);
      pushLine(`branches ${pr.headBranch} -> ${pr.baseBranch}`);
      pushLine(`created ${pr.createdAt}`);
      pushLine(`updated ${pr.updatedAt}`);
      if (pr.mergedAt !== null) {
        pushLine(`merged ${pr.mergedAt}`);
      }
      if (pr.closedAt !== null) {
        pushLine(`closed ${pr.closedAt}`);
      }
      pushLine(
        `review threads ${String(review.openThreads.length)} open / ${String(review.resolvedThreads.length)} resolved`,
      );
      pushLine(
        `review comments ${String(openCommentCount + resolvedCommentCount)} total (${String(
          openCommentCount,
        )} open, ${String(resolvedCommentCount)} resolved)`,
      );
      pushLine('');
      appendThreadDetails(pushLine, 'open threads', review.openThreads);
      pushLine('');
      appendThreadDetails(pushLine, 'resolved threads', review.resolvedThreads);
    }
  }

  return {
    directoryId: base.directoryId,
    path: base.path,
    lines,
    actionBySourceLineIndex,
    actionLineIndexByKind: {
      conversationNew: base.actionLineIndexByKind.conversationNew,
      projectClose: base.actionLineIndexByKind.projectClose,
    },
  };
}

export function buildProjectPaneRows(
  snapshot: ProjectPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number,
): { rows: readonly string[]; top: number } {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, paneRows);
  const wrappedLines = buildProjectPaneWrappedLines(snapshot, safeCols);
  const maxTop = Math.max(0, wrappedLines.length - safeRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const viewport = wrappedLines.slice(nextTop, nextTop + safeRows);
  while (viewport.length < safeRows) {
    viewport.push({
      text: '',
      sourceLineIndex: -1,
    });
  }
  return {
    rows: viewport.map((row) => padOrTrimDisplay(row.text, safeCols)),
    top: nextTop,
  };
}

export function projectPaneActionAtRow(
  snapshot: ProjectPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number,
  rowIndex: number,
): ProjectPaneAction | null {
  const safeRows = Math.max(1, paneRows);
  const wrappedLines = buildProjectPaneWrappedLines(snapshot, cols);
  const maxTop = Math.max(0, wrappedLines.length - safeRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const normalizedRow = Math.max(0, Math.min(safeRows - 1, rowIndex));
  const line = wrappedLines[nextTop + normalizedRow]!;
  const mappedAction = snapshot.actionBySourceLineIndex[line.sourceLineIndex];
  if (mappedAction !== undefined) {
    return mappedAction;
  }
  if (line.sourceLineIndex === snapshot.actionLineIndexByKind.conversationNew) {
    return 'conversation.new';
  }
  if (line.sourceLineIndex === snapshot.actionLineIndexByKind.projectClose) {
    return 'project.close';
  }
  return null;
}

export function buildTaskPaneSnapshot(
  repositories: ReadonlyMap<string, TaskPaneRepositoryRecord>,
  tasks: ReadonlyMap<string, TaskPaneTaskRecord>,
  selectedTaskId: string | null,
  selectedRepositoryId: string | null,
  nowMs: number,
  notice: string | null,
): TaskPaneSnapshot {
  const activeRepositories = sortedRepositoryList(repositories);
  const repositoryNameById = new Map<string, string>(
    activeRepositories.map((repository) => [repository.repositoryId, repository.name] as const),
  );
  const orderedTasks = sortTasksForHomePane([...tasks.values()]);
  const activeTasks = orderedTasks.filter((task) => task.status !== 'completed');
  const completedTasks = orderedTasks.filter((task) => task.status === 'completed');
  const effectiveSelectedTaskId =
    (selectedTaskId !== null && tasks.has(selectedTaskId) ? selectedTaskId : null) ??
    activeTasks[0]?.taskId ??
    orderedTasks[0]?.taskId ??
    null;
  const effectiveSelectedRepositoryId =
    (selectedRepositoryId !== null && repositories.has(selectedRepositoryId)
      ? selectedRepositoryId
      : null) ??
    activeRepositories[0]?.repositoryId ??
    null;
  const lines: TaskPaneSnapshotLine[] = [];
  const push = (
    text: string,
    taskId: string | null = null,
    repositoryId: string | null = null,
    action: TaskPaneAction | null = null,
  ): void => {
    lines.push({
      text,
      taskId,
      repositoryId,
      action,
    });
  };

  if (notice !== null) {
    push(` NOTICE: ${truncateLabel(notice, 68)}`);
    push('');
  }
  push(
    ' REPOSITORIES                                          R add  drag prioritize',
    null,
    null,
    'repository.create',
  );
  push(` ${fillLine(74, '─')}`);
  if (activeRepositories.length === 0) {
    push('   no repositories');
  } else {
    for (const repository of activeRepositories) {
      const selected = repository.repositoryId === effectiveSelectedRepositoryId ? '▸' : ' ';
      const repositoryName =
        repository.name.trim().length === 0 ? '(unnamed repository)' : repository.name.trim();
      const remoteLabel = repositoryRemoteLabel(repository.remoteUrl);
      const branch = repository.defaultBranch?.trim() ?? '';
      const branchLabel = branch.length === 0 ? 'main' : branch;
      const updatedLabel = repositoryLastCommitAgeLabel(repository, nowMs);
      const commitCountLabel = repositoryCommitCountLabel(repository);
      const row = ` ${selected} ${truncateLabel(repositoryName, 14).padEnd(14)}  ${truncateLabel(remoteLabel, 30).padEnd(30)}  ${truncateLabel(branchLabel, 6).padEnd(6)}  ${updatedLabel.padStart(3)}  ${commitCountLabel.padStart(4)}`;
      push(row, null, repository.repositoryId);
    }
  }
  push('');
  push(
    ' TASKS                                                   A add  E edit  X archive',
    null,
    null,
    'task.create',
  );
  push(` ${fillLine(74, '─')}`);
  if (orderedTasks.length === 0) {
    push('   no tasks');
  } else {
    for (const task of orderedTasks) {
      const selected = task.taskId === effectiveSelectedTaskId ? '▸' : ' ';
      const repositoryName =
        (task.repositoryId !== null ? repositoryNameById.get(task.repositoryId) : null) ??
        '(missing repo)';
      const taskOrderLabel = `#${String(Math.max(1, task.orderIndex + 1))}`;
      const row = ` ${selected} ${taskStatusGlyph(task.status)} ${truncateLabel(task.title, 38).padEnd(38)}  ${truncateLabel(repositoryName, 14).padEnd(14)}  ${taskOrderLabel}`;
      push(row, task.taskId, task.repositoryId);
    }
  }
  if (completedTasks.length > 0) {
    push('');
    push(
      ` COMPLETED: ${String(completedTasks.length)}  UPDATED ${formatRelativeIsoTime(nowMs, completedTasks[0]?.updatedAt)}`,
    );
  }
  return {
    lines,
  };
}

export function buildTaskPaneRows(
  snapshot: TaskPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number,
): TaskPaneView {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, paneRows);
  const tooSmallForFrame = safeCols < 4 || safeRows < 4;
  if (tooSmallForFrame) {
    const maxTop = Math.max(0, snapshot.lines.length - safeRows);
    const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
    const viewport = snapshot.lines.slice(nextTop, nextTop + safeRows);
    while (viewport.length < safeRows) {
      viewport.push({
        text: '',
        taskId: null,
        repositoryId: null,
        action: null,
      });
    }
    return {
      rows: viewport.map((row) => padOrTrimDisplay(row.text, safeCols)),
      taskIds: viewport.map((row) => row.taskId),
      repositoryIds: viewport.map((row) => row.repositoryId),
      actions: viewport.map((row) => row.action),
      actionCells: viewport.map(() => null),
      top: nextTop,
    };
  }

  const fixedRows = 5;
  const contentRows = Math.max(1, safeRows - fixedRows);
  const maxTop = Math.max(0, snapshot.lines.length - contentRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const viewport = snapshot.lines.slice(nextTop, nextTop + contentRows);
  while (viewport.length < contentRows) {
    viewport.push({
      text: '',
      taskId: null,
      repositoryId: null,
      action: null,
    });
  }

  const rows: string[] = [];
  const taskIds: Array<string | null> = [];
  const repositoryIds: Array<string | null> = [];
  const actions: Array<TaskPaneAction | null> = [];
  const actionCells: Array<readonly TaskPaneActionCell[] | null> = [];

  const pushRow = (
    text: string,
    taskId: string | null = null,
    repositoryId: string | null = null,
    action: TaskPaneAction | null = null,
    cells: readonly TaskPaneActionCell[] | null = null,
  ): void => {
    rows.push(padOrTrimDisplay(text, safeCols));
    taskIds.push(taskId);
    repositoryIds.push(repositoryId);
    actions.push(action);
    actionCells.push(cells);
  };

  const innerCols = safeCols - 2;
  const topInner = `─ Home ${fillLine(Math.max(0, innerCols - 7), '─')}`;
  pushRow(`┌${padOrTrimDisplay(topInner, innerCols)}┐`);
  for (const row of viewport) {
    pushRow(normalizeTaskPaneRow(row.text, safeCols), row.taskId, row.repositoryId, row.action);
  }
  pushRow(`├${fillLine(innerCols, '─')}┤`);

  const repositoryFooterContent = ` ${TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL}  ${TASKS_PANE_FOOTER_REPOSITORY_ARCHIVE_BUTTON_LABEL}`;
  const repositoryFooterInner = padOrTrimDisplay(repositoryFooterContent, innerCols);
  const repositoryFooterCells: TaskPaneActionCell[] = [];
  const repositoryFooterMappings: ReadonlyArray<{ label: string; action: TaskPaneAction }> = [
    {
      label: TASKS_PANE_FOOTER_REPOSITORY_EDIT_BUTTON_LABEL,
      action: 'repository.edit',
    },
    {
      label: TASKS_PANE_FOOTER_REPOSITORY_ARCHIVE_BUTTON_LABEL,
      action: 'repository.archive',
    },
  ];
  for (const mapping of repositoryFooterMappings) {
    const start = repositoryFooterInner.indexOf(mapping.label);
    if (start < 0) {
      continue;
    }
    repositoryFooterCells.push({
      startCol: 1 + start,
      endCol: start + mapping.label.length,
      action: mapping.action,
    });
  }
  pushRow(`│${repositoryFooterInner}│`, null, null, null, repositoryFooterCells);

  const taskFooterContent = ` ${TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL}  ${TASKS_PANE_FOOTER_DELETE_BUTTON_LABEL}  ${TASKS_PANE_FOOTER_COMPLETE_BUTTON_LABEL}  ${TASKS_PANE_FOOTER_DRAFT_BUTTON_LABEL}`;
  const taskFooterInner = padOrTrimDisplay(taskFooterContent, innerCols);
  const taskFooterCells: TaskPaneActionCell[] = [];
  const taskFooterMappings: ReadonlyArray<{ label: string; action: TaskPaneAction }> = [
    {
      label: TASKS_PANE_FOOTER_EDIT_BUTTON_LABEL,
      action: 'task.edit',
    },
    {
      label: TASKS_PANE_FOOTER_DELETE_BUTTON_LABEL,
      action: 'task.delete',
    },
    {
      label: TASKS_PANE_FOOTER_COMPLETE_BUTTON_LABEL,
      action: 'task.complete',
    },
    {
      label: TASKS_PANE_FOOTER_DRAFT_BUTTON_LABEL,
      action: 'task.draft',
    },
  ];
  for (const mapping of taskFooterMappings) {
    const start = taskFooterInner.indexOf(mapping.label);
    if (start < 0) {
      continue;
    }
    taskFooterCells.push({
      startCol: 1 + start,
      endCol: start + mapping.label.length,
      action: mapping.action,
    });
  }
  pushRow(`│${taskFooterInner}│`, null, null, null, taskFooterCells);
  pushRow(`└${fillLine(innerCols, '─')}┘`);

  return {
    rows,
    taskIds,
    repositoryIds,
    actions,
    actionCells,
    top: nextTop,
  };
}

export function taskPaneActionAtRow(view: TaskPaneView, rowIndex: number): TaskPaneAction | null {
  if (view.actions.length === 0) {
    return null;
  }
  const normalizedRow = Math.max(0, Math.min(view.actions.length - 1, rowIndex));
  return view.actions[normalizedRow] ?? null;
}

export function taskPaneActionAtCell(
  view: TaskPaneView,
  rowIndex: number,
  colIndex: number,
): TaskPaneAction | null {
  if (view.rows.length === 0) {
    return null;
  }
  const normalizedRow = Math.max(0, Math.min(view.rows.length - 1, rowIndex));
  const normalizedCol = Math.max(0, Math.floor(colIndex));
  const hitboxes = view.actionCells[normalizedRow] ?? null;
  if (hitboxes !== null) {
    for (const hitbox of hitboxes) {
      if (normalizedCol >= hitbox.startCol && normalizedCol <= hitbox.endCol) {
        return hitbox.action;
      }
    }
  }
  return taskPaneActionAtRow(view, normalizedRow);
}

export function taskPaneTaskIdAtRow(view: TaskPaneView, rowIndex: number): string | null {
  if (view.taskIds.length === 0) {
    return null;
  }
  const normalizedRow = Math.max(0, Math.min(view.taskIds.length - 1, rowIndex));
  return view.taskIds[normalizedRow] ?? null;
}

export function taskPaneRepositoryIdAtRow(view: TaskPaneView, rowIndex: number): string | null {
  if (view.repositoryIds.length === 0) {
    return null;
  }
  const normalizedRow = Math.max(0, Math.min(view.repositoryIds.length - 1, rowIndex));
  return view.repositoryIds[normalizedRow] ?? null;
}

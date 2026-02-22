export type ProjectPaneGitHubToggleAction = `project.github.toggle:${string}`;

type ProjectPaneGitHubPrLifecycleState = 'draft' | 'open' | 'merged' | 'closed';
type ProjectPaneGitHubCiRollup =
  | 'pending'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'neutral'
  | 'none';

export interface ProjectPaneGitHubReviewComment {
  readonly commentId: string;
  readonly authorLogin: string | null;
  readonly body: string;
  readonly url: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectPaneGitHubReviewThread {
  readonly threadId: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly resolvedByLogin: string | null;
  readonly comments: readonly ProjectPaneGitHubReviewComment[];
}

export interface ProjectPaneGitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string | null;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly state: ProjectPaneGitHubPrLifecycleState;
  readonly isDraft: boolean;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly ciRollup?: ProjectPaneGitHubCiRollup | null;
  readonly updatedAt: string;
  readonly createdAt: string;
}

export interface ProjectPaneGitHubReviewSummary {
  readonly status: 'loading' | 'ready' | 'error';
  readonly branchName: string | null;
  readonly branchSource: 'pinned' | 'current' | null;
  readonly pr: ProjectPaneGitHubPullRequestSummary | null;
  readonly openThreads: readonly ProjectPaneGitHubReviewThread[];
  readonly resolvedThreads: readonly ProjectPaneGitHubReviewThread[];
  readonly errorMessage: string | null;
}

interface BuildProjectPaneGitHubReviewLinesInput {
  readonly review: ProjectPaneGitHubReviewSummary;
  readonly expandedNodeIds: ReadonlySet<string>;
}

interface BuildProjectPaneGitHubReviewLinesResult {
  readonly lines: readonly string[];
  readonly actionByRelativeLineIndex: Readonly<Record<number, ProjectPaneGitHubToggleAction>>;
}

const OPEN_THREAD_GROUP_NODE_ID = 'github/open-threads';
const RESOLVED_THREAD_GROUP_NODE_ID = 'github/resolved-threads';

function sanitizeInlineText(value: string): string {
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  return collapsed;
}

function commentPreview(body: string, maxLength = 160): string {
  const normalized = sanitizeInlineText(body);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatAuthor(login: string | null): string {
  const normalized = login?.trim() ?? '';
  return normalized.length > 0 ? `@${normalized}` : '@unknown';
}

function countComments(threads: readonly ProjectPaneGitHubReviewThread[]): number {
  let total = 0;
  for (const thread of threads) {
    total += thread.comments.length;
  }
  return total;
}

function prStateLabel(pr: ProjectPaneGitHubPullRequestSummary): string {
  if (pr.isDraft || pr.state === 'draft') {
    return 'draft';
  }
  if (pr.state === 'merged') {
    return 'merged';
  }
  if (pr.state === 'closed') {
    return 'closed';
  }
  return 'open';
}

function toggleAction(nodeId: string): ProjectPaneGitHubToggleAction {
  return `project.github.toggle:${nodeId}`;
}

function threadNodeId(thread: ProjectPaneGitHubReviewThread): string {
  return `github/thread:${thread.threadId}`;
}

function pushLine(
  lines: string[],
  actionByRelativeLineIndex: Record<number, ProjectPaneGitHubToggleAction>,
  line: string,
  action: ProjectPaneGitHubToggleAction | null,
): void {
  const nextIndex = lines.length;
  lines.push(line);
  if (action !== null) {
    actionByRelativeLineIndex[nextIndex] = action;
  }
}

function appendThreadGroup(
  lines: string[],
  actionByRelativeLineIndex: Record<number, ProjectPaneGitHubToggleAction>,
  input: {
    readonly label: string;
    readonly nodeId: string;
    readonly threads: readonly ProjectPaneGitHubReviewThread[];
    readonly expandedNodeIds: ReadonlySet<string>;
  },
): void {
  const commentCount = countComments(input.threads);
  const expanded = input.expandedNodeIds.has(input.nodeId);
  const groupGlyph = expanded ? '▼' : '▶';
  pushLine(
    lines,
    actionByRelativeLineIndex,
    `${groupGlyph} ${input.label} (${String(input.threads.length)} threads, ${String(commentCount)} comments)`,
    toggleAction(input.nodeId),
  );
  if (!expanded) {
    return;
  }
  if (input.threads.length === 0) {
    pushLine(lines, actionByRelativeLineIndex, '  (none)', null);
    return;
  }

  for (const thread of input.threads) {
    const nodeId = threadNodeId(thread);
    const threadExpanded = input.expandedNodeIds.has(nodeId);
    const threadGlyph = threadExpanded ? '▼' : '▶';
    const firstAuthor = thread.comments[0]?.authorLogin ?? null;
    const metadataParts: string[] = [];
    if (thread.isOutdated) {
      metadataParts.push('outdated');
    }
    if (thread.isResolved && thread.resolvedByLogin !== null) {
      metadataParts.push(`resolved by ${formatAuthor(thread.resolvedByLogin)}`);
    }
    const metadataSuffix = metadataParts.length === 0 ? '' : `, ${metadataParts.join(', ')}`;
    pushLine(
      lines,
      actionByRelativeLineIndex,
      `  ${threadGlyph} ${formatAuthor(firstAuthor)} (${String(thread.comments.length)} comments${metadataSuffix})`,
      toggleAction(nodeId),
    );
    if (!threadExpanded) {
      continue;
    }
    if (thread.comments.length === 0) {
      pushLine(lines, actionByRelativeLineIndex, '    - (no comments)', null);
      continue;
    }
    for (const comment of thread.comments) {
      const preview = commentPreview(comment.body);
      pushLine(
        lines,
        actionByRelativeLineIndex,
        `    - ${formatAuthor(comment.authorLogin)}: ${preview}`,
        null,
      );
    }
  }
}

export function buildProjectPaneGitHubReviewLines(
  input: BuildProjectPaneGitHubReviewLinesInput,
): BuildProjectPaneGitHubReviewLinesResult {
  const lines: string[] = [];
  const actionByRelativeLineIndex: Record<number, ProjectPaneGitHubToggleAction> = {};

  pushLine(lines, actionByRelativeLineIndex, 'github review', null);

  const branchName = input.review.branchName?.trim() ?? '';
  const branchSource = input.review.branchSource;
  const sourceLabel = branchSource === null ? '' : ` (${branchSource})`;
  pushLine(
    lines,
    actionByRelativeLineIndex,
    `branch ${branchName.length > 0 ? branchName : '(none)'}${sourceLabel}`,
    null,
  );

  if (input.review.status === 'loading') {
    pushLine(lines, actionByRelativeLineIndex, 'status loading GitHub review data…', null);
    return {
      lines,
      actionByRelativeLineIndex,
    };
  }

  if (input.review.status === 'error') {
    const message =
      input.review.errorMessage === null
        ? 'unknown error'
        : sanitizeInlineText(input.review.errorMessage);
    pushLine(lines, actionByRelativeLineIndex, `status error ${message}`, null);
    return {
      lines,
      actionByRelativeLineIndex,
    };
  }

  const pr = input.review.pr;
  if (pr === null) {
    pushLine(lines, actionByRelativeLineIndex, 'pr none for tracked branch', null);
    return {
      lines,
      actionByRelativeLineIndex,
    };
  }

  const stateLabel = prStateLabel(pr);
  pushLine(
    lines,
    actionByRelativeLineIndex,
    `pr #${String(pr.number)} ${stateLabel} ${sanitizeInlineText(pr.title)}`,
    null,
  );
  pushLine(
    lines,
    actionByRelativeLineIndex,
    `from ${pr.headBranch} -> ${pr.baseBranch} by ${formatAuthor(pr.authorLogin)}`,
    null,
  );

  appendThreadGroup(lines, actionByRelativeLineIndex, {
    label: 'open comments',
    nodeId: OPEN_THREAD_GROUP_NODE_ID,
    threads: input.review.openThreads,
    expandedNodeIds: input.expandedNodeIds,
  });
  appendThreadGroup(lines, actionByRelativeLineIndex, {
    label: 'resolved comments',
    nodeId: RESOLVED_THREAD_GROUP_NODE_ID,
    threads: input.review.resolvedThreads,
    expandedNodeIds: input.expandedNodeIds,
  });

  return {
    lines,
    actionByRelativeLineIndex,
  };
}

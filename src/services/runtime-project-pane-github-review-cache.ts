import type { ProjectPaneGitHubReviewSummary } from '../mux/project-pane-github-review.ts';

interface QueueLatestControlPlaneOp {
  (
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label: string,
  ): void;
}

interface RuntimeProjectPaneGitHubReviewCacheOptions {
  readonly ttlMs: number;
  readonly refreshIntervalMs: number;
  readonly queueLatestControlPlaneOp: QueueLatestControlPlaneOp;
  readonly loadReview: (directoryId: string) => Promise<ProjectPaneGitHubReviewSummary>;
  readonly onUpdate: (directoryId: string, review: ProjectPaneGitHubReviewSummary) => void;
  readonly formatErrorMessage: (error: unknown) => string;
  readonly nowMs?: () => number;
  readonly setInterval?: (callback: () => void, ms: number) => NodeJS.Timeout;
  readonly clearInterval?: (timer: NodeJS.Timeout) => void;
}

interface RuntimeProjectPaneGitHubReviewCacheRequestOptions {
  readonly forceRefresh?: boolean;
}

interface CacheEntry {
  review: ProjectPaneGitHubReviewSummary | null;
  fetchedAtMs: number | null;
  inFlight: boolean;
}

function loadingState(
  previous: ProjectPaneGitHubReviewSummary | null,
): ProjectPaneGitHubReviewSummary {
  return {
    status: 'loading',
    branchName: previous?.branchName ?? null,
    branchSource: previous?.branchSource ?? null,
    pr: previous?.pr ?? null,
    openThreads: previous?.openThreads ?? [],
    resolvedThreads: previous?.resolvedThreads ?? [],
    errorMessage: null,
  };
}

function errorState(
  previous: ProjectPaneGitHubReviewSummary | null,
  message: string,
): ProjectPaneGitHubReviewSummary {
  return {
    status: 'error',
    branchName: previous?.branchName ?? null,
    branchSource: previous?.branchSource ?? null,
    pr: previous?.pr ?? null,
    openThreads: previous?.openThreads ?? [],
    resolvedThreads: previous?.resolvedThreads ?? [],
    errorMessage: message,
  };
}

export class RuntimeProjectPaneGitHubReviewCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly nowMs: () => number;
  private readonly setIntervalFn: (callback: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearIntervalFn: (timer: NodeJS.Timeout) => void;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: RuntimeProjectPaneGitHubReviewCacheOptions) {
    this.nowMs = options.nowMs ?? Date.now;
    this.setIntervalFn = options.setInterval ?? setInterval;
    this.clearIntervalFn = options.clearInterval ?? clearInterval;
  }

  request(
    directoryId: string,
    requestOptions: RuntimeProjectPaneGitHubReviewCacheRequestOptions = {},
  ): void {
    const entry = this.entries.get(directoryId) ?? {
      review: null,
      fetchedAtMs: null,
      inFlight: false,
    };
    this.entries.set(directoryId, entry);
    const forceRefresh = requestOptions.forceRefresh === true;
    if (entry.inFlight) {
      return;
    }
    if (!forceRefresh && this.isFresh(entry)) {
      return;
    }
    const previous = entry.review;
    entry.inFlight = true;
    const nextLoading = loadingState(previous);
    entry.review = nextLoading;
    this.options.onUpdate(directoryId, nextLoading);

    this.options.queueLatestControlPlaneOp(
      `project-pane-github-review:${directoryId}`,
      async ({ signal }) => {
        if (signal.aborted) {
          return;
        }
        try {
          const loaded = await this.options.loadReview(directoryId);
          if (signal.aborted) {
            return;
          }
          entry.review = loaded;
          entry.fetchedAtMs = this.nowMs();
          this.options.onUpdate(directoryId, loaded);
        } catch (error: unknown) {
          if (signal.aborted) {
            return;
          }
          const message = this.options.formatErrorMessage(error);
          const nextError = errorState(previous, message);
          entry.review = nextError;
          this.options.onUpdate(directoryId, nextError);
        } finally {
          entry.inFlight = false;
        }
      },
      'project-pane-github-review',
    );
  }

  startAutoRefresh(resolveDirectoryId: () => string | null): void {
    this.stopAutoRefresh();
    if (this.options.refreshIntervalMs <= 0) {
      return;
    }
    this.refreshTimer = this.setIntervalFn(() => {
      const directoryId = resolveDirectoryId();
      if (directoryId === null) {
        return;
      }
      this.request(directoryId);
    }, this.options.refreshIntervalMs);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer === null) {
      return;
    }
    this.clearIntervalFn(this.refreshTimer);
    this.refreshTimer = null;
  }

  private isFresh(entry: CacheEntry): boolean {
    if (entry.review?.status !== 'ready') {
      return false;
    }
    if (entry.fetchedAtMs === null) {
      return false;
    }
    return this.nowMs() - entry.fetchedAtMs < this.options.ttlMs;
  }
}

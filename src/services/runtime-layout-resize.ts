import { computeDualPaneLayout } from '../mux/dual-pane-core.ts';

interface RuntimeLayoutResizeConversationRecord {
  readonly sessionId: string;
  readonly live: boolean;
  readonly oracle: {
    resize: (cols: number, rows: number) => void;
  };
}

interface RuntimeLayoutResizeConversationManager<
  TConversation extends RuntimeLayoutResizeConversationRecord,
> {
  readonly activeConversationId: string | null;
  get(sessionId: string): TConversation | undefined;
  values(): IterableIterator<TConversation>;
}

interface RuntimeLayoutResizeSize {
  readonly cols: number;
  readonly rows: number;
}

type RuntimeLayout = ReturnType<typeof computeDualPaneLayout>;

interface RuntimeLayoutResizeOptions<
  TConversation extends RuntimeLayoutResizeConversationRecord,
> {
  readonly getSize: () => RuntimeLayoutResizeSize;
  readonly setSize: (nextSize: RuntimeLayoutResizeSize) => void;
  readonly getLayout: () => RuntimeLayout;
  readonly setLayout: (nextLayout: RuntimeLayout) => void;
  readonly getLeftPaneColsOverride: () => number | null;
  readonly setLeftPaneColsOverride: (leftCols: number | null) => void;
  readonly conversationManager: RuntimeLayoutResizeConversationManager<TConversation>;
  readonly ptySizeByConversationId: Map<string, RuntimeLayoutResizeSize>;
  readonly sendResize: (sessionId: string, cols: number, rows: number) => void;
  readonly markDirty: () => void;
  readonly resetFrameCache: () => void;
  readonly resizeRecordingOracle: (nextLayout: RuntimeLayout) => void;
  readonly queuePersistMuxUiState: () => void;
  readonly resizeMinIntervalMs: number;
  readonly ptyResizeSettleMs: number;
  readonly nowMs?: () => number;
  readonly setTimeoutFn?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class RuntimeLayoutResize<
  TConversation extends RuntimeLayoutResizeConversationRecord,
> {
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSize: RuntimeLayoutResizeSize | null = null;
  private lastResizeApplyAtMs = 0;
  private ptyResizeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPtySize: RuntimeLayoutResizeSize | null = null;
  private readonly nowMs: () => number;
  private readonly setTimeoutFn: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly options: RuntimeLayoutResizeOptions<TConversation>) {
    this.nowMs = options.nowMs ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  clearResizeTimer(): void {
    if (this.resizeTimer === null) {
      return;
    }
    this.clearTimeoutFn(this.resizeTimer);
    this.resizeTimer = null;
  }

  clearPtyResizeTimer(): void {
    if (this.ptyResizeTimer === null) {
      return;
    }
    this.clearTimeoutFn(this.ptyResizeTimer);
    this.ptyResizeTimer = null;
  }

  schedulePtyResize(ptySize: RuntimeLayoutResizeSize, immediate = false): void {
    this.pendingPtySize = ptySize;
    if (immediate) {
      this.clearPtyResizeTimer();
      this.flushPendingPtyResize();
      return;
    }

    if (this.ptyResizeTimer !== null) {
      this.clearTimeoutFn(this.ptyResizeTimer);
    }
    this.ptyResizeTimer = this.setTimeoutFn(
      () => {
        this.flushPendingPtyResize();
      },
      this.options.ptyResizeSettleMs,
    );
  }

  applyLayout(nextSize: RuntimeLayoutResizeSize, forceImmediatePtyResize = false): void {
    const nextLayout = computeDualPaneLayout(nextSize.cols, nextSize.rows, {
      leftCols: this.options.getLeftPaneColsOverride(),
    });
    this.schedulePtyResize(
      {
        cols: nextLayout.rightCols,
        rows: nextLayout.paneRows,
      },
      forceImmediatePtyResize,
    );
    const layout = this.options.getLayout();
    if (
      nextLayout.cols === layout.cols &&
      nextLayout.rows === layout.rows &&
      nextLayout.leftCols === layout.leftCols &&
      nextLayout.rightCols === layout.rightCols &&
      nextLayout.paneRows === layout.paneRows
    ) {
      return;
    }
    this.options.setSize(nextSize);
    this.options.setLayout(nextLayout);
    for (const conversation of this.options.conversationManager.values()) {
      conversation.oracle.resize(nextLayout.rightCols, nextLayout.paneRows);
      if (conversation.live) {
        this.applyPtyResizeToSession(
          conversation.sessionId,
          {
            cols: nextLayout.rightCols,
            rows: nextLayout.paneRows,
          },
          true,
        );
      }
    }
    this.options.resizeRecordingOracle(nextLayout);
    // Force a full clear on actual layout changes to avoid stale diagonal artifacts during drag.
    this.options.resetFrameCache();
    this.options.markDirty();
  }

  queueResize(nextSize: RuntimeLayoutResizeSize): void {
    this.pendingSize = nextSize;
    if (this.resizeTimer !== null) {
      return;
    }

    const nowMs = this.nowMs();
    const elapsedMs = nowMs - this.lastResizeApplyAtMs;
    const delayMs =
      elapsedMs >= this.options.resizeMinIntervalMs
        ? 0
        : this.options.resizeMinIntervalMs - elapsedMs;
    this.resizeTimer = this.setTimeoutFn(
      () => {
        this.flushPendingResize();
      },
      delayMs,
    );
  }

  applyPaneDividerAtCol(col: number): void {
    const size = this.options.getSize();
    const normalizedCol = Math.max(1, Math.min(size.cols, col));
    this.options.setLeftPaneColsOverride(Math.max(1, normalizedCol - 1));
    this.applyLayout(size);
    this.options.queuePersistMuxUiState();
  }

  private applyPtyResizeToSession(
    sessionId: string,
    ptySize: RuntimeLayoutResizeSize,
    force = false,
  ): void {
    const conversation = this.options.conversationManager.get(sessionId);
    if (conversation === undefined || !conversation.live) {
      return;
    }
    const currentPtySize = this.options.ptySizeByConversationId.get(sessionId);
    if (
      !force &&
      currentPtySize !== undefined &&
      currentPtySize.cols === ptySize.cols &&
      currentPtySize.rows === ptySize.rows
    ) {
      return;
    }
    this.options.ptySizeByConversationId.set(sessionId, {
      cols: ptySize.cols,
      rows: ptySize.rows,
    });
    conversation.oracle.resize(ptySize.cols, ptySize.rows);
    this.options.sendResize(sessionId, ptySize.cols, ptySize.rows);
    this.options.markDirty();
  }

  private applyPtyResize(ptySize: RuntimeLayoutResizeSize): void {
    const activeConversationId = this.options.conversationManager.activeConversationId;
    if (activeConversationId === null) {
      return;
    }
    this.applyPtyResizeToSession(activeConversationId, ptySize, false);
  }

  private flushPendingPtyResize(): void {
    this.ptyResizeTimer = null;
    const ptySize = this.pendingPtySize;
    if (ptySize === null) {
      return;
    }
    this.pendingPtySize = null;
    this.applyPtyResize(ptySize);
  }

  private flushPendingResize(): void {
    this.resizeTimer = null;
    const nextSize = this.pendingSize;
    if (nextSize === null) {
      return;
    }

    const nowMs = this.nowMs();
    const elapsedMs = nowMs - this.lastResizeApplyAtMs;
    if (elapsedMs < this.options.resizeMinIntervalMs) {
      this.resizeTimer = this.setTimeoutFn(
        () => {
          this.flushPendingResize();
        },
        this.options.resizeMinIntervalMs - elapsedMs,
      );
      return;
    }

    this.pendingSize = null;
    this.applyLayout(nextSize);
    this.lastResizeApplyAtMs = this.nowMs();

    if (this.pendingSize !== null && this.resizeTimer === null) {
      this.resizeTimer = this.setTimeoutFn(
        () => {
          this.flushPendingResize();
        },
        this.options.resizeMinIntervalMs,
      );
    }
  }
}

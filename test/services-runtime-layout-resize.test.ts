import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { computeDualPaneLayout } from '../src/mux/dual-pane-core.ts';
import { RuntimeLayoutResize } from '../src/services/runtime-layout-resize.ts';

interface ConversationRecord {
  readonly sessionId: string;
  live: boolean;
  readonly oracle: {
    resize: (cols: number, rows: number) => void;
  };
}

interface TimerRecord {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
}

interface Harness {
  readonly service: RuntimeLayoutResize<ConversationRecord>;
  readonly conversations: Map<string, ConversationRecord>;
  readonly conversationManager: {
    activeConversationId: string | null;
    get: (sessionId: string) => ConversationRecord | undefined;
    values: () => IterableIterator<ConversationRecord>;
  };
  readonly ptySizeByConversationId: Map<string, { cols: number; rows: number }>;
  readonly sentResizeCalls: string[];
  readonly dirtyMarks: number[];
  readonly frameResets: number[];
  readonly recordingResizes: string[];
  readonly persistedUiStateCalls: number[];
  readonly oracleResizes: string[];
  readonly timerRecords: TimerRecord[];
  readonly setNowMs: (next: number) => void;
  readonly runNextTimer: () => boolean;
  readonly state: {
    size: { cols: number; rows: number };
    layout: ReturnType<typeof computeDualPaneLayout>;
    leftPaneColsOverride: number | null;
  };
}

const createHarness = (input?: {
  activeConversationId?: string | null;
  conversations?: ConversationRecord[];
  size?: { cols: number; rows: number };
  resizeMinIntervalMs?: number;
  ptyResizeSettleMs?: number;
  onMarkDirty?: () => void;
}): Harness => {
  const sentResizeCalls: string[] = [];
  const dirtyMarks: number[] = [];
  const frameResets: number[] = [];
  const recordingResizes: string[] = [];
  const persistedUiStateCalls: number[] = [];
  const oracleResizes: string[] = [];
  const timerRecords: TimerRecord[] = [];
  let nowMs = 100;
  const state = {
    size: input?.size ?? { cols: 120, rows: 40 },
    leftPaneColsOverride: null as number | null,
    layout: computeDualPaneLayout((input?.size ?? { cols: 120, rows: 40 }).cols, (input?.size ?? {
      cols: 120,
      rows: 40,
    }).rows, {
      leftCols: null,
    }),
  };
  const conversations = new Map<string, ConversationRecord>(
    (input?.conversations ?? []).map((conversation) => [conversation.sessionId, conversation]),
  );
  const conversationManager = {
    activeConversationId: input?.activeConversationId ?? null,
    get: (sessionId: string): ConversationRecord | undefined => conversations.get(sessionId),
    values: (): IterableIterator<ConversationRecord> => conversations.values(),
  };
  const ptySizeByConversationId = new Map<string, { cols: number; rows: number }>();

  const service = new RuntimeLayoutResize<ConversationRecord>({
    getSize: () => state.size,
    setSize: (nextSize) => {
      state.size = {
        cols: nextSize.cols,
        rows: nextSize.rows,
      };
    },
    getLayout: () => state.layout,
    setLayout: (nextLayout) => {
      state.layout = nextLayout;
    },
    getLeftPaneColsOverride: () => state.leftPaneColsOverride,
    setLeftPaneColsOverride: (leftCols) => {
      state.leftPaneColsOverride = leftCols;
    },
    conversationManager,
    ptySizeByConversationId,
    sendResize: (sessionId, cols, rows) => {
      sentResizeCalls.push(`${sessionId}:${cols}x${rows}`);
    },
    markDirty: () => {
      dirtyMarks.push(1);
      input?.onMarkDirty?.();
    },
    resetFrameCache: () => {
      frameResets.push(1);
    },
    resizeRecordingOracle: (layout) => {
      recordingResizes.push(`${layout.cols}x${layout.rows}`);
    },
    queuePersistMuxUiState: () => {
      persistedUiStateCalls.push(1);
    },
    resizeMinIntervalMs: input?.resizeMinIntervalMs ?? 33,
    ptyResizeSettleMs: input?.ptyResizeSettleMs ?? 75,
    nowMs: () => nowMs,
    setTimeoutFn: (callback, delayMs) => {
      const timer: TimerRecord = {
        callback,
        delayMs,
        cleared: false,
      };
      timerRecords.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (timer) => {
      const typed = timer as unknown as TimerRecord;
      typed.cleared = true;
    },
  });

  for (const conversation of conversations.values()) {
    const resize = conversation.oracle.resize;
    conversation.oracle.resize = (cols, rows) => {
      oracleResizes.push(`${conversation.sessionId}:${cols}x${rows}`);
      resize(cols, rows);
    };
  }

  return {
    service,
    conversations,
    conversationManager,
    ptySizeByConversationId,
    sentResizeCalls,
    dirtyMarks,
    frameResets,
    recordingResizes,
    persistedUiStateCalls,
    oracleResizes,
    timerRecords,
    setNowMs: (next) => {
      nowMs = next;
    },
    runNextTimer: () => {
      while (timerRecords.length > 0) {
        const next = timerRecords.shift();
        if (next === undefined) {
          return false;
        }
        if (next.cleared) {
          continue;
        }
        next.callback();
        return true;
      }
      return false;
    },
    state,
  };
};

void test('runtime layout resize applies immediate pty resize only for live active conversation', () => {
  const harness = createHarness({
    activeConversationId: 'session-live',
    conversations: [
      {
        sessionId: 'session-live',
        live: true,
        oracle: {
          resize: () => {},
        },
      },
    ],
  });

  harness.service.schedulePtyResize({ cols: 80, rows: 24 }, true);
  harness.service.schedulePtyResize({ cols: 80, rows: 24 }, true);

  assert.deepEqual(harness.sentResizeCalls, ['session-live:80x24']);
  assert.deepEqual(harness.oracleResizes, ['session-live:80x24']);
  assert.equal(harness.dirtyMarks.length, 1);
  assert.deepEqual(harness.ptySizeByConversationId.get('session-live'), { cols: 80, rows: 24 });

  harness.conversationManager.activeConversationId = 'missing';
  harness.service.schedulePtyResize({ cols: 81, rows: 24 }, true);
  assert.deepEqual(harness.sentResizeCalls, ['session-live:80x24']);

  harness.conversationManager.activeConversationId = 'session-live';
  const liveConversation = harness.conversations.get('session-live');
  assert.ok(liveConversation);
  liveConversation.live = false;
  harness.service.schedulePtyResize({ cols: 82, rows: 24 }, true);
  assert.deepEqual(harness.sentResizeCalls, ['session-live:80x24']);

  liveConversation.live = true;
  harness.service.schedulePtyResize({ cols: 83, rows: 24 }, false);
  assert.equal(harness.runNextTimer(), true);
  assert.deepEqual(harness.sentResizeCalls, ['session-live:80x24', 'session-live:83x24']);
});

void test('runtime layout resize updates layout state and resizes conversations on layout changes', () => {
  const harness = createHarness({
    activeConversationId: 'session-live',
    conversations: [
      {
        sessionId: 'session-live',
        live: true,
        oracle: {
          resize: () => {},
        },
      },
      {
        sessionId: 'session-idle',
        live: false,
        oracle: {
          resize: () => {},
        },
      },
    ],
  });

  harness.service.applyLayout({ cols: 130, rows: 44 }, true);

  assert.deepEqual(harness.state.size, { cols: 130, rows: 44 });
  assert.equal(harness.frameResets.length, 1);
  assert.deepEqual(harness.recordingResizes, ['130x44']);
  assert.deepEqual(harness.sentResizeCalls, ['session-live:90x43', 'session-live:90x43']);
  assert.deepEqual(harness.oracleResizes, [
    'session-live:90x43',
    'session-live:90x43',
    'session-live:90x43',
    'session-idle:90x43',
  ]);
  assert.equal(harness.dirtyMarks.length, 3);

  harness.service.applyLayout({ cols: 130, rows: 44 }, false);
  assert.equal(harness.frameResets.length, 1);
});

void test('runtime layout resize queues and throttles terminal resize updates', () => {
  const harness = createHarness({
    activeConversationId: null,
    resizeMinIntervalMs: 33,
    ptyResizeSettleMs: 10,
  });

  harness.setNowMs(100);
  harness.service.queueResize({ cols: 125, rows: 41 });
  assert.equal(harness.timerRecords[0]?.delayMs, 0);
  assert.equal(harness.runNextTimer(), true);
  harness.service.clearPtyResizeTimer();

  harness.setNowMs(110);
  harness.service.queueResize({ cols: 126, rows: 41 });
  assert.equal(harness.runNextTimer(), true);
  assert.equal(harness.timerRecords[0]?.delayMs, 23);

  harness.setNowMs(140);
  assert.equal(harness.runNextTimer(), true);
  harness.service.clearPtyResizeTimer();
  assert.deepEqual(harness.state.size, { cols: 126, rows: 41 });
});

void test('runtime layout resize schedules follow-up resize when pending size appears during apply', () => {
  let callbackArmed = false;
  let callbackService: RuntimeLayoutResize<ConversationRecord> | null = null;
  const harness = createHarness({
    activeConversationId: null,
    resizeMinIntervalMs: 33,
    ptyResizeSettleMs: 10,
    onMarkDirty: () => {
      if (callbackArmed || callbackService === null) {
        return;
      }
      callbackArmed = true;
      callbackService.queueResize({ cols: 140, rows: 45 });
      callbackService.clearResizeTimer();
    },
  });
  callbackService = harness.service;

  harness.setNowMs(100);
  harness.service.queueResize({ cols: 130, rows: 44 });
  assert.equal(harness.runNextTimer(), true);
  harness.service.clearPtyResizeTimer();
  assert.equal(harness.timerRecords.some((timer) => !timer.cleared && timer.delayMs === 33), true);

  harness.setNowMs(140);
  assert.equal(harness.runNextTimer(), true);
  harness.service.clearPtyResizeTimer();
  assert.deepEqual(harness.state.size, { cols: 140, rows: 45 });
});

void test('runtime layout resize applies pane divider updates and clears timers', () => {
  const harness = createHarness({
    activeConversationId: null,
  });

  harness.service.applyPaneDividerAtCol(0);
  assert.equal(harness.state.leftPaneColsOverride, 1);
  assert.equal(harness.persistedUiStateCalls.length, 1);

  harness.service.applyPaneDividerAtCol(500);
  assert.equal(harness.state.leftPaneColsOverride, 119);
  assert.equal(harness.persistedUiStateCalls.length, 2);

  harness.service.queueResize({ cols: 121, rows: 40 });
  harness.service.clearResizeTimer();
  harness.service.clearResizeTimer();
  harness.service.schedulePtyResize({ cols: 80, rows: 24 }, false);
  harness.service.clearPtyResizeTimer();
  harness.service.clearPtyResizeTimer();
  assert.equal(harness.runNextTimer(), false);
});

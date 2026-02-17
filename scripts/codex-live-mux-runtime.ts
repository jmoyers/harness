import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import {
  openCodexControlPlaneClient,
  subscribeControlPlaneKeyEvents,
  type ControlPlaneKeyEvent,
} from '../src/control-plane/codex-session-stream.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import type { StreamObservedEvent, StreamServerEnvelope } from '../src/control-plane/stream-protocol.ts';
import {
  parseSessionSummaryRecord,
  parseSessionSummaryList,
} from '../src/control-plane/session-summary.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';
import { TerminalSnapshotOracle, renderSnapshotAnsiRow } from '../src/terminal/snapshot-oracle.ts';
import { type NormalizedEventEnvelope } from '../src/events/normalized-events.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import {
  classifyPaneAt,
  computeDualPaneLayout,
  diffRenderedRows,
  parseMuxInputChunk,
  wheelDeltaRowsFromCode,
} from '../src/mux/dual-pane-core.ts';
import { loadHarnessConfig, updateHarnessMuxUiConfig } from '../src/config/config-core.ts';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import {
  detectMuxGlobalShortcut,
  normalizeMuxKeyboardInputForPty,
  resolveMuxShortcutBindings,
} from '../src/mux/input-shortcuts.ts';
import { createMuxInputModeManager } from '../src/mux/terminal-input-modes.ts';
import {
  cycleConversationId,
} from '../src/mux/conversation-rail.ts';
import { findAnsiIntegrityIssues } from '../src/mux/ansi-integrity.ts';
import { ControlPlaneOpQueue } from '../src/mux/control-plane-op-queue.ts';
import { detectConversationDoubleClick, detectEntityDoubleClick } from '../src/mux/double-click.ts';
import {
  actionAtWorkspaceRailCell,
  conversationIdAtWorkspaceRailRow,
  projectWorkspaceRailConversation,
  projectIdAtWorkspaceRailRow,
  repositoryIdAtWorkspaceRailRow,
  kindAtWorkspaceRailRow,
} from '../src/mux/workspace-rail-model.ts';
import type { buildWorkspaceRailViewRows } from '../src/mux/workspace-rail-model.ts';
import { buildRailRows } from '../src/mux/live-mux/rail-layout.ts';
import { buildSelectorIndexEntries } from '../src/mux/selector-index.ts';
import {
  createNewThreadPromptState,
  normalizeThreadAgentType,
  resolveNewThreadPromptAgentByRow,
} from '../src/mux/new-thread-prompt.ts';
import {
  buildProjectPaneRows,
  buildProjectPaneSnapshot,
  projectPaneActionAtRow,
  sortedRepositoryList,
  sortTasksByOrder,
  type ProjectPaneSnapshot,
  type TaskPaneAction,
} from '../src/mux/harness-core-ui.ts';
import {
  buildTaskFocusedPaneView,
  taskFocusedPaneActionAtCell,
  taskFocusedPaneActionAtRow,
  taskFocusedPaneRepositoryIdAtRow,
  taskFocusedPaneTaskIdAtRow,
  type TaskFocusedPaneView,
} from '../src/mux/task-focused-pane.ts';
import {
  createTaskComposerBuffer,
  insertTaskComposerText,
  normalizeTaskComposerBuffer,
  taskComposerBackspace,
  taskComposerDeleteForward,
  taskComposerDeleteToLineEnd,
  taskComposerDeleteToLineStart,
  taskComposerDeleteWordLeft,
  taskComposerMoveLeft,
  taskComposerMoveLineEnd,
  taskComposerMoveLineStart,
  taskComposerMoveRight,
  taskComposerMoveVertical,
  taskComposerMoveWordLeft,
  taskComposerMoveWordRight,
  taskFieldsFromComposerText,
  type TaskComposerBuffer,
} from '../src/mux/task-composer.ts';
import {
  detectTaskScreenKeybindingAction,
  resolveTaskScreenKeybindings,
} from '../src/mux/task-screen-keybindings.ts';
import { applyMuxControlPlaneKeyEvent } from '../src/mux/runtime-wiring.ts';
import { StartupSequencer } from '../src/mux/startup-sequencer.ts';
import {
  applyModalOverlay,
  buildRenderRows,
  cursorStyleEqual,
  cursorStyleToDecscusr,
  renderCanonicalFrameAnsi,
} from '../src/mux/render-frame.ts';
import { createTerminalRecordingWriter } from '../src/recording/terminal-recording.ts';
import { renderTerminalRecordingToGif } from './terminal-recording-gif-lib.ts';
import {
  buildAgentSessionStartArgs,
  mergeAdapterStateFromSessionEvent,
  normalizeAdapterState,
} from '../src/adapters/agent-session-state.ts';
import {
  configurePerfCore,
  perfNowNs,
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan,
} from '../src/perf/perf-core.ts';
import { isUiModalOverlayHit } from '../src/ui/kit.ts';
import {
  parseDirectoryGitStatusRecord,
  parseConversationRecord,
  parseDirectoryRecord,
  parseRepositoryRecord,
  parseSessionControllerRecord,
  parseTaskRecord,
} from '../src/mux/live-mux/control-plane-records.ts';
import {
  leftColsFromPaneWidthPercent,
  paneWidthPercentFromLayout,
} from '../src/mux/live-mux/layout.ts';
import {
  normalizeGitHubRemoteUrl,
  repositoryNameFromGitHubRemoteUrl,
} from '../src/mux/live-mux/git-parsing.ts';
import { readProcessUsageSample } from '../src/mux/live-mux/git-snapshot.ts';
import { probeTerminalPalette } from '../src/mux/live-mux/terminal-palette.ts';
import { dismissModalOnOutsideClick as dismissModalOnOutsideClickHelper } from '../src/mux/live-mux/modal-pointer.ts';
import {
  leftNavTargetKey,
  visibleLeftNavTargets,
  type LeftNavSelection,
} from '../src/mux/live-mux/left-nav.ts';
import {
  reduceRepositoryFoldChordInput,
  repositoryTreeArrowAction,
  selectedRepositoryGroupIdForLeftNav,
} from '../src/mux/live-mux/repository-folding.ts';
import {
  readObservedStreamCursorBaseline,
  subscribeObservedStream,
  unsubscribeObservedStream,
} from '../src/mux/live-mux/observed-stream.ts';
import {
  buildAddDirectoryModalOverlay as buildAddDirectoryModalOverlayFrame,
  buildConversationTitleModalOverlay as buildConversationTitleModalOverlayFrame,
  buildNewThreadModalOverlay as buildNewThreadModalOverlayFrame,
  buildRepositoryModalOverlay as buildRepositoryModalOverlayFrame,
  buildTaskEditorModalOverlay as buildTaskEditorModalOverlayFrame,
} from '../src/mux/live-mux/modal-overlays.ts';
import {
  applySummaryToConversation,
  compactDebugText,
  conversationOrder,
  conversationSummary,
  createConversationState,
  debugFooterForConversation,
  formatCommandForDebugBar,
  launchCommandForAgent,
  type ConversationState,
} from '../src/mux/live-mux/conversation-state.ts';
import {
  extractFocusEvents,
  formatErrorMessage,
  parseBooleanEnv,
  parsePositiveInt,
  prepareArtifactPath,
  readStartupTerminalSize,
  resolveWorkspacePathForMux,
  restoreTerminalState,
  sanitizeProcessEnv,
  terminalSize,
} from '../src/mux/live-mux/startup-utils.ts';
import {
  normalizeExitCode,
  isSessionNotFoundError,
  isSessionNotLiveError,
  isConversationNotFoundError,
  mapTerminalOutputToNormalizedEvent,
  mapSessionEventToNormalizedEvent,
  observedAtFromSessionEvent,
} from '../src/mux/live-mux/event-mapping.ts';
import { parseMuxArgs } from '../src/mux/live-mux/args.ts';
import {
  hasAltModifier,
  isCopyShortcutInput,
  isLeftButtonPress,
  isMotionMouseCode,
  isMouseRelease,
  isSelectionDrag,
  isWheelMouseCode,
  mergeUniqueRows,
  pointFromMouseEvent,
  renderSelectionOverlay,
  selectionPointsEqual,
  selectionText,
  selectionVisibleRows,
  type PaneSelection,
  writeTextToClipboard,
} from '../src/mux/live-mux/selection.ts';
import {
  handleConversationTitleEditInput as handleConversationTitleEditInputHelper,
  handleNewThreadPromptInput as handleNewThreadPromptInputHelper,
} from '../src/mux/live-mux/modal-conversation-handlers.ts';
import {
  handleAddDirectoryPromptInput as handleAddDirectoryPromptInputHelper,
  handleRepositoryPromptInput as handleRepositoryPromptInputHelper,
} from '../src/mux/live-mux/modal-prompt-handlers.ts';
import { handleTaskEditorPromptInput as handleTaskEditorPromptInputHelper } from '../src/mux/live-mux/modal-task-editor-handler.ts';

type ThreadAgentType = ReturnType<typeof normalizeThreadAgentType>;
type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type ControlPlaneDirectoryRecord = NonNullable<ReturnType<typeof parseDirectoryRecord>>;
type ControlPlaneRepositoryRecord = NonNullable<ReturnType<typeof parseRepositoryRecord>>;
type ControlPlaneTaskRecord = NonNullable<ReturnType<typeof parseTaskRecord>>;
interface GitSummary {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

interface GitRepositorySnapshot {
  readonly normalizedRemoteUrl: string | null;
  readonly commitCount: number | null;
  readonly lastCommitAt: string | null;
  readonly shortCommitHash: string | null;
  readonly inferredName: string | null;
  readonly defaultBranch: string | null;
}

type ProcessUsageSample = Awaited<ReturnType<typeof readProcessUsageSample>>;

interface RenderCursorStyle {
  readonly shape: 'block' | 'underline' | 'bar';
  readonly blinking: boolean;
}

interface MuxPerfStatusRow {
  readonly fps: number;
  readonly kbPerSecond: number;
  readonly renderAvgMs: number;
  readonly renderMaxMs: number;
  readonly outputHandleAvgMs: number;
  readonly outputHandleMaxMs: number;
  readonly eventLoopP95Ms: number;
}

interface SelectionPoint {
  readonly rowAbs: number;
  readonly col: number;
}

interface PaneSelectionDrag {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly hasDragged: boolean;
}

interface ConversationTitleEditState {
  conversationId: string;
  value: string;
  lastSavedValue: string;
  error: string | null;
  persistInFlight: boolean;
  debounceTimer: NodeJS.Timeout | null;
}

interface RepositoryPromptState {
  readonly mode: 'add' | 'edit';
  readonly repositoryId: string | null;
  readonly value: string;
  readonly error: string | null;
}

interface ConversationProjectionSnapshot {
  readonly status: string;
  readonly glyph: string;
  readonly detailText: string;
}

const DEFAULT_RESIZE_MIN_INTERVAL_MS = 33;
const DEFAULT_PTY_RESIZE_SETTLE_MS = 75;
const DEFAULT_STARTUP_SETTLE_QUIET_MS = 300;
const DEFAULT_STARTUP_SETTLE_NONEMPTY_FALLBACK_MS = 1500;
const DEFAULT_BACKGROUND_START_MAX_WAIT_MS = 5000;
const DEFAULT_BACKGROUND_RESUME_PERSISTED = false;
const DEFAULT_BACKGROUND_PROBES_ENABLED = false;
const DEFAULT_CONVERSATION_TITLE_EDIT_DEBOUNCE_MS = 250;
const DEFAULT_TASK_EDITOR_AUTOSAVE_DEBOUNCE_MS = 250;
const CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS = 350;
const HOME_PANE_EDIT_DOUBLE_CLICK_WINDOW_MS = 350;
const UI_STATE_PERSIST_DEBOUNCE_MS = 200;
const REPOSITORY_TOGGLE_CHORD_TIMEOUT_MS = 1250;
const REPOSITORY_COLLAPSE_ALL_CHORD_PREFIX = Buffer.from([0x0b]);
const UNTRACKED_REPOSITORY_GROUP_ID = 'untracked';
const GIT_SUMMARY_LOADING: GitSummary = {
  branch: '(loading)',
  changedFiles: 0,
  additions: 0,
  deletions: 0,
};

const GIT_REPOSITORY_NONE: GitRepositorySnapshot = {
  normalizedRemoteUrl: null,
  commitCount: null,
  lastCommitAt: null,
  shortCommitHash: null,
  inferredName: null,
  defaultBranch: null,
};

interface TaskEditorPromptState {
  mode: 'create' | 'edit';
  taskId: string | null;
  title: string;
  description: string;
  repositoryIds: readonly string[];
  repositoryIndex: number;
  fieldIndex: 0 | 1 | 2;
  error: string | null;
}

interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}
const MUX_MODAL_THEME = {
  frameStyle: {
    fg: { kind: 'indexed', index: 252 },
    bg: { kind: 'indexed', index: 236 },
    bold: true,
  },
  titleStyle: {
    fg: { kind: 'indexed', index: 231 },
    bg: { kind: 'indexed', index: 236 },
    bold: true,
  },
  bodyStyle: {
    fg: { kind: 'indexed', index: 253 },
    bg: { kind: 'indexed', index: 236 },
    bold: false,
  },
  footerStyle: {
    fg: { kind: 'indexed', index: 247 },
    bg: { kind: 'indexed', index: 236 },
    bold: false,
  },
} as const;

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('codex:live:mux requires a TTY stdin/stdout\n');
    return 2;
  }

  const invocationDirectory =
    process.env.HARNESS_INVOKE_CWD ?? process.env.INIT_CWD ?? process.cwd();
  loadHarnessSecrets({ cwd: invocationDirectory });
  const options = parseMuxArgs(process.argv.slice(2));
  const loadedConfig = loadHarnessConfig({
    cwd: options.invocationDirectory,
  });
  const debugConfig = loadedConfig.config.debug;
  const perfEnabled = parseBooleanEnv(
    process.env.HARNESS_PERF_ENABLED,
    debugConfig.enabled && debugConfig.perf.enabled,
  );
  const perfFilePath = resolve(
    options.invocationDirectory,
    process.env.HARNESS_PERF_FILE_PATH ?? debugConfig.perf.filePath,
  );
  const perfTruncateOnStart = parseBooleanEnv(
    process.env.HARNESS_PERF_TRUNCATE_ON_START,
    debugConfig.overwriteArtifactsOnStart,
  );
  if (perfEnabled) {
    prepareArtifactPath(perfFilePath, perfTruncateOnStart);
  }
  configurePerfCore({
    enabled: perfEnabled,
    filePath: perfFilePath,
  });
  const startupSpan = startPerfSpan('mux.startup.total', {
    invocationDirectory: options.invocationDirectory,
    codexArgs: options.codexArgs.length,
  });
  recordPerfEvent('mux.startup.begin', {
    stdinTty: process.stdin.isTTY ? 1 : 0,
    stdoutTty: process.stdout.isTTY ? 1 : 0,
    perfFilePath,
  });
  if (loadedConfig.error !== null) {
    process.stderr.write(
      `[config] using last-known-good due to parse error: ${loadedConfig.error}\n`,
    );
  }
  const shortcutBindings = resolveMuxShortcutBindings(loadedConfig.config.mux.keybindings);
  const taskScreenKeybindings = resolveTaskScreenKeybindings(loadedConfig.config.mux.keybindings);
  const modalDismissShortcutBindings = resolveMuxShortcutBindings({
    'mux.app.quit': ['escape'],
    'mux.app.interrupt-all': [],
    'mux.conversation.new': [],
    'mux.conversation.next': [],
    'mux.conversation.previous': [],
    'mux.conversation.archive': [],
    'mux.conversation.takeover': [],
    'mux.conversation.delete': [],
    'mux.directory.add': [],
    'mux.directory.close': [],
  });
  const store = new SqliteEventStore(options.storePath);

  let size = await readStartupTerminalSize();
  recordPerfEvent('mux.startup.terminal-size', {
    cols: size.cols,
    rows: size.rows,
  });
  const configuredMuxUi = loadedConfig.config.mux.ui;
  const configuredMuxGit = loadedConfig.config.mux.git;
  const configuredCodexLaunch = loadedConfig.config.codex.launch;
  const codexLaunchModeByDirectoryPath: Record<string, 'yolo' | 'standard'> = {};
  for (const [directoryPath, mode] of Object.entries(configuredCodexLaunch.directoryModes)) {
    const normalizedDirectoryPath = resolveWorkspacePathForMux(
      options.invocationDirectory,
      directoryPath,
    );
    codexLaunchModeByDirectoryPath[normalizedDirectoryPath] = mode;
  }
  const configuredClaudeLaunch = loadedConfig.config.claude.launch;
  const claudeLaunchModeByDirectoryPath: Record<string, 'yolo' | 'standard'> = {};
  for (const [directoryPath, mode] of Object.entries(configuredClaudeLaunch.directoryModes)) {
    const normalizedDirectoryPath = resolveWorkspacePathForMux(
      options.invocationDirectory,
      directoryPath,
    );
    claudeLaunchModeByDirectoryPath[normalizedDirectoryPath] = mode;
  }
  let leftPaneColsOverride: number | null =
    configuredMuxUi.paneWidthPercent === null
      ? null
      : leftColsFromPaneWidthPercent(size.cols, configuredMuxUi.paneWidthPercent);
  let layout = computeDualPaneLayout(size.cols, size.rows, {
    leftCols: leftPaneColsOverride,
  });
  const resizeMinIntervalMs = debugConfig.enabled
    ? debugConfig.mux.resizeMinIntervalMs
    : DEFAULT_RESIZE_MIN_INTERVAL_MS;
  const ptyResizeSettleMs = debugConfig.enabled
    ? debugConfig.mux.ptyResizeSettleMs
    : DEFAULT_PTY_RESIZE_SETTLE_MS;
  const startupSettleQuietMs = debugConfig.enabled
    ? debugConfig.mux.startupSettleQuietMs
    : DEFAULT_STARTUP_SETTLE_QUIET_MS;
  const controlPlaneConnectRetryWindowMs = parsePositiveInt(
    process.env.HARNESS_CONTROL_PLANE_CONNECT_RETRY_WINDOW_MS,
    0,
  );
  const controlPlaneConnectRetryDelayMs = Math.max(
    1,
    parsePositiveInt(process.env.HARNESS_CONTROL_PLANE_CONNECT_RETRY_DELAY_MS, 50),
  );
  const backgroundResumePersisted = parseBooleanEnv(
    process.env.HARNESS_MUX_BACKGROUND_RESUME,
    DEFAULT_BACKGROUND_RESUME_PERSISTED,
  );
  const backgroundProbesEnabled = parseBooleanEnv(
    process.env.HARNESS_MUX_BACKGROUND_PROBES,
    DEFAULT_BACKGROUND_PROBES_ENABLED,
  );
  const validateAnsi = debugConfig.enabled ? debugConfig.mux.validateAnsi : false;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  const inputModeManager = createMuxInputModeManager((sequence) => {
    process.stdout.write(sequence);
  });

  const paletteProbeSpan = startPerfSpan('mux.startup.palette-probe');
  const probedPalette = await probeTerminalPalette();
  paletteProbeSpan.end({
    hasForeground: probedPalette.foregroundHex !== undefined,
    hasBackground: probedPalette.backgroundHex !== undefined,
  });
  let muxRecordingWriter: ReturnType<typeof createTerminalRecordingWriter> | null = null;
  let muxRecordingOracle: TerminalSnapshotOracle | null = null;
  if (options.recordingPath !== null) {
    const recordIntervalMs = Math.max(1, Math.floor(1000 / options.recordingFps));
    const recordingWriterOptions: Parameters<typeof createTerminalRecordingWriter>[0] = {
      filePath: options.recordingPath,
      source: 'codex-live-mux',
      defaultForegroundHex: process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex ?? 'd0d7de',
      defaultBackgroundHex: process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex ?? '0f1419',
      minFrameIntervalMs: recordIntervalMs,
    };
    if (probedPalette.indexedHexByCode !== undefined) {
      recordingWriterOptions.ansiPaletteIndexedHex = probedPalette.indexedHexByCode;
    }
    muxRecordingWriter = createTerminalRecordingWriter(recordingWriterOptions);
    muxRecordingOracle = new TerminalSnapshotOracle(size.cols, size.rows);
  }
  const controlPlaneMode =
    options.controlPlaneHost !== null && options.controlPlanePort !== null
      ? {
          mode: 'remote' as const,
          host: options.controlPlaneHost,
          port: options.controlPlanePort,
          ...(options.controlPlaneAuthToken !== null
            ? {
                authToken: options.controlPlaneAuthToken,
              }
            : {}),
          connectRetryWindowMs: controlPlaneConnectRetryWindowMs,
          connectRetryDelayMs: controlPlaneConnectRetryDelayMs,
        }
      : {
          mode: 'embedded' as const,
        };
  const closeLiveSessionsOnClientStop = controlPlaneMode.mode === 'embedded';
  const controlPlaneOpenSpan = startPerfSpan('mux.startup.control-plane-open');
  const controlPlaneClient = await openCodexControlPlaneClient(controlPlaneMode, {
    startEmbeddedServer: async () =>
      await startControlPlaneStreamServer({
        stateStorePath: resolve(
          options.invocationDirectory,
          process.env.HARNESS_CONTROL_PLANE_DB_PATH ?? '.harness/control-plane.sqlite',
        ),
        codexTelemetry: loadedConfig.config.codex.telemetry,
        codexHistory: loadedConfig.config.codex.history,
        gitStatus: {
          enabled: loadedConfig.config.mux.git.enabled,
          pollMs: loadedConfig.config.mux.git.idlePollMs,
          maxConcurrency: loadedConfig.config.mux.git.maxConcurrency,
          minDirectoryRefreshMs: Math.max(loadedConfig.config.mux.git.idlePollMs, 30_000),
        },
        lifecycleHooks: loadedConfig.config.hooks.lifecycle,
        startSession: (input) => {
          const sessionOptions: Parameters<typeof startCodexLiveSession>[0] = {
            args: input.args,
            initialCols: input.initialCols,
            initialRows: input.initialRows,
            enableSnapshotModel: debugConfig.mux.serverSnapshotModelEnabled,
          };
          if (input.useNotifyHook !== undefined) {
            sessionOptions.useNotifyHook = input.useNotifyHook;
          }
          if (input.command !== undefined) {
            sessionOptions.command = input.command;
          }
          if (input.baseArgs !== undefined) {
            sessionOptions.baseArgs = input.baseArgs;
          }
          if (input.env !== undefined) {
            sessionOptions.env = input.env;
          }
          if (input.cwd !== undefined) {
            sessionOptions.cwd = input.cwd;
          }
          if (input.terminalForegroundHex !== undefined) {
            sessionOptions.terminalForegroundHex = input.terminalForegroundHex;
          }
          if (input.terminalBackgroundHex !== undefined) {
            sessionOptions.terminalBackgroundHex = input.terminalBackgroundHex;
          }
          return startCodexLiveSession(sessionOptions);
        },
      }),
  });
  controlPlaneOpenSpan.end();
  const streamClient = controlPlaneClient.client;
  const startupObservedCursor = await readObservedStreamCursorBaseline(streamClient, options.scope);
  const directoryUpsertSpan = startPerfSpan('mux.startup.directory-upsert');
  const directoryResult = await streamClient.sendCommand({
    type: 'directory.upsert',
    directoryId: `directory-${options.scope.workspaceId}`,
    tenantId: options.scope.tenantId,
    userId: options.scope.userId,
    workspaceId: options.scope.workspaceId,
    path: options.invocationDirectory,
  });
  const persistedDirectory = parseDirectoryRecord(directoryResult['directory']);
  if (persistedDirectory === null) {
    throw new Error('control-plane directory.upsert returned malformed directory record');
  }
  directoryUpsertSpan.end();
  let activeDirectoryId: string | null = persistedDirectory.directoryId;
  let mainPaneMode: 'conversation' | 'project' | 'home' = 'conversation';
  let leftNavSelection: LeftNavSelection = {
    kind: 'project',
    directoryId: persistedDirectory.directoryId,
  };
  let activeRepositorySelectionId: string | null = null;
  const collapsedRepositoryGroupIds = new Set<string>();
  const expandedRepositoryGroupIds = new Set<string>();
  let repositoryToggleChordPrefixAtMs: number | null = null;
  let projectPaneSnapshot: ProjectPaneSnapshot | null = null;
  let projectPaneScrollTop = 0;
  let taskPaneScrollTop = 0;
  let latestTaskPaneView: TaskFocusedPaneView = {
    rows: [],
    taskIds: [],
    repositoryIds: [],
    actions: [],
    actionCells: [],
    top: 0,
    selectedRepositoryId: null,
  };
  let taskPaneSelectedTaskId: string | null = null;
  let taskPaneSelectedRepositoryId: string | null = null;
  let taskRepositoryDropdownOpen = false;
  let taskEditorTarget: { kind: 'draft' } | { kind: 'task'; taskId: string } = {
    kind: 'draft',
  };
  let taskDraftComposer = createTaskComposerBuffer('');
  const taskComposerByTaskId = new Map<string, TaskComposerBuffer>();
  const taskAutosaveTimerByTaskId = new Map<string, NodeJS.Timeout>();
  let taskPaneSelectionFocus: 'task' | 'repository' = 'task';
  let taskPaneNotice: string | null = null;
  let taskPaneTaskEditClickState: { entityId: string; atMs: number } | null = null;
  let taskPaneRepositoryEditClickState: { entityId: string; atMs: number } | null = null;
  let homePaneDragState: HomePaneDragState | null = null;

  const sessionEnv = {
    ...sanitizeProcessEnv(),
    TERM: process.env.TERM ?? 'xterm-256color',
  };
  const directories = new Map<string, ControlPlaneDirectoryRecord>([
    [persistedDirectory.directoryId, persistedDirectory],
  ]);
  const repositories = new Map<string, ControlPlaneRepositoryRecord>();
  const repositoryAssociationByDirectoryId = new Map<string, string>();
  const directoryRepositorySnapshotByDirectoryId = new Map<string, GitRepositorySnapshot>();
  const muxControllerId = `human-mux-${process.pid}-${randomUUID()}`;
  const muxControllerLabel = `human mux ${process.pid}`;
  const conversations = new Map<string, ConversationState>();
  const tasks = new Map<string, ControlPlaneTaskRecord>();
  let observedStreamSubscriptionId: string | null = null;
  let keyEventSubscription: Awaited<ReturnType<typeof subscribeControlPlaneKeyEvents>> | null =
    null;
  const conversationStartInFlight = new Map<string, Promise<ConversationState>>();
  const removedConversationIds = new Set<string>();
  let activeConversationId: string | null = null;
  let startupFirstPaintTargetSessionId: string | null = null;
  let startupActiveStartCommandSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveFirstOutputSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveFirstPaintSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveSettledSpan: ReturnType<typeof startPerfSpan> | null = null;
  const startupSequencer = new StartupSequencer({
    quietMs: startupSettleQuietMs,
    nonemptyFallbackMs: DEFAULT_STARTUP_SETTLE_NONEMPTY_FALLBACK_MS,
  });
  const startupSessionFirstOutputObserved = new Set<string>();

  const endStartupActiveStartCommandSpan = (
    attrs: Record<string, boolean | number | string>,
  ): void => {
    if (startupActiveStartCommandSpan === null) {
      return;
    }
    startupActiveStartCommandSpan.end(attrs);
    startupActiveStartCommandSpan = null;
  };

  const endStartupActiveFirstOutputSpan = (
    attrs: Record<string, boolean | number | string>,
  ): void => {
    if (startupActiveFirstOutputSpan === null) {
      return;
    }
    startupActiveFirstOutputSpan.end(attrs);
    startupActiveFirstOutputSpan = null;
  };

  const endStartupActiveFirstPaintSpan = (
    attrs: Record<string, boolean | number | string>,
  ): void => {
    if (startupActiveFirstPaintSpan === null) {
      return;
    }
    startupActiveFirstPaintSpan.end(attrs);
    startupActiveFirstPaintSpan = null;
  };

  const endStartupActiveSettledSpan = (attrs: Record<string, boolean | number | string>): void => {
    if (startupActiveSettledSpan === null) {
      return;
    }
    startupActiveSettledSpan.end(attrs);
    startupActiveSettledSpan = null;
  };

  const clearStartupSettledTimer = (): void => {
    startupSequencer.clearSettledTimer();
  };

  const signalStartupActiveSettled = (): void => {
    startupSequencer.signalSettled();
  };

  const visibleGlyphCellCount = (conversation: ConversationState): number => {
    const frame = conversation.oracle.snapshotWithoutHash();
    let count = 0;
    for (const line of frame.richLines) {
      for (const cell of line.cells) {
        if (!cell.continued && cell.glyph.trim().length > 0) {
          count += 1;
        }
      }
    }
    return count;
  };

  const visibleText = (conversation: ConversationState): string => {
    const frame = conversation.oracle.snapshotWithoutHash();
    const rows: string[] = [];
    for (const line of frame.richLines) {
      let row = '';
      for (const cell of line.cells) {
        if (cell.continued) {
          continue;
        }
        row += cell.glyph;
      }
      rows.push(row.trimEnd());
    }
    return rows.join('\n');
  };

  const codexHeaderVisible = (conversation: ConversationState): boolean => {
    const text = visibleText(conversation);
    return text.includes('OpenAI Codex') && text.includes('model:') && text.includes('directory:');
  };

  const scheduleStartupSettledProbe = (sessionId: string): void => {
    startupSequencer.scheduleSettledProbe(sessionId, (event) => {
      if (startupFirstPaintTargetSessionId !== event.sessionId) {
        return;
      }
      const conversation = conversations.get(event.sessionId);
      const glyphCells = conversation === undefined ? 0 : visibleGlyphCellCount(conversation);
      recordPerfEvent('mux.startup.active-settled', {
        sessionId: event.sessionId,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells,
      });
      endStartupActiveSettledSpan({
        observed: true,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells,
      });
      signalStartupActiveSettled();
    });
  };

  const firstDirectoryId = (): string | null => {
    const iterator = directories.keys().next();
    if (iterator.done === true) {
      return null;
    }
    return iterator.value;
  };

  const resolveActiveDirectoryId = (): string | null => {
    if (activeDirectoryId !== null && directories.has(activeDirectoryId)) {
      return activeDirectoryId;
    }
    const fallback = firstDirectoryId();
    activeDirectoryId = fallback;
    return fallback;
  };

  const resolveDirectoryForAction = (): string | null => {
    if (mainPaneMode === 'project') {
      if (activeDirectoryId !== null && directories.has(activeDirectoryId)) {
        return activeDirectoryId;
      }
      return null;
    }
    if (activeConversationId !== null) {
      const conversation = conversations.get(activeConversationId);
      if (conversation?.directoryId !== null && conversation?.directoryId !== undefined) {
        if (directories.has(conversation.directoryId)) {
          return conversation.directoryId;
        }
      }
    }
    if (activeDirectoryId !== null && directories.has(activeDirectoryId)) {
      return activeDirectoryId;
    }
    return null;
  };

  const repositoryGroupIdForDirectory = (directoryId: string): string =>
    repositoryAssociationByDirectoryId.get(directoryId) ?? UNTRACKED_REPOSITORY_GROUP_ID;

  const isRepositoryGroupCollapsed = (repositoryGroupId: string): boolean => {
    if (repositoriesCollapsed) {
      return !expandedRepositoryGroupIds.has(repositoryGroupId);
    }
    return collapsedRepositoryGroupIds.has(repositoryGroupId);
  };

  const collapseRepositoryGroup = (repositoryGroupId: string): void => {
    if (repositoriesCollapsed) {
      expandedRepositoryGroupIds.delete(repositoryGroupId);
      return;
    }
    collapsedRepositoryGroupIds.add(repositoryGroupId);
  };

  const expandRepositoryGroup = (repositoryGroupId: string): void => {
    if (repositoriesCollapsed) {
      expandedRepositoryGroupIds.add(repositoryGroupId);
      return;
    }
    collapsedRepositoryGroupIds.delete(repositoryGroupId);
  };

  const toggleRepositoryGroup = (repositoryGroupId: string): void => {
    if (isRepositoryGroupCollapsed(repositoryGroupId)) {
      expandRepositoryGroup(repositoryGroupId);
      return;
    }
    collapseRepositoryGroup(repositoryGroupId);
  };

  const collapseAllRepositoryGroups = (): void => {
    repositoriesCollapsed = true;
    collapsedRepositoryGroupIds.clear();
    expandedRepositoryGroupIds.clear();
    queuePersistMuxUiState();
  };

  const expandAllRepositoryGroups = (): void => {
    repositoriesCollapsed = false;
    collapsedRepositoryGroupIds.clear();
    expandedRepositoryGroupIds.clear();
    queuePersistMuxUiState();
  };

  const firstDirectoryForRepositoryGroup = (repositoryGroupId: string): string | null => {
    for (const directory of directories.values()) {
      const candidateRepositoryGroupId = repositoryGroupIdForDirectory(directory.directoryId);
      if (candidateRepositoryGroupId === repositoryGroupId) {
        return directory.directoryId;
      }
    }
    return null;
  };

  const selectLeftNavHome = (): void => {
    leftNavSelection = {
      kind: 'home',
    };
  };

  const selectLeftNavRepository = (repositoryGroupId: string): void => {
    activeRepositorySelectionId = repositoryGroupId;
    leftNavSelection = {
      kind: 'repository',
      repositoryId: repositoryGroupId,
    };
  };

  const selectLeftNavProject = (directoryId: string): void => {
    activeRepositorySelectionId = repositoryGroupIdForDirectory(directoryId);
    leftNavSelection = {
      kind: 'project',
      directoryId,
    };
  };

  const selectLeftNavConversation = (sessionId: string): void => {
    leftNavSelection = {
      kind: 'conversation',
      sessionId,
    };
  };

  const ensureConversation = (
    sessionId: string,
    seed?: {
      directoryId?: string | null;
      title?: string;
      agentType?: string;
      adapterState?: Record<string, unknown>;
    },
  ): ConversationState => {
    const existing = conversations.get(sessionId);
    if (existing !== undefined) {
      if (seed?.directoryId !== undefined) {
        existing.directoryId = seed.directoryId;
      }
      if (seed?.title !== undefined) {
        existing.title = seed.title;
      }
      if (seed?.agentType !== undefined) {
        existing.agentType = seed.agentType;
      }
      if (seed?.adapterState !== undefined) {
        existing.adapterState = normalizeAdapterState(seed.adapterState);
      }
      return existing;
    }
    removedConversationIds.delete(sessionId);
    const directoryId = seed?.directoryId ?? resolveActiveDirectoryId();
    const state = createConversationState(
      sessionId,
      directoryId,
      seed?.title ?? '',
      seed?.agentType ?? 'codex',
      normalizeAdapterState(seed?.adapterState),
      `turn-${randomUUID()}`,
      options.scope,
      layout.rightCols,
      layout.paneRows,
    );
    conversations.set(sessionId, state);
    return state;
  };

  const activeConversation = (): ConversationState => {
    if (activeConversationId === null) {
      throw new Error('active thread is not set');
    }
    const state = conversations.get(activeConversationId);
    if (state === undefined) {
      throw new Error(`active thread missing: ${activeConversationId}`);
    }
    return state;
  };

  const isConversationControlledByLocalHuman = (conversation: ConversationState): boolean => {
    return (
      conversation.controller !== null &&
      conversation.controller.controllerType === 'human' &&
      conversation.controller.controllerId === muxControllerId
    );
  };

  const applyControlPlaneKeyEvent = (event: ControlPlaneKeyEvent): void => {
    const existing = conversations.get(event.sessionId);
    const beforeProjection =
      existing === undefined ? null : projectionSnapshotForConversation(existing);
    const updated = applyMuxControlPlaneKeyEvent(event, {
      removedConversationIds,
      ensureConversation,
    });
    if (updated === null) {
      return;
    }
    refreshSelectorInstrumentation(`event:${event.type}`);
    recordProjectionTransition(event, beforeProjection, updated);
  };

  const hydrateDirectoryList = async (): Promise<void> => {
    const listed = await streamClient.sendCommand({
      type: 'directory.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
    });
    const rows = Array.isArray(listed['directories']) ? listed['directories'] : [];
    directories.clear();
    for (const row of rows) {
      const record = parseDirectoryRecord(row);
      if (record === null) {
        continue;
      }
      const normalizedPath = resolveWorkspacePathForMux(options.invocationDirectory, record.path);
      if (normalizedPath !== record.path) {
        const repairedResult = await streamClient.sendCommand({
          type: 'directory.upsert',
          directoryId: record.directoryId,
          tenantId: record.tenantId,
          userId: record.userId,
          workspaceId: record.workspaceId,
          path: normalizedPath,
        });
        const repairedRecord = parseDirectoryRecord(repairedResult['directory']);
        directories.set(record.directoryId, repairedRecord ?? { ...record, path: normalizedPath });
        continue;
      }
      directories.set(record.directoryId, record);
    }
    if (!directories.has(persistedDirectory.directoryId)) {
      directories.set(persistedDirectory.directoryId, persistedDirectory);
    }
    if (resolveActiveDirectoryId() === null) {
      throw new Error('no active directory available after hydrate');
    }
  };

  const syncRepositoryAssociationsWithDirectorySnapshots = (): void => {
    for (const directoryId of repositoryAssociationByDirectoryId.keys()) {
      if (!directories.has(directoryId)) {
        repositoryAssociationByDirectoryId.delete(directoryId);
      }
    }
    for (const directoryId of directoryRepositorySnapshotByDirectoryId.keys()) {
      if (!directories.has(directoryId)) {
        directoryRepositorySnapshotByDirectoryId.delete(directoryId);
      }
    }
  };

  const hydrateRepositoryList = async (): Promise<void> => {
    const listed = await streamClient.sendCommand({
      type: 'repository.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
    });
    const rows = Array.isArray(listed['repositories']) ? listed['repositories'] : [];
    repositories.clear();
    for (const row of rows) {
      const record = parseRepositoryRecord(row);
      if (record === null) {
        continue;
      }
      repositories.set(record.repositoryId, record);
    }
    syncRepositoryAssociationsWithDirectorySnapshots();
  };

  const hydrateDirectoryGitStatus = async (): Promise<void> => {
    if (!configuredMuxGit.enabled) {
      return;
    }
    const listed = await streamClient.sendCommand({
      type: 'directory.git-status',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
    });
    const rows = Array.isArray(listed['gitStatuses']) ? listed['gitStatuses'] : [];
    for (const row of rows) {
      const record = parseDirectoryGitStatusRecord(row);
      if (record === null) {
        continue;
      }
      gitSummaryByDirectoryId.set(record.directoryId, record.summary);
      directoryRepositorySnapshotByDirectoryId.set(record.directoryId, record.repositorySnapshot);
      if (record.repositoryId === null) {
        repositoryAssociationByDirectoryId.delete(record.directoryId);
      } else {
        repositoryAssociationByDirectoryId.set(record.directoryId, record.repositoryId);
      }
      if (record.repository !== null) {
        repositories.set(record.repository.repositoryId, record.repository);
      }
    }
    syncRepositoryAssociationsWithDirectorySnapshots();
  };

  const hydratePersistedConversationsForDirectory = async (
    directoryId: string,
  ): Promise<number> => {
    const listedPersisted = await streamClient.sendCommand({
      type: 'conversation.list',
      directoryId,
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
    });
    const persistedRows = Array.isArray(listedPersisted['conversations'])
      ? listedPersisted['conversations']
      : [];
    for (const row of persistedRows) {
      const record = parseConversationRecord(row);
      if (record === null) {
        continue;
      }
      const conversation = ensureConversation(record.conversationId, {
        directoryId: record.directoryId,
        title: record.title,
        agentType: record.agentType,
        adapterState: record.adapterState,
      });
      conversation.scope.tenantId = record.tenantId;
      conversation.scope.userId = record.userId;
      conversation.scope.workspaceId = record.workspaceId;
      conversation.status =
        !record.runtimeLive &&
        (record.runtimeStatus === 'running' || record.runtimeStatus === 'needs-input')
          ? 'completed'
          : record.runtimeStatus;
      // Persisted runtime flags are advisory; session.list is authoritative for live sessions.
      conversation.live = false;
    }
    return persistedRows.length;
  };

  async function subscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await streamClient.sendCommand({
        type: 'pty.subscribe-events',
        sessionId,
      });
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
        throw error;
      }
    }
  }

  async function unsubscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await streamClient.sendCommand({
        type: 'pty.unsubscribe-events',
        sessionId,
      });
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
        throw error;
      }
    }
  }

  const startConversation = async (sessionId: string): Promise<ConversationState> => {
    const inFlight = conversationStartInFlight.get(sessionId);
    if (inFlight !== undefined) {
      return await inFlight;
    }

    const task = (async (): Promise<ConversationState> => {
      const existing = conversations.get(sessionId);
      const targetConversation = existing ?? ensureConversation(sessionId);
      const agentType = normalizeThreadAgentType(targetConversation.agentType);
      const baseArgsForAgent = agentType === 'codex' ? options.codexArgs : [];
      const configuredDirectoryPath =
        targetConversation.directoryId === null
          ? null
          : (directories.get(targetConversation.directoryId)?.path ?? null);
      const sessionCwd = resolveWorkspacePathForMux(
        options.invocationDirectory,
        configuredDirectoryPath ?? options.invocationDirectory,
      );
      const launchArgs = buildAgentSessionStartArgs(
        agentType,
        baseArgsForAgent,
        targetConversation.adapterState,
        {
          directoryPath: sessionCwd,
          codexLaunchDefaultMode: configuredCodexLaunch.defaultMode,
          codexLaunchModeByDirectoryPath: codexLaunchModeByDirectoryPath,
          claudeLaunchDefaultMode: configuredClaudeLaunch.defaultMode,
          claudeLaunchModeByDirectoryPath: claudeLaunchModeByDirectoryPath,
        },
      );
      targetConversation.launchCommand = formatCommandForDebugBar(
        launchCommandForAgent(agentType),
        launchArgs,
      );

      if (existing?.live === true) {
        if (startupFirstPaintTargetSessionId === sessionId) {
          endStartupActiveStartCommandSpan({
            alreadyLive: true,
          });
        }
        return existing;
      }

      const startSpan = startPerfSpan('mux.conversation.start', {
        sessionId,
      });
      targetConversation.lastOutputCursor = 0;
      const ptyStartCommand: Parameters<typeof streamClient.sendCommand>[0] = {
        type: 'pty.start',
        sessionId,
        args: launchArgs,
        env: sessionEnv,
        cwd: sessionCwd,
        initialCols: layout.rightCols,
        initialRows: layout.paneRows,
        tenantId: options.scope.tenantId,
        userId: options.scope.userId,
        workspaceId: options.scope.workspaceId,
        worktreeId: options.scope.worktreeId,
      };
      const terminalForegroundHex = process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex;
      const terminalBackgroundHex = process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex;
      if (terminalForegroundHex !== undefined) {
        ptyStartCommand.terminalForegroundHex = terminalForegroundHex;
      }
      if (terminalBackgroundHex !== undefined) {
        ptyStartCommand.terminalBackgroundHex = terminalBackgroundHex;
      }
      await streamClient.sendCommand(ptyStartCommand);
      ptySizeByConversationId.set(sessionId, {
        cols: layout.rightCols,
        rows: layout.paneRows,
      });
      streamClient.sendResize(sessionId, layout.rightCols, layout.paneRows);
      if (startupFirstPaintTargetSessionId === sessionId) {
        endStartupActiveStartCommandSpan({
          alreadyLive: false,
          argCount: launchArgs.length,
          resumed: launchArgs[0] === 'resume',
        });
      }
      const state = ensureConversation(sessionId);
      recordPerfEvent('mux.conversation.start.command', {
        sessionId,
        argCount: launchArgs.length,
        resumed: launchArgs[0] === 'resume',
      });
      const statusRecord = await streamClient.sendCommand({
        type: 'session.status',
        sessionId,
      });
      const statusSummary = parseSessionSummaryRecord(statusRecord);
      if (statusSummary !== null) {
        applySummaryToConversation(state, statusSummary);
      }
      await subscribeConversationEvents(sessionId);
      startSpan.end({
        live: state.live,
      });
      return state;
    })();

    conversationStartInFlight.set(sessionId, task);
    try {
      return await task;
    } finally {
      conversationStartInFlight.delete(sessionId);
    }
  };

  const queuePersistedConversationsInBackground = (activeSessionId: string | null): number => {
    const ordered = conversationOrder(conversations);
    let queued = 0;
    for (const sessionId of ordered) {
      if (activeSessionId !== null && sessionId === activeSessionId) {
        continue;
      }
      const conversation = conversations.get(sessionId);
      if (conversation === undefined || conversation.live) {
        continue;
      }
      queueBackgroundControlPlaneOp(async () => {
        const latest = conversations.get(sessionId);
        if (latest === undefined || latest.live) {
          return;
        }
        await startConversation(sessionId);
        markDirty();
      }, `background-start:${sessionId}`);
      queued += 1;
    }
    return queued;
  };

  const hydrateConversationList = async (): Promise<void> => {
    const hydrateSpan = startPerfSpan('mux.startup.hydrate-conversations');
    await hydrateDirectoryList();
    let persistedCount = 0;
    for (const directoryId of directories.keys()) {
      persistedCount += await hydratePersistedConversationsForDirectory(directoryId);
    }

    const listedLive = await streamClient.sendCommand({
      type: 'session.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
      worktreeId: options.scope.worktreeId,
      sort: 'started-asc',
    });
    const summaries = parseSessionSummaryList(listedLive['sessions']);
    for (const summary of summaries) {
      const conversation = ensureConversation(summary.sessionId);
      applySummaryToConversation(conversation, summary);
      if (summary.live) {
        await subscribeConversationEvents(summary.sessionId);
      }
    }
    hydrateSpan.end({
      persisted: persistedCount,
      live: summaries.length,
    });
  };

  async function hydrateStartupState(): Promise<void> {
    await hydrateConversationList();
    await hydrateRepositoryList();
    await hydrateTaskPlanningState();
    await hydrateDirectoryGitStatus();
    await subscribeTaskPlanningEvents(startupObservedCursor);
    if (activeConversationId === null) {
      const ordered = conversationOrder(conversations);
      activeConversationId = ordered[0] ?? null;
    }
    if (activeConversationId !== null) {
      selectLeftNavConversation(activeConversationId);
    }
    if (activeConversationId === null && resolveActiveDirectoryId() !== null) {
      mainPaneMode = 'project';
      selectLeftNavProject(resolveActiveDirectoryId()!);
    }
  }

  const gitSummaryByDirectoryId = new Map<string, GitSummary>();
  const processUsageBySessionId = new Map<string, ProcessUsageSample>();
  const selectorIndexBySessionId = new Map<
    string,
    {
      selectorIndex: number;
      directoryIndex: number;
      directoryId: string;
    }
  >();
  let lastSelectorSnapshotHash: string | null = null;
  let selectorSnapshotVersion = 0;
  let processUsageRefreshInFlight = false;

  const projectionSnapshotForConversation = (
    conversation: ConversationState,
  ): ConversationProjectionSnapshot => {
    const projected = projectWorkspaceRailConversation(
      {
        ...conversationSummary(conversation),
        directoryKey: conversation.directoryId ?? 'directory-missing',
        title: conversation.title,
        agentLabel: conversation.agentType,
        cpuPercent: processUsageBySessionId.get(conversation.sessionId)?.cpuPercent ?? null,
        memoryMb: processUsageBySessionId.get(conversation.sessionId)?.memoryMb ?? null,
        lastKnownWork: conversation.lastKnownWork,
        lastKnownWorkAt: conversation.lastKnownWorkAt,
        controller: conversation.controller,
      },
      {
        nowMs: Date.now(),
      },
    );
    return {
      status: projected.status,
      glyph: projected.glyph,
      detailText: compactDebugText(projected.detailText),
    };
  };

  const projectionSnapshotEqual = (
    left: ConversationProjectionSnapshot | null,
    right: ConversationProjectionSnapshot,
  ): boolean => {
    if (left === null) {
      return false;
    }
    return (
      left.status === right.status &&
      left.glyph === right.glyph &&
      left.detailText === right.detailText
    );
  };

  const refreshSelectorInstrumentation = (reason: string): void => {
    const orderedIds = conversationOrder(conversations);
    const entries = buildSelectorIndexEntries(directories, conversations, orderedIds);
    const hash = entries
      .map(
        (entry) =>
          `${entry.selectorIndex}:${entry.directoryId}:${entry.sessionId}:${entry.directoryIndex}:${entry.title}:${entry.agentType}`,
      )
      .join('|');
    if (hash === lastSelectorSnapshotHash) {
      return;
    }
    lastSelectorSnapshotHash = hash;
    selectorSnapshotVersion += 1;
    selectorIndexBySessionId.clear();
    for (const entry of entries) {
      selectorIndexBySessionId.set(entry.sessionId, {
        selectorIndex: entry.selectorIndex,
        directoryIndex: entry.directoryIndex,
        directoryId: entry.directoryId,
      });
    }
    recordPerfEvent('mux.selector.snapshot', {
      reason: compactDebugText(reason),
      version: selectorSnapshotVersion,
      count: entries.length,
    });
    for (const entry of entries) {
      recordPerfEvent('mux.selector.entry', {
        version: selectorSnapshotVersion,
        index: entry.selectorIndex,
        directoryIndex: entry.directoryIndex,
        sessionId: entry.sessionId,
        directoryId: entry.directoryId,
        title: compactDebugText(entry.title),
        agentType: entry.agentType,
      });
    }
  };

  const recordProjectionTransition = (
    event: ControlPlaneKeyEvent,
    before: ConversationProjectionSnapshot | null,
    conversation: ConversationState,
  ): void => {
    const after = projectionSnapshotForConversation(conversation);
    if (projectionSnapshotEqual(before, after)) {
      return;
    }
    const selectorEntry = selectorIndexBySessionId.get(conversation.sessionId);
    let source = '';
    let eventName = '';
    let summary: string | null = null;
    if (event.type === 'session-telemetry') {
      source = event.keyEvent.source;
      eventName = event.keyEvent.eventName ?? '';
      summary = event.keyEvent.summary;
    } else if (event.type === 'session-status') {
      source = event.telemetry?.source ?? '';
      eventName = event.telemetry?.eventName ?? '';
      summary = event.telemetry?.summary ?? null;
    }
    recordPerfEvent('mux.session-projection.transition', {
      sessionId: conversation.sessionId,
      eventType: event.type,
      cursor: event.cursor,
      selectorIndex: selectorEntry?.selectorIndex ?? 0,
      directoryIndex: selectorEntry?.directoryIndex ?? 0,
      statusFrom: before?.status ?? '',
      statusTo: after.status,
      glyphFrom: before?.glyph ?? '',
      glyphTo: after.glyph,
      detailFrom: before?.detailText ?? '',
      detailTo: after.detailText,
      source,
      eventName,
      summary: compactDebugText(summary),
    });
  };

  refreshSelectorInstrumentation('startup');

  const processUsageEqual = (left: ProcessUsageSample, right: ProcessUsageSample): boolean =>
    left.cpuPercent === right.cpuPercent && left.memoryMb === right.memoryMb;

  const gitSummaryEqual = (left: GitSummary, right: GitSummary): boolean =>
    left.branch === right.branch &&
    left.changedFiles === right.changedFiles &&
    left.additions === right.additions &&
    left.deletions === right.deletions;

  const gitRepositorySnapshotEqual = (
    left: GitRepositorySnapshot,
    right: GitRepositorySnapshot,
  ): boolean =>
    left.normalizedRemoteUrl === right.normalizedRemoteUrl &&
    left.commitCount === right.commitCount &&
    left.lastCommitAt === right.lastCommitAt &&
    left.shortCommitHash === right.shortCommitHash &&
    left.defaultBranch === right.defaultBranch &&
    left.inferredName === right.inferredName;

  const ensureDirectoryGitState = (directoryId: string): void => {
    if (!gitSummaryByDirectoryId.has(directoryId)) {
      gitSummaryByDirectoryId.set(directoryId, GIT_SUMMARY_LOADING);
    }
  };

  const deleteDirectoryGitState = (directoryId: string): void => {
    gitSummaryByDirectoryId.delete(directoryId);
    directoryRepositorySnapshotByDirectoryId.delete(directoryId);
    repositoryAssociationByDirectoryId.delete(directoryId);
  };

  const syncGitStateWithDirectories = (): void => {
    for (const directoryId of directories.keys()) {
      ensureDirectoryGitState(directoryId);
    }
    const staleDirectoryIds = [...gitSummaryByDirectoryId.keys()].filter(
      (directoryId) => !directories.has(directoryId),
    );
    for (const directoryId of staleDirectoryIds) {
      deleteDirectoryGitState(directoryId);
    }
    syncRepositoryAssociationsWithDirectorySnapshots();
  };

  const noteGitActivity = (directoryId: string | null): void => {
    if (directoryId === null || !directories.has(directoryId)) {
      return;
    }
    ensureDirectoryGitState(directoryId);
  };

  const applyObservedGitStatusEvent = (observed: StreamObservedEvent): void => {
    if (!configuredMuxGit.enabled) {
      return;
    }
    if (observed.type !== 'directory-git-updated') {
      return;
    }
    const previousSummary =
      gitSummaryByDirectoryId.get(observed.directoryId) ?? GIT_SUMMARY_LOADING;
    const summaryChanged = !gitSummaryEqual(previousSummary, observed.summary);
    gitSummaryByDirectoryId.set(observed.directoryId, observed.summary);

    const previousRepositorySnapshot =
      directoryRepositorySnapshotByDirectoryId.get(observed.directoryId) ?? GIT_REPOSITORY_NONE;
    const repositorySnapshotChanged = !gitRepositorySnapshotEqual(
      previousRepositorySnapshot,
      observed.repositorySnapshot,
    );
    directoryRepositorySnapshotByDirectoryId.set(observed.directoryId, observed.repositorySnapshot);

    let associationChanged = false;
    if (observed.repositoryId === null) {
      associationChanged = repositoryAssociationByDirectoryId.delete(observed.directoryId);
    } else {
      const previousRepositoryId =
        repositoryAssociationByDirectoryId.get(observed.directoryId) ?? null;
      repositoryAssociationByDirectoryId.set(observed.directoryId, observed.repositoryId);
      associationChanged = previousRepositoryId !== observed.repositoryId;
    }

    let repositoryRecordChanged = false;
    if (observed.repository !== null) {
      const repository = parseRepositoryRecord(observed.repository);
      if (repository !== null) {
        const previous = repositories.get(repository.repositoryId);
        repositories.set(repository.repositoryId, repository);
        repositoryRecordChanged =
          previous === undefined ||
          previous.name !== repository.name ||
          previous.remoteUrl !== repository.remoteUrl ||
          previous.defaultBranch !== repository.defaultBranch ||
          previous.archivedAt !== repository.archivedAt;
      }
    }

    if (repositoryRecordChanged) {
      syncRepositoryAssociationsWithDirectorySnapshots();
      syncTaskPaneRepositorySelection();
    }

    if (
      summaryChanged ||
      repositorySnapshotChanged ||
      associationChanged ||
      repositoryRecordChanged
    ) {
      markDirty();
    }
  };

  const refreshProcessUsage = async (reason: 'startup' | 'interval'): Promise<void> => {
    if (processUsageRefreshInFlight) {
      return;
    }
    processUsageRefreshInFlight = true;
    const usageSpan = startPerfSpan('mux.background.process-usage', {
      reason,
      conversations: conversations.size,
    });
    try {
      const entries = await Promise.all(
        [...conversations.entries()].map(async ([sessionId, conversation]) => ({
          sessionId,
          sample: await readProcessUsageSample(conversation.processId),
        })),
      );

      let changed = false;
      const observedSessionIds = new Set<string>();
      for (const entry of entries) {
        observedSessionIds.add(entry.sessionId);
        const previous = processUsageBySessionId.get(entry.sessionId);
        if (previous === undefined || !processUsageEqual(previous, entry.sample)) {
          processUsageBySessionId.set(entry.sessionId, entry.sample);
          changed = true;
        }
      }
      for (const sessionId of processUsageBySessionId.keys()) {
        if (observedSessionIds.has(sessionId)) {
          continue;
        }
        processUsageBySessionId.delete(sessionId);
        changed = true;
      }

      if (changed) {
        markDirty();
      }
      usageSpan.end({
        reason,
        samples: entries.length,
        changed,
      });
    } finally {
      processUsageRefreshInFlight = false;
    }
  };

  const idFactory = (): string => `event-${randomUUID()}`;
  let exit: PtyExit | null = null;
  let dirty = true;
  let stop = false;
  let inputRemainder = '';
  let previousRows: readonly string[] = [];
  let forceFullClear = true;
  let renderedCursorVisible: boolean | null = null;
  let renderedCursorStyle: RenderCursorStyle | null = null;
  let renderedBracketedPaste: boolean | null = null;
  let previousSelectionRows: readonly number[] = [];
  let latestRailViewRows: ReturnType<typeof buildWorkspaceRailViewRows> = [];
  let repositoriesCollapsed = configuredMuxUi.repositoriesCollapsed;
  let shortcutsCollapsed = configuredMuxUi.shortcutsCollapsed;
  let persistedMuxUiState = {
    paneWidthPercent: paneWidthPercentFromLayout(layout),
    repositoriesCollapsed: configuredMuxUi.repositoriesCollapsed,
    shortcutsCollapsed: configuredMuxUi.shortcutsCollapsed,
  };
  let pendingMuxUiStatePersist: {
    paneWidthPercent: number;
    repositoriesCollapsed: boolean;
    shortcutsCollapsed: boolean;
  } | null = null;
  let muxUiStatePersistTimer: NodeJS.Timeout | null = null;
  let renderScheduled = false;
  let shuttingDown = false;
  let runtimeFatal: { origin: string; error: unknown } | null = null;
  let runtimeFatalExitTimer: NodeJS.Timeout | null = null;
  let selection: PaneSelection | null = null;
  let selectionDrag: PaneSelectionDrag | null = null;
  let selectionPinnedFollowOutput: boolean | null = null;
  let repositoryPrompt: RepositoryPromptState | null = null;
  let newThreadPrompt: NewThreadPromptState | null = null;
  let addDirectoryPrompt: { value: string; error: string | null } | null = null;
  let taskEditorPrompt: TaskEditorPromptState | null = null;
  let conversationTitleEdit: ConversationTitleEditState | null = null;
  let conversationTitleEditClickState: { conversationId: string; atMs: number } | null = null;
  let paneDividerDragActive = false;
  let ansiValidationReported = false;
  let resizeTimer: NodeJS.Timeout | null = null;
  let pendingSize: { cols: number; rows: number } | null = null;
  let lastResizeApplyAtMs = 0;
  let ptyResizeTimer: NodeJS.Timeout | null = null;
  let pendingPtySize: { cols: number; rows: number } | null = null;
  const ptySizeByConversationId = new Map<string, { cols: number; rows: number }>();

  const requestStop = (): void => {
    if (stop) {
      return;
    }
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    if ('taskId' in taskEditorTarget && typeof taskEditorTarget.taskId === 'string') {
      flushTaskComposerPersist(taskEditorTarget.taskId);
    }
    for (const taskId of taskAutosaveTimerByTaskId.keys()) {
      flushTaskComposerPersist(taskId);
    }
    stop = true;
    if (closeLiveSessionsOnClientStop) {
      queueControlPlaneOp(async () => {
        for (const sessionId of conversationOrder(conversations)) {
          const conversation = conversations.get(sessionId);
          if (conversation === undefined || !conversation.live) {
            continue;
          }
          streamClient.sendSignal(sessionId, 'interrupt');
          streamClient.sendSignal(sessionId, 'terminate');
          try {
            await streamClient.sendCommand({
              type: 'pty.close',
              sessionId,
            });
          } catch {
            // Best-effort shutdown only.
          }
        }
      }, 'shutdown-close-live-sessions');
    }
    markDirty();
  };

  const handleRuntimeFatal = (origin: string, error: unknown): void => {
    if (runtimeFatal !== null) {
      return;
    }
    runtimeFatal = {
      origin,
      error,
    };
    shuttingDown = true;
    stop = true;
    dirty = false;
    process.stderr.write(`[mux] fatal runtime error (${origin}): ${formatErrorMessage(error)}\n`);
    restoreTerminalState(true, inputModeManager.restore);
    runtimeFatalExitTimer = setTimeout(() => {
      process.stderr.write('[mux] fatal runtime error forced exit\n');
      process.exit(1);
    }, 1200);
    runtimeFatalExitTimer.unref?.();
  };

  const scheduleRender = (): void => {
    if (shuttingDown || renderScheduled) {
      return;
    }
    renderScheduled = true;
    setImmediate(() => {
      renderScheduled = false;
      try {
        render();
        if (dirty) {
          scheduleRender();
        }
      } catch (error: unknown) {
        handleRuntimeFatal('render', error);
      }
    });
  };

  const markDirty = (): void => {
    if (shuttingDown) {
      return;
    }
    dirty = true;
    scheduleRender();
  };

  keyEventSubscription = await subscribeControlPlaneKeyEvents(streamClient, {
    tenantId: options.scope.tenantId,
    userId: options.scope.userId,
    workspaceId: options.scope.workspaceId,
    ...(startupObservedCursor === null
      ? {}
      : {
          afterCursor: startupObservedCursor,
        }),
    onEvent: (event) => {
      applyControlPlaneKeyEvent(event);
      markDirty();
    },
  });

  const muxUiStatePersistenceEnabled = loadedConfig.error === null;
  const persistMuxUiStateNow = (): void => {
    if (!muxUiStatePersistenceEnabled) {
      return;
    }
    if (muxUiStatePersistTimer !== null) {
      clearTimeout(muxUiStatePersistTimer);
      muxUiStatePersistTimer = null;
    }
    const pending = pendingMuxUiStatePersist;
    if (pending === null) {
      return;
    }
    pendingMuxUiStatePersist = null;
    if (
      pending.paneWidthPercent === persistedMuxUiState.paneWidthPercent &&
      pending.repositoriesCollapsed === persistedMuxUiState.repositoriesCollapsed &&
      pending.shortcutsCollapsed === persistedMuxUiState.shortcutsCollapsed
    ) {
      return;
    }
    try {
      const updated = updateHarnessMuxUiConfig(pending, {
        filePath: loadedConfig.filePath,
      });
      persistedMuxUiState = {
        paneWidthPercent:
          updated.mux.ui.paneWidthPercent === null
            ? paneWidthPercentFromLayout(layout)
            : updated.mux.ui.paneWidthPercent,
        repositoriesCollapsed: updated.mux.ui.repositoriesCollapsed,
        shortcutsCollapsed: updated.mux.ui.shortcutsCollapsed,
      };
    } catch (error: unknown) {
      process.stderr.write(
        `[config] unable to persist mux ui state: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  };
  const queuePersistMuxUiState = (): void => {
    if (!muxUiStatePersistenceEnabled) {
      return;
    }
    pendingMuxUiStatePersist = {
      paneWidthPercent: paneWidthPercentFromLayout(layout),
      repositoriesCollapsed,
      shortcutsCollapsed,
    };
    if (muxUiStatePersistTimer !== null) {
      clearTimeout(muxUiStatePersistTimer);
    }
    muxUiStatePersistTimer = setTimeout(persistMuxUiStateNow, UI_STATE_PERSIST_DEBOUNCE_MS);
    muxUiStatePersistTimer.unref?.();
  };

  let processUsageTimer: NodeJS.Timeout | null = null;
  let backgroundProbesStarted = false;
  const startBackgroundProbes = (timedOut: boolean): void => {
    if (shuttingDown || backgroundProbesStarted || !backgroundProbesEnabled) {
      return;
    }
    backgroundProbesStarted = true;
    recordPerfEvent('mux.startup.background-probes.begin', {
      timedOut,
      settledObserved: startupSequencer.snapshot().settledObserved,
    });
    void refreshProcessUsage('startup');
    processUsageTimer = setInterval(() => {
      void refreshProcessUsage('interval');
    }, 1000);
  };
  if (configuredMuxGit.enabled) {
    syncGitStateWithDirectories();
    if (activeDirectoryId !== null) {
      noteGitActivity(activeDirectoryId);
    }
  } else {
    recordPerfEvent('mux.background.git-summary.skipped', {
      reason: 'disabled',
    });
  }
  recordPerfEvent('mux.startup.background-probes.wait', {
    maxWaitMs: DEFAULT_BACKGROUND_START_MAX_WAIT_MS,
    enabled: backgroundProbesEnabled ? 1 : 0,
  });
  if (!backgroundProbesEnabled) {
    recordPerfEvent('mux.startup.background-probes.skipped', {
      reason: 'disabled',
    });
  }
  void (async () => {
    if (!backgroundProbesEnabled) {
      return;
    }
    let timedOut = false;
    await Promise.race([
      startupSequencer.waitForSettled(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, DEFAULT_BACKGROUND_START_MAX_WAIT_MS);
      }),
    ]);
    startBackgroundProbes(timedOut);
  })();

  const PERSISTED_EVENT_FLUSH_DELAY_MS = 12;
  const PERSISTED_EVENT_FLUSH_MAX_BATCH = 64;
  let pendingPersistedEvents: NormalizedEventEnvelope[] = [];
  let persistedEventFlushTimer: NodeJS.Timeout | null = null;

  const flushPendingPersistedEvents = (reason: 'timer' | 'immediate' | 'shutdown'): void => {
    if (persistedEventFlushTimer !== null) {
      clearTimeout(persistedEventFlushTimer);
      persistedEventFlushTimer = null;
    }
    if (pendingPersistedEvents.length === 0) {
      return;
    }
    const batch = pendingPersistedEvents;
    pendingPersistedEvents = [];
    const flushSpan = startPerfSpan('mux.events.flush', {
      reason,
      count: batch.length,
    });
    try {
      store.appendEvents(batch);
      flushSpan.end({
        reason,
        status: 'ok',
        count: batch.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      flushSpan.end({
        reason,
        status: 'error',
        count: batch.length,
        message,
      });
      process.stderr.write(`[mux] event-store error ${message}\n`);
    }
  };

  const schedulePersistedEventFlush = (): void => {
    if (persistedEventFlushTimer !== null) {
      return;
    }
    persistedEventFlushTimer = setTimeout(() => {
      persistedEventFlushTimer = null;
      flushPendingPersistedEvents('timer');
    }, PERSISTED_EVENT_FLUSH_DELAY_MS);
  };

  const enqueuePersistedEvent = (event: NormalizedEventEnvelope): void => {
    pendingPersistedEvents.push(event);
    if (pendingPersistedEvents.length >= PERSISTED_EVENT_FLUSH_MAX_BATCH) {
      flushPendingPersistedEvents('immediate');
      return;
    }
    schedulePersistedEventFlush();
  };

  const eventLoopDelayMonitor = monitorEventLoopDelay({
    resolution: 20,
  });
  eventLoopDelayMonitor.enable();

  let outputSampleWindowStartedAtMs = Date.now();
  let outputSampleActiveBytes = 0;
  let outputSampleInactiveBytes = 0;
  let outputSampleActiveChunks = 0;
  let outputSampleInactiveChunks = 0;
  let outputHandleSampleCount = 0;
  let outputHandleSampleTotalMs = 0;
  let outputHandleSampleMaxMs = 0;
  let renderSampleCount = 0;
  let renderSampleTotalMs = 0;
  let renderSampleMaxMs = 0;
  let renderSampleChangedRows = 0;
  let perfStatusRow: MuxPerfStatusRow = {
    fps: 0,
    kbPerSecond: 0,
    renderAvgMs: 0,
    renderMaxMs: 0,
    outputHandleAvgMs: 0,
    outputHandleMaxMs: 0,
    eventLoopP95Ms: 0,
  };
  const outputSampleSessionIds = new Set<string>();
  const outputLoadSampleTimer = setInterval(() => {
    const totalChunks = outputSampleActiveChunks + outputSampleInactiveChunks;
    const hasRenderSamples = renderSampleCount > 0;
    const nowMs = Date.now();
    const windowMs = Math.max(1, nowMs - outputSampleWindowStartedAtMs);
    const eventLoopP95Ms = Number(eventLoopDelayMonitor.percentile(95)) / 1e6;
    const eventLoopMaxMs = Number(eventLoopDelayMonitor.max) / 1e6;
    const outputHandleAvgMs =
      outputHandleSampleCount === 0 ? 0 : outputHandleSampleTotalMs / outputHandleSampleCount;
    const renderAvgMs = renderSampleCount === 0 ? 0 : renderSampleTotalMs / renderSampleCount;
    const nextPerfStatusRow: MuxPerfStatusRow = {
      fps: Number(((renderSampleCount * 1000) / windowMs).toFixed(1)),
      kbPerSecond: Number(
        (((outputSampleActiveBytes + outputSampleInactiveBytes) * 1000) / windowMs / 1024).toFixed(
          1,
        ),
      ),
      renderAvgMs: Number(renderAvgMs.toFixed(2)),
      renderMaxMs: Number(renderSampleMaxMs.toFixed(2)),
      outputHandleAvgMs: Number(outputHandleAvgMs.toFixed(2)),
      outputHandleMaxMs: Number(outputHandleSampleMaxMs.toFixed(2)),
      eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(1)),
    };
    if (
      nextPerfStatusRow.fps !== perfStatusRow.fps ||
      nextPerfStatusRow.kbPerSecond !== perfStatusRow.kbPerSecond ||
      nextPerfStatusRow.renderAvgMs !== perfStatusRow.renderAvgMs ||
      nextPerfStatusRow.renderMaxMs !== perfStatusRow.renderMaxMs ||
      nextPerfStatusRow.outputHandleAvgMs !== perfStatusRow.outputHandleAvgMs ||
      nextPerfStatusRow.outputHandleMaxMs !== perfStatusRow.outputHandleMaxMs ||
      nextPerfStatusRow.eventLoopP95Ms !== perfStatusRow.eventLoopP95Ms
    ) {
      perfStatusRow = nextPerfStatusRow;
      markDirty();
    }
    if (totalChunks > 0 || hasRenderSamples) {
      const controlPlaneQueueMetrics = controlPlaneQueue.metrics();
      recordPerfEvent('mux.output-load.sample', {
        windowMs,
        activeChunks: outputSampleActiveChunks,
        inactiveChunks: outputSampleInactiveChunks,
        activeBytes: outputSampleActiveBytes,
        inactiveBytes: outputSampleInactiveBytes,
        outputHandleCount: outputHandleSampleCount,
        outputHandleAvgMs: Number(outputHandleAvgMs.toFixed(3)),
        outputHandleMaxMs: Number(outputHandleSampleMaxMs.toFixed(3)),
        renderCount: renderSampleCount,
        renderAvgMs: Number(renderAvgMs.toFixed(3)),
        renderMaxMs: Number(renderSampleMaxMs.toFixed(3)),
        renderChangedRows: renderSampleChangedRows,
        eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(3)),
        eventLoopMaxMs: Number(eventLoopMaxMs.toFixed(3)),
        activeConversationId: activeConversationId ?? 'none',
        sessionsWithOutput: outputSampleSessionIds.size,
        pendingPersistedEvents: pendingPersistedEvents.length,
        interactiveQueued: controlPlaneQueueMetrics.interactiveQueued,
        backgroundQueued: controlPlaneQueueMetrics.backgroundQueued,
        controlPlaneOpRunning: controlPlaneQueueMetrics.running ? 1 : 0,
      });
    }
    outputSampleWindowStartedAtMs = nowMs;
    outputSampleActiveBytes = 0;
    outputSampleInactiveBytes = 0;
    outputSampleActiveChunks = 0;
    outputSampleInactiveChunks = 0;
    outputHandleSampleCount = 0;
    outputHandleSampleTotalMs = 0;
    outputHandleSampleMaxMs = 0;
    renderSampleCount = 0;
    renderSampleTotalMs = 0;
    renderSampleMaxMs = 0;
    renderSampleChangedRows = 0;
    outputSampleSessionIds.clear();
    eventLoopDelayMonitor.reset();
  }, 1000);

  const applyPtyResizeToSession = (
    sessionId: string,
    ptySize: { cols: number; rows: number },
    force = false,
  ): void => {
    const conversation = conversations.get(sessionId);
    if (conversation === undefined || !conversation.live) {
      return;
    }
    const currentPtySize = ptySizeByConversationId.get(sessionId);
    if (
      !force &&
      currentPtySize !== undefined &&
      currentPtySize.cols === ptySize.cols &&
      currentPtySize.rows === ptySize.rows
    ) {
      return;
    }
    ptySizeByConversationId.set(sessionId, {
      cols: ptySize.cols,
      rows: ptySize.rows,
    });
    conversation.oracle.resize(ptySize.cols, ptySize.rows);
    streamClient.sendResize(sessionId, ptySize.cols, ptySize.rows);
    markDirty();
  };

  const applyPtyResize = (ptySize: { cols: number; rows: number }): void => {
    if (activeConversationId === null) {
      return;
    }
    applyPtyResizeToSession(activeConversationId, ptySize, false);
  };

  const flushPendingPtyResize = (): void => {
    ptyResizeTimer = null;
    const ptySize = pendingPtySize;
    if (ptySize === null) {
      return;
    }
    pendingPtySize = null;
    applyPtyResize(ptySize);
  };

  const schedulePtyResize = (ptySize: { cols: number; rows: number }, immediate = false): void => {
    pendingPtySize = ptySize;
    if (immediate) {
      if (ptyResizeTimer !== null) {
        clearTimeout(ptyResizeTimer);
        ptyResizeTimer = null;
      }
      flushPendingPtyResize();
      return;
    }

    if (ptyResizeTimer !== null) {
      clearTimeout(ptyResizeTimer);
    }
    ptyResizeTimer = setTimeout(flushPendingPtyResize, ptyResizeSettleMs);
  };

  const applyLayout = (
    nextSize: { cols: number; rows: number },
    forceImmediatePtyResize = false,
  ): void => {
    const nextLayout = computeDualPaneLayout(nextSize.cols, nextSize.rows, {
      leftCols: leftPaneColsOverride,
    });
    schedulePtyResize(
      {
        cols: nextLayout.rightCols,
        rows: nextLayout.paneRows,
      },
      forceImmediatePtyResize,
    );
    if (
      nextLayout.cols === layout.cols &&
      nextLayout.rows === layout.rows &&
      nextLayout.leftCols === layout.leftCols &&
      nextLayout.rightCols === layout.rightCols &&
      nextLayout.paneRows === layout.paneRows
    ) {
      return;
    }
    size = nextSize;
    layout = nextLayout;
    for (const conversation of conversations.values()) {
      conversation.oracle.resize(nextLayout.rightCols, nextLayout.paneRows);
      if (conversation.live) {
        applyPtyResizeToSession(
          conversation.sessionId,
          {
            cols: nextLayout.rightCols,
            rows: nextLayout.paneRows,
          },
          true,
        );
      }
    }
    if (muxRecordingOracle !== null) {
      muxRecordingOracle.resize(nextLayout.cols, nextLayout.rows);
    }
    // Force a full clear on actual layout changes to avoid stale diagonal artifacts during drag.
    previousRows = [];
    forceFullClear = true;
    markDirty();
  };

  const flushPendingResize = (): void => {
    resizeTimer = null;
    const nextSize = pendingSize;
    if (nextSize === null) {
      return;
    }

    const nowMs = Date.now();
    const elapsedMs = nowMs - lastResizeApplyAtMs;
    if (elapsedMs < resizeMinIntervalMs) {
      resizeTimer = setTimeout(flushPendingResize, resizeMinIntervalMs - elapsedMs);
      return;
    }

    pendingSize = null;
    applyLayout(nextSize);
    lastResizeApplyAtMs = Date.now();

    if (pendingSize !== null && resizeTimer === null) {
      resizeTimer = setTimeout(flushPendingResize, resizeMinIntervalMs);
    }
  };

  const queueResize = (nextSize: { cols: number; rows: number }): void => {
    pendingSize = nextSize;
    if (resizeTimer !== null) {
      return;
    }

    const nowMs = Date.now();
    const elapsedMs = nowMs - lastResizeApplyAtMs;
    const delayMs = elapsedMs >= resizeMinIntervalMs ? 0 : resizeMinIntervalMs - elapsedMs;
    resizeTimer = setTimeout(flushPendingResize, delayMs);
  };

  const applyPaneDividerAtCol = (col: number): void => {
    const normalizedCol = Math.max(1, Math.min(size.cols, col));
    leftPaneColsOverride = Math.max(1, normalizedCol - 1);
    applyLayout(size);
    queuePersistMuxUiState();
  };

  const controlPlaneOpSpans = new Map<number, ReturnType<typeof startPerfSpan>>();
  const controlPlaneQueue = new ControlPlaneOpQueue({
    onFatal: (error: unknown) => {
      handleRuntimeFatal('control-plane-pump', error);
    },
    onEnqueued: (event, metrics) => {
      recordPerfEvent('mux.control-plane.op.enqueued', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        interactiveQueued: metrics.interactiveQueued,
        backgroundQueued: metrics.backgroundQueued,
      });
    },
    onStart: (event, metrics) => {
      const opSpan = startPerfSpan('mux.control-plane.op', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        waitMs: event.waitMs,
      });
      controlPlaneOpSpans.set(event.id, opSpan);
      recordPerfEvent('mux.control-plane.op.start', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        waitMs: event.waitMs,
        interactiveQueued: metrics.interactiveQueued,
        backgroundQueued: metrics.backgroundQueued,
      });
    },
    onSuccess: (event) => {
      const opSpan = controlPlaneOpSpans.get(event.id);
      if (opSpan !== undefined) {
        opSpan.end({
          id: event.id,
          label: event.label,
          priority: event.priority,
          status: 'ok',
          waitMs: event.waitMs,
        });
        controlPlaneOpSpans.delete(event.id);
      }
    },
    onError: (event, _metrics, error) => {
      const message = error instanceof Error ? error.message : String(error);
      const opSpan = controlPlaneOpSpans.get(event.id);
      if (opSpan !== undefined) {
        opSpan.end({
          id: event.id,
          label: event.label,
          priority: event.priority,
          status: 'error',
          waitMs: event.waitMs,
          message,
        });
        controlPlaneOpSpans.delete(event.id);
      }
      process.stderr.write(`[mux] control-plane error ${message}\n`);
    },
  });

  const waitForControlPlaneDrain = async (): Promise<void> => {
    await controlPlaneQueue.waitForDrain();
  };

  const queueControlPlaneOp = (task: () => Promise<void>, label = 'interactive-op'): void => {
    controlPlaneQueue.enqueueInteractive(task, label);
  };

  const queueBackgroundControlPlaneOp = (
    task: () => Promise<void>,
    label = 'background-op',
  ): void => {
    controlPlaneQueue.enqueueBackground(task, label);
  };

  const clearConversationTitleEditTimer = (edit: ConversationTitleEditState): void => {
    if (edit.debounceTimer !== null) {
      clearTimeout(edit.debounceTimer);
      edit.debounceTimer = null;
    }
  };

  const queueConversationTitlePersist = (
    edit: ConversationTitleEditState,
    reason: 'debounced' | 'flush',
  ): void => {
    const titleToPersist = edit.value;
    if (titleToPersist === edit.lastSavedValue) {
      return;
    }
    edit.persistInFlight = true;
    markDirty();
    queueControlPlaneOp(async () => {
      try {
        const result = await streamClient.sendCommand({
          type: 'conversation.update',
          conversationId: edit.conversationId,
          title: titleToPersist,
        });
        const parsed = parseConversationRecord(result['conversation']);
        const persistedTitle = parsed?.title ?? titleToPersist;
        const latestConversation = conversations.get(edit.conversationId);
        const latestEdit = conversationTitleEdit;
        const shouldApplyToConversation =
          latestEdit === null ||
          latestEdit.conversationId !== edit.conversationId ||
          latestEdit.value === titleToPersist;
        if (latestConversation !== undefined && shouldApplyToConversation) {
          latestConversation.title = persistedTitle;
        }
        if (latestEdit !== null && latestEdit.conversationId === edit.conversationId) {
          latestEdit.lastSavedValue = persistedTitle;
          if (latestEdit.value === titleToPersist) {
            latestEdit.error = null;
          }
        }
      } catch (error: unknown) {
        const latestEdit = conversationTitleEdit;
        if (
          latestEdit !== null &&
          latestEdit.conversationId === edit.conversationId &&
          latestEdit.value === titleToPersist
        ) {
          latestEdit.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      } finally {
        const latestEdit = conversationTitleEdit;
        if (latestEdit !== null && latestEdit.conversationId === edit.conversationId) {
          latestEdit.persistInFlight = false;
        }
        markDirty();
      }
    }, `title-edit-${reason}:${edit.conversationId}`);
  };

  const scheduleConversationTitlePersist = (): void => {
    const edit = conversationTitleEdit;
    if (edit === null) {
      return;
    }
    clearConversationTitleEditTimer(edit);
    edit.debounceTimer = setTimeout(() => {
      const latestEdit = conversationTitleEdit;
      if (latestEdit === null || latestEdit.conversationId !== edit.conversationId) {
        return;
      }
      latestEdit.debounceTimer = null;
      queueConversationTitlePersist(latestEdit, 'debounced');
    }, DEFAULT_CONVERSATION_TITLE_EDIT_DEBOUNCE_MS);
    edit.debounceTimer.unref?.();
  };

  const stopConversationTitleEdit = (persistPending: boolean): void => {
    const edit = conversationTitleEdit;
    if (edit === null) {
      return;
    }
    clearConversationTitleEditTimer(edit);
    if (persistPending) {
      queueConversationTitlePersist(edit, 'flush');
    }
    conversationTitleEdit = null;
    markDirty();
  };

  const beginConversationTitleEdit = (conversationId: string): void => {
    const target = conversations.get(conversationId);
    if (target === undefined) {
      return;
    }
    if (conversationTitleEdit?.conversationId === conversationId) {
      return;
    }
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    conversationTitleEdit = {
      conversationId,
      value: target.title,
      lastSavedValue: target.title,
      error: null,
      persistInFlight: false,
      debounceTimer: null,
    };
    markDirty();
  };

  const buildNewThreadModalOverlay = (
    viewportRows: number,
  ) => {
    return buildNewThreadModalOverlayFrame(layout.cols, viewportRows, newThreadPrompt, MUX_MODAL_THEME);
  };

  const buildAddDirectoryModalOverlay = (
    viewportRows: number,
  ) => {
    return buildAddDirectoryModalOverlayFrame(layout.cols, viewportRows, addDirectoryPrompt, MUX_MODAL_THEME);
  };

  const buildTaskEditorModalOverlay = (
    viewportRows: number,
  ) => {
    return buildTaskEditorModalOverlayFrame(
      layout.cols,
      viewportRows,
      taskEditorPrompt,
      (repositoryId) => repositories.get(repositoryId)?.name ?? null,
      MUX_MODAL_THEME,
    );
  };

  const buildRepositoryModalOverlay = (
    viewportRows: number,
  ) => {
    return buildRepositoryModalOverlayFrame(layout.cols, viewportRows, repositoryPrompt, MUX_MODAL_THEME);
  };

  const buildConversationTitleModalOverlay = (
    viewportRows: number,
  ) => {
    return buildConversationTitleModalOverlayFrame(
      layout.cols,
      viewportRows,
      conversationTitleEdit,
      MUX_MODAL_THEME,
    );
  };

  const buildCurrentModalOverlay = () => {
    const newThreadOverlay = buildNewThreadModalOverlay(layout.rows);
    if (newThreadOverlay !== null) {
      return newThreadOverlay;
    }
    const addDirectoryOverlay = buildAddDirectoryModalOverlay(layout.rows);
    if (addDirectoryOverlay !== null) {
      return addDirectoryOverlay;
    }
    const taskEditorOverlay = buildTaskEditorModalOverlay(layout.rows);
    if (taskEditorOverlay !== null) {
      return taskEditorOverlay;
    }
    const repositoryOverlay = buildRepositoryModalOverlay(layout.rows);
    if (repositoryOverlay !== null) {
      return repositoryOverlay;
    }
    return buildConversationTitleModalOverlay(layout.rows);
  };

  const dismissModalOnOutsideClick = (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ): boolean => {
    const result = dismissModalOnOutsideClickHelper({
      input,
      inputRemainder,
      dismiss,
      buildCurrentModalOverlay,
      isOverlayHit: isUiModalOverlayHit,
      ...(onInsidePointerPress === undefined
        ? {}
        : {
            onInsidePointerPress,
          }),
    });
    inputRemainder = result.inputRemainder;
    return result.handled;
  };

  const attachConversation = async (sessionId: string): Promise<void> => {
    const conversation = conversations.get(sessionId);
    if (conversation === undefined) {
      return;
    }
    if (!conversation.live) {
      return;
    }
    if (!conversation.attached) {
      const sinceCursor = Math.max(0, conversation.lastOutputCursor);
      await streamClient.sendCommand({
        type: 'pty.attach',
        sessionId,
        sinceCursor,
      });
      conversation.attached = true;
      recordPerfEvent('mux.conversation.attach', {
        sessionId,
        sinceCursor,
      });
    }
  };

  const detachConversation = async (sessionId: string): Promise<void> => {
    const conversation = conversations.get(sessionId);
    if (conversation === undefined) {
      return;
    }
    if (!conversation.attached) {
      return;
    }
    await streamClient.sendCommand({
      type: 'pty.detach',
      sessionId,
    });
    conversation.attached = false;
    recordPerfEvent('mux.conversation.detach', {
      sessionId,
      lastOutputCursor: conversation.lastOutputCursor,
    });
  };

  const refreshProjectPaneSnapshot = (directoryId: string): void => {
    const directory = directories.get(directoryId);
    if (directory === undefined) {
      projectPaneSnapshot = null;
      return;
    }
    projectPaneSnapshot = buildProjectPaneSnapshot(directory.directoryId, directory.path);
  };

  const enterProjectPane = (directoryId: string): void => {
    if (!directories.has(directoryId)) {
      return;
    }
    activeDirectoryId = directoryId;
    selectLeftNavProject(directoryId);
    noteGitActivity(directoryId);
    mainPaneMode = 'project';
    homePaneDragState = null;
    taskPaneTaskEditClickState = null;
    taskPaneRepositoryEditClickState = null;
    projectPaneScrollTop = 0;
    refreshProjectPaneSnapshot(directoryId);
    forceFullClear = true;
    previousRows = [];
  };

  function orderedTaskRecords(): readonly ControlPlaneTaskRecord[] {
    return sortTasksByOrder([...tasks.values()]);
  }

  function orderedActiveRepositoryRecords(): readonly ControlPlaneRepositoryRecord[] {
    return sortedRepositoryList(repositories);
  }

  const taskComposerForTask = (taskId: string): TaskComposerBuffer | null => {
    const existing = taskComposerByTaskId.get(taskId);
    if (existing !== undefined) {
      return existing;
    }
    const task = tasks.get(taskId);
    if (task === undefined) {
      return null;
    }
    return createTaskComposerBuffer(
      task.description.length === 0 ? task.title : `${task.title}\n${task.description}`,
    );
  };

  const setTaskComposerForTask = (taskId: string, buffer: TaskComposerBuffer): void => {
    taskComposerByTaskId.set(taskId, normalizeTaskComposerBuffer(buffer));
  };

  const clearTaskAutosaveTimer = (taskId: string): void => {
    const timer = taskAutosaveTimerByTaskId.get(taskId);
    if (timer !== undefined) {
      clearTimeout(timer);
      taskAutosaveTimerByTaskId.delete(taskId);
    }
  };

  const taskBelongsToSelectedRepository = (task: ControlPlaneTaskRecord): boolean =>
    taskPaneSelectedRepositoryId !== null && task.repositoryId === taskPaneSelectedRepositoryId;

  const selectedRepositoryTaskRecords = (): readonly ControlPlaneTaskRecord[] => {
    return orderedTaskRecords().filter(taskBelongsToSelectedRepository);
  };

  const queuePersistTaskComposer = (taskId: string, reason: string): void => {
    const task = tasks.get(taskId);
    const buffer = taskComposerByTaskId.get(taskId);
    if (task === undefined || buffer === undefined) {
      return;
    }
    const fields = taskFieldsFromComposerText(buffer.text);
    if (fields.title.length === 0) {
      taskPaneNotice = 'first line is required';
      markDirty();
      return;
    }
    if (fields.title === task.title && fields.description === task.description) {
      return;
    }
    queueControlPlaneOp(async () => {
      const result = await streamClient.sendCommand({
        type: 'task.update',
        taskId,
        repositoryId: task.repositoryId,
        title: fields.title,
        description: fields.description,
      });
      const parsed = applyTaskFromCommandResult(result);
      if (parsed === null) {
        throw new Error('control-plane task.update returned malformed task record');
      }
      const persistedText =
        parsed.description.length === 0 ? parsed.title : `${parsed.title}\n${parsed.description}`;
      const latestBuffer = taskComposerByTaskId.get(taskId);
      if (latestBuffer !== undefined && latestBuffer.text === persistedText) {
        taskComposerByTaskId.delete(taskId);
      }
    }, `task-editor-save:${reason}:${taskId}`);
  };

  const scheduleTaskComposerPersist = (taskId: string): void => {
    clearTaskAutosaveTimer(taskId);
    const timer = setTimeout(() => {
      taskAutosaveTimerByTaskId.delete(taskId);
      queuePersistTaskComposer(taskId, 'debounced');
    }, DEFAULT_TASK_EDITOR_AUTOSAVE_DEBOUNCE_MS);
    timer.unref?.();
    taskAutosaveTimerByTaskId.set(taskId, timer);
  };

  const flushTaskComposerPersist = (taskId: string): void => {
    clearTaskAutosaveTimer(taskId);
    queuePersistTaskComposer(taskId, 'flush');
  };

  const focusDraftComposer = (): void => {
    if ('taskId' in taskEditorTarget && typeof taskEditorTarget.taskId === 'string') {
      flushTaskComposerPersist(taskEditorTarget.taskId);
    }
    taskEditorTarget = {
      kind: 'draft',
    };
    taskPaneSelectionFocus = 'task';
    markDirty();
  };

  const focusTaskComposer = (taskId: string): void => {
    if (!tasks.has(taskId)) {
      return;
    }
    if (taskEditorTarget.kind === 'task' && taskEditorTarget.taskId !== taskId) {
      flushTaskComposerPersist(taskEditorTarget.taskId);
    }
    taskEditorTarget = {
      kind: 'task',
      taskId,
    };
    taskPaneSelectedTaskId = taskId;
    taskPaneSelectionFocus = 'task';
    taskPaneNotice = null;
    markDirty();
  };

  function syncTaskPaneSelectionFocus(): void {
    const hasTaskSelection = taskPaneSelectedTaskId !== null && tasks.has(taskPaneSelectedTaskId);
    const hasRepositorySelection =
      taskPaneSelectedRepositoryId !== null && repositories.has(taskPaneSelectedRepositoryId);
    if (taskPaneSelectionFocus === 'task' && hasTaskSelection) {
      return;
    }
    if (taskPaneSelectionFocus === 'repository' && hasRepositorySelection) {
      return;
    }
    if (hasTaskSelection) {
      taskPaneSelectionFocus = 'task';
      return;
    }
    if (hasRepositorySelection) {
      taskPaneSelectionFocus = 'repository';
      return;
    }
    taskPaneSelectionFocus = 'task';
  }

  function syncTaskPaneSelection(): void {
    const scopedTaskIds = new Set(selectedRepositoryTaskRecords().map((task) => task.taskId));
    if (taskPaneSelectedTaskId !== null && !scopedTaskIds.has(taskPaneSelectedTaskId)) {
      taskPaneSelectedTaskId = null;
    }
    if (taskPaneSelectedTaskId === null) {
      const scopedTasks = selectedRepositoryTaskRecords();
      taskPaneSelectedTaskId = scopedTasks[0]?.taskId ?? null;
    }
    syncTaskPaneSelectionFocus();
    if (taskEditorTarget.kind === 'task' && !scopedTaskIds.has(taskEditorTarget.taskId)) {
      focusDraftComposer();
    }
  }

  function syncTaskPaneRepositorySelection(): void {
    if (taskPaneSelectedRepositoryId !== null) {
      const selectedRepository = repositories.get(taskPaneSelectedRepositoryId);
      if (selectedRepository === undefined || selectedRepository.archivedAt !== null) {
        taskPaneSelectedRepositoryId = null;
      }
    }
    if (taskPaneSelectedRepositoryId === null) {
      taskPaneSelectedRepositoryId = activeRepositoryIds()[0] ?? null;
    }
    taskRepositoryDropdownOpen = false;
    syncTaskPaneSelectionFocus();
    syncTaskPaneSelection();
  }

  const selectedTaskRecord = (): ControlPlaneTaskRecord | null => {
    if (taskPaneSelectedTaskId === null) {
      return null;
    }
    return tasks.get(taskPaneSelectedTaskId) ?? null;
  };

  const selectTaskById = (taskId: string): void => {
    const taskRecord = tasks.get(taskId);
    if (taskRecord === undefined) {
      return;
    }
    taskPaneSelectedTaskId = taskId;
    taskPaneSelectionFocus = 'task';
    if (taskRecord.repositoryId !== null && repositories.has(taskRecord.repositoryId)) {
      taskPaneSelectedRepositoryId = taskRecord.repositoryId;
    }
    focusTaskComposer(taskId);
  };

  const selectRepositoryById = (repositoryId: string): void => {
    if (!repositories.has(repositoryId)) {
      return;
    }
    if ('taskId' in taskEditorTarget && typeof taskEditorTarget.taskId === 'string') {
      flushTaskComposerPersist(taskEditorTarget.taskId);
    }
    taskPaneSelectedRepositoryId = repositoryId;
    taskRepositoryDropdownOpen = false;
    taskPaneSelectionFocus = 'repository';
    taskEditorTarget = {
      kind: 'draft',
    };
    syncTaskPaneSelection();
    taskPaneNotice = null;
    markDirty();
  };

  const activeRepositoryIds = (): readonly string[] => {
    return orderedActiveRepositoryRecords().map((repository) => repository.repositoryId);
  };

  const enterHomePane = (): void => {
    mainPaneMode = 'home';
    selectLeftNavHome();
    projectPaneSnapshot = null;
    projectPaneScrollTop = 0;
    selection = null;
    selectionDrag = null;
    releaseViewportPinForSelection();
    taskPaneScrollTop = 0;
    taskPaneNotice = null;
    taskRepositoryDropdownOpen = false;
    taskPaneTaskEditClickState = null;
    taskPaneRepositoryEditClickState = null;
    homePaneDragState = null;
    syncTaskPaneSelection();
    syncTaskPaneRepositorySelection();
    forceFullClear = true;
    previousRows = [];
    markDirty();
  };

  async function hydrateTaskPlanningState(): Promise<void> {
    const repositoriesResult = await streamClient.sendCommand({
      type: 'repository.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
    });
    const repositoriesRaw = repositoriesResult['repositories'];
    if (!Array.isArray(repositoriesRaw)) {
      throw new Error('control-plane repository.list returned malformed repositories');
    }
    repositories.clear();
    for (const value of repositoriesRaw) {
      const repository = parseRepositoryRecord(value);
      if (repository === null) {
        throw new Error('control-plane repository.list returned malformed repository record');
      }
      repositories.set(repository.repositoryId, repository);
    }
    syncTaskPaneRepositorySelection();

    const tasksResult = await streamClient.sendCommand({
      type: 'task.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
      limit: 1000,
    });
    const tasksRaw = tasksResult['tasks'];
    if (!Array.isArray(tasksRaw)) {
      throw new Error('control-plane task.list returned malformed tasks');
    }
    tasks.clear();
    for (const value of tasksRaw) {
      const task = parseTaskRecord(value);
      if (task === null) {
        throw new Error('control-plane task.list returned malformed task record');
      }
      tasks.set(task.taskId, task);
    }
    syncTaskPaneSelection();
    syncTaskPaneRepositorySelection();
    markDirty();
  }

  const applyObservedTaskPlanningEvent = (observed: StreamObservedEvent): void => {
    if (observed.type === 'repository-upserted' || observed.type === 'repository-updated') {
      const repository = parseRepositoryRecord(observed.repository);
      if (repository !== null) {
        repositories.set(repository.repositoryId, repository);
        syncTaskPaneRepositorySelection();
        markDirty();
      }
      return;
    }
    if (observed.type === 'repository-archived') {
      const repository = repositories.get(observed.repositoryId);
      if (repository !== undefined) {
        repositories.set(observed.repositoryId, {
          ...repository,
          archivedAt: observed.ts,
        });
        syncTaskPaneRepositorySelection();
        markDirty();
      }
      return;
    }
    if (observed.type === 'task-created' || observed.type === 'task-updated') {
      const task = parseTaskRecord(observed.task);
      if (task !== null) {
        tasks.set(task.taskId, task);
        syncTaskPaneSelection();
        markDirty();
      }
      return;
    }
    if (observed.type === 'task-deleted') {
      if (tasks.delete(observed.taskId)) {
        syncTaskPaneSelection();
        markDirty();
      }
      return;
    }
    if (observed.type === 'task-reordered') {
      let changed = false;
      for (const value of observed.tasks) {
        const task = parseTaskRecord(value);
        if (task === null) {
          continue;
        }
        tasks.set(task.taskId, task);
        changed = true;
      }
      if (changed) {
        syncTaskPaneSelection();
        markDirty();
      }
    }
  };

  const subscribeTaskPlanningEvents = async (afterCursor: number | null): Promise<void> => {
    if (observedStreamSubscriptionId !== null) {
      return;
    }
    observedStreamSubscriptionId = await subscribeObservedStream(
      streamClient,
      options.scope,
      afterCursor,
    );
  };

  const unsubscribeTaskPlanningEvents = async (): Promise<void> => {
    if (observedStreamSubscriptionId === null) {
      return;
    }
    const subscriptionId = observedStreamSubscriptionId;
    observedStreamSubscriptionId = null;
    await unsubscribeObservedStream(streamClient, subscriptionId);
  };

  const activateConversation = async (sessionId: string): Promise<void> => {
    if (activeConversationId === sessionId) {
      if (mainPaneMode !== 'conversation') {
        mainPaneMode = 'conversation';
        selectLeftNavConversation(sessionId);
        forceFullClear = true;
        previousRows = [];
        markDirty();
      }
      return;
    }
    if (conversationTitleEdit !== null && conversationTitleEdit.conversationId !== sessionId) {
      stopConversationTitleEdit(true);
    }
    const previousActiveId = activeConversationId;
    selection = null;
    selectionDrag = null;
    releaseViewportPinForSelection();
    if (previousActiveId !== null) {
      await detachConversation(previousActiveId);
    }
    activeConversationId = sessionId;
    mainPaneMode = 'conversation';
    selectLeftNavConversation(sessionId);
    homePaneDragState = null;
    taskPaneTaskEditClickState = null;
    taskPaneRepositoryEditClickState = null;
    projectPaneSnapshot = null;
    projectPaneScrollTop = 0;
    forceFullClear = true;
    previousRows = [];
    const targetConversation = conversations.get(sessionId);
    if (targetConversation?.directoryId !== undefined) {
      noteGitActivity(targetConversation.directoryId);
    }
    if (
      targetConversation !== undefined &&
      !targetConversation.live &&
      targetConversation.status !== 'exited'
    ) {
      await startConversation(sessionId);
    }
    if (targetConversation?.status !== 'exited') {
      try {
        await attachConversation(sessionId);
      } catch (error: unknown) {
        if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
          throw error;
        }
        if (targetConversation !== undefined) {
          targetConversation.live = false;
          targetConversation.attached = false;
          if (
            targetConversation.status === 'running' ||
            targetConversation.status === 'needs-input'
          ) {
            targetConversation.status = 'completed';
            targetConversation.attentionReason = null;
          }
        }
        await startConversation(sessionId);
        await attachConversation(sessionId);
      }
    }
    schedulePtyResize(
      {
        cols: layout.rightCols,
        rows: layout.paneRows,
      },
      true,
    );
    markDirty();
  };

  const removeConversationState = (sessionId: string): void => {
    if (conversationTitleEdit?.conversationId === sessionId) {
      stopConversationTitleEdit(false);
    }
    removedConversationIds.add(sessionId);
    conversations.delete(sessionId);
    conversationStartInFlight.delete(sessionId);
    ptySizeByConversationId.delete(sessionId);
    processUsageBySessionId.delete(sessionId);
  };

  const reorderIdsByMove = (
    orderedIds: readonly string[],
    movedId: string,
    targetId: string,
  ): readonly string[] | null => {
    const fromIndex = orderedIds.indexOf(movedId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
      return null;
    }
    const reordered = [...orderedIds];
    const [moved] = reordered.splice(fromIndex, 1);
    if (moved === undefined) {
      return null;
    }
    reordered.splice(targetIndex, 0, moved);
    return reordered;
  };

  const taskIdOrderForReorder = (orderedActiveTaskIds: readonly string[]): readonly string[] => {
    const ordered = orderedTaskRecords();
    const completedTaskIds = ordered
      .filter((task) => task.status === 'completed')
      .map((task) => task.taskId);
    return [...orderedActiveTaskIds, ...completedTaskIds];
  };

  const queueTaskReorderByIds = (orderedActiveTaskIds: readonly string[], label: string): void => {
    queueControlPlaneOp(async () => {
      const result = await streamClient.sendCommand({
        type: 'task.reorder',
        tenantId: options.scope.tenantId,
        userId: options.scope.userId,
        workspaceId: options.scope.workspaceId,
        orderedTaskIds: [...taskIdOrderForReorder(orderedActiveTaskIds)],
      });
      applyTaskListFromCommandResult(result);
    }, label);
  };

  const openTaskCreatePrompt = (): void => {
    if (taskPaneSelectedRepositoryId === null || !repositories.has(taskPaneSelectedRepositoryId)) {
      taskPaneNotice = 'select a repository first';
      markDirty();
      return;
    }
    focusDraftComposer();
    taskPaneNotice = null;
    markDirty();
  };

  const openTaskEditPrompt = (taskId: string): void => {
    const task = tasks.get(taskId);
    if (task === undefined) {
      return;
    }
    if (task.repositoryId !== null) {
      taskPaneSelectedRepositoryId = task.repositoryId;
    }
    focusTaskComposer(task.taskId);
    taskPaneNotice = null;
    markDirty();
  };

  const applyTaskFromCommandResult = (
    result: Record<string, unknown>,
  ): ControlPlaneTaskRecord | null => {
    const parsed = parseTaskRecord(result['task']);
    if (parsed === null) {
      return null;
    }
    tasks.set(parsed.taskId, parsed);
    taskPaneSelectedTaskId = parsed.taskId;
    if (parsed.repositoryId !== null && repositories.has(parsed.repositoryId)) {
      taskPaneSelectedRepositoryId = parsed.repositoryId;
    }
    taskPaneSelectionFocus = 'task';
    syncTaskPaneSelection();
    markDirty();
    return parsed;
  };

  const applyTaskListFromCommandResult = (result: Record<string, unknown>): boolean => {
    const raw = result['tasks'];
    if (!Array.isArray(raw)) {
      return false;
    }
    let changed = false;
    for (const value of raw) {
      const parsed = parseTaskRecord(value);
      if (parsed === null) {
        continue;
      }
      tasks.set(parsed.taskId, parsed);
      changed = true;
    }
    if (changed) {
      syncTaskPaneSelection();
      markDirty();
    }
    return changed;
  };

  const repositoryHomePriority = (repository: ControlPlaneRepositoryRecord): number | null => {
    const raw = repository.metadata['homePriority'];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return null;
    }
    if (!Number.isInteger(raw) || raw < 0) {
      return null;
    }
    return raw;
  };

  const queueRepositoryPriorityOrder = (
    orderedRepositoryIds: readonly string[],
    label: string,
  ): void => {
    const updates: Array<{
      repositoryId: string;
      metadata: Record<string, unknown>;
    }> = [];
    for (let index = 0; index < orderedRepositoryIds.length; index += 1) {
      const repositoryId = orderedRepositoryIds[index]!;
      const repository = repositories.get(repositoryId);
      if (repository === undefined) {
        continue;
      }
      if (repositoryHomePriority(repository) === index) {
        continue;
      }
      updates.push({
        repositoryId,
        metadata: {
          ...repository.metadata,
          homePriority: index,
        },
      });
    }
    if (updates.length === 0) {
      return;
    }
    queueControlPlaneOp(async () => {
      for (const update of updates) {
        const result = await streamClient.sendCommand({
          type: 'repository.update',
          repositoryId: update.repositoryId,
          metadata: update.metadata,
        });
        const parsed = parseRepositoryRecord(result['repository']);
        if (parsed === null) {
          throw new Error('control-plane repository.update returned malformed repository record');
        }
        repositories.set(parsed.repositoryId, parsed);
      }
      syncTaskPaneRepositorySelection();
      markDirty();
    }, label);
  };

  const reorderTaskByDrop = (draggedTaskId: string, targetTaskId: string): void => {
    const orderedActiveTasks = orderedTaskRecords().filter((task) => task.status !== 'completed');
    const orderedActiveTaskIds = orderedActiveTasks.map((task) => task.taskId);
    const draggedTask = tasks.get(draggedTaskId);
    const targetTask = tasks.get(targetTaskId);
    if (draggedTask === undefined || targetTask === undefined) {
      return;
    }
    if (draggedTask.status === 'completed' || targetTask.status === 'completed') {
      taskPaneNotice = 'cannot reorder completed tasks';
      markDirty();
      return;
    }
    const reordered = reorderIdsByMove(orderedActiveTaskIds, draggedTaskId, targetTaskId);
    if (reordered === null) {
      return;
    }
    queueTaskReorderByIds(reordered, 'tasks-reorder-drag');
  };

  const reorderRepositoryByDrop = (
    draggedRepositoryId: string,
    targetRepositoryId: string,
  ): void => {
    const orderedRepositoryIds = orderedActiveRepositoryRecords().map(
      (repository) => repository.repositoryId,
    );
    const reordered = reorderIdsByMove(
      orderedRepositoryIds,
      draggedRepositoryId,
      targetRepositoryId,
    );
    if (reordered === null) {
      return;
    }
    queueRepositoryPriorityOrder(reordered, 'repositories-reorder-drag');
  };

  const runTaskPaneAction = (action: TaskPaneAction): void => {
    if (action === 'task.create') {
      openTaskCreatePrompt();
      return;
    }
    if (action === 'repository.create') {
      taskPaneNotice = null;
      openRepositoryPromptForCreate();
      return;
    }
    if (action === 'repository.edit') {
      const selectedRepositoryId = taskPaneSelectedRepositoryId;
      if (selectedRepositoryId === null || !repositories.has(selectedRepositoryId)) {
        taskPaneNotice = 'select a repository first';
        markDirty();
        return;
      }
      taskPaneSelectionFocus = 'repository';
      taskPaneNotice = null;
      openRepositoryPromptForEdit(selectedRepositoryId);
      return;
    }
    if (action === 'repository.archive') {
      const selectedRepositoryId = taskPaneSelectedRepositoryId;
      if (selectedRepositoryId === null || !repositories.has(selectedRepositoryId)) {
        taskPaneNotice = 'select a repository first';
        markDirty();
        return;
      }
      taskPaneSelectionFocus = 'repository';
      queueControlPlaneOp(async () => {
        await archiveRepositoryById(selectedRepositoryId);
        syncTaskPaneRepositorySelection();
      }, 'tasks-archive-repository');
      return;
    }
    const selected = selectedTaskRecord();
    if (selected === null) {
      taskPaneNotice = 'select a task first';
      markDirty();
      return;
    }
    if (action === 'task.edit') {
      taskPaneSelectionFocus = 'task';
      openTaskEditPrompt(selected.taskId);
      return;
    }
    if (action === 'task.delete') {
      taskPaneSelectionFocus = 'task';
      queueControlPlaneOp(async () => {
        clearTaskAutosaveTimer(selected.taskId);
        await streamClient.sendCommand({
          type: 'task.delete',
          taskId: selected.taskId,
        });
        tasks.delete(selected.taskId);
        taskComposerByTaskId.delete(selected.taskId);
        if (taskEditorTarget.kind === 'task' && taskEditorTarget.taskId === selected.taskId) {
          taskEditorTarget = {
            kind: 'draft',
          };
        }
        syncTaskPaneSelection();
        markDirty();
      }, 'tasks-delete');
      return;
    }
    if (action === 'task.ready') {
      taskPaneSelectionFocus = 'task';
      queueControlPlaneOp(async () => {
        const result = await streamClient.sendCommand({
          type: 'task.ready',
          taskId: selected.taskId,
        });
        applyTaskFromCommandResult(result);
      }, 'tasks-ready');
      return;
    }
    if (action === 'task.draft') {
      taskPaneSelectionFocus = 'task';
      queueControlPlaneOp(async () => {
        const result = await streamClient.sendCommand({
          type: 'task.draft',
          taskId: selected.taskId,
        });
        applyTaskFromCommandResult(result);
      }, 'tasks-draft');
      return;
    }
    if (action === 'task.complete') {
      taskPaneSelectionFocus = 'task';
      queueControlPlaneOp(async () => {
        const result = await streamClient.sendCommand({
          type: 'task.complete',
          taskId: selected.taskId,
        });
        applyTaskFromCommandResult(result);
      }, 'tasks-complete');
      return;
    }
    if (action === 'task.reorder-up' || action === 'task.reorder-down') {
      const ordered = orderedTaskRecords();
      const activeTasks = ordered.filter((task) => task.status !== 'completed');
      const selectedIndex = activeTasks.findIndex((task) => task.taskId === selected.taskId);
      if (selectedIndex < 0) {
        taskPaneNotice = 'cannot reorder completed tasks';
        markDirty();
        return;
      }
      const swapIndex = action === 'task.reorder-up' ? selectedIndex - 1 : selectedIndex + 1;
      if (swapIndex < 0 || swapIndex >= activeTasks.length) {
        return;
      }
      const reordered = [...activeTasks];
      const currentTask = reordered[selectedIndex]!;
      reordered[selectedIndex] = reordered[swapIndex]!;
      reordered[swapIndex] = currentTask;
      taskPaneSelectionFocus = 'task';
      queueTaskReorderByIds(
        reordered.map((task) => task.taskId),
        action === 'task.reorder-up' ? 'tasks-reorder-up' : 'tasks-reorder-down',
      );
    }
  };

  const openNewThreadPrompt = (directoryId: string): void => {
    if (!directories.has(directoryId)) {
      return;
    }
    addDirectoryPrompt = null;
    repositoryPrompt = null;
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    conversationTitleEditClickState = null;
    newThreadPrompt = createNewThreadPromptState(directoryId);
    markDirty();
  };

  const openRepositoryPromptForCreate = (): void => {
    newThreadPrompt = null;
    addDirectoryPrompt = null;
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    conversationTitleEditClickState = null;
    repositoryPrompt = {
      mode: 'add',
      repositoryId: null,
      value: '',
      error: null,
    };
    markDirty();
  };

  const openRepositoryPromptForEdit = (repositoryId: string): void => {
    const repository = repositories.get(repositoryId);
    if (repository === undefined) {
      return;
    }
    newThreadPrompt = null;
    addDirectoryPrompt = null;
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    conversationTitleEditClickState = null;
    repositoryPrompt = {
      mode: 'edit',
      repositoryId,
      value: repository.remoteUrl,
      error: null,
    };
    taskPaneSelectionFocus = 'repository';
    markDirty();
  };

  const upsertRepositoryByRemoteUrl = async (
    remoteUrl: string,
    existingRepositoryId?: string,
  ): Promise<void> => {
    const normalizedRemoteUrl = normalizeGitHubRemoteUrl(remoteUrl);
    if (normalizedRemoteUrl === null) {
      throw new Error('github url required');
    }
    const result =
      existingRepositoryId === undefined
        ? await streamClient.sendCommand({
            type: 'repository.upsert',
            repositoryId: `repository-${randomUUID()}`,
            tenantId: options.scope.tenantId,
            userId: options.scope.userId,
            workspaceId: options.scope.workspaceId,
            name: repositoryNameFromGitHubRemoteUrl(normalizedRemoteUrl),
            remoteUrl: normalizedRemoteUrl,
            defaultBranch: 'main',
            metadata: {
              source: 'mux-manual',
            },
          })
        : await streamClient.sendCommand({
            type: 'repository.update',
            repositoryId: existingRepositoryId,
            name: repositoryNameFromGitHubRemoteUrl(normalizedRemoteUrl),
            remoteUrl: normalizedRemoteUrl,
          });
    const repository = parseRepositoryRecord(result['repository']);
    if (repository === null) {
      throw new Error('control-plane repository command returned malformed repository record');
    }
    repositories.set(repository.repositoryId, repository);
    syncRepositoryAssociationsWithDirectorySnapshots();
    syncTaskPaneRepositorySelection();
    markDirty();
  };

  const archiveRepositoryById = async (repositoryId: string): Promise<void> => {
    await streamClient.sendCommand({
      type: 'repository.archive',
      repositoryId,
    });
    repositories.delete(repositoryId);
    syncRepositoryAssociationsWithDirectorySnapshots();
    syncTaskPaneRepositorySelection();
    markDirty();
  };

  const createAndActivateConversationInDirectory = async (
    directoryId: string,
    agentType: ThreadAgentType,
  ): Promise<void> => {
    const sessionId = `conversation-${randomUUID()}`;
    const title = '';
    await streamClient.sendCommand({
      type: 'conversation.create',
      conversationId: sessionId,
      directoryId,
      title,
      agentType,
      adapterState: {},
    });
    ensureConversation(sessionId, {
      directoryId,
      title,
      agentType,
      adapterState: {},
    });
    noteGitActivity(directoryId);
    await startConversation(sessionId);
    await activateConversation(sessionId);
  };

  const archiveConversation = async (sessionId: string): Promise<void> => {
    const target = conversations.get(sessionId);
    if (target === undefined) {
      return;
    }
    if (target.live) {
      try {
        await streamClient.sendCommand({
          type: 'pty.close',
          sessionId,
        });
      } catch {
        // Best-effort close only.
      }
    }

    try {
      await streamClient.sendCommand({
        type: 'session.remove',
        sessionId,
      });
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error)) {
        throw error;
      }
    }

    try {
      await streamClient.sendCommand({
        type: 'conversation.archive',
        conversationId: sessionId,
      });
    } catch (error: unknown) {
      if (!isConversationNotFoundError(error)) {
        throw error;
      }
    }
    await unsubscribeConversationEvents(sessionId);

    removeConversationState(sessionId);

    if (activeConversationId === sessionId) {
      const archivedDirectoryId = target.directoryId;
      const ordered = conversationOrder(conversations);
      const nextConversationId =
        ordered.find((candidateId) => {
          const candidate = conversations.get(candidateId);
          return candidate?.directoryId === archivedDirectoryId;
        }) ??
        ordered[0] ??
        null;
      activeConversationId = null;
      if (nextConversationId !== null) {
        await activateConversation(nextConversationId);
        return;
      }
      const fallbackDirectoryId = resolveActiveDirectoryId();
      if (fallbackDirectoryId !== null) {
        enterProjectPane(fallbackDirectoryId);
        markDirty();
        return;
      }
      markDirty();
      return;
    }

    markDirty();
  };

  const takeoverConversation = async (sessionId: string): Promise<void> => {
    const target = conversations.get(sessionId);
    if (target === undefined) {
      return;
    }
    const result = await streamClient.sendCommand({
      type: 'session.claim',
      sessionId,
      controllerId: muxControllerId,
      controllerType: 'human',
      controllerLabel: muxControllerLabel,
      reason: 'human takeover',
      takeover: true,
    });
    const controller = parseSessionControllerRecord(result['controller']);
    if (controller !== null) {
      target.controller = controller;
    }
    target.lastEventAt = new Date().toISOString();
    markDirty();
  };

  const addDirectoryByPath = async (rawPath: string): Promise<void> => {
    const normalizedPath = resolveWorkspacePathForMux(options.invocationDirectory, rawPath);
    const directoryResult = await streamClient.sendCommand({
      type: 'directory.upsert',
      directoryId: `directory-${randomUUID()}`,
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
      path: normalizedPath,
    });
    const directory = parseDirectoryRecord(directoryResult['directory']);
    if (directory === null) {
      throw new Error('control-plane directory.upsert returned malformed directory record');
    }
    directories.set(directory.directoryId, directory);
    activeDirectoryId = directory.directoryId;
    syncGitStateWithDirectories();
    noteGitActivity(directory.directoryId);

    await hydratePersistedConversationsForDirectory(directory.directoryId);
    const targetConversationId = conversationOrder(conversations).find((sessionId) => {
      const conversation = conversations.get(sessionId);
      return conversation?.directoryId === directory.directoryId;
    });
    if (targetConversationId !== undefined) {
      await activateConversation(targetConversationId);
      return;
    }
    enterProjectPane(directory.directoryId);
    markDirty();
  };

  const closeDirectory = async (directoryId: string): Promise<void> => {
    if (!directories.has(directoryId)) {
      return;
    }
    const sessionIds = conversationOrder(conversations).filter((sessionId) => {
      const conversation = conversations.get(sessionId);
      return conversation?.directoryId === directoryId;
    });

    for (const sessionId of sessionIds) {
      const target = conversations.get(sessionId);
      if (target?.live === true) {
        try {
          await streamClient.sendCommand({
            type: 'pty.close',
            sessionId,
          });
        } catch {
          // Best-effort close only.
        }
      }
      await streamClient.sendCommand({
        type: 'conversation.archive',
        conversationId: sessionId,
      });
      await unsubscribeConversationEvents(sessionId);
      removeConversationState(sessionId);
      if (activeConversationId === sessionId) {
        activeConversationId = null;
      }
    }

    await streamClient.sendCommand({
      type: 'directory.archive',
      directoryId,
    });
    directories.delete(directoryId);
    deleteDirectoryGitState(directoryId);
    if (projectPaneSnapshot?.directoryId === directoryId) {
      projectPaneSnapshot = null;
      projectPaneScrollTop = 0;
    }

    if (directories.size === 0) {
      await addDirectoryByPath(options.invocationDirectory);
      return;
    }

    if (
      activeDirectoryId === directoryId ||
      activeDirectoryId === null ||
      !directories.has(activeDirectoryId)
    ) {
      activeDirectoryId = firstDirectoryId();
    }
    if (activeDirectoryId !== null) {
      noteGitActivity(activeDirectoryId);
    }

    const fallbackDirectoryId = resolveActiveDirectoryId();
    const fallbackConversationId =
      conversationOrder(conversations).find((sessionId) => {
        const conversation = conversations.get(sessionId);
        return conversation?.directoryId === fallbackDirectoryId;
      }) ??
      conversationOrder(conversations)[0] ??
      null;
    if (fallbackConversationId !== null) {
      await activateConversation(fallbackConversationId);
      return;
    }
    if (fallbackDirectoryId !== null) {
      enterProjectPane(fallbackDirectoryId);
      markDirty();
      return;
    }

    markDirty();
  };

  const pinViewportForSelection = (): void => {
    if (selectionPinnedFollowOutput !== null) {
      return;
    }
    if (activeConversationId === null) {
      return;
    }
    const follow = activeConversation().oracle.snapshotWithoutHash().viewport.followOutput;
    selectionPinnedFollowOutput = follow;
    if (follow) {
      activeConversation().oracle.setFollowOutput(false);
    }
  };

  const releaseViewportPinForSelection = (): void => {
    if (selectionPinnedFollowOutput === null) {
      return;
    }
    const shouldRepin = selectionPinnedFollowOutput;
    selectionPinnedFollowOutput = null;
    if (shouldRepin) {
      if (activeConversationId === null) {
        return;
      }
      activeConversation().oracle.setFollowOutput(true);
    }
  };

  const render = (): void => {
    if (shuttingDown || !dirty) {
      return;
    }
    const projectPaneActive =
      mainPaneMode === 'project' &&
      activeDirectoryId !== null &&
      directories.has(activeDirectoryId);
    const homePaneActive = mainPaneMode === 'home';
    if (!projectPaneActive && !homePaneActive && activeConversationId === null) {
      dirty = false;
      return;
    }
    const renderStartedAtNs = perfNowNs();

    const active =
      activeConversationId === null ? null : (conversations.get(activeConversationId) ?? null);
    if (!projectPaneActive && !homePaneActive && active === null) {
      dirty = false;
      return;
    }
    const rightFrame =
      !projectPaneActive && !homePaneActive && active !== null
        ? active.oracle.snapshotWithoutHash()
        : null;
    const renderSelection =
      rightFrame !== null && selectionDrag !== null && selectionDrag.hasDragged
        ? {
            anchor: selectionDrag.anchor,
            focus: selectionDrag.focus,
            text: '',
          }
        : rightFrame !== null
          ? selection
          : null;
    const selectionRows =
      rightFrame === null ? [] : selectionVisibleRows(rightFrame, renderSelection);
    const orderedIds = conversationOrder(conversations);
    refreshSelectorInstrumentation('render');
    const rail = buildRailRows({
      layout,
      repositories,
      repositoryAssociationByDirectoryId,
      directoryRepositorySnapshotByDirectoryId,
      directories,
      conversations,
      orderedIds,
      activeProjectId: activeDirectoryId,
      activeRepositoryId: activeRepositorySelectionId,
      activeConversationId,
      projectSelectionEnabled: leftNavSelection.kind === 'project',
      repositorySelectionEnabled: leftNavSelection.kind === 'repository',
      homeSelectionEnabled: leftNavSelection.kind === 'home',
      repositoriesCollapsed,
      collapsedRepositoryGroupIds,
      shortcutsCollapsed,
      gitSummaryByDirectoryId,
      processUsageBySessionId,
      shortcutBindings,
      loadingGitSummary: GIT_SUMMARY_LOADING,
    });
    latestRailViewRows = rail.viewRows;
    let rightRows: readonly string[] = [];
    latestTaskPaneView = {
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    };
    if (rightFrame !== null) {
      rightRows = Array.from({ length: layout.paneRows }, (_value, row) =>
        renderSnapshotAnsiRow(rightFrame, row, layout.rightCols),
      );
    } else if (homePaneActive) {
      const view = buildTaskFocusedPaneView({
        repositories,
        tasks,
        selectedRepositoryId: taskPaneSelectedRepositoryId,
        repositoryDropdownOpen: taskRepositoryDropdownOpen,
        editorTarget: taskEditorTarget,
        draftBuffer: taskDraftComposer,
        taskBufferById: taskComposerByTaskId,
        notice: taskPaneNotice,
        cols: layout.rightCols,
        rows: layout.paneRows,
        scrollTop: taskPaneScrollTop,
      });
      taskPaneSelectedRepositoryId = view.selectedRepositoryId;
      taskPaneScrollTop = view.top;
      latestTaskPaneView = view;
      rightRows = view.rows;
    } else if (projectPaneActive && activeDirectoryId !== null) {
      if (projectPaneSnapshot === null || projectPaneSnapshot.directoryId !== activeDirectoryId) {
        refreshProjectPaneSnapshot(activeDirectoryId);
      }
      if (projectPaneSnapshot === null) {
        rightRows = Array.from({ length: layout.paneRows }, () => ' '.repeat(layout.rightCols));
      } else {
        const view = buildProjectPaneRows(
          projectPaneSnapshot,
          layout.rightCols,
          layout.paneRows,
          projectPaneScrollTop,
        );
        projectPaneScrollTop = view.top;
        rightRows = view.rows;
      }
    } else {
      rightRows = Array.from({ length: layout.paneRows }, () => ' '.repeat(layout.rightCols));
    }
    const statusFooter =
      !projectPaneActive && !homePaneActive && active !== null
        ? debugFooterForConversation(active)
        : undefined;
    const rows = buildRenderRows(layout, rail.ansiRows, rightRows, perfStatusRow, statusFooter);
    const modalOverlay = buildCurrentModalOverlay();
    if (modalOverlay !== null) {
      applyModalOverlay(rows, modalOverlay);
    }
    if (validateAnsi) {
      const issues = findAnsiIntegrityIssues(rows);
      if (issues.length > 0 && !ansiValidationReported) {
        ansiValidationReported = true;
        process.stderr.write(`[mux] ansi-integrity-failed ${issues.join(' | ')}\n`);
      }
    }
    const diff = forceFullClear ? diffRenderedRows(rows, []) : diffRenderedRows(rows, previousRows);
    const overlayResetRows = mergeUniqueRows(previousSelectionRows, selectionRows);

    let output = '';
    if (forceFullClear) {
      output += '\u001b[?25l\u001b[H\u001b[2J';
      forceFullClear = false;
      renderedCursorVisible = false;
      renderedCursorStyle = null;
      renderedBracketedPaste = null;
    }
    output += diff.output;

    if (overlayResetRows.length > 0) {
      const changedRows = new Set<number>(diff.changedRows);
      for (const row of overlayResetRows) {
        if (row < 0 || row >= layout.paneRows || changedRows.has(row)) {
          continue;
        }
        const rowContent = rows[row] ?? '';
        output += `\u001b[${String(row + 1)};1H\u001b[2K${rowContent}`;
      }
    }

    let shouldShowCursor = false;
    if (rightFrame !== null) {
      const shouldEnableBracketedPaste = rightFrame.modes.bracketedPaste;
      if (renderedBracketedPaste !== shouldEnableBracketedPaste) {
        output += shouldEnableBracketedPaste ? '\u001b[?2004h' : '\u001b[?2004l';
        renderedBracketedPaste = shouldEnableBracketedPaste;
      }

      if (!cursorStyleEqual(renderedCursorStyle, rightFrame.cursor.style)) {
        output += cursorStyleToDecscusr(rightFrame.cursor.style);
        renderedCursorStyle = rightFrame.cursor.style;
      }

      output += renderSelectionOverlay(layout, rightFrame, renderSelection);

      shouldShowCursor =
        rightFrame.viewport.followOutput &&
        rightFrame.cursor.visible &&
        rightFrame.cursor.row >= 0 &&
        rightFrame.cursor.row < layout.paneRows &&
        rightFrame.cursor.col >= 0 &&
        rightFrame.cursor.col < layout.rightCols;

      if (shouldShowCursor) {
        if (renderedCursorVisible !== true) {
          output += '\u001b[?25h';
          renderedCursorVisible = true;
        }
        output += `\u001b[${String(rightFrame.cursor.row + 1)};${String(layout.rightStartCol + rightFrame.cursor.col)}H`;
      } else {
        if (renderedCursorVisible !== false) {
          output += '\u001b[?25l';
          renderedCursorVisible = false;
        }
      }
    } else {
      if (renderedBracketedPaste !== false) {
        output += '\u001b[?2004l';
        renderedBracketedPaste = false;
      }
      if (renderedCursorVisible !== false) {
        output += '\u001b[?25l';
        renderedCursorVisible = false;
      }
    }

    if (output.length > 0) {
      process.stdout.write(output);
      if (
        active !== null &&
        rightFrame !== null &&
        startupFirstPaintTargetSessionId !== null &&
        activeConversationId === startupFirstPaintTargetSessionId &&
        startupSequencer.snapshot().firstOutputObserved &&
        !startupSequencer.snapshot().firstPaintObserved
      ) {
        const glyphCells = visibleGlyphCellCount(active);
        if (startupSequencer.markFirstPaintVisible(startupFirstPaintTargetSessionId, glyphCells)) {
          recordPerfEvent('mux.startup.active-first-visible-paint', {
            sessionId: startupFirstPaintTargetSessionId,
            changedRows: diff.changedRows.length,
            glyphCells,
          });
          endStartupActiveFirstPaintSpan({
            observed: true,
            changedRows: diff.changedRows.length,
            glyphCells,
          });
        }
      }
      if (
        active !== null &&
        rightFrame !== null &&
        startupFirstPaintTargetSessionId !== null &&
        activeConversationId === startupFirstPaintTargetSessionId &&
        startupSequencer.snapshot().firstOutputObserved
      ) {
        const glyphCells = visibleGlyphCellCount(active);
        if (
          startupSequencer.markHeaderVisible(
            startupFirstPaintTargetSessionId,
            codexHeaderVisible(active),
          )
        ) {
          recordPerfEvent('mux.startup.active-header-visible', {
            sessionId: startupFirstPaintTargetSessionId,
            glyphCells,
          });
        }
        const selectedGate = startupSequencer.maybeSelectSettleGate(
          startupFirstPaintTargetSessionId,
          glyphCells,
        );
        if (selectedGate !== null) {
          recordPerfEvent('mux.startup.active-settle-gate', {
            sessionId: startupFirstPaintTargetSessionId,
            gate: selectedGate,
            glyphCells,
          });
        }
        scheduleStartupSettledProbe(startupFirstPaintTargetSessionId);
      }
      if (muxRecordingWriter !== null && muxRecordingOracle !== null) {
        const recordingCursorStyle: RenderCursorStyle =
          rightFrame === null ? { shape: 'block', blinking: false } : rightFrame.cursor.style;
        const recordingCursorRow = rightFrame === null ? 0 : rightFrame.cursor.row;
        const recordingCursorCol =
          rightFrame === null
            ? layout.rightStartCol - 1
            : layout.rightStartCol + rightFrame.cursor.col - 1;
        const canonicalFrame = renderCanonicalFrameAnsi(
          rows,
          recordingCursorStyle,
          shouldShowCursor,
          recordingCursorRow,
          recordingCursorCol,
        );
        muxRecordingOracle.ingest(canonicalFrame);
        try {
          muxRecordingWriter.capture(muxRecordingOracle.snapshot());
        } catch {
          // Recording failures must never break live interaction.
        }
      }
    }
    previousRows = diff.nextRows;
    previousSelectionRows = selectionRows;
    dirty = false;
    const renderDurationMs = Number(perfNowNs() - renderStartedAtNs) / 1e6;
    renderSampleCount += 1;
    renderSampleTotalMs += renderDurationMs;
    if (renderDurationMs > renderSampleMaxMs) {
      renderSampleMaxMs = renderDurationMs;
    }
    renderSampleChangedRows += diff.changedRows.length;
  };

  const handleEnvelope = (envelope: StreamServerEnvelope): void => {
    if (envelope.kind === 'pty.output') {
      const outputHandledStartedAtNs = perfNowNs();
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = ensureConversation(envelope.sessionId);
      noteGitActivity(conversation.directoryId);
      const chunk = Buffer.from(envelope.chunkBase64, 'base64');
      outputSampleSessionIds.add(envelope.sessionId);
      if (activeConversationId === envelope.sessionId) {
        outputSampleActiveBytes += chunk.length;
        outputSampleActiveChunks += 1;
      } else {
        outputSampleInactiveBytes += chunk.length;
        outputSampleInactiveChunks += 1;
      }
      if (!startupSessionFirstOutputObserved.has(envelope.sessionId)) {
        startupSessionFirstOutputObserved.add(envelope.sessionId);
        recordPerfEvent('mux.session.first-output', {
          sessionId: envelope.sessionId,
          bytes: chunk.length,
        });
      }
      if (
        startupFirstPaintTargetSessionId !== null &&
        envelope.sessionId === startupFirstPaintTargetSessionId &&
        !startupSequencer.snapshot().firstOutputObserved
      ) {
        if (startupSequencer.markFirstOutput(envelope.sessionId)) {
          recordPerfEvent('mux.startup.active-first-output', {
            sessionId: envelope.sessionId,
            bytes: chunk.length,
          });
          endStartupActiveFirstOutputSpan({
            observed: true,
            bytes: chunk.length,
          });
        }
      }
      if (envelope.cursor < conversation.lastOutputCursor) {
        recordPerfEvent('mux.output.cursor-regression', {
          sessionId: envelope.sessionId,
          previousCursor: conversation.lastOutputCursor,
          cursor: envelope.cursor,
        });
        conversation.lastOutputCursor = 0;
      }
      conversation.oracle.ingest(chunk);
      conversation.lastOutputCursor = envelope.cursor;
      if (
        startupFirstPaintTargetSessionId !== null &&
        envelope.sessionId === startupFirstPaintTargetSessionId
      ) {
        scheduleStartupSettledProbe(envelope.sessionId);
      }

      const normalized = mapTerminalOutputToNormalizedEvent(chunk, conversation.scope, idFactory);
      enqueuePersistedEvent(normalized);
      conversation.lastEventAt = normalized.ts;
      if (activeConversationId === envelope.sessionId) {
        markDirty();
      }
      const outputHandledDurationMs = Number(perfNowNs() - outputHandledStartedAtNs) / 1e6;
      outputHandleSampleCount += 1;
      outputHandleSampleTotalMs += outputHandledDurationMs;
      if (outputHandledDurationMs > outputHandleSampleMaxMs) {
        outputHandleSampleMaxMs = outputHandledDurationMs;
      }
      return;
    }

    if (envelope.kind === 'pty.event') {
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = ensureConversation(envelope.sessionId);
      noteGitActivity(conversation.directoryId);
      const observedAt = observedAtFromSessionEvent(envelope.event);
      const updatedAdapterState = mergeAdapterStateFromSessionEvent(
        conversation.agentType,
        conversation.adapterState,
        envelope.event,
        observedAt,
      );
      if (updatedAdapterState !== null) {
        conversation.adapterState = updatedAdapterState;
      }
      const normalized = mapSessionEventToNormalizedEvent(
        envelope.event,
        conversation.scope,
        idFactory,
      );
      if (normalized !== null) {
        enqueuePersistedEvent(normalized);
      }
      if (envelope.event.type === 'session-exit') {
        exit = envelope.event.exit;
        conversation.status = 'exited';
        conversation.live = false;
        conversation.attentionReason = null;
        conversation.lastExit = envelope.event.exit;
        conversation.exitedAt = new Date().toISOString();
        conversation.attached = false;
        ptySizeByConversationId.delete(envelope.sessionId);
      }
      markDirty();
      return;
    }

    if (envelope.kind === 'pty.exit') {
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = conversations.get(envelope.sessionId);
      if (conversation !== undefined) {
        noteGitActivity(conversation.directoryId);
        exit = envelope.exit;
        conversation.status = 'exited';
        conversation.live = false;
        conversation.attentionReason = null;
        conversation.lastExit = envelope.exit;
        conversation.exitedAt = new Date().toISOString();
        conversation.attached = false;
        ptySizeByConversationId.delete(envelope.sessionId);
      }
      markDirty();
      return;
    }

    if (envelope.kind === 'stream.event') {
      applyObservedGitStatusEvent(envelope.event);
      applyObservedTaskPlanningEvent(envelope.event);
    }
  };

  const removeEnvelopeListener = streamClient.onEnvelope((envelope) => {
    try {
      handleEnvelope(envelope);
    } catch (error: unknown) {
      handleRuntimeFatal('stream-envelope', error);
    }
  });

  const initialActiveId = activeConversationId;
  activeConversationId = null;
  startupSequencer.setTargetSession(initialActiveId);
  if (initialActiveId !== null) {
    startupFirstPaintTargetSessionId = initialActiveId;
    startupActiveStartCommandSpan = startPerfSpan('mux.startup.active-start-command', {
      sessionId: initialActiveId,
    });
    startupActiveFirstOutputSpan = startPerfSpan('mux.startup.active-first-output', {
      sessionId: initialActiveId,
    });
    startupActiveFirstPaintSpan = startPerfSpan('mux.startup.active-first-visible-paint', {
      sessionId: initialActiveId,
    });
    startupActiveSettledSpan = startPerfSpan('mux.startup.active-settled', {
      sessionId: initialActiveId,
      quietMs: startupSettleQuietMs,
    });
    const initialActivateSpan = startPerfSpan('mux.startup.activate-initial', {
      initialActiveId,
    });
    await activateConversation(initialActiveId);
    initialActivateSpan.end();
  }
  startupSpan.end({
    conversations: conversations.size,
  });
  recordPerfEvent('mux.startup.ready', {
    conversations: conversations.size,
  });
  void (async () => {
    let timedOut = false;
    recordPerfEvent('mux.startup.background-start.wait', {
      sessionId: initialActiveId ?? 'none',
      maxWaitMs: DEFAULT_BACKGROUND_START_MAX_WAIT_MS,
      enabled: backgroundResumePersisted ? 1 : 0,
    });
    if (!backgroundResumePersisted) {
      recordPerfEvent('mux.startup.background-start.skipped', {
        sessionId: initialActiveId ?? 'none',
        reason: 'disabled',
      });
      return;
    }
    await Promise.race([
      startupSequencer.waitForSettled(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, DEFAULT_BACKGROUND_START_MAX_WAIT_MS);
      }),
    ]);
    recordPerfEvent('mux.startup.background-start.begin', {
      sessionId: initialActiveId ?? 'none',
      timedOut,
      settledObserved: startupSequencer.snapshot().settledObserved,
    });
    const queued = queuePersistedConversationsInBackground(initialActiveId);
    recordPerfEvent('mux.startup.background-start.queued', {
      sessionId: initialActiveId ?? 'none',
      queued,
    });
  })();

  const handleTaskEditorPromptInput = (input: Buffer): boolean => {
    const handled = handleTaskEditorPromptInputHelper({
      input,
      prompt: taskEditorPrompt,
      isQuitShortcut: (rawInput) =>
        detectMuxGlobalShortcut(rawInput, modalDismissShortcutBindings) === 'mux.app.quit',
      dismissOnOutsideClick: (rawInput, dismiss) => dismissModalOnOutsideClick(rawInput, dismiss),
    });
    if (!handled.handled) {
      return false;
    }
    if (handled.nextPrompt !== undefined) {
      taskEditorPrompt = handled.nextPrompt;
    }
    if (handled.markDirty) {
      markDirty();
    }
    if (handled.submitPayload === undefined) {
      return true;
    }
    const payload = handled.submitPayload;
    queueControlPlaneOp(async () => {
      try {
        if (payload.mode === 'create') {
          const result = await streamClient.sendCommand({
            type: 'task.create',
            tenantId: options.scope.tenantId,
            userId: options.scope.userId,
            workspaceId: options.scope.workspaceId,
            repositoryId: payload.repositoryId,
            title: payload.title,
            description: payload.description,
          });
          const parsed = applyTaskFromCommandResult(result);
          if (parsed === null) {
            throw new Error('control-plane task.create returned malformed task record');
          }
        } else {
          if (payload.taskId === null) {
            throw new Error('task edit state missing task id');
          }
          const result = await streamClient.sendCommand({
            type: 'task.update',
            taskId: payload.taskId,
            repositoryId: payload.repositoryId,
            title: payload.title,
            description: payload.description,
          });
          const parsed = applyTaskFromCommandResult(result);
          if (parsed === null) {
            throw new Error('control-plane task.update returned malformed task record');
          }
        }
        taskEditorPrompt = null;
        taskPaneNotice = null;
      } catch (error: unknown) {
        if (taskEditorPrompt !== null) {
          taskEditorPrompt.error = error instanceof Error ? error.message : String(error);
        } else {
          taskPaneNotice = error instanceof Error ? error.message : String(error);
        }
      } finally {
        markDirty();
      }
    }, payload.commandLabel);
    return true;
  };

  const handleConversationTitleEditInput = (input: Buffer): boolean => {
    return handleConversationTitleEditInputHelper({
      input,
      edit: conversationTitleEdit,
      isQuitShortcut: (rawInput) =>
        detectMuxGlobalShortcut(rawInput, modalDismissShortcutBindings) === 'mux.app.quit',
      isArchiveShortcut: (rawInput) => {
        const action = detectMuxGlobalShortcut(rawInput, shortcutBindings);
        return action === 'mux.conversation.archive' || action === 'mux.conversation.delete';
      },
      dismissOnOutsideClick: (rawInput, dismiss, onInsidePointerPress) =>
        dismissModalOnOutsideClick(rawInput, dismiss, onInsidePointerPress),
      buildConversationTitleModalOverlay: () => buildConversationTitleModalOverlay(layout.rows),
      stopConversationTitleEdit,
      queueControlPlaneOp,
      archiveConversation,
      markDirty,
      conversations,
      scheduleConversationTitlePersist,
    });
  };

  const handleNewThreadPromptInput = (input: Buffer): boolean => {
    return handleNewThreadPromptInputHelper({
      input,
      prompt: newThreadPrompt,
      isQuitShortcut: (rawInput) =>
        detectMuxGlobalShortcut(rawInput, modalDismissShortcutBindings) === 'mux.app.quit',
      dismissOnOutsideClick: (rawInput, dismiss, onInsidePointerPress) =>
        dismissModalOnOutsideClick(rawInput, dismiss, onInsidePointerPress),
      buildNewThreadModalOverlay: () => buildNewThreadModalOverlay(layout.rows),
      resolveNewThreadPromptAgentByRow,
      queueControlPlaneOp,
      createAndActivateConversationInDirectory,
      markDirty,
      setPrompt: (prompt) => {
        newThreadPrompt = prompt;
      },
    });
  };

  const handleAddDirectoryPromptInput = (input: Buffer): boolean => {
    return handleAddDirectoryPromptInputHelper({
      input,
      prompt: addDirectoryPrompt,
      isQuitShortcut: (rawInput) =>
        detectMuxGlobalShortcut(rawInput, modalDismissShortcutBindings) === 'mux.app.quit',
      dismissOnOutsideClick: (rawInput, dismiss) => dismissModalOnOutsideClick(rawInput, dismiss),
      setPrompt: (next) => {
        addDirectoryPrompt = next;
      },
      markDirty,
      queueControlPlaneOp,
      addDirectoryByPath,
    });
  };

  const handleRepositoryPromptInput = (input: Buffer): boolean => {
    return handleRepositoryPromptInputHelper({
      input,
      prompt: repositoryPrompt,
      isQuitShortcut: (rawInput) =>
        detectMuxGlobalShortcut(rawInput, modalDismissShortcutBindings) === 'mux.app.quit',
      dismissOnOutsideClick: (rawInput, dismiss) => dismissModalOnOutsideClick(rawInput, dismiss),
      setPrompt: (next) => {
        repositoryPrompt = next;
      },
      markDirty,
      repositoriesHas: (repositoryId) => repositories.has(repositoryId),
      normalizeGitHubRemoteUrl,
      queueControlPlaneOp,
      upsertRepositoryByRemoteUrl,
    });
  };

  const homeEditorBuffer = (): TaskComposerBuffer => {
    if (taskEditorTarget.kind === 'task') {
      return taskComposerForTask(taskEditorTarget.taskId) ?? createTaskComposerBuffer('');
    }
    return taskDraftComposer;
  };

  const updateHomeEditorBuffer = (next: TaskComposerBuffer): void => {
    if (taskEditorTarget.kind === 'task') {
      setTaskComposerForTask(taskEditorTarget.taskId, next);
      scheduleTaskComposerPersist(taskEditorTarget.taskId);
    } else {
      taskDraftComposer = normalizeTaskComposerBuffer(next);
    }
    markDirty();
  };

  const selectRepositoryByDirection = (direction: 1 | -1): void => {
    const orderedIds = activeRepositoryIds();
    if (orderedIds.length === 0) {
      return;
    }
    const currentIndex = Math.max(0, orderedIds.indexOf(taskPaneSelectedRepositoryId ?? ''));
    const nextIndex = Math.max(0, Math.min(orderedIds.length - 1, currentIndex + direction));
    selectRepositoryById(orderedIds[nextIndex]!);
  };

  const submitDraftTaskFromComposer = (): void => {
    const repositoryId = taskPaneSelectedRepositoryId;
    if (repositoryId === null || !repositories.has(repositoryId)) {
      taskPaneNotice = 'select a repository first';
      markDirty();
      return;
    }
    const fields = taskFieldsFromComposerText(taskDraftComposer.text);
    if (fields.title.length === 0) {
      taskPaneNotice = 'first line is required';
      markDirty();
      return;
    }
    queueControlPlaneOp(async () => {
      const result = await streamClient.sendCommand({
        type: 'task.create',
        tenantId: options.scope.tenantId,
        userId: options.scope.userId,
        workspaceId: options.scope.workspaceId,
        repositoryId,
        title: fields.title,
        description: fields.description,
      });
      const parsed = applyTaskFromCommandResult(result);
      if (parsed === null) {
        throw new Error('control-plane task.create returned malformed task record');
      }
      taskDraftComposer = createTaskComposerBuffer('');
      taskPaneNotice = null;
      syncTaskPaneSelection();
      markDirty();
    }, 'task-composer-create');
  };

  const moveTaskEditorFocusUp = (): void => {
    if (taskEditorTarget.kind === 'draft') {
      const scopedTasks = selectedRepositoryTaskRecords();
      const fallback = scopedTasks[scopedTasks.length - 1];
      if (fallback !== undefined) {
        focusTaskComposer(fallback.taskId);
      }
      return;
    }
    const focusedTaskId = taskEditorTarget.taskId;
    const scopedTasks = selectedRepositoryTaskRecords();
    const index = scopedTasks.findIndex((task) => task.taskId === focusedTaskId);
    if (index <= 0) {
      return;
    }
    const target = scopedTasks[index - 1];
    if (target !== undefined) {
      focusTaskComposer(target.taskId);
    }
  };

  const handleTaskPaneShortcutInput = (input: Buffer): boolean => {
    if (mainPaneMode !== 'home') {
      return false;
    }
    const action = detectTaskScreenKeybindingAction(input, taskScreenKeybindings);
    if (action !== null) {
      if (action === 'mux.home.repo.dropdown.toggle') {
        taskRepositoryDropdownOpen = !taskRepositoryDropdownOpen;
        markDirty();
        return true;
      }
      if (action === 'mux.home.repo.next') {
        taskRepositoryDropdownOpen = true;
        selectRepositoryByDirection(1);
        return true;
      }
      if (action === 'mux.home.repo.previous') {
        taskRepositoryDropdownOpen = true;
        selectRepositoryByDirection(-1);
        return true;
      }
      if (action === 'mux.home.task.status.ready') {
        runTaskPaneAction('task.ready');
        return true;
      }
      if (action === 'mux.home.task.status.draft') {
        runTaskPaneAction('task.draft');
        return true;
      }
      if (action === 'mux.home.task.status.complete') {
        runTaskPaneAction('task.complete');
        return true;
      }
      if (action === 'mux.home.task.reorder.up') {
        runTaskPaneAction('task.reorder-up');
        return true;
      }
      if (action === 'mux.home.task.reorder.down') {
        runTaskPaneAction('task.reorder-down');
        return true;
      }
      if (action === 'mux.home.task.newline') {
        updateHomeEditorBuffer(insertTaskComposerText(homeEditorBuffer(), '\n'));
        return true;
      }
      if (action === 'mux.home.task.submit') {
        if (taskEditorTarget.kind === 'draft') {
          submitDraftTaskFromComposer();
        } else {
          focusDraftComposer();
        }
        return true;
      }
      if (action === 'mux.home.editor.cursor.left') {
        updateHomeEditorBuffer(taskComposerMoveLeft(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.cursor.right') {
        updateHomeEditorBuffer(taskComposerMoveRight(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.cursor.up') {
        const vertical = taskComposerMoveVertical(homeEditorBuffer(), -1);
        if (vertical.hitBoundary) {
          moveTaskEditorFocusUp();
        } else {
          updateHomeEditorBuffer(vertical.next);
        }
        return true;
      }
      if (action === 'mux.home.editor.cursor.down') {
        if (taskEditorTarget.kind === 'task') {
          const vertical = taskComposerMoveVertical(homeEditorBuffer(), 1);
          if (vertical.hitBoundary) {
            focusDraftComposer();
          } else {
            updateHomeEditorBuffer(vertical.next);
          }
        } else {
          updateHomeEditorBuffer(taskComposerMoveVertical(homeEditorBuffer(), 1).next);
        }
        return true;
      }
      if (action === 'mux.home.editor.line.start') {
        updateHomeEditorBuffer(taskComposerMoveLineStart(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.line.end') {
        updateHomeEditorBuffer(taskComposerMoveLineEnd(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.word.left') {
        updateHomeEditorBuffer(taskComposerMoveWordLeft(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.word.right') {
        updateHomeEditorBuffer(taskComposerMoveWordRight(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.delete.backward') {
        updateHomeEditorBuffer(taskComposerBackspace(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.delete.forward') {
        updateHomeEditorBuffer(taskComposerDeleteForward(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.delete.word.backward') {
        updateHomeEditorBuffer(taskComposerDeleteWordLeft(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.delete.line.start') {
        updateHomeEditorBuffer(taskComposerDeleteToLineStart(homeEditorBuffer()));
        return true;
      }
      if (action === 'mux.home.editor.delete.line.end') {
        updateHomeEditorBuffer(taskComposerDeleteToLineEnd(homeEditorBuffer()));
        return true;
      }
    }

    if (input.includes(0x1b)) {
      return false;
    }

    let next = homeEditorBuffer();
    let changed = false;
    for (const byte of input) {
      if (byte >= 32 && byte <= 126) {
        next = insertTaskComposerText(next, String.fromCharCode(byte));
        changed = true;
      }
    }
    if (!changed) {
      return false;
    }
    updateHomeEditorBuffer(next);
    return true;
  };

  const visibleLeftNavTargetsForState = (): readonly LeftNavSelection[] =>
    visibleLeftNavTargets(latestRailViewRows);

  const selectedRepositoryGroupId = (): string | null => {
    return selectedRepositoryGroupIdForLeftNav(
      leftNavSelection,
      conversations,
      repositoryGroupIdForDirectory,
    );
  };

  const activateLeftNavTarget = (
    target: LeftNavSelection,
    direction: 'next' | 'previous',
  ): void => {
    if (target.kind === 'home') {
      enterHomePane();
      return;
    }
    if (target.kind === 'repository') {
      const firstDirectoryId = firstDirectoryForRepositoryGroup(target.repositoryId);
      if (firstDirectoryId !== null) {
        enterProjectPane(firstDirectoryId);
      } else {
        mainPaneMode = 'project';
      }
      selectLeftNavRepository(target.repositoryId);
      markDirty();
      return;
    }
    if (target.kind === 'project') {
      if (directories.has(target.directoryId)) {
        enterProjectPane(target.directoryId);
        markDirty();
        return;
      }
      const visibleTargets = visibleLeftNavTargetsForState();
      const fallbackConversation = visibleTargets.find(
        (entry): entry is Extract<LeftNavSelection, { kind: 'conversation' }> =>
          entry.kind === 'conversation' &&
          conversations.get(entry.sessionId)?.directoryId === target.directoryId,
      );
      if (fallbackConversation !== undefined) {
        queueControlPlaneOp(async () => {
          await activateConversation(fallbackConversation.sessionId);
        }, `shortcut-activate-${direction}-directory-fallback`);
      }
      return;
    }
    if (!conversations.has(target.sessionId)) {
      return;
    }
    queueControlPlaneOp(async () => {
      await activateConversation(target.sessionId);
    }, `shortcut-activate-${direction}`);
  };

  const cycleLeftNavSelection = (direction: 'next' | 'previous'): boolean => {
    const targets = visibleLeftNavTargetsForState();
    if (targets.length === 0) {
      return false;
    }
    const targetKeys = targets.map((target) => leftNavTargetKey(target));
    const targetKey = cycleConversationId(
      targetKeys,
      leftNavTargetKey(leftNavSelection),
      direction,
    );
    if (targetKey === null) {
      return false;
    }
    const target = targets.find((entry) => leftNavTargetKey(entry) === targetKey);
    if (target === undefined) {
      return false;
    }
    activateLeftNavTarget(target, direction);
    return true;
  };

  const handleRepositoryTreeArrow = (input: Buffer): boolean => {
    const repositoryId = selectedRepositoryGroupId();
    const action = repositoryTreeArrowAction(input, leftNavSelection, repositoryId);
    if (repositoryId === null || action === null) {
      return false;
    }
    if (action === 'expand') {
      expandRepositoryGroup(repositoryId);
      selectLeftNavRepository(repositoryId);
      markDirty();
      return true;
    }
    if (action === 'collapse') {
      collapseRepositoryGroup(repositoryId);
      selectLeftNavRepository(repositoryId);
      markDirty();
      return true;
    }
    return false;
  };

  const handleRepositoryFoldChords = (input: Buffer): boolean => {
    const reduced = reduceRepositoryFoldChordInput({
      input,
      leftNavSelection,
      nowMs: Date.now(),
      prefixAtMs: repositoryToggleChordPrefixAtMs,
      chordTimeoutMs: REPOSITORY_TOGGLE_CHORD_TIMEOUT_MS,
      collapseAllChordPrefix: REPOSITORY_COLLAPSE_ALL_CHORD_PREFIX,
    });
    repositoryToggleChordPrefixAtMs = reduced.nextPrefixAtMs;
    if (reduced.action === 'expand-all') {
      expandAllRepositoryGroups();
      markDirty();
      return true;
    }
    if (reduced.action === 'collapse-all') {
      collapseAllRepositoryGroups();
      markDirty();
      return true;
    }
    return reduced.consumed;
  };

  const onInput = (chunk: Buffer): void => {
    if (shuttingDown) {
      return;
    }
    if (handleTaskEditorPromptInput(chunk)) {
      return;
    }
    if (handleRepositoryPromptInput(chunk)) {
      return;
    }
    if (handleNewThreadPromptInput(chunk)) {
      return;
    }
    if (handleConversationTitleEditInput(chunk)) {
      return;
    }
    if (handleAddDirectoryPromptInput(chunk)) {
      return;
    }

    if (chunk.length === 1 && chunk[0] === 0x1b) {
      if (selection !== null || selectionDrag !== null) {
        selection = null;
        selectionDrag = null;
        releaseViewportPinForSelection();
        markDirty();
      }
      if (mainPaneMode === 'conversation' && activeConversationId !== null) {
        const escapeTarget = conversations.get(activeConversationId);
        if (escapeTarget !== undefined) {
          streamClient.sendInput(escapeTarget.sessionId, chunk);
        }
      }
      return;
    }

    const focusExtraction = extractFocusEvents(chunk);
    if (focusExtraction.focusInCount > 0) {
      inputModeManager.enable();
      markDirty();
    }
    if (focusExtraction.focusOutCount > 0) {
      markDirty();
    }

    if (focusExtraction.sanitized.length === 0) {
      return;
    }
    if (handleRepositoryFoldChords(focusExtraction.sanitized)) {
      return;
    }
    if (handleRepositoryTreeArrow(focusExtraction.sanitized)) {
      return;
    }

    const globalShortcut = detectMuxGlobalShortcut(focusExtraction.sanitized, shortcutBindings);
    if (globalShortcut === 'mux.app.interrupt-all') {
      requestStop();
      return;
    }
    if (globalShortcut === 'mux.app.quit') {
      requestStop();
      return;
    }
    if (globalShortcut === 'mux.conversation.new') {
      const targetDirectoryId = resolveDirectoryForAction();
      if (targetDirectoryId !== null) {
        openNewThreadPrompt(targetDirectoryId);
      }
      return;
    }
    if (globalShortcut === 'mux.conversation.archive') {
      const targetConversationId = mainPaneMode === 'conversation' ? activeConversationId : null;
      if (targetConversationId !== null && conversations.has(targetConversationId)) {
        queueControlPlaneOp(async () => {
          await archiveConversation(targetConversationId);
        }, 'shortcut-archive-conversation');
      }
      return;
    }
    if (globalShortcut === 'mux.conversation.delete') {
      const targetConversationId = mainPaneMode === 'conversation' ? activeConversationId : null;
      if (targetConversationId !== null && conversations.has(targetConversationId)) {
        queueControlPlaneOp(async () => {
          await archiveConversation(targetConversationId);
        }, 'shortcut-delete-conversation');
      }
      return;
    }
    if (globalShortcut === 'mux.conversation.takeover') {
      const targetConversationId = mainPaneMode === 'conversation' ? activeConversationId : null;
      if (targetConversationId !== null && conversations.has(targetConversationId)) {
        queueControlPlaneOp(async () => {
          await takeoverConversation(targetConversationId);
        }, 'shortcut-takeover-conversation');
      }
      return;
    }
    if (globalShortcut === 'mux.directory.add') {
      repositoryPrompt = null;
      addDirectoryPrompt = {
        value: '',
        error: null,
      };
      markDirty();
      return;
    }
    if (globalShortcut === 'mux.directory.close') {
      const targetDirectoryId =
        mainPaneMode === 'project' &&
        activeDirectoryId !== null &&
        directories.has(activeDirectoryId)
          ? activeDirectoryId
          : null;
      if (targetDirectoryId !== null) {
        queueControlPlaneOp(async () => {
          await closeDirectory(targetDirectoryId);
        }, 'shortcut-close-directory');
      }
      return;
    }
    if (
      globalShortcut === 'mux.conversation.next' ||
      globalShortcut === 'mux.conversation.previous'
    ) {
      const direction = globalShortcut === 'mux.conversation.next' ? 'next' : 'previous';
      cycleLeftNavSelection(direction);
      return;
    }
    if (handleTaskPaneShortcutInput(focusExtraction.sanitized)) {
      return;
    }

    if (
      mainPaneMode === 'conversation' &&
      selection !== null &&
      isCopyShortcutInput(focusExtraction.sanitized)
    ) {
      if (activeConversationId === null) {
        return;
      }
      const selectedFrame = activeConversation().oracle.snapshotWithoutHash();
      const copied = writeTextToClipboard(selectionText(selectedFrame, selection));
      if (copied) {
        markDirty();
      }
      return;
    }

    const parsed = parseMuxInputChunk(inputRemainder, focusExtraction.sanitized);
    inputRemainder = parsed.remainder;

    const inputConversation =
      activeConversationId === null ? null : (conversations.get(activeConversationId) ?? null);
    let snapshotForInput =
      inputConversation === null ? null : inputConversation.oracle.snapshotWithoutHash();
    const routedTokens: Array<(typeof parsed.tokens)[number]> = [];
    for (const token of parsed.tokens) {
      if (token.kind !== 'mouse') {
        if (selection !== null && token.text.length > 0) {
          selection = null;
          selectionDrag = null;
          releaseViewportPinForSelection();
          markDirty();
        }
        routedTokens.push(token);
        continue;
      }

      if (paneDividerDragActive) {
        if (isMouseRelease(token.event.final)) {
          paneDividerDragActive = false;
          markDirty();
          continue;
        }
        if (!isWheelMouseCode(token.event.code)) {
          applyPaneDividerAtCol(token.event.col);
          continue;
        }
      }

      const target = classifyPaneAt(layout, token.event.col, token.event.row);
      if (homePaneDragState !== null && isMouseRelease(token.event.final)) {
        const drag = homePaneDragState;
        homePaneDragState = null;
        if (mainPaneMode === 'home' && target === 'right' && drag.hasDragged) {
          const rowIndex = Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1));
          if (drag.kind === 'task') {
            const targetTaskId = taskFocusedPaneTaskIdAtRow(latestTaskPaneView, rowIndex);
            if (targetTaskId !== null) {
              reorderTaskByDrop(drag.itemId, targetTaskId);
            }
          } else {
            const targetRepositoryId = taskFocusedPaneRepositoryIdAtRow(
              latestTaskPaneView,
              rowIndex,
            );
            if (targetRepositoryId !== null) {
              reorderRepositoryByDrop(drag.itemId, targetRepositoryId);
            }
          }
        }
        markDirty();
        continue;
      }
      if (
        target === 'separator' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code)
      ) {
        paneDividerDragActive = true;
        applyPaneDividerAtCol(token.event.col);
        continue;
      }
      const isMainPaneTarget = target === 'right';
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (wheelDelta !== null) {
        if (target === 'right') {
          if (mainPaneMode === 'project') {
            projectPaneScrollTop = Math.max(0, projectPaneScrollTop + wheelDelta);
          } else if (mainPaneMode === 'home') {
            taskPaneScrollTop = Math.max(0, taskPaneScrollTop + wheelDelta);
          } else if (inputConversation !== null) {
            inputConversation.oracle.scrollViewport(wheelDelta);
            snapshotForInput = inputConversation.oracle.snapshotWithoutHash();
          }
          markDirty();
          continue;
        }
      }
      if (
        homePaneDragState !== null &&
        mainPaneMode === 'home' &&
        target === 'right' &&
        isSelectionDrag(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code)
      ) {
        const rowIndex = Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1));
        homePaneDragState = {
          ...homePaneDragState,
          latestRowIndex: rowIndex,
          hasDragged:
            homePaneDragState.hasDragged || rowIndex !== homePaneDragState.startedRowIndex,
        };
        markDirty();
        continue;
      }
      const projectPaneActionClick =
        target === 'right' &&
        mainPaneMode === 'project' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (projectPaneActionClick && projectPaneSnapshot !== null) {
        const snapshot = projectPaneSnapshot;
        const rowIndex = Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1));
        const action = projectPaneActionAtRow(
          snapshot,
          layout.rightCols,
          layout.paneRows,
          projectPaneScrollTop,
          rowIndex,
        );
        if (action === 'conversation.new') {
          openNewThreadPrompt(snapshot.directoryId);
          markDirty();
          continue;
        }
        if (action === 'project.close') {
          queueControlPlaneOp(async () => {
            await closeDirectory(snapshot.directoryId);
          }, 'project-pane-close-project');
          markDirty();
          continue;
        }
      }
      const taskPaneActionClick =
        target === 'right' &&
        mainPaneMode === 'home' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (taskPaneActionClick) {
        const rowIndex = Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1));
        const colIndex = Math.max(
          0,
          Math.min(layout.rightCols - 1, token.event.col - layout.rightStartCol),
        );
        const action =
          taskFocusedPaneActionAtCell(latestTaskPaneView, rowIndex, colIndex) ??
          taskFocusedPaneActionAtRow(latestTaskPaneView, rowIndex);
        if (action !== null) {
          taskPaneTaskEditClickState = null;
          taskPaneRepositoryEditClickState = null;
          homePaneDragState = null;
          if (action === 'repository.dropdown.toggle') {
            taskRepositoryDropdownOpen = !taskRepositoryDropdownOpen;
          } else if (action === 'repository.select') {
            const repositoryId = taskFocusedPaneRepositoryIdAtRow(latestTaskPaneView, rowIndex);
            if (repositoryId !== null) {
              selectRepositoryById(repositoryId);
            }
          } else if (action === 'task.focus') {
            const taskId = taskFocusedPaneTaskIdAtRow(latestTaskPaneView, rowIndex);
            if (taskId !== null) {
              selectTaskById(taskId);
            }
          } else if (action === 'task.status.ready') {
            const taskId = taskFocusedPaneTaskIdAtRow(latestTaskPaneView, rowIndex);
            if (taskId !== null) {
              selectTaskById(taskId);
              runTaskPaneAction('task.ready');
            }
          } else if (action === 'task.status.draft') {
            const taskId = taskFocusedPaneTaskIdAtRow(latestTaskPaneView, rowIndex);
            if (taskId !== null) {
              selectTaskById(taskId);
              runTaskPaneAction('task.draft');
            }
          } else if (action === 'task.status.complete') {
            const taskId = taskFocusedPaneTaskIdAtRow(latestTaskPaneView, rowIndex);
            if (taskId !== null) {
              selectTaskById(taskId);
              runTaskPaneAction('task.complete');
            }
          }
          markDirty();
          continue;
        }
        const taskId = taskFocusedPaneTaskIdAtRow(latestTaskPaneView, rowIndex);
        if (taskId !== null) {
          const click = detectEntityDoubleClick(
            taskPaneTaskEditClickState,
            taskId,
            Date.now(),
            HOME_PANE_EDIT_DOUBLE_CLICK_WINDOW_MS,
          );
          selectTaskById(taskId);
          taskPaneNotice = null;
          taskPaneTaskEditClickState = click.nextState;
          taskPaneRepositoryEditClickState = null;
          if (click.doubleClick) {
            homePaneDragState = null;
            openTaskEditPrompt(taskId);
          } else {
            homePaneDragState = {
              kind: 'task',
              itemId: taskId,
              startedRowIndex: rowIndex,
              latestRowIndex: rowIndex,
              hasDragged: false,
            };
          }
          markDirty();
          continue;
        }
        const repositoryId = taskFocusedPaneRepositoryIdAtRow(latestTaskPaneView, rowIndex);
        if (repositoryId !== null) {
          const click = detectEntityDoubleClick(
            taskPaneRepositoryEditClickState,
            repositoryId,
            Date.now(),
            HOME_PANE_EDIT_DOUBLE_CLICK_WINDOW_MS,
          );
          selectRepositoryById(repositoryId);
          taskPaneNotice = null;
          taskPaneRepositoryEditClickState = click.nextState;
          taskPaneTaskEditClickState = null;
          if (click.doubleClick) {
            homePaneDragState = null;
            openRepositoryPromptForEdit(repositoryId);
          } else {
            homePaneDragState = {
              kind: 'repository',
              itemId: repositoryId,
              startedRowIndex: rowIndex,
              latestRowIndex: rowIndex,
              hasDragged: false,
            };
          }
          markDirty();
          continue;
        }
        taskPaneTaskEditClickState = null;
        taskPaneRepositoryEditClickState = null;
        homePaneDragState = null;
      }
      const leftPaneConversationSelect =
        target === 'left' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (leftPaneConversationSelect) {
        const rowIndex = Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1));
        const colIndex = Math.max(0, Math.min(layout.leftCols - 1, token.event.col - 1));
        const selectedConversationId = conversationIdAtWorkspaceRailRow(
          latestRailViewRows,
          rowIndex,
        );
        const selectedProjectId = projectIdAtWorkspaceRailRow(latestRailViewRows, rowIndex);
        const selectedRepositoryId = repositoryIdAtWorkspaceRailRow(latestRailViewRows, rowIndex);
        const selectedAction = actionAtWorkspaceRailCell(
          latestRailViewRows,
          rowIndex,
          colIndex,
          layout.leftCols,
        );
        const selectedRowKind = kindAtWorkspaceRailRow(latestRailViewRows, rowIndex);
        const supportsConversationTitleEditClick =
          selectedRowKind === 'conversation-title' || selectedRowKind === 'conversation-body';
        const keepTitleEditActive =
          conversationTitleEdit !== null &&
          selectedConversationId === conversationTitleEdit.conversationId &&
          supportsConversationTitleEditClick;
        if (!keepTitleEditActive && conversationTitleEdit !== null) {
          stopConversationTitleEdit(true);
        }
        if (selection !== null || selectionDrag !== null) {
          selection = null;
          selectionDrag = null;
          releaseViewportPinForSelection();
        }
        if (selectedAction === 'conversation.new') {
          conversationTitleEditClickState = null;
          const targetDirectoryId = selectedProjectId ?? resolveDirectoryForAction();
          if (targetDirectoryId !== null) {
            openNewThreadPrompt(targetDirectoryId);
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'conversation.delete') {
          conversationTitleEditClickState = null;
          if (activeConversationId !== null) {
            const targetConversationId = activeConversationId;
            queueControlPlaneOp(async () => {
              await archiveConversation(targetConversationId);
            }, 'mouse-archive-conversation');
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'project.add') {
          conversationTitleEditClickState = null;
          repositoryPrompt = null;
          addDirectoryPrompt = {
            value: '',
            error: null,
          };
          markDirty();
          continue;
        }
        if (selectedAction === 'repository.add') {
          conversationTitleEditClickState = null;
          openRepositoryPromptForCreate();
          continue;
        }
        if (selectedAction === 'repository.edit') {
          conversationTitleEditClickState = null;
          if (selectedRepositoryId !== null && repositories.has(selectedRepositoryId)) {
            openRepositoryPromptForEdit(selectedRepositoryId);
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'repository.archive') {
          conversationTitleEditClickState = null;
          if (selectedRepositoryId !== null && repositories.has(selectedRepositoryId)) {
            queueControlPlaneOp(async () => {
              await archiveRepositoryById(selectedRepositoryId);
            }, 'mouse-archive-repository');
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'repository.toggle') {
          conversationTitleEditClickState = null;
          if (selectedRepositoryId !== null) {
            toggleRepositoryGroup(selectedRepositoryId);
            selectLeftNavRepository(selectedRepositoryId);
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'repositories.toggle') {
          conversationTitleEditClickState = null;
          if (repositoriesCollapsed) {
            expandAllRepositoryGroups();
          } else {
            collapseAllRepositoryGroups();
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'home.open') {
          conversationTitleEditClickState = null;
          enterHomePane();
          markDirty();
          continue;
        }
        if (selectedAction === 'project.close') {
          conversationTitleEditClickState = null;
          const targetDirectoryId = selectedProjectId ?? resolveDirectoryForAction();
          if (targetDirectoryId !== null) {
            queueControlPlaneOp(async () => {
              await closeDirectory(targetDirectoryId);
            }, 'mouse-close-directory');
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'shortcuts.toggle') {
          conversationTitleEditClickState = null;
          shortcutsCollapsed = !shortcutsCollapsed;
          queuePersistMuxUiState();
          markDirty();
          continue;
        }
        const clickNowMs = Date.now();
        const conversationClick =
          selectedConversationId !== null && supportsConversationTitleEditClick
            ? detectConversationDoubleClick(
                conversationTitleEditClickState,
                selectedConversationId,
                clickNowMs,
                CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS,
              )
            : {
                doubleClick: false,
                nextState: null,
              };
        conversationTitleEditClickState = conversationClick.nextState;
        if (selectedConversationId !== null && selectedConversationId === activeConversationId) {
          if (mainPaneMode !== 'conversation') {
            mainPaneMode = 'conversation';
            selectLeftNavConversation(selectedConversationId);
            projectPaneSnapshot = null;
            projectPaneScrollTop = 0;
            forceFullClear = true;
            previousRows = [];
          }
          if (conversationClick.doubleClick) {
            beginConversationTitleEdit(selectedConversationId);
          }
          markDirty();
          continue;
        }
        if (selectedConversationId !== null) {
          if (conversationClick.doubleClick) {
            queueControlPlaneOp(async () => {
              await activateConversation(selectedConversationId);
              beginConversationTitleEdit(selectedConversationId);
            }, 'mouse-activate-edit-conversation');
            markDirty();
            continue;
          }
          queueControlPlaneOp(async () => {
            await activateConversation(selectedConversationId);
          }, 'mouse-activate-conversation');
          markDirty();
          continue;
        }
        if (
          selectedConversationId === null &&
          selectedProjectId !== null &&
          directories.has(selectedProjectId)
        ) {
          conversationTitleEditClickState = null;
          enterProjectPane(selectedProjectId);
          markDirty();
          continue;
        }
        conversationTitleEditClickState = null;
        markDirty();
        continue;
      }
      if (snapshotForInput === null || mainPaneMode !== 'conversation') {
        routedTokens.push(token);
        continue;
      }
      const point = pointFromMouseEvent(layout, snapshotForInput, token.event);
      const startSelection =
        isMainPaneTarget &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code);
      const updateSelection =
        selectionDrag !== null &&
        isMainPaneTarget &&
        isSelectionDrag(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code);
      const releaseSelection = selectionDrag !== null && isMouseRelease(token.event.final);

      if (startSelection) {
        selection = null;
        pinViewportForSelection();
        selectionDrag = {
          anchor: point,
          focus: point,
          hasDragged: false,
        };
        markDirty();
        continue;
      }

      if (updateSelection && selectionDrag !== null) {
        selectionDrag = {
          anchor: selectionDrag.anchor,
          focus: point,
          hasDragged:
            selectionDrag.hasDragged || !selectionPointsEqual(selectionDrag.anchor, point),
        };
        markDirty();
        continue;
      }

      if (releaseSelection && selectionDrag !== null) {
        const finalized = {
          anchor: selectionDrag.anchor,
          focus: point,
          hasDragged:
            selectionDrag.hasDragged || !selectionPointsEqual(selectionDrag.anchor, point),
        };
        if (finalized.hasDragged) {
          const completedSelection: PaneSelection = {
            anchor: finalized.anchor,
            focus: finalized.focus,
            text: '',
          };
          selection = {
            ...completedSelection,
            text: selectionText(snapshotForInput, completedSelection),
          };
        } else {
          selection = null;
        }
        if (!finalized.hasDragged) {
          releaseViewportPinForSelection();
        }
        selectionDrag = null;
        markDirty();
        continue;
      }

      if (selection !== null && !isWheelMouseCode(token.event.code)) {
        selection = null;
        selectionDrag = null;
        releaseViewportPinForSelection();
        markDirty();
      }

      routedTokens.push(token);
    }

    let mainPaneScrollRows = 0;
    const forwardToSession: Buffer[] = [];
    for (const token of routedTokens) {
      if (token.kind === 'passthrough') {
        if (mainPaneMode === 'conversation' && token.text.length > 0) {
          forwardToSession.push(normalizeMuxKeyboardInputForPty(Buffer.from(token.text, 'utf8')));
        }
        continue;
      }
      if (classifyPaneAt(layout, token.event.col, token.event.row) !== 'right') {
        continue;
      }
      if (mainPaneMode !== 'conversation') {
        continue;
      }
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (wheelDelta !== null) {
        mainPaneScrollRows += wheelDelta;
        continue;
      }
      // The mux owns mouse interactions. Forwarding raw SGR mouse sequences to shell-style
      // threads produces visible control garbage (for example on initial click-to-focus).
      continue;
    }

    if (mainPaneScrollRows !== 0 && inputConversation !== null) {
      inputConversation.oracle.scrollViewport(mainPaneScrollRows);
      markDirty();
    }

    if (inputConversation === null) {
      return;
    }
    if (
      inputConversation.controller !== null &&
      !isConversationControlledByLocalHuman(inputConversation)
    ) {
      return;
    }

    for (const forwardChunk of forwardToSession) {
      streamClient.sendInput(inputConversation.sessionId, forwardChunk);
    }
    if (forwardToSession.length > 0) {
      noteGitActivity(inputConversation.directoryId);
    }
  };

  const onResize = (): void => {
    const nextSize = terminalSize();
    queueResize(nextSize);
  };
  const onInputSafe = (chunk: Buffer): void => {
    try {
      onInput(chunk);
    } catch (error: unknown) {
      handleRuntimeFatal('stdin-data', error);
    }
  };
  const onResizeSafe = (): void => {
    try {
      onResize();
    } catch (error: unknown) {
      handleRuntimeFatal('stdout-resize', error);
    }
  };
  const onUncaughtException = (error: Error): void => {
    handleRuntimeFatal('uncaught-exception', error);
  };
  const onUnhandledRejection = (reason: unknown): void => {
    handleRuntimeFatal('unhandled-rejection', reason);
  };

  await hydrateStartupState();

  process.stdin.on('data', onInputSafe);
  process.stdout.on('resize', onResizeSafe);
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  process.once('uncaughtException', onUncaughtException);
  process.once('unhandledRejection', onUnhandledRejection);

  inputModeManager.enable();
  applyLayout(size, true);
  scheduleRender();

  try {
    while (!stop) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  } finally {
    shuttingDown = true;
    dirty = false;
    clearInterval(outputLoadSampleTimer);
    eventLoopDelayMonitor.disable();
    if (processUsageTimer !== null) {
      clearInterval(processUsageTimer);
      processUsageTimer = null;
    }
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (ptyResizeTimer !== null) {
      clearTimeout(ptyResizeTimer);
      ptyResizeTimer = null;
    }
    persistMuxUiStateNow();
    if (conversationTitleEdit !== null) {
      clearConversationTitleEditTimer(conversationTitleEdit);
    }
    if ('taskId' in taskEditorTarget && typeof taskEditorTarget.taskId === 'string') {
      flushTaskComposerPersist(taskEditorTarget.taskId);
    }
    for (const taskId of taskAutosaveTimerByTaskId.keys()) {
      flushTaskComposerPersist(taskId);
    }
    if (renderScheduled) {
      renderScheduled = false;
    }
    process.stdin.off('data', onInputSafe);
    process.stdout.off('resize', onResizeSafe);
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
    removeEnvelopeListener();
    await unsubscribeTaskPlanningEvents();
    if (keyEventSubscription !== null) {
      await keyEventSubscription.close();
      keyEventSubscription = null;
    }
    if (runtimeFatalExitTimer !== null) {
      clearTimeout(runtimeFatalExitTimer);
      runtimeFatalExitTimer = null;
    }

    let recordingCloseError: unknown = null;
    try {
      await waitForControlPlaneDrain();
      await controlPlaneClient.close();
    } catch {
      // Best-effort shutdown only.
    }
    flushPendingPersistedEvents('shutdown');
    if (muxRecordingWriter !== null) {
      try {
        await muxRecordingWriter.close();
      } catch (error: unknown) {
        recordingCloseError = error;
      }
    }
    store.close();
    restoreTerminalState(true, inputModeManager.restore);
    if (
      options.recordingGifOutputPath !== null &&
      options.recordingPath !== null &&
      recordingCloseError === null
    ) {
      try {
        await renderTerminalRecordingToGif({
          recordingPath: options.recordingPath,
          outputPath: options.recordingGifOutputPath,
        });
        process.stderr.write(
          `[mux-recording] jsonl=${options.recordingPath} gif=${options.recordingGifOutputPath}\n`,
        );
      } catch (error: unknown) {
        process.stderr.write(
          `[mux-recording] gif-export-failed ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    } else if (recordingCloseError !== null) {
      const recordingCloseErrorMessage =
        recordingCloseError instanceof Error
          ? recordingCloseError.message
          : typeof recordingCloseError === 'string'
            ? recordingCloseError
            : 'unknown error';
      process.stderr.write(`[mux-recording] close-failed ${recordingCloseErrorMessage}\n`);
    }
    endStartupActiveStartCommandSpan({
      observed: false,
    });
    const startupSnapshot = startupSequencer.snapshot();
    endStartupActiveFirstOutputSpan({
      observed: startupSnapshot.firstOutputObserved,
    });
    endStartupActiveFirstPaintSpan({
      observed: startupSnapshot.firstPaintObserved,
    });
    clearStartupSettledTimer();
    endStartupActiveSettledSpan({
      observed: startupSnapshot.settledObserved,
      gate: startupSnapshot.settleGate ?? 'none',
    });
    signalStartupActiveSettled();
    shutdownPerfCore();
  }

  if (exit === null) {
    if (runtimeFatal !== null) {
      return 1;
    }
    return 0;
  }
  return normalizeExitCode(exit);
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error: unknown) {
  shutdownPerfCore();
  restoreTerminalState(true);
  process.stderr.write(`codex:live:mux fatal error: ${formatErrorMessage(error)}\n`);
  process.exitCode = 1;
}

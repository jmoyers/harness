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
import { SqliteEventStore } from '../src/store/event-store.ts';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import { type NormalizedEventEnvelope } from '../src/events/normalized-events.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import {
  classifyPaneAt,
  computeDualPaneLayout,
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
import { ControlPlaneOpQueue } from '../src/mux/control-plane-op-queue.ts';
import {
  projectWorkspaceRailConversation,
} from '../src/mux/workspace-rail-model.ts';
import type { buildWorkspaceRailViewRows } from '../src/mux/workspace-rail-model.ts';
import { buildSelectorIndexEntries } from '../src/mux/selector-index.ts';
import {
  createNewThreadPromptState,
  normalizeThreadAgentType,
  resolveNewThreadPromptAgentByRow,
} from '../src/mux/new-thread-prompt.ts';
import {
  buildProjectPaneSnapshot,
  projectPaneActionAtRow,
  sortedRepositoryList,
  sortTasksByOrder,
  type TaskPaneAction,
} from '../src/mux/harness-core-ui.ts';
import {
  taskFocusedPaneActionAtCell,
  taskFocusedPaneActionAtRow,
  taskFocusedPaneRepositoryIdAtRow,
  taskFocusedPaneTaskIdAtRow,
} from '../src/mux/task-focused-pane.ts';
import {
  createTaskComposerBuffer,
  normalizeTaskComposerBuffer,
  taskFieldsFromComposerText,
  type TaskComposerBuffer,
} from '../src/mux/task-composer.ts';
import {
  resolveTaskScreenKeybindings,
} from '../src/mux/task-screen-keybindings.ts';
import { applyMuxControlPlaneKeyEvent } from '../src/mux/runtime-wiring.ts';
import { StartupSequencer } from '../src/mux/startup-sequencer.ts';
import {
  applyModalOverlay,
  buildRenderRows,
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
import {
  parseRepositoryRecord,
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
import {
  firstDirectoryForRepositoryGroup as firstDirectoryForRepositoryGroupFn,
} from '../src/mux/live-mux/repository-folding.ts';
import {
  readObservedStreamCursorBaseline,
  subscribeObservedStream,
  unsubscribeObservedStream,
} from '../src/mux/live-mux/observed-stream.ts';
import {
  compactDebugText,
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
  pointFromMouseEvent,
  reduceConversationMouseSelection,
  renderSelectionOverlay,
  selectionText,
  selectionVisibleRows,
  type PaneSelectionDrag,
  type PaneSelection,
  writeTextToClipboard,
} from '../src/mux/live-mux/selection.ts';
import { handleTaskPaneShortcutInput as handleTaskPaneShortcutInputFn } from '../src/mux/live-mux/task-pane-shortcuts.ts';
import { handleGlobalShortcut as handleGlobalShortcutFn } from '../src/mux/live-mux/global-shortcut-handlers.ts';
import {
  applyObservedGitStatusEvent as applyObservedGitStatusEventFn,
  deleteDirectoryGitState as deleteDirectoryGitStateFn,
  type GitRepositorySnapshot,
  type GitSummary,
} from '../src/mux/live-mux/git-state.ts';
import { refreshProcessUsageSnapshots as refreshProcessUsageSnapshotsFn } from '../src/mux/live-mux/process-usage.ts';
import {
  resolveDirectoryForAction as resolveDirectoryForActionFn,
} from '../src/mux/live-mux/directory-resolution.ts';
import { requestStop as requestStopFn } from '../src/mux/live-mux/runtime-shutdown.ts';
import { routeInputTokensForConversation as routeInputTokensForConversationFn } from '../src/mux/live-mux/input-forwarding.ts';
import { handleProjectPaneActionClick as handleProjectPaneActionClickFn } from '../src/mux/live-mux/project-pane-pointer.ts';
import {
  handleHomePaneDragMove as handleHomePaneDragMoveFn,
  handleMainPaneWheelInput as handleMainPaneWheelInputFn,
  handlePaneDividerDragInput as handlePaneDividerDragInputFn,
  handleSeparatorPointerPress as handleSeparatorPointerPressFn,
} from '../src/mux/live-mux/pointer-routing.ts';
import { handleHomePaneDragRelease as handleHomePaneDragReleaseFn } from '../src/mux/live-mux/home-pane-drop.ts';
import { handleHomePanePointerClick as handleHomePanePointerClickFn } from '../src/mux/live-mux/home-pane-pointer.ts';
import { runTaskPaneAction as runTaskPaneActionFn } from '../src/mux/live-mux/actions-task.ts';
import {
  archiveRepositoryById as archiveRepositoryByIdFn,
  openRepositoryPromptForCreate as openRepositoryPromptForCreateFn,
  openRepositoryPromptForEdit as openRepositoryPromptForEditFn,
  queueRepositoryPriorityOrder as queueRepositoryPriorityOrderFn,
  reorderRepositoryByDrop as reorderRepositoryByDropFn,
  upsertRepositoryByRemoteUrl as upsertRepositoryByRemoteUrlFn,
} from '../src/mux/live-mux/actions-repository.ts';
import {
  addDirectoryByPath as addDirectoryByPathFn,
  archiveConversation as archiveConversationFn,
  closeDirectory as closeDirectoryFn,
  createAndActivateConversationInDirectory as createAndActivateConversationInDirectoryFn,
  openOrCreateCritiqueConversationInDirectory as openOrCreateCritiqueConversationInDirectoryFn,
  openNewThreadPrompt as openNewThreadPromptFn,
  takeoverConversation as takeoverConversationFn,
} from '../src/mux/live-mux/actions-conversation.ts';
import { toggleGatewayProfiler as toggleGatewayProfilerFn } from '../src/mux/live-mux/gateway-profiler.ts';
import {
  WorkspaceModel,
  type ConversationTitleEditState,
  type RepositoryPromptState,
  type TaskEditorPromptState,
} from '../src/domain/workspace.ts';
import {
  ConversationManager,
  type ConversationSeed,
} from '../src/domain/conversations.ts';
import { RepositoryManager } from '../src/domain/repositories.ts';
import { DirectoryManager } from '../src/domain/directories.ts';
import { TaskManager } from '../src/domain/tasks.ts';
import { ControlPlaneService } from '../src/services/control-plane.ts';
import { Screen, type ScreenCursorStyle } from '../src/ui/screen.ts';
import { ConversationPane } from '../src/ui/panes/conversation.ts';
import { HomePane } from '../src/ui/panes/home.ts';
import { ProjectPane } from '../src/ui/panes/project.ts';
import { LeftRailPane } from '../src/ui/panes/left-rail.ts';
import { ModalManager } from '../src/ui/modals/manager.ts';
import { InputRouter } from '../src/ui/input.ts';
import { RepositoryFoldInput } from '../src/ui/repository-fold-input.ts';
import { LeftNavInput } from '../src/ui/left-nav-input.ts';
import { LeftRailPointerInput } from '../src/ui/left-rail-pointer-input.ts';

type ThreadAgentType = ReturnType<typeof normalizeThreadAgentType>;
type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type ControlPlaneDirectoryRecord = Awaited<ReturnType<ControlPlaneService['upsertDirectory']>>;
type ControlPlaneRepositoryRecord = NonNullable<ReturnType<typeof parseRepositoryRecord>>;
type ControlPlaneTaskRecord = NonNullable<ReturnType<typeof parseTaskRecord>>;

type ProcessUsageSample = Awaited<ReturnType<typeof readProcessUsageSample>>;

interface MuxPerfStatusRow {
  readonly fps: number;
  readonly kbPerSecond: number;
  readonly renderAvgMs: number;
  readonly renderMaxMs: number;
  readonly outputHandleAvgMs: number;
  readonly outputHandleMaxMs: number;
  readonly eventLoopP95Ms: number;
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
const DEBUG_FOOTER_NOTICE_TTL_MS = 8000;
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
  const muxSessionName =
    typeof process.env.HARNESS_SESSION_NAME === 'string' &&
    process.env.HARNESS_SESSION_NAME.trim().length > 0
      ? process.env.HARNESS_SESSION_NAME.trim()
      : null;
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
    'mux.gateway.profile.toggle': [],
    'mux.conversation.new': [],
    'mux.conversation.critique.open-or-create': [],
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
  const configuredCritique = loadedConfig.config.critique;
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
  const configuredCursorLaunch = loadedConfig.config.cursor.launch;
  const cursorLaunchModeByDirectoryPath: Record<string, 'yolo' | 'standard'> = {};
  for (const [directoryPath, mode] of Object.entries(configuredCursorLaunch.directoryModes)) {
    const normalizedDirectoryPath = resolveWorkspacePathForMux(
      options.invocationDirectory,
      directoryPath,
    );
    cursorLaunchModeByDirectoryPath[normalizedDirectoryPath] = mode;
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
        critique: loadedConfig.config.critique,
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
  const controlPlaneService = new ControlPlaneService(streamClient, {
    tenantId: options.scope.tenantId,
    userId: options.scope.userId,
    workspaceId: options.scope.workspaceId,
  });
  const startupObservedCursor = await readObservedStreamCursorBaseline(streamClient, options.scope);
  const directoryUpsertSpan = startPerfSpan('mux.startup.directory-upsert');
  const persistedDirectory = await controlPlaneService.upsertDirectory({
    directoryId: `directory-${options.scope.workspaceId}`,
    path: options.invocationDirectory,
  });
  directoryUpsertSpan.end();
  const workspace = new WorkspaceModel({
    activeDirectoryId: persistedDirectory.directoryId,
    leftNavSelection: {
      kind: 'project',
      directoryId: persistedDirectory.directoryId,
    },
    latestTaskPaneView: {
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    },
    taskDraftComposer: createTaskComposerBuffer(''),
    repositoriesCollapsed: configuredMuxUi.repositoriesCollapsed,
    shortcutsCollapsed: configuredMuxUi.shortcutsCollapsed,
  });
  workspace.repositoryToggleChordPrefixAtMs = null;
  workspace.projectPaneSnapshot = null;
  workspace.projectPaneScrollTop = 0;
  workspace.taskPaneScrollTop = 0;
  workspace.taskPaneSelectedTaskId = null;
  workspace.taskPaneSelectedRepositoryId = null;
  workspace.taskRepositoryDropdownOpen = false;
  workspace.taskEditorTarget = {
    kind: 'draft',
  };
  workspace.taskPaneSelectionFocus = 'task';
  workspace.taskPaneNotice = null;
  workspace.taskPaneTaskEditClickState = null;
  workspace.taskPaneRepositoryEditClickState = null;
  workspace.homePaneDragState = null;

  const sessionEnv = {
    ...sanitizeProcessEnv(),
    TERM: process.env.TERM ?? 'xterm-256color',
  };
  const directoryManager = new DirectoryManager<ControlPlaneDirectoryRecord, GitSummary>();
  directoryManager.setDirectory(persistedDirectory.directoryId, persistedDirectory);
  const _unsafeDirectoryMap = directoryManager.readonlyDirectories();
  const _unsafeDirectoryGitSummaryMap = directoryManager.mutableGitSummaries();
  const repositoryManager = new RepositoryManager<
    ControlPlaneRepositoryRecord,
    GitRepositorySnapshot
  >();
  const repositories = repositoryManager.unsafeMutableRepositories();
  const repositoryAssociationByDirectoryId =
    repositoryManager.unsafeMutableDirectoryAssociations();
  const directoryRepositorySnapshotByDirectoryId =
    repositoryManager.unsafeMutableDirectorySnapshots();
  const muxControllerId = `human-mux-${process.pid}-${randomUUID()}`;
  const muxControllerLabel = `human mux ${process.pid}`;
  const conversationManager = new ConversationManager();
  const _unsafeConversationMap = conversationManager.readonlyMap();
  const taskManager = new TaskManager<ControlPlaneTaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  let observedStreamSubscriptionId: string | null = null;
  let keyEventSubscription: Awaited<ReturnType<typeof subscribeControlPlaneKeyEvents>> | null =
    null;
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
      const conversation = conversationManager.get(event.sessionId);
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

  const resolveActiveDirectoryId = (): string | null => {
    workspace.activeDirectoryId = directoryManager.resolveActiveDirectoryId(workspace.activeDirectoryId);
    return workspace.activeDirectoryId;
  };

  const resolveDirectoryForAction = (): string | null => {
    return resolveDirectoryForActionFn({
      mainPaneMode: workspace.mainPaneMode,
      activeDirectoryId: workspace.activeDirectoryId,
      activeConversationId: conversationManager.activeConversationId,
      conversations: _unsafeConversationMap,
      directoriesHas: (directoryId) => directoryManager.hasDirectory(directoryId),
    });
  };

  const repositoryGroupIdForDirectory = (directoryId: string): string =>
    repositoryManager.repositoryGroupIdForDirectory(directoryId, UNTRACKED_REPOSITORY_GROUP_ID);

  const collapseRepositoryGroup = (repositoryGroupId: string): void => {
    repositoryManager.collapseRepositoryGroup(repositoryGroupId, workspace.repositoriesCollapsed);
  };

  const expandRepositoryGroup = (repositoryGroupId: string): void => {
    repositoryManager.expandRepositoryGroup(repositoryGroupId, workspace.repositoriesCollapsed);
  };

  const toggleRepositoryGroup = (repositoryGroupId: string): void => {
    repositoryManager.toggleRepositoryGroup(repositoryGroupId, workspace.repositoriesCollapsed);
  };

  const collapseAllRepositoryGroups = (): void => {
    workspace.repositoriesCollapsed = repositoryManager.collapseAllRepositoryGroups();
    queuePersistMuxUiState();
  };

  const expandAllRepositoryGroups = (): void => {
    workspace.repositoriesCollapsed = repositoryManager.expandAllRepositoryGroups();
    queuePersistMuxUiState();
  };

  const firstDirectoryForRepositoryGroup = (repositoryGroupId: string): string | null => {
    return firstDirectoryForRepositoryGroupFn(
      _unsafeDirectoryMap,
      repositoryGroupIdForDirectory,
      repositoryGroupId,
    );
  };

  conversationManager.configureEnsureDependencies({
    resolveDefaultDirectoryId: resolveActiveDirectoryId,
    normalizeAdapterState,
    createConversation: (input) =>
      createConversationState(
        input.sessionId,
        input.directoryId,
        input.title,
        input.agentType,
        input.adapterState,
        `turn-${randomUUID()}`,
        options.scope,
        layout.rightCols,
        layout.paneRows,
      ),
  });

  const ensureConversation = (sessionId: string, seed?: ConversationSeed): ConversationState => {
    return conversationManager.ensure(sessionId, seed);
  };

  const applyControlPlaneKeyEvent = (event: ControlPlaneKeyEvent): void => {
    const existing = conversationManager.get(event.sessionId);
    const beforeProjection =
      existing === undefined ? null : projectionSnapshotForConversation(existing);
    const updated = applyMuxControlPlaneKeyEvent(event, {
      removedConversationIds: conversationManager.removedConversationIds,
      ensureConversation,
    });
    if (updated === null) {
      return;
    }
    refreshSelectorInstrumentation(`event:${event.type}`);
    recordProjectionTransition(event, beforeProjection, updated);
  };

  const hydrateDirectoryList = async (): Promise<void> => {
    const rows = await controlPlaneService.listDirectories();
    directoryManager.clearDirectories();
    for (const row of rows) {
      const record = row;
      const normalizedPath = resolveWorkspacePathForMux(options.invocationDirectory, record.path);
      if (normalizedPath !== record.path) {
        const repairedRecord = await controlPlaneService.upsertDirectory({
          directoryId: record.directoryId,
          path: normalizedPath,
        });
        directoryManager.setDirectory(record.directoryId, repairedRecord);
        continue;
      }
      directoryManager.setDirectory(record.directoryId, record);
    }
    if (!directoryManager.hasDirectory(persistedDirectory.directoryId)) {
      directoryManager.setDirectory(persistedDirectory.directoryId, persistedDirectory);
    }
    if (resolveActiveDirectoryId() === null) {
      throw new Error('no active directory available after hydrate');
    }
  };

  const syncRepositoryAssociationsWithDirectorySnapshots = (): void => {
    repositoryManager.syncWithDirectories((directoryId) => directoryManager.hasDirectory(directoryId));
  };

  const hydrateRepositoryList = async (): Promise<void> => {
    const rows = await controlPlaneService.listRepositories();
    repositories.clear();
    for (const record of rows) {
      repositories.set(record.repositoryId, record);
    }
    syncRepositoryAssociationsWithDirectorySnapshots();
  };

  const hydrateDirectoryGitStatus = async (): Promise<void> => {
    if (!configuredMuxGit.enabled) {
      return;
    }
    const rows = await controlPlaneService.listDirectoryGitStatuses();
    for (const record of rows) {
      _unsafeDirectoryGitSummaryMap.set(record.directoryId, record.summary);
      repositoryManager.setDirectoryRepositorySnapshot(record.directoryId, record.repositorySnapshot);
      repositoryManager.setDirectoryRepositoryAssociation(record.directoryId, record.repositoryId);
      if (record.repository !== null) {
        repositoryManager.setRepository(record.repository.repositoryId, record.repository);
      }
    }
    syncRepositoryAssociationsWithDirectorySnapshots();
  };

  const hydratePersistedConversationsForDirectory = async (
    directoryId: string,
  ): Promise<number> => {
    const persistedRows = await controlPlaneService.listConversations(directoryId);
    for (const record of persistedRows) {
      conversationManager.upsertFromPersistedRecord({
        record,
        ensureConversation,
      });
    }
    return persistedRows.length;
  };

  async function subscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await controlPlaneService.subscribePtyEvents(sessionId);
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
        throw error;
      }
    }
  }

  async function unsubscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await controlPlaneService.unsubscribePtyEvents(sessionId);
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
        throw error;
      }
    }
  }

  const startConversation = async (sessionId: string): Promise<ConversationState> => {
    return await conversationManager.runWithStartInFlight(sessionId, async () => {
      const existing = conversationManager.get(sessionId);
      const targetConversation = existing ?? ensureConversation(sessionId);
      const agentType = normalizeThreadAgentType(targetConversation.agentType);
      const baseArgsForAgent =
        agentType === 'codex'
          ? options.codexArgs
          : agentType === 'critique'
            ? configuredCritique.launch.defaultArgs
            : [];
      const configuredDirectoryPath =
        targetConversation.directoryId === null
          ? null
          : (directoryManager.getDirectory(targetConversation.directoryId)?.path ?? null);
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
          cursorLaunchDefaultMode: configuredCursorLaunch.defaultMode,
          cursorLaunchModeByDirectoryPath: cursorLaunchModeByDirectoryPath,
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
      const ptyStartInput: Parameters<ControlPlaneService['startPtySession']>[0] = {
        sessionId,
        args: launchArgs,
        env: sessionEnv,
        cwd: sessionCwd,
        initialCols: layout.rightCols,
        initialRows: layout.paneRows,
        worktreeId: options.scope.worktreeId,
      };
      const terminalForegroundHex = process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex;
      const terminalBackgroundHex = process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex;
      if (terminalForegroundHex !== undefined) {
        ptyStartInput.terminalForegroundHex = terminalForegroundHex;
      }
      if (terminalBackgroundHex !== undefined) {
        ptyStartInput.terminalBackgroundHex = terminalBackgroundHex;
      }
      await controlPlaneService.startPtySession(ptyStartInput);
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
      const statusSummary = await controlPlaneService.getSessionStatus(sessionId);
      if (statusSummary !== null) {
        conversationManager.upsertFromSessionSummary({
          summary: statusSummary,
          ensureConversation,
        });
      }
      await subscribeConversationEvents(sessionId);
      startSpan.end({
        live: state.live,
      });
      return state;
    });
  };

  const queuePersistedConversationsInBackground = (activeSessionId: string | null): number => {
    const ordered = conversationManager.orderedIds();
    let queued = 0;
    for (const sessionId of ordered) {
      if (activeSessionId !== null && sessionId === activeSessionId) {
        continue;
      }
      const conversation = conversationManager.get(sessionId);
      if (conversation === undefined || conversation.live) {
        continue;
      }
      queueBackgroundControlPlaneOp(async () => {
        const latest = conversationManager.get(sessionId);
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
    for (const directoryId of directoryManager.directoryIds()) {
      persistedCount += await hydratePersistedConversationsForDirectory(directoryId);
    }

    const summaries = await controlPlaneService.listSessions({
      worktreeId: options.scope.worktreeId,
      sort: 'started-asc',
    });
    for (const summary of summaries) {
      conversationManager.upsertFromSessionSummary({
        summary,
        ensureConversation,
      });
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
    conversationManager.ensureActiveConversationId();
    if (conversationManager.activeConversationId !== null) {
      workspace.selectLeftNavConversation(conversationManager.activeConversationId);
    }
    const activeDirectoryId = resolveActiveDirectoryId();
    if (conversationManager.activeConversationId === null && activeDirectoryId !== null) {
      workspace.mainPaneMode = 'project';
      workspace.selectLeftNavProject(
        activeDirectoryId,
        repositoryGroupIdForDirectory(activeDirectoryId),
      );
    }
  }

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
    const orderedIds = conversationManager.orderedIds();
    const entries = buildSelectorIndexEntries(_unsafeDirectoryMap, _unsafeConversationMap, orderedIds);
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

  const ensureDirectoryGitState = (directoryId: string): void => {
    directoryManager.ensureGitSummary(directoryId, GIT_SUMMARY_LOADING);
  };

  const deleteDirectoryGitState = (directoryId: string): void => {
    deleteDirectoryGitStateFn(
      directoryId,
      _unsafeDirectoryGitSummaryMap,
      directoryRepositorySnapshotByDirectoryId,
      repositoryAssociationByDirectoryId,
    );
  };

  const syncGitStateWithDirectories = (): void => {
    directoryManager.syncGitSummariesWithDirectories(GIT_SUMMARY_LOADING);
    syncRepositoryAssociationsWithDirectorySnapshots();
  };

  const noteGitActivity = (directoryId: string | null): void => {
    if (directoryId === null || !directoryManager.hasDirectory(directoryId)) {
      return;
    }
    ensureDirectoryGitState(directoryId);
  };

  const applyObservedGitStatusEvent = (observed: StreamObservedEvent): void => {
    const reduced = applyObservedGitStatusEventFn({
      enabled: configuredMuxGit.enabled,
      observed,
      gitSummaryByDirectoryId: _unsafeDirectoryGitSummaryMap,
      loadingSummary: GIT_SUMMARY_LOADING,
      directoryRepositorySnapshotByDirectoryId,
      emptyRepositorySnapshot: GIT_REPOSITORY_NONE,
      repositoryAssociationByDirectoryId,
      repositories,
      parseRepositoryRecord,
      repositoryRecordChanged: (previous, repository) =>
        previous === undefined ||
        previous.name !== repository.name ||
        previous.remoteUrl !== repository.remoteUrl ||
        previous.defaultBranch !== repository.defaultBranch ||
        previous.archivedAt !== repository.archivedAt,
    });
    if (!reduced.handled) {
      return;
    }
    if (reduced.repositoryRecordChanged) {
      syncRepositoryAssociationsWithDirectorySnapshots();
      syncTaskPaneRepositorySelection();
    }
    if (reduced.changed) {
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
      conversations: conversationManager.size(),
    });
    try {
      const refreshed = await refreshProcessUsageSnapshotsFn({
        conversations: _unsafeConversationMap,
        processUsageBySessionId,
        readProcessUsageSample,
        processIdForConversation: (conversation) => conversation.processId,
        processUsageEqual,
      });

      if (refreshed.changed) {
        markDirty();
      }
      usageSpan.end({
        reason,
        samples: refreshed.samples,
        changed: refreshed.changed,
      });
    } finally {
      processUsageRefreshInFlight = false;
    }
  };

  const idFactory = (): string => `event-${randomUUID()}`;
  let exit: PtyExit | null = null;
  const screen = new Screen();
  const conversationPane = new ConversationPane();
  const homePane = new HomePane();
  const projectPane = new ProjectPane();
  const leftRailPane = new LeftRailPane();
  let stop = false;
  let inputRemainder = '';
  let latestRailViewRows: ReturnType<typeof buildWorkspaceRailViewRows> = [];
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
  let debugFooterNotice: { text: string; expiresAtMs: number } | null = null;
  const modalManager = new ModalManager({
    theme: MUX_MODAL_THEME,
    resolveRepositoryName: (repositoryId) => repositories.get(repositoryId)?.name ?? null,
    getNewThreadPrompt: () => newThreadPrompt,
    getAddDirectoryPrompt: () => addDirectoryPrompt,
    getTaskEditorPrompt: () => taskEditorPrompt,
    getRepositoryPrompt: () => repositoryPrompt,
    getConversationTitleEdit: () => conversationTitleEdit,
  });
  let paneDividerDragActive = false;
  let resizeTimer: NodeJS.Timeout | null = null;
  let pendingSize: { cols: number; rows: number } | null = null;
  let lastResizeApplyAtMs = 0;
  let ptyResizeTimer: NodeJS.Timeout | null = null;
  let pendingPtySize: { cols: number; rows: number } | null = null;
  const ptySizeByConversationId = new Map<string, { cols: number; rows: number }>();

  const requestStop = (): void => {
    requestStopFn({
      stop,
      hasConversationTitleEdit: conversationTitleEdit !== null,
      stopConversationTitleEdit: () => stopConversationTitleEdit(true),
      activeTaskEditorTaskId:
        'taskId' in workspace.taskEditorTarget && typeof workspace.taskEditorTarget.taskId === 'string'
          ? workspace.taskEditorTarget.taskId
          : null,
      autosaveTaskIds: [...taskManager.autosaveTaskIds()],
      flushTaskComposerPersist,
      closeLiveSessionsOnClientStop,
      orderedConversationIds: conversationManager.orderedIds(),
      conversations: _unsafeConversationMap,
      queueControlPlaneOp,
      sendSignal: (sessionId, signal) => {
        streamClient.sendSignal(sessionId, signal);
      },
      closeSession: async (sessionId) => {
        await controlPlaneService.closePtySession(sessionId);
      },
      markDirty,
      setStop: (next) => { stop = next; },
    });
  };

  const setDebugFooterNotice = (text: string): void => {
    const normalized = text.trim();
    if (normalized.length === 0) {
      debugFooterNotice = null;
      return;
    }
    debugFooterNotice = {
      text: normalized,
      expiresAtMs: Date.now() + DEBUG_FOOTER_NOTICE_TTL_MS,
    };
  };

  const activeDebugFooterNoticeText = (): string | null => {
    if (debugFooterNotice === null) {
      return null;
    }
    if (Date.now() > debugFooterNotice.expiresAtMs) {
      debugFooterNotice = null;
      return null;
    }
    return debugFooterNotice.text;
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
    screen.clearDirty();
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
        if (screen.isDirty()) {
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
    screen.markDirty();
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
      workspace.repositoriesCollapsed = updated.mux.ui.repositoriesCollapsed;
      workspace.shortcutsCollapsed = updated.mux.ui.shortcutsCollapsed;
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
      repositoriesCollapsed: workspace.repositoriesCollapsed,
      shortcutsCollapsed: workspace.shortcutsCollapsed,
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
    if (workspace.activeDirectoryId !== null) {
      noteGitActivity(workspace.activeDirectoryId);
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
        activeConversationId: conversationManager.activeConversationId ?? 'none',
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
    const conversation = conversationManager.get(sessionId);
    if (conversation === undefined || !conversationManager.isLive(sessionId)) {
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
    const activeConversationId = conversationManager.activeConversationId;
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
    for (const conversation of conversationManager.values()) {
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
    screen.resetFrameCache();
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
        const parsed = await controlPlaneService.updateConversationTitle({
          conversationId: edit.conversationId,
          title: titleToPersist,
        });
        const persistedTitle = parsed?.title ?? titleToPersist;
        const latestConversation = conversationManager.get(edit.conversationId);
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
    const target = conversationManager.get(conversationId);
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
    return modalManager.buildNewThreadOverlay(layout.cols, viewportRows);
  };

  const buildConversationTitleModalOverlay = (
    viewportRows: number,
  ) => {
    return modalManager.buildConversationTitleOverlay(layout.cols, viewportRows);
  };

  const buildCurrentModalOverlay = () => {
    return modalManager.buildCurrentOverlay(layout.cols, layout.rows);
  };

  const dismissModalOnOutsideClick = (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ): boolean => {
    const result = modalManager.dismissOnOutsideClick({
      input,
      inputRemainder,
      layoutCols: layout.cols,
      viewportRows: layout.rows,
      dismiss,
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
    const attachResult = await conversationManager.attachIfLive({
      sessionId,
      attach: async (sinceCursor) => {
        await controlPlaneService.attachPty({
          sessionId,
          sinceCursor,
        });
      },
    });
    if (attachResult.attached && attachResult.sinceCursor !== null) {
      recordPerfEvent('mux.conversation.attach', {
        sessionId,
        sinceCursor: attachResult.sinceCursor,
      });
    }
  };

  const detachConversation = async (sessionId: string): Promise<void> => {
    const detachResult = await conversationManager.detachIfAttached({
      sessionId,
      detach: async () => {
        await controlPlaneService.detachPty(sessionId);
      },
    });
    if (detachResult.detached && detachResult.conversation !== null) {
      recordPerfEvent('mux.conversation.detach', {
        sessionId,
        lastOutputCursor: detachResult.conversation.lastOutputCursor,
      });
    }
  };

  const refreshProjectPaneSnapshot = (directoryId: string): void => {
    const directory = directoryManager.getDirectory(directoryId);
    if (directory === undefined) {
      workspace.projectPaneSnapshot = null;
      return;
    }
    workspace.projectPaneSnapshot = buildProjectPaneSnapshot(directory.directoryId, directory.path);
  };

  const enterProjectPane = (directoryId: string): void => {
    if (!directoryManager.hasDirectory(directoryId)) {
      return;
    }
    workspace.activeDirectoryId = directoryId;
    workspace.selectLeftNavProject(directoryId, repositoryGroupIdForDirectory(directoryId));
    noteGitActivity(directoryId);
    workspace.mainPaneMode = 'project';
    workspace.homePaneDragState = null;
    workspace.taskPaneTaskEditClickState = null;
    workspace.taskPaneRepositoryEditClickState = null;
    workspace.projectPaneScrollTop = 0;
    refreshProjectPaneSnapshot(directoryId);
    screen.resetFrameCache();
  };

  function orderedTaskRecords(): readonly ControlPlaneTaskRecord[] {
    return taskManager.orderedTasks(sortTasksByOrder);
  }

  function orderedActiveRepositoryRecords(): readonly ControlPlaneRepositoryRecord[] {
    return sortedRepositoryList(repositories);
  }

  const taskComposerForTask = (taskId: string): TaskComposerBuffer | null => {
    const existing = taskManager.getTaskComposer(taskId);
    if (existing !== undefined) {
      return existing;
    }
    const task = taskManager.getTask(taskId);
    if (task === undefined) {
      return null;
    }
    return createTaskComposerBuffer(
      task.description.length === 0 ? task.title : `${task.title}\n${task.description}`,
    );
  };

  const setTaskComposerForTask = (taskId: string, buffer: TaskComposerBuffer): void => {
    taskManager.setTaskComposer(taskId, normalizeTaskComposerBuffer(buffer));
  };

  const clearTaskAutosaveTimer = (taskId: string): void => {
    const timer = taskManager.getTaskAutosaveTimer(taskId);
    if (timer !== undefined) {
      clearTimeout(timer);
      taskManager.deleteTaskAutosaveTimer(taskId);
    }
  };

  const selectedRepositoryTaskRecords = (): readonly ControlPlaneTaskRecord[] => {
    return taskManager.tasksForRepository({
      repositoryId: workspace.taskPaneSelectedRepositoryId,
      sortTasks: sortTasksByOrder,
      taskRepositoryId: (task) => task.repositoryId,
    });
  };

  const queuePersistTaskComposer = (taskId: string, reason: string): void => {
    const task = taskManager.getTask(taskId);
    const buffer = taskManager.getTaskComposer(taskId);
    if (task === undefined || buffer === undefined) {
      return;
    }
    const fields = taskFieldsFromComposerText(buffer.text);
    if (fields.title.length === 0) {
      workspace.taskPaneNotice = 'first line is required';
      markDirty();
      return;
    }
    if (fields.title === task.title && fields.description === task.description) {
      return;
    }
    queueControlPlaneOp(async () => {
      const parsed = await controlPlaneService.updateTask({
        taskId,
        repositoryId: task.repositoryId,
        title: fields.title,
        description: fields.description,
      });
      applyTaskRecord(parsed);
      const persistedText =
        parsed.description.length === 0 ? parsed.title : `${parsed.title}\n${parsed.description}`;
      const latestBuffer = taskManager.getTaskComposer(taskId);
      if (latestBuffer !== undefined && latestBuffer.text === persistedText) {
        taskManager.deleteTaskComposer(taskId);
      }
    }, `task-editor-save:${reason}:${taskId}`);
  };

  const scheduleTaskComposerPersist = (taskId: string): void => {
    clearTaskAutosaveTimer(taskId);
    const timer = setTimeout(() => {
      taskManager.deleteTaskAutosaveTimer(taskId);
      queuePersistTaskComposer(taskId, 'debounced');
    }, DEFAULT_TASK_EDITOR_AUTOSAVE_DEBOUNCE_MS);
    timer.unref?.();
    taskManager.setTaskAutosaveTimer(taskId, timer);
  };

  const flushTaskComposerPersist = (taskId: string): void => {
    clearTaskAutosaveTimer(taskId);
    queuePersistTaskComposer(taskId, 'flush');
  };

  const focusDraftComposer = (): void => {
    if ('taskId' in workspace.taskEditorTarget && typeof workspace.taskEditorTarget.taskId === 'string') {
      flushTaskComposerPersist(workspace.taskEditorTarget.taskId);
    }
    workspace.taskEditorTarget = {
      kind: 'draft',
    };
    workspace.taskPaneSelectionFocus = 'task';
    markDirty();
  };

  const focusTaskComposer = (taskId: string): void => {
    if (!taskManager.hasTask(taskId)) {
      return;
    }
    if (workspace.taskEditorTarget.kind === 'task' && workspace.taskEditorTarget.taskId !== taskId) {
      flushTaskComposerPersist(workspace.taskEditorTarget.taskId);
    }
    workspace.taskEditorTarget = {
      kind: 'task',
      taskId,
    };
    workspace.taskPaneSelectedTaskId = taskId;
    workspace.taskPaneSelectionFocus = 'task';
    workspace.taskPaneNotice = null;
    markDirty();
  };

  function syncTaskPaneSelectionFocus(): void {
    const hasTaskSelection =
      workspace.taskPaneSelectedTaskId !== null && taskManager.hasTask(workspace.taskPaneSelectedTaskId);
    const hasRepositorySelection =
      workspace.taskPaneSelectedRepositoryId !== null && repositories.has(workspace.taskPaneSelectedRepositoryId);
    if (workspace.taskPaneSelectionFocus === 'task' && hasTaskSelection) {
      return;
    }
    if (workspace.taskPaneSelectionFocus === 'repository' && hasRepositorySelection) {
      return;
    }
    if (hasTaskSelection) {
      workspace.taskPaneSelectionFocus = 'task';
      return;
    }
    if (hasRepositorySelection) {
      workspace.taskPaneSelectionFocus = 'repository';
      return;
    }
    workspace.taskPaneSelectionFocus = 'task';
  }

  function syncTaskPaneSelection(): void {
    const scopedTaskIds = new Set(selectedRepositoryTaskRecords().map((task) => task.taskId));
    if (workspace.taskPaneSelectedTaskId !== null && !scopedTaskIds.has(workspace.taskPaneSelectedTaskId)) {
      workspace.taskPaneSelectedTaskId = null;
    }
    if (workspace.taskPaneSelectedTaskId === null) {
      const scopedTasks = selectedRepositoryTaskRecords();
      workspace.taskPaneSelectedTaskId = scopedTasks[0]?.taskId ?? null;
    }
    syncTaskPaneSelectionFocus();
    if (workspace.taskEditorTarget.kind === 'task' && !scopedTaskIds.has(workspace.taskEditorTarget.taskId)) {
      focusDraftComposer();
    }
  }

  function syncTaskPaneRepositorySelection(): void {
    if (workspace.taskPaneSelectedRepositoryId !== null) {
      const selectedRepository = repositories.get(workspace.taskPaneSelectedRepositoryId);
      if (selectedRepository === undefined || selectedRepository.archivedAt !== null) {
        workspace.taskPaneSelectedRepositoryId = null;
      }
    }
    if (workspace.taskPaneSelectedRepositoryId === null) {
      workspace.taskPaneSelectedRepositoryId = activeRepositoryIds()[0] ?? null;
    }
    workspace.taskRepositoryDropdownOpen = false;
    syncTaskPaneSelectionFocus();
    syncTaskPaneSelection();
  }

  const selectedTaskRecord = (): ControlPlaneTaskRecord | null => {
    if (workspace.taskPaneSelectedTaskId === null) {
      return null;
    }
    return taskManager.getTask(workspace.taskPaneSelectedTaskId) ?? null;
  };

  const selectTaskById = (taskId: string): void => {
    const taskRecord = taskManager.getTask(taskId);
    if (taskRecord === undefined) {
      return;
    }
    workspace.taskPaneSelectedTaskId = taskId;
    workspace.taskPaneSelectionFocus = 'task';
    if (taskRecord.repositoryId !== null && repositories.has(taskRecord.repositoryId)) {
      workspace.taskPaneSelectedRepositoryId = taskRecord.repositoryId;
    }
    focusTaskComposer(taskId);
  };

  const selectRepositoryById = (repositoryId: string): void => {
    if (!repositories.has(repositoryId)) {
      return;
    }
    if ('taskId' in workspace.taskEditorTarget && typeof workspace.taskEditorTarget.taskId === 'string') {
      flushTaskComposerPersist(workspace.taskEditorTarget.taskId);
    }
    workspace.taskPaneSelectedRepositoryId = repositoryId;
    workspace.taskRepositoryDropdownOpen = false;
    workspace.taskPaneSelectionFocus = 'repository';
    workspace.taskEditorTarget = {
      kind: 'draft',
    };
    syncTaskPaneSelection();
    workspace.taskPaneNotice = null;
    markDirty();
  };

  const activeRepositoryIds = (): readonly string[] => {
    return orderedActiveRepositoryRecords().map((repository) => repository.repositoryId);
  };

  const enterHomePane = (): void => {
    workspace.mainPaneMode = 'home';
    workspace.selectLeftNavHome();
    workspace.projectPaneSnapshot = null;
    workspace.projectPaneScrollTop = 0;
    selection = null;
    selectionDrag = null;
    releaseViewportPinForSelection();
    workspace.taskPaneScrollTop = 0;
    workspace.taskPaneNotice = null;
    workspace.taskRepositoryDropdownOpen = false;
    workspace.taskPaneTaskEditClickState = null;
    workspace.taskPaneRepositoryEditClickState = null;
    workspace.homePaneDragState = null;
    syncTaskPaneSelection();
    syncTaskPaneRepositorySelection();
    screen.resetFrameCache();
    markDirty();
  };

  async function hydrateTaskPlanningState(): Promise<void> {
    repositories.clear();
    for (const repository of await controlPlaneService.listRepositories()) {
      repositories.set(repository.repositoryId, repository);
    }
    syncTaskPaneRepositorySelection();

    taskManager.clearTasks();
    for (const task of await controlPlaneService.listTasks(1000)) {
      taskManager.setTask(task);
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
        taskManager.setTask(task);
        syncTaskPaneSelection();
        markDirty();
      }
      return;
    }
    if (observed.type === 'task-deleted') {
      if (taskManager.deleteTask(observed.taskId)) {
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
        taskManager.setTask(task);
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
    if (conversationManager.activeConversationId === sessionId) {
      if (workspace.mainPaneMode !== 'conversation') {
        workspace.mainPaneMode = 'conversation';
        workspace.selectLeftNavConversation(sessionId);
        screen.resetFrameCache();
        markDirty();
      }
      return;
    }
    if (conversationTitleEdit !== null && conversationTitleEdit.conversationId !== sessionId) {
      stopConversationTitleEdit(true);
    }
    const previousActiveId = conversationManager.activeConversationId;
    selection = null;
    selectionDrag = null;
    releaseViewportPinForSelection();
    if (previousActiveId !== null) {
      await detachConversation(previousActiveId);
    }
    conversationManager.setActiveConversationId(sessionId);
    workspace.mainPaneMode = 'conversation';
    workspace.selectLeftNavConversation(sessionId);
    workspace.homePaneDragState = null;
    workspace.taskPaneTaskEditClickState = null;
    workspace.taskPaneRepositoryEditClickState = null;
    workspace.projectPaneSnapshot = null;
    workspace.projectPaneScrollTop = 0;
    screen.resetFrameCache();
    const targetConversation = conversationManager.get(sessionId);
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
        conversationManager.markSessionUnavailable(sessionId);
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
    conversationManager.remove(sessionId);
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

  const queueTaskReorderByIds = (orderedActiveTaskIds: readonly string[], label: string): void => {
    queueControlPlaneOp(async () => {
      const tasks = await controlPlaneService.reorderTasks(
        taskManager.taskReorderPayloadIds({
          orderedActiveTaskIds,
          sortTasks: sortTasksByOrder,
          isCompleted: (task) => task.status === 'completed',
        }),
      );
      applyTaskList(tasks);
    }, label);
  };

  const openTaskCreatePrompt = (): void => {
    if (workspace.taskPaneSelectedRepositoryId === null || !repositories.has(workspace.taskPaneSelectedRepositoryId)) {
      workspace.taskPaneNotice = 'select a repository first';
      markDirty();
      return;
    }
    focusDraftComposer();
    workspace.taskPaneNotice = null;
    markDirty();
  };

  const openTaskEditPrompt = (taskId: string): void => {
    const task = taskManager.getTask(taskId);
    if (task === undefined) {
      return;
    }
    if (task.repositoryId !== null) {
      workspace.taskPaneSelectedRepositoryId = task.repositoryId;
    }
    focusTaskComposer(task.taskId);
    workspace.taskPaneNotice = null;
    markDirty();
  };

  const applyTaskRecord = (parsed: ControlPlaneTaskRecord): ControlPlaneTaskRecord => {
    taskManager.setTask(parsed);
    workspace.taskPaneSelectedTaskId = parsed.taskId;
    if (parsed.repositoryId !== null && repositories.has(parsed.repositoryId)) {
      workspace.taskPaneSelectedRepositoryId = parsed.repositoryId;
    }
    workspace.taskPaneSelectionFocus = 'task';
    syncTaskPaneSelection();
    markDirty();
    return parsed;
  };

  const applyTaskList = (tasks: readonly ControlPlaneTaskRecord[]): boolean => {
    let changed = false;
    for (const parsed of tasks) {
      taskManager.setTask(parsed);
      changed = true;
    }
    if (changed) {
      syncTaskPaneSelection();
      markDirty();
    }
    return changed;
  };

  const queueRepositoryPriorityOrder = (
    orderedRepositoryIds: readonly string[],
    label: string,
  ): void => {
    queueRepositoryPriorityOrderFn({
      orderedRepositoryIds,
      repositories,
      queueControlPlaneOp,
      updateRepositoryMetadata: async (repositoryId, metadata) => {
        return await controlPlaneService.updateRepository({
          repositoryId,
          metadata,
        });
      },
      upsertRepository: (repository) => {
        repositories.set(repository.repositoryId, repository);
      },
      syncTaskPaneRepositorySelection,
      markDirty,
      label,
    });
  };

  const reorderTaskByDrop = (draggedTaskId: string, targetTaskId: string): void => {
    const reordered = taskManager.reorderedActiveTaskIdsForDrop({
      draggedTaskId,
      targetTaskId,
      sortTasks: sortTasksByOrder,
      isCompleted: (task) => task.status === 'completed',
    });
    if (reordered === 'cannot-reorder-completed') {
      workspace.taskPaneNotice = 'cannot reorder completed tasks';
      markDirty();
      return;
    }
    if (reordered === null) {
      return;
    }
    queueTaskReorderByIds(reordered, 'tasks-reorder-drag');
  };

  const reorderRepositoryByDrop = (
    draggedRepositoryId: string,
    targetRepositoryId: string,
  ): void => {
    reorderRepositoryByDropFn({
      draggedRepositoryId,
      targetRepositoryId,
      orderedRepositoryIds: orderedActiveRepositoryRecords().map(
        (repository) => repository.repositoryId,
      ),
      reorderIdsByMove,
      queueRepositoryPriorityOrder,
    });
  };

  const runTaskPaneAction = (action: TaskPaneAction): void => {
    runTaskPaneActionFn({
      action,
      openTaskCreatePrompt,
      openRepositoryPromptForCreate,
      selectedRepositoryId: workspace.taskPaneSelectedRepositoryId,
      repositoryExists: (repositoryId) => repositories.has(repositoryId),
      setTaskPaneNotice: (notice) => {
        workspace.taskPaneNotice = notice;
      },
      markDirty,
      setTaskPaneSelectionFocus: (focus) => {
        workspace.taskPaneSelectionFocus = focus;
      },
      openRepositoryPromptForEdit,
      queueArchiveRepository: (repositoryId) => {
        queueControlPlaneOp(async () => {
          await archiveRepositoryById(repositoryId);
          syncTaskPaneRepositorySelection();
        }, 'tasks-archive-repository');
      },
      selectedTask: selectedTaskRecord(),
      openTaskEditPrompt,
      queueDeleteTask: (taskId) => {
        queueControlPlaneOp(async () => {
          clearTaskAutosaveTimer(taskId);
          await controlPlaneService.deleteTask(taskId);
          taskManager.deleteTask(taskId);
          taskManager.deleteTaskComposer(taskId);
          if (workspace.taskEditorTarget.kind === 'task' && workspace.taskEditorTarget.taskId === taskId) {
            workspace.taskEditorTarget = {
              kind: 'draft',
            };
          }
          syncTaskPaneSelection();
          markDirty();
        }, 'tasks-delete');
      },
      queueTaskReady: (taskId) => {
        queueControlPlaneOp(async () => {
          applyTaskRecord(await controlPlaneService.taskReady(taskId));
        }, 'tasks-ready');
      },
      queueTaskDraft: (taskId) => {
        queueControlPlaneOp(async () => {
          applyTaskRecord(await controlPlaneService.taskDraft(taskId));
        }, 'tasks-draft');
      },
      queueTaskComplete: (taskId) => {
        queueControlPlaneOp(async () => {
          applyTaskRecord(await controlPlaneService.taskComplete(taskId));
        }, 'tasks-complete');
      },
      orderedTaskRecords,
      queueTaskReorderByIds,
    });
  };

  const openNewThreadPrompt = (directoryId: string): void => {
    openNewThreadPromptFn({
      directoryId,
      directoriesHas: (nextDirectoryId) => directoryManager.hasDirectory(nextDirectoryId),
      clearAddDirectoryPrompt: () => {
        addDirectoryPrompt = null;
      },
      clearRepositoryPrompt: () => {
        repositoryPrompt = null;
      },
      hasConversationTitleEdit: conversationTitleEdit !== null,
      stopConversationTitleEdit: () => {
        stopConversationTitleEdit(true);
      },
      clearConversationTitleEditClickState: () => {
        conversationTitleEditClickState = null;
      },
      createNewThreadPromptState,
      setNewThreadPrompt: (prompt) => {
        newThreadPrompt = prompt;
      },
      markDirty,
    });
  };

  const openRepositoryPromptForCreate = (): void => {
    openRepositoryPromptForCreateFn({
      clearNewThreadPrompt: () => {
        newThreadPrompt = null;
      },
      clearAddDirectoryPrompt: () => {
        addDirectoryPrompt = null;
      },
      hasConversationTitleEdit: conversationTitleEdit !== null,
      stopConversationTitleEdit: () => {
        stopConversationTitleEdit(true);
      },
      clearConversationTitleEditClickState: () => {
        conversationTitleEditClickState = null;
      },
      setRepositoryPrompt: (prompt) => {
        repositoryPrompt = prompt;
      },
      markDirty,
    });
  };

  const openRepositoryPromptForEdit = (repositoryId: string): void => {
    openRepositoryPromptForEditFn({
      repositoryId,
      repositories,
      clearNewThreadPrompt: () => {
        newThreadPrompt = null;
      },
      clearAddDirectoryPrompt: () => {
        addDirectoryPrompt = null;
      },
      hasConversationTitleEdit: conversationTitleEdit !== null,
      stopConversationTitleEdit: () => {
        stopConversationTitleEdit(true);
      },
      clearConversationTitleEditClickState: () => {
        conversationTitleEditClickState = null;
      },
      setRepositoryPrompt: (prompt) => {
        repositoryPrompt = prompt;
      },
      setTaskPaneSelectionFocusRepository: () => {
        workspace.taskPaneSelectionFocus = 'repository';
      },
      markDirty,
    });
  };

  const upsertRepositoryByRemoteUrl = async (
    remoteUrl: string,
    existingRepositoryId?: string,
  ): Promise<void> => {
    await upsertRepositoryByRemoteUrlFn({
      remoteUrl,
      existingRepositoryId: existingRepositoryId ?? null,
      normalizeGitHubRemoteUrl,
      repositoryNameFromGitHubRemoteUrl,
      createRepositoryId: () => `repository-${randomUUID()}`,
      scope: options.scope,
      createRepository: async (payload) => ({
        repository: await controlPlaneService.upsertRepository(payload),
      }),
      updateRepository: async (payload) => ({
        repository: await controlPlaneService.updateRepository(payload),
      }),
      parseRepositoryRecord,
      upsertRepository: (repository) => {
        repositories.set(repository.repositoryId, repository);
      },
      syncRepositoryAssociationsWithDirectorySnapshots,
      syncTaskPaneRepositorySelection,
      markDirty,
    });
  };

  const archiveRepositoryById = async (repositoryId: string): Promise<void> => {
    await archiveRepositoryByIdFn({
      repositoryId,
      archiveRepository: (targetRepositoryId) => controlPlaneService.archiveRepository(targetRepositoryId),
      deleteRepository: (targetRepositoryId) => {
        repositories.delete(targetRepositoryId);
      },
      syncRepositoryAssociationsWithDirectorySnapshots,
      syncTaskPaneRepositorySelection,
      markDirty,
    });
  };

  const createAndActivateConversationInDirectory = async (
    directoryId: string,
    agentType: ThreadAgentType,
  ): Promise<void> => {
    await createAndActivateConversationInDirectoryFn({
      directoryId,
      agentType,
      createConversationId: () => `conversation-${randomUUID()}`,
      createConversationRecord: async (sessionId, targetDirectoryId, targetAgentType) => {
        await controlPlaneService.createConversation({
          conversationId: sessionId,
          directoryId: targetDirectoryId,
          title: '',
          agentType: String(targetAgentType),
          adapterState: {},
        });
      },
      ensureConversation: (sessionId, seed) => {
        ensureConversation(sessionId, seed);
      },
      noteGitActivity,
      startConversation,
      activateConversation,
    });
  };

  const openOrCreateCritiqueConversationInDirectory = async (
    directoryId: string,
  ): Promise<void> => {
    await openOrCreateCritiqueConversationInDirectoryFn({
      directoryId,
      orderedConversationIds: () => conversationManager.orderedIds(),
      conversationById: (sessionId) => {
        const conversation = conversationManager.get(sessionId);
        if (conversation === undefined) {
          return null;
        }
        return {
          directoryId: conversation.directoryId,
          agentType: conversation.agentType,
        };
      },
      activateConversation,
      createAndActivateCritiqueConversationInDirectory: async (targetDirectoryId) => {
        await createAndActivateConversationInDirectory(targetDirectoryId, 'critique');
      },
    });
  };

  const archiveConversation = async (sessionId: string): Promise<void> => {
    await archiveConversationFn({
      sessionId,
      conversations: _unsafeConversationMap,
      closePtySession: async (targetSessionId) => {
        await controlPlaneService.closePtySession(targetSessionId);
      },
      removeSession: async (targetSessionId) => {
        await controlPlaneService.removeSession(targetSessionId);
      },
      isSessionNotFoundError,
      archiveConversationRecord: async (targetSessionId) => {
        await controlPlaneService.archiveConversation(targetSessionId);
      },
      isConversationNotFoundError,
      unsubscribeConversationEvents,
      removeConversationState,
      activeConversationId: conversationManager.activeConversationId,
      setActiveConversationId: (next) => {
        conversationManager.setActiveConversationId(next);
      },
      orderedConversationIds: () => conversationManager.orderedIds(),
      conversationDirectoryId: (targetSessionId) => conversationManager.directoryIdOf(targetSessionId),
      resolveActiveDirectoryId,
      enterProjectPane,
      activateConversation,
      markDirty,
    });
  };

  const takeoverConversation = async (sessionId: string): Promise<void> => {
    await takeoverConversationFn({
      sessionId,
      conversationsHas: (targetSessionId) => conversationManager.has(targetSessionId),
      claimSession: async (targetSessionId) => {
        return await controlPlaneService.claimSession({
          sessionId: targetSessionId,
          controllerId: muxControllerId,
          controllerType: 'human',
          controllerLabel: muxControllerLabel,
          reason: 'human takeover',
          takeover: true,
        });
      },
      applyController: (targetSessionId, controller) => {
        conversationManager.setController(targetSessionId, controller);
      },
      setLastEventNow: (targetSessionId) => {
        conversationManager.setLastEventAt(targetSessionId, new Date().toISOString());
      },
      markDirty,
    });
  };

  const addDirectoryByPath = async (rawPath: string): Promise<void> => {
    await addDirectoryByPathFn({
      rawPath,
      resolveWorkspacePathForMux: (value) =>
        resolveWorkspacePathForMux(options.invocationDirectory, value),
      upsertDirectory: async (path) => {
        return await controlPlaneService.upsertDirectory({
          directoryId: `directory-${randomUUID()}`,
          path,
        });
      },
      setDirectory: (directory) => {
        directoryManager.setDirectory(directory.directoryId, directory);
      },
      directoryIdOf: (directory) => directory.directoryId,
      setActiveDirectoryId: (directoryId) => {
        workspace.activeDirectoryId = directoryId;
      },
      syncGitStateWithDirectories,
      noteGitActivity,
      hydratePersistedConversationsForDirectory,
      findConversationIdByDirectory: (directoryId) =>
        conversationManager.findConversationIdByDirectory(
          directoryId,
          conversationManager.orderedIds(),
        ),
      activateConversation,
      enterProjectPane,
      markDirty,
    });
  };

  const closeDirectory = async (directoryId: string): Promise<void> => {
    await closeDirectoryFn({
      directoryId,
      directoriesHas: (targetDirectoryId) => directoryManager.hasDirectory(targetDirectoryId),
      orderedConversationIds: () => conversationManager.orderedIds(),
      conversationDirectoryId: (sessionId) => conversationManager.directoryIdOf(sessionId),
      conversationLive: (sessionId) => conversationManager.isLive(sessionId),
      closePtySession: async (sessionId) => {
        await controlPlaneService.closePtySession(sessionId);
      },
      archiveConversationRecord: async (sessionId) => {
        await controlPlaneService.archiveConversation(sessionId);
      },
      unsubscribeConversationEvents,
      removeConversationState,
      activeConversationId: conversationManager.activeConversationId,
      setActiveConversationId: (sessionId) => {
        conversationManager.setActiveConversationId(sessionId);
      },
      archiveDirectory: async (targetDirectoryId) => {
        await controlPlaneService.archiveDirectory(targetDirectoryId);
      },
      deleteDirectory: (targetDirectoryId) => {
        directoryManager.deleteDirectory(targetDirectoryId);
      },
      deleteDirectoryGitState,
      projectPaneSnapshotDirectoryId: workspace.projectPaneSnapshot?.directoryId ?? null,
      clearProjectPaneSnapshot: () => {
        workspace.projectPaneSnapshot = null;
        workspace.projectPaneScrollTop = 0;
      },
      directoriesSize: () => directoryManager.directoriesSize(),
      addDirectoryByPath,
      invocationDirectory: options.invocationDirectory,
      activeDirectoryId: workspace.activeDirectoryId,
      setActiveDirectoryId: (targetDirectoryId) => {
        workspace.activeDirectoryId = targetDirectoryId;
      },
      firstDirectoryId: () => directoryManager.firstDirectoryId(),
      noteGitActivity,
      resolveActiveDirectoryId,
      activateConversation,
      enterProjectPane,
      markDirty,
    });
  };

  const toggleGatewayProfiler = async (): Promise<void> => {
    try {
      const result = await toggleGatewayProfilerFn({
        invocationDirectory: options.invocationDirectory,
        sessionName: muxSessionName,
      });
      const scopedMessage =
        muxSessionName === null
          ? `[profile] ${result.message}`
          : `[profile:${muxSessionName}] ${result.message}`;
      workspace.taskPaneNotice = scopedMessage;
      setDebugFooterNotice(scopedMessage);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const scopedMessage =
        muxSessionName === null ? `[profile] ${message}` : `[profile:${muxSessionName}] ${message}`;
      workspace.taskPaneNotice = scopedMessage;
      setDebugFooterNotice(scopedMessage);
    } finally {
      markDirty();
    }
  };

  const pinViewportForSelection = (): void => {
    if (selectionPinnedFollowOutput !== null) {
      return;
    }
    const active = conversationManager.getActiveConversation();
    if (active === null) {
      return;
    }
    const follow = active.oracle.snapshotWithoutHash().viewport.followOutput;
    selectionPinnedFollowOutput = follow;
    if (follow) {
      active.oracle.setFollowOutput(false);
    }
  };

  const releaseViewportPinForSelection = (): void => {
    if (selectionPinnedFollowOutput === null) {
      return;
    }
    const shouldRepin = selectionPinnedFollowOutput;
    selectionPinnedFollowOutput = null;
    if (shouldRepin) {
      const active = conversationManager.getActiveConversation();
      if (active === null) {
        return;
      }
      active.oracle.setFollowOutput(true);
    }
  };

  const render = (): void => {
    if (shuttingDown || !screen.isDirty()) {
      return;
    }
    const projectPaneActive =
      workspace.mainPaneMode === 'project' &&
      workspace.activeDirectoryId !== null &&
      directoryManager.hasDirectory(workspace.activeDirectoryId);
    const homePaneActive = workspace.mainPaneMode === 'home';
    if (!projectPaneActive && !homePaneActive && conversationManager.activeConversationId === null) {
      screen.clearDirty();
      return;
    }
    const renderStartedAtNs = perfNowNs();

    const active = conversationManager.getActiveConversation();
    if (!projectPaneActive && !homePaneActive && active === null) {
      screen.clearDirty();
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
    const orderedIds = conversationManager.orderedIds();
    refreshSelectorInstrumentation('render');
    const rail = leftRailPane.render({
      layout,
      repositories,
      repositoryAssociationByDirectoryId,
      directoryRepositorySnapshotByDirectoryId,
      directories: _unsafeDirectoryMap,
      conversations: _unsafeConversationMap,
      orderedIds,
      activeProjectId: workspace.activeDirectoryId,
      activeRepositoryId: workspace.activeRepositorySelectionId,
      activeConversationId: conversationManager.activeConversationId,
      projectSelectionEnabled: workspace.leftNavSelection.kind === 'project',
      repositorySelectionEnabled: workspace.leftNavSelection.kind === 'repository',
      homeSelectionEnabled: workspace.leftNavSelection.kind === 'home',
      repositoriesCollapsed: workspace.repositoriesCollapsed,
      collapsedRepositoryGroupIds: repositoryManager.readonlyCollapsedRepositoryGroupIds(),
      shortcutsCollapsed: workspace.shortcutsCollapsed,
      gitSummaryByDirectoryId: _unsafeDirectoryGitSummaryMap,
      processUsageBySessionId,
      shortcutBindings,
      loadingGitSummary: GIT_SUMMARY_LOADING,
    });
    latestRailViewRows = rail.viewRows;
    let rightRows: readonly string[] = [];
    workspace.latestTaskPaneView = {
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    };
    if (rightFrame !== null) {
      rightRows = conversationPane.render(rightFrame, layout);
    } else if (homePaneActive) {
      const view = homePane.render({
        layout,
        repositories,
        tasks: taskManager.readonlyTasks(),
        selectedRepositoryId: workspace.taskPaneSelectedRepositoryId,
        repositoryDropdownOpen: workspace.taskRepositoryDropdownOpen,
        editorTarget: workspace.taskEditorTarget,
        draftBuffer: workspace.taskDraftComposer,
        taskBufferById: taskManager.readonlyTaskComposers(),
        notice: workspace.taskPaneNotice,
        scrollTop: workspace.taskPaneScrollTop,
      });
      workspace.taskPaneSelectedRepositoryId = view.selectedRepositoryId;
      workspace.taskPaneScrollTop = view.top;
      workspace.latestTaskPaneView = view;
      rightRows = view.rows;
    } else if (projectPaneActive && workspace.activeDirectoryId !== null) {
      if (workspace.projectPaneSnapshot === null || workspace.projectPaneSnapshot.directoryId !== workspace.activeDirectoryId) {
        refreshProjectPaneSnapshot(workspace.activeDirectoryId);
      }
      if (workspace.projectPaneSnapshot === null) {
        rightRows = projectPane.render({
          layout,
          snapshot: null,
          scrollTop: workspace.projectPaneScrollTop,
        }).rows;
      } else {
        const view = projectPane.render({
          layout,
          snapshot: workspace.projectPaneSnapshot,
          scrollTop: workspace.projectPaneScrollTop,
        });
        workspace.projectPaneScrollTop = view.scrollTop;
        rightRows = view.rows;
      }
    } else {
      rightRows = Array.from({ length: layout.paneRows }, () => ' '.repeat(layout.rightCols));
    }
    const baseStatusFooter =
      !projectPaneActive && !homePaneActive && active !== null
        ? debugFooterForConversation(active)
        : '';
    const statusNotice = activeDebugFooterNoticeText();
    const statusFooter =
      statusNotice === null || statusNotice.length === 0
        ? baseStatusFooter
        : `${baseStatusFooter.length > 0 ? `${baseStatusFooter}  ` : ''}${statusNotice}`;
    const rows = buildRenderRows(layout, rail.ansiRows, rightRows, perfStatusRow, statusFooter);
    const modalOverlay = buildCurrentModalOverlay();
    if (modalOverlay !== null) {
      applyModalOverlay(rows, modalOverlay);
    }
    const selectionOverlay =
      rightFrame === null ? '' : renderSelectionOverlay(layout, rightFrame, renderSelection);
    const flushResult = screen.flush({
      layout,
      rows,
      rightFrame,
      selectionRows,
      selectionOverlay,
      validateAnsi,
    });
    const changedRowCount = flushResult.changedRowCount;

    if (flushResult.wroteOutput) {
      if (
        active !== null &&
        rightFrame !== null &&
        startupFirstPaintTargetSessionId !== null &&
        conversationManager.activeConversationId === startupFirstPaintTargetSessionId &&
        startupSequencer.snapshot().firstOutputObserved &&
        !startupSequencer.snapshot().firstPaintObserved
      ) {
        const glyphCells = visibleGlyphCellCount(active);
        if (startupSequencer.markFirstPaintVisible(startupFirstPaintTargetSessionId, glyphCells)) {
          recordPerfEvent('mux.startup.active-first-visible-paint', {
            sessionId: startupFirstPaintTargetSessionId,
            changedRows: changedRowCount,
            glyphCells,
          });
          endStartupActiveFirstPaintSpan({
            observed: true,
            changedRows: changedRowCount,
            glyphCells,
          });
        }
      }
      if (
        active !== null &&
        rightFrame !== null &&
        startupFirstPaintTargetSessionId !== null &&
        conversationManager.activeConversationId === startupFirstPaintTargetSessionId &&
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
        const recordingCursorStyle: ScreenCursorStyle =
          rightFrame === null ? { shape: 'block', blinking: false } : rightFrame.cursor.style;
        const recordingCursorRow = rightFrame === null ? 0 : rightFrame.cursor.row;
        const recordingCursorCol =
          rightFrame === null
            ? layout.rightStartCol - 1
            : layout.rightStartCol + rightFrame.cursor.col - 1;
        const canonicalFrame = renderCanonicalFrameAnsi(
          rows,
          recordingCursorStyle,
          flushResult.shouldShowCursor,
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
    const renderDurationMs = Number(perfNowNs() - renderStartedAtNs) / 1e6;
    renderSampleCount += 1;
    renderSampleTotalMs += renderDurationMs;
    if (renderDurationMs > renderSampleMaxMs) {
      renderSampleMaxMs = renderDurationMs;
    }
    renderSampleChangedRows += changedRowCount;
  };

  const handleEnvelope = (envelope: StreamServerEnvelope): void => {
    if (envelope.kind === 'pty.output') {
      const outputHandledStartedAtNs = perfNowNs();
      if (conversationManager.isRemoved(envelope.sessionId)) {
        return;
      }
      const chunk = Buffer.from(envelope.chunkBase64, 'base64');
      const outputIngest = conversationManager.ingestOutputChunk({
        sessionId: envelope.sessionId,
        cursor: envelope.cursor,
        chunk,
        ensureConversation,
      });
      const conversation = outputIngest.conversation;
      noteGitActivity(conversation.directoryId);
      outputSampleSessionIds.add(envelope.sessionId);
      if (conversationManager.activeConversationId === envelope.sessionId) {
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
      if (outputIngest.cursorRegressed) {
        recordPerfEvent('mux.output.cursor-regression', {
          sessionId: envelope.sessionId,
          previousCursor: outputIngest.previousCursor,
          cursor: envelope.cursor,
        });
      }
      if (
        startupFirstPaintTargetSessionId !== null &&
        envelope.sessionId === startupFirstPaintTargetSessionId
      ) {
        scheduleStartupSettledProbe(envelope.sessionId);
      }

      const normalized = mapTerminalOutputToNormalizedEvent(chunk, conversation.scope, idFactory);
      enqueuePersistedEvent(normalized);
      conversation.lastEventAt = normalized.ts;
      if (conversationManager.activeConversationId === envelope.sessionId) {
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
      if (conversationManager.isRemoved(envelope.sessionId)) {
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
        conversationManager.markSessionExited({
          sessionId: envelope.sessionId,
          exit: envelope.event.exit,
          exitedAt: new Date().toISOString(),
        });
        ptySizeByConversationId.delete(envelope.sessionId);
      }
      markDirty();
      return;
    }

    if (envelope.kind === 'pty.exit') {
      if (conversationManager.isRemoved(envelope.sessionId)) {
        return;
      }
      const conversation = conversationManager.get(envelope.sessionId);
      if (conversation !== undefined) {
        noteGitActivity(conversation.directoryId);
        exit = envelope.exit;
        conversationManager.markSessionExited({
          sessionId: envelope.sessionId,
          exit: envelope.exit,
          exitedAt: new Date().toISOString(),
        });
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

  const initialActiveId = conversationManager.activeConversationId;
  conversationManager.setActiveConversationId(null);
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
    conversations: conversationManager.size(),
  });
  recordPerfEvent('mux.startup.ready', {
    conversations: conversationManager.size(),
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

  const inputRouter = new InputRouter({
    isModalDismissShortcut: (rawInput) =>
      detectMuxGlobalShortcut(rawInput, modalDismissShortcutBindings) === 'mux.app.quit',
    isArchiveConversationShortcut: (rawInput) => {
      const action = detectMuxGlobalShortcut(rawInput, shortcutBindings);
      return action === 'mux.conversation.archive' || action === 'mux.conversation.delete';
    },
    dismissOnOutsideClick: (rawInput, dismiss, onInsidePointerPress) =>
      dismissModalOnOutsideClick(rawInput, dismiss, onInsidePointerPress),
    buildConversationTitleModalOverlay: () => buildConversationTitleModalOverlay(layout.rows),
    buildNewThreadModalOverlay: () => buildNewThreadModalOverlay(layout.rows),
    resolveNewThreadPromptAgentByRow,
    stopConversationTitleEdit,
    queueControlPlaneOp,
    archiveConversation,
    createAndActivateConversationInDirectory,
    addDirectoryByPath,
    normalizeGitHubRemoteUrl,
    upsertRepositoryByRemoteUrl,
    repositoriesHas: (repositoryId) => repositories.has(repositoryId),
    markDirty,
    conversations: _unsafeConversationMap,
    scheduleConversationTitlePersist,
    getTaskEditorPrompt: () => taskEditorPrompt,
    setTaskEditorPrompt: (next) => {
      taskEditorPrompt = next;
    },
    submitTaskEditorPayload: (payload) => {
      queueControlPlaneOp(async () => {
        try {
          if (payload.mode === 'create') {
            applyTaskRecord(await controlPlaneService.createTask({
              repositoryId: payload.repositoryId,
              title: payload.title,
              description: payload.description,
            }));
          } else {
            if (payload.taskId === null) {
              throw new Error('task edit state missing task id');
            }
            applyTaskRecord(await controlPlaneService.updateTask({
              taskId: payload.taskId,
              repositoryId: payload.repositoryId,
              title: payload.title,
              description: payload.description,
            }));
          }
          taskEditorPrompt = null;
          workspace.taskPaneNotice = null;
        } catch (error: unknown) {
          if (taskEditorPrompt !== null) {
            taskEditorPrompt.error = error instanceof Error ? error.message : String(error);
          } else {
            workspace.taskPaneNotice = error instanceof Error ? error.message : String(error);
          }
        } finally {
          markDirty();
        }
      }, payload.commandLabel);
    },
    getConversationTitleEdit: () => conversationTitleEdit,
    getNewThreadPrompt: () => newThreadPrompt,
    setNewThreadPrompt: (prompt) => {
      newThreadPrompt = prompt;
    },
    getAddDirectoryPrompt: () => addDirectoryPrompt,
    setAddDirectoryPrompt: (next) => {
      addDirectoryPrompt = next;
    },
    getRepositoryPrompt: () => repositoryPrompt,
    setRepositoryPrompt: (next) => {
      repositoryPrompt = next;
    },
  });

  const homeEditorBuffer = (): TaskComposerBuffer => {
    if (workspace.taskEditorTarget.kind === 'task') {
      return taskComposerForTask(workspace.taskEditorTarget.taskId) ?? createTaskComposerBuffer('');
    }
    return workspace.taskDraftComposer;
  };

  const updateHomeEditorBuffer = (next: TaskComposerBuffer): void => {
    if (workspace.taskEditorTarget.kind === 'task') {
      setTaskComposerForTask(workspace.taskEditorTarget.taskId, next);
      scheduleTaskComposerPersist(workspace.taskEditorTarget.taskId);
    } else {
      workspace.taskDraftComposer = normalizeTaskComposerBuffer(next);
    }
    markDirty();
  };

  const selectRepositoryByDirection = (direction: 1 | -1): void => {
    const orderedIds = activeRepositoryIds();
    if (orderedIds.length === 0) {
      return;
    }
    const currentIndex = Math.max(0, orderedIds.indexOf(workspace.taskPaneSelectedRepositoryId ?? ''));
    const nextIndex = Math.max(0, Math.min(orderedIds.length - 1, currentIndex + direction));
    selectRepositoryById(orderedIds[nextIndex]!);
  };

  const submitDraftTaskFromComposer = (): void => {
    const repositoryId = workspace.taskPaneSelectedRepositoryId;
    if (repositoryId === null || !repositories.has(repositoryId)) {
      workspace.taskPaneNotice = 'select a repository first';
      markDirty();
      return;
    }
    const fields = taskFieldsFromComposerText(workspace.taskDraftComposer.text);
    if (fields.title.length === 0) {
      workspace.taskPaneNotice = 'first line is required';
      markDirty();
      return;
    }
    queueControlPlaneOp(async () => {
      const parsed = await controlPlaneService.createTask({
        repositoryId,
        title: fields.title,
        description: fields.description,
      });
      applyTaskRecord(parsed);
      workspace.taskDraftComposer = createTaskComposerBuffer('');
      workspace.taskPaneNotice = null;
      syncTaskPaneSelection();
      markDirty();
    }, 'task-composer-create');
  };

  const moveTaskEditorFocusUp = (): void => {
    if (workspace.taskEditorTarget.kind === 'draft') {
      const scopedTasks = selectedRepositoryTaskRecords();
      const fallback = scopedTasks[scopedTasks.length - 1];
      if (fallback !== undefined) {
        focusTaskComposer(fallback.taskId);
      }
      return;
    }
    const focusedTaskId = workspace.taskEditorTarget.taskId;
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
    return handleTaskPaneShortcutInputFn({
      input,
      mainPaneMode: workspace.mainPaneMode,
      taskScreenKeybindings,
      taskEditorTarget: workspace.taskEditorTarget,
      homeEditorBuffer,
      updateHomeEditorBuffer,
      moveTaskEditorFocusUp,
      focusDraftComposer,
      submitDraftTaskFromComposer,
      runTaskPaneAction: (action) => {
        runTaskPaneAction(action);
      },
      selectRepositoryByDirection,
      getTaskRepositoryDropdownOpen: () => workspace.taskRepositoryDropdownOpen,
      setTaskRepositoryDropdownOpen: (open) => {
        workspace.taskRepositoryDropdownOpen = open;
      },
      markDirty,
    });
  };

  const leftNavInput = new LeftNavInput({
    getLatestRailRows: () => latestRailViewRows,
    getCurrentSelection: () => workspace.leftNavSelection,
    enterHomePane,
    firstDirectoryForRepositoryGroup,
    enterProjectPane,
    setMainPaneProjectMode: () => {
      workspace.mainPaneMode = 'project';
    },
    selectLeftNavRepository: (repositoryGroupId) => {
      workspace.selectLeftNavRepository(repositoryGroupId);
    },
    markDirty,
    directoriesHas: (directoryId) => directoryManager.hasDirectory(directoryId),
    conversationDirectoryId: (sessionId) => conversationManager.directoryIdOf(sessionId),
    queueControlPlaneOp,
    activateConversation,
    conversationsHas: (sessionId) => conversationManager.has(sessionId),
  });
  const repositoryFoldInput = new RepositoryFoldInput({
    getLeftNavSelection: () => workspace.leftNavSelection,
    getRepositoryToggleChordPrefixAtMs: () => workspace.repositoryToggleChordPrefixAtMs,
    setRepositoryToggleChordPrefixAtMs: (value) => {
      workspace.repositoryToggleChordPrefixAtMs = value;
    },
    conversations: _unsafeConversationMap,
    repositoryGroupIdForDirectory,
    collapseRepositoryGroup,
    expandRepositoryGroup,
    collapseAllRepositoryGroups,
    expandAllRepositoryGroups,
    selectLeftNavRepository: (repositoryGroupId) => {
      workspace.selectLeftNavRepository(repositoryGroupId);
    },
    markDirty,
    chordTimeoutMs: REPOSITORY_TOGGLE_CHORD_TIMEOUT_MS,
    collapseAllChordPrefix: REPOSITORY_COLLAPSE_ALL_CHORD_PREFIX,
    nowMs: () => Date.now(),
  });
  const leftRailPointerInput = new LeftRailPointerInput({
    getLatestRailRows: () => latestRailViewRows,
    hasConversationTitleEdit: () => conversationTitleEdit !== null,
    conversationTitleEditConversationId: () => conversationTitleEdit?.conversationId ?? null,
    stopConversationTitleEdit: () => {
      stopConversationTitleEdit(true);
    },
    hasSelection: () => selection !== null || selectionDrag !== null,
    clearSelection: () => {
      selection = null;
      selectionDrag = null;
      releaseViewportPinForSelection();
    },
    activeConversationId: () => conversationManager.activeConversationId,
    repositoriesCollapsed: () => workspace.repositoriesCollapsed,
    clearConversationTitleEditClickState: () => {
      conversationTitleEditClickState = null;
    },
    resolveDirectoryForAction,
    openNewThreadPrompt,
    queueArchiveConversation: (conversationId) => {
      queueControlPlaneOp(async () => {
        await archiveConversation(conversationId);
      }, 'mouse-archive-conversation');
    },
    openAddDirectoryPrompt: () => {
      repositoryPrompt = null;
      addDirectoryPrompt = {
        value: '',
        error: null,
      };
    },
    openRepositoryPromptForCreate,
    repositoryExists: (repositoryId) => repositories.has(repositoryId),
    openRepositoryPromptForEdit,
    queueArchiveRepository: (repositoryId) => {
      queueControlPlaneOp(async () => {
        await archiveRepositoryById(repositoryId);
      }, 'mouse-archive-repository');
    },
    toggleRepositoryGroup,
    selectLeftNavRepository: (repositoryGroupId) => {
      workspace.selectLeftNavRepository(repositoryGroupId);
    },
    expandAllRepositoryGroups,
    collapseAllRepositoryGroups,
    enterHomePane,
    queueCloseDirectory: (directoryId) => {
      queueControlPlaneOp(async () => {
        await closeDirectory(directoryId);
      }, 'mouse-close-directory');
    },
    toggleShortcutsCollapsed: () => {
      workspace.shortcutsCollapsed = !workspace.shortcutsCollapsed;
      queuePersistMuxUiState();
    },
    previousConversationClickState: () => conversationTitleEditClickState,
    setConversationClickState: (next) => {
      conversationTitleEditClickState = next;
    },
    nowMs: () => Date.now(),
    conversationTitleEditDoubleClickWindowMs: CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS,
    isConversationPaneActive: () => workspace.mainPaneMode === 'conversation',
    ensureConversationPaneActive: (conversationId) => {
      workspace.mainPaneMode = 'conversation';
      workspace.selectLeftNavConversation(conversationId);
      workspace.projectPaneSnapshot = null;
      workspace.projectPaneScrollTop = 0;
      screen.resetFrameCache();
    },
    beginConversationTitleEdit,
    queueActivateConversation: (conversationId) => {
      queueControlPlaneOp(async () => {
        await activateConversation(conversationId);
      }, 'mouse-activate-conversation');
    },
    queueActivateConversationAndEdit: (conversationId) => {
      queueControlPlaneOp(async () => {
        await activateConversation(conversationId);
        beginConversationTitleEdit(conversationId);
      }, 'mouse-activate-edit-conversation');
    },
    directoriesHas: (directoryId) => directoryManager.hasDirectory(directoryId),
    enterProjectPane,
    markDirty,
  });

  const onInput = (chunk: Buffer): void => {
    if (shuttingDown) {
      return;
    }
    if (inputRouter.routeModalInput(chunk)) {
      return;
    }

    if (chunk.length === 1 && chunk[0] === 0x1b) {
      if (selection !== null || selectionDrag !== null) {
        selection = null;
        selectionDrag = null;
        releaseViewportPinForSelection();
        markDirty();
      }
      if (workspace.mainPaneMode === 'conversation') {
        const escapeTarget = conversationManager.getActiveConversation();
        if (escapeTarget !== null) {
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
    if (repositoryFoldInput.handleRepositoryFoldChords(focusExtraction.sanitized)) {
      return;
    }
    if (repositoryFoldInput.handleRepositoryTreeArrow(focusExtraction.sanitized)) {
      return;
    }

    const globalShortcut = detectMuxGlobalShortcut(focusExtraction.sanitized, shortcutBindings);
    if (
      handleGlobalShortcutFn({
        shortcut: globalShortcut,
        requestStop,
        resolveDirectoryForAction,
        openNewThreadPrompt,
        openOrCreateCritiqueConversationInDirectory,
        toggleGatewayProfile: async () => {
          await toggleGatewayProfiler();
        },
        resolveConversationForAction: () =>
          workspace.mainPaneMode === 'conversation' ? conversationManager.activeConversationId : null,
        conversationsHas: (sessionId) => conversationManager.has(sessionId),
        queueControlPlaneOp,
        archiveConversation,
        takeoverConversation,
        openAddDirectoryPrompt: () => {
          repositoryPrompt = null;
          addDirectoryPrompt = {
            value: '',
            error: null,
          };
          markDirty();
        },
        resolveClosableDirectoryId: () =>
          workspace.mainPaneMode === 'project' &&
          workspace.activeDirectoryId !== null &&
          directoryManager.hasDirectory(workspace.activeDirectoryId)
            ? workspace.activeDirectoryId
            : null,
        closeDirectory,
        cycleLeftNavSelection: (direction) => {
          leftNavInput.cycleSelection(direction);
        },
      })
    ) {
      return;
    }
    if (handleTaskPaneShortcutInput(focusExtraction.sanitized)) {
      return;
    }

    if (
      workspace.mainPaneMode === 'conversation' &&
      selection !== null &&
      isCopyShortcutInput(focusExtraction.sanitized)
    ) {
      const active = conversationManager.getActiveConversation();
      if (active === null) {
        return;
      }
      const selectedFrame = active.oracle.snapshotWithoutHash();
      const copied = writeTextToClipboard(selectionText(selectedFrame, selection));
      if (copied) {
        markDirty();
      }
      return;
    }

    const parsed = parseMuxInputChunk(inputRemainder, focusExtraction.sanitized);
    inputRemainder = parsed.remainder;

    const inputConversation = conversationManager.getActiveConversation();
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

      if (
        handlePaneDividerDragInputFn({
          paneDividerDragActive,
          isMouseRelease: isMouseRelease(token.event.final),
          isWheelMouseCode: isWheelMouseCode(token.event.code),
          mouseCol: token.event.col,
          setPaneDividerDragActive: (active) => { paneDividerDragActive = active; },
          applyPaneDividerAtCol,
          markDirty,
        })
      ) {
        continue;
      }

      const target = classifyPaneAt(layout, token.event.col, token.event.row);
      if (
        handleHomePaneDragReleaseFn({
          homePaneDragState: workspace.homePaneDragState,
          isMouseRelease: isMouseRelease(token.event.final),
          mainPaneMode: workspace.mainPaneMode,
          target,
          rowIndex: Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1)),
          taskIdAtRow: (index) => taskFocusedPaneTaskIdAtRow(workspace.latestTaskPaneView, index),
          repositoryIdAtRow: (index) => taskFocusedPaneRepositoryIdAtRow(workspace.latestTaskPaneView, index),
          reorderTaskByDrop,
          reorderRepositoryByDrop,
          setHomePaneDragState: (next) => { workspace.homePaneDragState = next; },
          markDirty,
        })
      ) {
        continue;
      }
      if (
        handleSeparatorPointerPressFn({
          target,
          isLeftButtonPress: isLeftButtonPress(token.event.code, token.event.final),
          hasAltModifier: hasAltModifier(token.event.code),
          mouseCol: token.event.col,
          setPaneDividerDragActive: (active) => { paneDividerDragActive = active; },
          applyPaneDividerAtCol,
        })
      ) {
        continue;
      }
      const isMainPaneTarget = target === 'right';
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (
        handleMainPaneWheelInputFn({
          target,
          wheelDelta,
          mainPaneMode: workspace.mainPaneMode,
          onProjectWheel: (delta) => {
            workspace.projectPaneScrollTop = Math.max(0, workspace.projectPaneScrollTop + delta);
          },
          onHomeWheel: (delta) => {
            workspace.taskPaneScrollTop = Math.max(0, workspace.taskPaneScrollTop + delta);
          },
          onConversationWheel: (delta) => {
            if (inputConversation !== null) {
              inputConversation.oracle.scrollViewport(delta);
              snapshotForInput = inputConversation.oracle.snapshotWithoutHash();
            }
          },
          markDirty,
        })
      ) {
        continue;
      }
      if (
        handleHomePaneDragMoveFn({
          homePaneDragState: workspace.homePaneDragState,
          mainPaneMode: workspace.mainPaneMode,
          target,
          isSelectionDrag: isSelectionDrag(token.event.code, token.event.final),
          hasAltModifier: hasAltModifier(token.event.code),
          rowIndex: Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1)),
          setHomePaneDragState: (next) => { workspace.homePaneDragState = next; },
          markDirty,
        })
      ) {
        continue;
      }
      const projectPaneActionClick =
        target === 'right' &&
        workspace.mainPaneMode === 'project' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (
        handleProjectPaneActionClickFn({
          clickEligible: projectPaneActionClick,
          snapshot: workspace.projectPaneSnapshot,
          rightCols: layout.rightCols,
          paneRows: layout.paneRows,
          projectPaneScrollTop: workspace.projectPaneScrollTop,
          rowIndex: Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1)),
          projectPaneActionAtRow,
          openNewThreadPrompt,
          queueCloseDirectory: (directoryId) => {
            queueControlPlaneOp(async () => {
              await closeDirectory(directoryId);
            }, 'project-pane-close-project');
          },
          markDirty,
        })
      ) {
        continue;
      }
      const taskPaneActionClick =
        target === 'right' &&
        workspace.mainPaneMode === 'home' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (
        handleHomePanePointerClickFn({
          clickEligible: taskPaneActionClick,
          paneRows: layout.paneRows,
          rightCols: layout.rightCols,
          rightStartCol: layout.rightStartCol,
          pointerRow: token.event.row,
          pointerCol: token.event.col,
          actionAtCell: (rowIndex, colIndex) =>
            taskFocusedPaneActionAtCell(workspace.latestTaskPaneView, rowIndex, colIndex),
          actionAtRow: (rowIndex) => taskFocusedPaneActionAtRow(workspace.latestTaskPaneView, rowIndex),
          clearTaskEditClickState: () => { workspace.taskPaneTaskEditClickState = null; },
          clearRepositoryEditClickState: () => { workspace.taskPaneRepositoryEditClickState = null; },
          clearHomePaneDragState: () => { workspace.homePaneDragState = null; },
          getTaskRepositoryDropdownOpen: () => workspace.taskRepositoryDropdownOpen,
          setTaskRepositoryDropdownOpen: (open) => { workspace.taskRepositoryDropdownOpen = open; },
          taskIdAtRow: (rowIndex) => taskFocusedPaneTaskIdAtRow(workspace.latestTaskPaneView, rowIndex),
          repositoryIdAtRow: (rowIndex) =>
            taskFocusedPaneRepositoryIdAtRow(workspace.latestTaskPaneView, rowIndex),
          selectTaskById,
          selectRepositoryById,
          runTaskPaneAction,
          nowMs: Date.now(),
          homePaneEditDoubleClickWindowMs: HOME_PANE_EDIT_DOUBLE_CLICK_WINDOW_MS,
          taskEditClickState: workspace.taskPaneTaskEditClickState,
          repositoryEditClickState: workspace.taskPaneRepositoryEditClickState,
          clearTaskPaneNotice: () => { workspace.taskPaneNotice = null; },
          setTaskEditClickState: (next) => { workspace.taskPaneTaskEditClickState = next; },
          setRepositoryEditClickState: (next) => { workspace.taskPaneRepositoryEditClickState = next; },
          setHomePaneDragState: (next) => { workspace.homePaneDragState = next; },
          openTaskEditPrompt,
          openRepositoryPromptForEdit,
          markDirty,
        })
      ) {
        continue;
      }
      const leftPaneConversationSelect =
        target === 'left' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (
        leftRailPointerInput.handlePointerClick({
          clickEligible: leftPaneConversationSelect,
          paneRows: layout.paneRows,
          leftCols: layout.leftCols,
          pointerRow: token.event.row,
          pointerCol: token.event.col,
        })
      ) {
          continue;
      }
      if (snapshotForInput === null || workspace.mainPaneMode !== 'conversation') {
        routedTokens.push(token);
        continue;
      }
      const selectionFrame = snapshotForInput;
      const selectionReduced = reduceConversationMouseSelection({
        selection,
        selectionDrag,
        point: pointFromMouseEvent(layout, selectionFrame, token.event),
        isMainPaneTarget,
        isLeftButtonPress:
          isLeftButtonPress(token.event.code, token.event.final) && !hasAltModifier(token.event.code),
        isSelectionDrag:
          isSelectionDrag(token.event.code, token.event.final) && !hasAltModifier(token.event.code),
        isMouseRelease: isMouseRelease(token.event.final),
        isWheelMouseCode: isWheelMouseCode(token.event.code),
        selectionTextForPane: (nextSelection) => selectionText(selectionFrame, nextSelection),
      });
      selection = selectionReduced.selection;
      selectionDrag = selectionReduced.selectionDrag;
      if (selectionReduced.pinViewport) {
        pinViewportForSelection();
      }
      if (selectionReduced.releaseViewportPin) {
        releaseViewportPinForSelection();
      }
      if (selectionReduced.markDirty) {
        markDirty();
      }
      if (selectionReduced.consumed) {
        continue;
      }

      routedTokens.push(token);
    }

    const { mainPaneScrollRows, forwardToSession } = routeInputTokensForConversationFn({
      tokens: routedTokens,
      mainPaneMode: workspace.mainPaneMode,
      normalizeMuxKeyboardInputForPty,
      classifyPaneAt: (col, row) => classifyPaneAt(layout, col, row),
      wheelDeltaRowsFromCode,
    });

    if (mainPaneScrollRows !== 0 && inputConversation !== null) {
      inputConversation.oracle.scrollViewport(mainPaneScrollRows);
      markDirty();
    }

    if (inputConversation === null) {
      return;
    }
    if (
      inputConversation.controller !== null &&
      !conversationManager.isControlledByLocalHuman({
        conversation: inputConversation,
        controllerId: muxControllerId,
      })
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
    screen.clearDirty();
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
    if ('taskId' in workspace.taskEditorTarget && typeof workspace.taskEditorTarget.taskId === 'string') {
      flushTaskComposerPersist(workspace.taskEditorTarget.taskId);
    }
    for (const taskId of taskManager.autosaveTaskIds()) {
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

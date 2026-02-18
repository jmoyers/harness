import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import type { PtyExit } from '../src/pty/pty_host.ts';
import {
  computeDualPaneLayout,
} from '../src/mux/dual-pane-core.ts';
import { loadHarnessConfig, updateHarnessMuxUiConfig } from '../src/config/config-core.ts';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import {
  detectMuxGlobalShortcut,
  resolveMuxShortcutBindings,
} from '../src/mux/input-shortcuts.ts';
import { createMuxInputModeManager } from '../src/mux/terminal-input-modes.ts';
import { ControlPlaneOpQueue } from '../src/mux/control-plane-op-queue.ts';
import type { buildWorkspaceRailViewRows } from '../src/mux/workspace-rail-model.ts';
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
  createConversationState,
  debugFooterForConversation,
  formatCommandForDebugBar,
  launchCommandForAgent,
  type ConversationState,
} from '../src/mux/live-mux/conversation-state.ts';
import {
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
  isCopyShortcutInput,
  renderSelectionOverlay,
  selectionText,
  selectionVisibleRows,
  type PaneSelectionDrag,
  type PaneSelection,
  writeTextToClipboard,
} from '../src/mux/live-mux/selection.ts';
import { handleTaskPaneShortcutInput as handleTaskPaneShortcutInputFn } from '../src/mux/live-mux/task-pane-shortcuts.ts';
import {
  applyObservedGitStatusEvent as applyObservedGitStatusEventFn,
  deleteDirectoryGitState as deleteDirectoryGitStateFn,
  type GitRepositorySnapshot,
  type GitSummary,
} from '../src/mux/live-mux/git-state.ts';
import {
  resolveDirectoryForAction as resolveDirectoryForActionFn,
} from '../src/mux/live-mux/directory-resolution.ts';
import { requestStop as requestStopFn } from '../src/mux/live-mux/runtime-shutdown.ts';
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
  openNewThreadPrompt as openNewThreadPromptFn,
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
import { ConversationStartupHydrationService } from '../src/services/conversation-startup-hydration.ts';
import { DirectoryHydrationService } from '../src/services/directory-hydration.ts';
import { EventPersistence } from '../src/services/event-persistence.ts';
import { MuxUiStatePersistence } from '../src/services/mux-ui-state-persistence.ts';
import { OutputLoadSampler } from '../src/services/output-load-sampler.ts';
import { ProcessUsageRefreshService } from '../src/services/process-usage-refresh.ts';
import { RecordingService } from '../src/services/recording.ts';
import { SessionProjectionInstrumentation } from '../src/services/session-projection-instrumentation.ts';
import { StartupBackgroundProbeService } from '../src/services/startup-background-probe.ts';
import { StartupBackgroundResumeService } from '../src/services/startup-background-resume.ts';
import { StartupOutputTracker } from '../src/services/startup-output-tracker.ts';
import { StartupPaintTracker } from '../src/services/startup-paint-tracker.ts';
import { RuntimeProcessWiring } from '../src/services/runtime-process-wiring.ts';
import { RuntimeConversationActions } from '../src/services/runtime-conversation-actions.ts';
import { RuntimeConversationActivation } from '../src/services/runtime-conversation-activation.ts';
import { RuntimeConversationStarter } from '../src/services/runtime-conversation-starter.ts';
import { RuntimeDirectoryActions } from '../src/services/runtime-directory-actions.ts';
import { RuntimeRenderLifecycle } from '../src/services/runtime-render-lifecycle.ts';
import { RuntimeShutdownService } from '../src/services/runtime-shutdown.ts';
import { TaskPaneSelectionActions } from '../src/services/task-pane-selection-actions.ts';
import { TaskPlanningHydrationService } from '../src/services/task-planning-hydration.ts';
import { TaskPlanningObservedEvents } from '../src/services/task-planning-observed-events.ts';
import { StartupShutdownService } from '../src/services/startup-shutdown.ts';
import { StartupSettledGate } from '../src/services/startup-settled-gate.ts';
import { StartupSpanTracker } from '../src/services/startup-span-tracker.ts';
import { StartupVisibility } from '../src/services/startup-visibility.ts';
import { Screen, type ScreenCursorStyle } from '../src/ui/screen.ts';
import { ConversationPane } from '../src/ui/panes/conversation.ts';
import { DebugFooterNotice } from '../src/ui/debug-footer-notice.ts';
import { HomePane } from '../src/ui/panes/home.ts';
import { ProjectPane } from '../src/ui/panes/project.ts';
import { LeftRailPane } from '../src/ui/panes/left-rail.ts';
import { ModalManager } from '../src/ui/modals/manager.ts';
import { InputRouter } from '../src/ui/input.ts';
import { RepositoryFoldInput } from '../src/ui/repository-fold-input.ts';
import { LeftNavInput } from '../src/ui/left-nav-input.ts';
import { LeftRailPointerInput } from '../src/ui/left-rail-pointer-input.ts';
import { MainPanePointerInput } from '../src/ui/main-pane-pointer-input.ts';
import { PointerRoutingInput } from '../src/ui/pointer-routing-input.ts';
import { ConversationSelectionInput } from '../src/ui/conversation-selection-input.ts';
import { GlobalShortcutInput } from '../src/ui/global-shortcut-input.ts';
import { InputTokenRouter } from '../src/ui/input-token-router.ts';
import { ConversationInputForwarder } from '../src/ui/conversation-input-forwarder.ts';
import { InputPreflight } from '../src/ui/input-preflight.ts';

type ThreadAgentType = ReturnType<typeof normalizeThreadAgentType>;
type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type ControlPlaneDirectoryRecord = Awaited<ReturnType<ControlPlaneService['upsertDirectory']>>;
type ControlPlaneRepositoryRecord = NonNullable<ReturnType<typeof parseRepositoryRecord>>;
type ControlPlaneTaskRecord = NonNullable<ReturnType<typeof parseTaskRecord>>;
type ControlPlaneSessionSummary = NonNullable<
  Awaited<ReturnType<ControlPlaneService['getSessionStatus']>>
>;

type ProcessUsageSample = Awaited<ReturnType<typeof readProcessUsageSample>>;

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
    mkdirSync(dirname(options.recordingPath), { recursive: true });
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
  const recordingService = new RecordingService({
    recordingWriter: muxRecordingWriter,
    recordingPath: options.recordingPath,
    recordingGifOutputPath: options.recordingGifOutputPath,
    renderTerminalRecordingToGif,
    writeStderr: (text) => {
      process.stderr.write(text);
    },
  });
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
  const startupSequencer = new StartupSequencer({
    quietMs: startupSettleQuietMs,
    nonemptyFallbackMs: DEFAULT_STARTUP_SETTLE_NONEMPTY_FALLBACK_MS,
  });
  const startupSpanTracker = new StartupSpanTracker(startPerfSpan, startupSettleQuietMs);
  const startupVisibility = new StartupVisibility();
  const startupSettledGate = new StartupSettledGate({
    startupSequencer,
    startupSpanTracker,
    getConversation: (sessionId) => conversationManager.get(sessionId),
    visibleGlyphCellCount: (conversation) => startupVisibility.visibleGlyphCellCount(conversation),
    recordPerfEvent,
  });
  const startupOutputTracker = new StartupOutputTracker({
    startupSequencer,
    startupSpanTracker,
    recordPerfEvent,
  });
  const startupPaintTracker = new StartupPaintTracker({
    startupSequencer,
    startupSpanTracker,
    startupVisibility,
    startupSettledGate,
    recordPerfEvent,
  });
  const startupShutdownService = new StartupShutdownService({
    startupSequencer,
    startupSpanTracker,
    startupSettledGate,
  });

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
      existing === undefined ? null : sessionProjectionInstrumentation.snapshotForConversation(existing);
    const updated = applyMuxControlPlaneKeyEvent(event, {
      removedConversationIds: conversationManager.removedConversationIds,
      ensureConversation,
    });
    if (updated === null) {
      return;
    }
    sessionProjectionInstrumentation.refreshSelectorSnapshot(
      `event:${event.type}`,
      _unsafeDirectoryMap,
      _unsafeConversationMap,
      conversationManager.orderedIds(),
    );
    sessionProjectionInstrumentation.recordTransition(event, beforeProjection, updated);
  };

  const directoryHydrationService = new DirectoryHydrationService<ControlPlaneDirectoryRecord>({
    controlPlaneService,
    resolveWorkspacePathForMux: (rawPath) =>
      resolveWorkspacePathForMux(options.invocationDirectory, rawPath),
    clearDirectories: () => {
      directoryManager.clearDirectories();
    },
    setDirectory: (directoryId, directory) => {
      directoryManager.setDirectory(directoryId, directory);
    },
    hasDirectory: (directoryId) => directoryManager.hasDirectory(directoryId),
    persistedDirectory,
    resolveActiveDirectoryId,
  });

  const hydrateDirectoryList = async (): Promise<void> => {
    await directoryHydrationService.hydrate();
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

  const runtimeConversationStarter =
    new RuntimeConversationStarter<ConversationState, ControlPlaneSessionSummary>({
    runWithStartInFlight: async (sessionId, run) => {
      return await conversationManager.runWithStartInFlight(sessionId, run);
    },
    conversationById: (sessionId) => conversationManager.get(sessionId),
    ensureConversation,
    normalizeThreadAgentType,
    codexArgs: options.codexArgs,
    critiqueDefaultArgs: configuredCritique.launch.defaultArgs,
    sessionCwdForConversation: (conversation) => {
      const configuredDirectoryPath =
        conversation.directoryId === null
          ? null
          : (directoryManager.getDirectory(conversation.directoryId)?.path ?? null);
      return resolveWorkspacePathForMux(
        options.invocationDirectory,
        configuredDirectoryPath ?? options.invocationDirectory,
      );
    },
    buildLaunchArgs: (input) => {
      return buildAgentSessionStartArgs(
        input.agentType,
        input.baseArgsForAgent,
        input.adapterState,
        {
          directoryPath: input.sessionCwd,
          codexLaunchDefaultMode: configuredCodexLaunch.defaultMode,
          codexLaunchModeByDirectoryPath: codexLaunchModeByDirectoryPath,
          claudeLaunchDefaultMode: configuredClaudeLaunch.defaultMode,
          claudeLaunchModeByDirectoryPath: claudeLaunchModeByDirectoryPath,
          cursorLaunchDefaultMode: configuredCursorLaunch.defaultMode,
          cursorLaunchModeByDirectoryPath: cursorLaunchModeByDirectoryPath,
        },
      );
    },
    launchCommandForAgent,
    formatCommandForDebugBar,
    startConversationSpan: (sessionId) =>
      startPerfSpan('mux.conversation.start', {
        sessionId,
      }),
    firstPaintTargetSessionId: () => startupSpanTracker.firstPaintTargetSessionId,
    endStartCommandSpan: (input) => {
      startupSpanTracker.endStartCommandSpan(input);
    },
    layout: () => layout,
    startPtySession: async (input) => {
      await controlPlaneService.startPtySession(input);
    },
    setPtySize: (sessionId, size) => {
      ptySizeByConversationId.set(sessionId, size);
    },
    sendResize: (sessionId, cols, rows) => {
      streamClient.sendResize(sessionId, cols, rows);
    },
    sessionEnv,
    worktreeId: options.scope.worktreeId,
    terminalForegroundHex: process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex,
    terminalBackgroundHex: process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex,
    recordStartCommand: (sessionId, launchArgs) => {
      recordPerfEvent('mux.conversation.start.command', {
        sessionId,
        argCount: launchArgs.length,
        resumed: launchArgs[0] === 'resume',
      });
    },
    getSessionStatus: async (sessionId) => {
      return await controlPlaneService.getSessionStatus(sessionId);
    },
    upsertFromSessionSummary: (summary) => {
      conversationManager.upsertFromSessionSummary({
        summary,
        ensureConversation,
      });
    },
    subscribeConversationEvents,
  });

  const startConversation = async (sessionId: string): Promise<ConversationState> => {
    return await runtimeConversationStarter.startConversation(sessionId);
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

  const conversationStartupHydrationService = new ConversationStartupHydrationService({
    startHydrationSpan: () => startPerfSpan('mux.startup.hydrate-conversations'),
    hydrateDirectoryList,
    directoryIds: () => directoryManager.directoryIds(),
    hydratePersistedConversationsForDirectory,
    listSessions: async () => {
      return await controlPlaneService.listSessions({
        worktreeId: options.scope.worktreeId,
        sort: 'started-asc',
      });
    },
    upsertFromSessionSummary: (summary) => {
      conversationManager.upsertFromSessionSummary({
        summary,
        ensureConversation,
      });
    },
    subscribeConversationEvents,
  });

  const hydrateConversationList = async (): Promise<void> => {
    await conversationStartupHydrationService.hydrateConversationList();
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
  let shuttingDown = false;
  let selection: PaneSelection | null = null;
  let selectionDrag: PaneSelectionDrag | null = null;
  let selectionPinnedFollowOutput: boolean | null = null;
  let repositoryPrompt: RepositoryPromptState | null = null;
  let newThreadPrompt: NewThreadPromptState | null = null;
  let addDirectoryPrompt: { value: string; error: string | null } | null = null;
  let taskEditorPrompt: TaskEditorPromptState | null = null;
  let conversationTitleEdit: ConversationTitleEditState | null = null;
  let conversationTitleEditClickState: { conversationId: string; atMs: number } | null = null;
  const debugFooterNotice = new DebugFooterNotice({
    ttlMs: DEBUG_FOOTER_NOTICE_TTL_MS,
  });
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

  const runtimeRenderLifecycle = new RuntimeRenderLifecycle({
    screen,
    render: () => {
      render();
    },
    isShuttingDown: () => shuttingDown,
    setShuttingDown: (next) => {
      shuttingDown = next;
    },
    setStop: (next) => {
      stop = next;
    },
    restoreTerminalState: () => {
      restoreTerminalState(true, inputModeManager.restore);
    },
    formatErrorMessage,
    writeStderr: (text) => process.stderr.write(text),
    exitProcess: (code) => {
      process.exit(code);
    },
  });
  const handleRuntimeFatal = (origin: string, error: unknown): void => {
    runtimeRenderLifecycle.handleRuntimeFatal(origin, error);
  };
  const scheduleRender = (): void => {
    runtimeRenderLifecycle.scheduleRender();
  };
  const markDirty = (): void => {
    runtimeRenderLifecycle.markDirty();
  };
  const processUsageRefreshService = new ProcessUsageRefreshService<
    ConversationState,
    ProcessUsageSample
  >({
    readProcessUsageSample,
    processIdForConversation: (conversation) => conversation.processId,
    processUsageEqual: (left, right) =>
      left.cpuPercent === right.cpuPercent && left.memoryMb === right.memoryMb,
    startPerfSpan,
    onChanged: markDirty,
  });
  const sessionProjectionInstrumentation = new SessionProjectionInstrumentation({
    getProcessUsageSample: (sessionId) => processUsageRefreshService.getSample(sessionId),
    recordPerfEvent,
  });
  sessionProjectionInstrumentation.refreshSelectorSnapshot(
    'startup',
    _unsafeDirectoryMap,
    _unsafeConversationMap,
    conversationManager.orderedIds(),
  );

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

  const muxUiStatePersistence = new MuxUiStatePersistence({
    enabled: loadedConfig.error === null,
    initialState: {
      paneWidthPercent: paneWidthPercentFromLayout(layout),
      repositoriesCollapsed: configuredMuxUi.repositoriesCollapsed,
      shortcutsCollapsed: configuredMuxUi.shortcutsCollapsed,
    },
    debounceMs: UI_STATE_PERSIST_DEBOUNCE_MS,
    persistState: (pending) => {
      const updated = updateHarnessMuxUiConfig(pending, {
        filePath: loadedConfig.filePath,
      });
      return {
        paneWidthPercent:
          updated.mux.ui.paneWidthPercent === null
            ? paneWidthPercentFromLayout(layout)
            : updated.mux.ui.paneWidthPercent,
        repositoriesCollapsed: updated.mux.ui.repositoriesCollapsed,
        shortcutsCollapsed: updated.mux.ui.shortcutsCollapsed,
      };
    },
    applyState: (state) => {
      workspace.repositoriesCollapsed = state.repositoriesCollapsed;
      workspace.shortcutsCollapsed = state.shortcutsCollapsed;
    },
    writeStderr: (text) => process.stderr.write(text),
  });
  const persistMuxUiStateNow = (): void => {
    muxUiStatePersistence.persistNow();
  };
  const queuePersistMuxUiState = (): void => {
    muxUiStatePersistence.queue({
      paneWidthPercent: paneWidthPercentFromLayout(layout),
      repositoriesCollapsed: workspace.repositoriesCollapsed,
      shortcutsCollapsed: workspace.shortcutsCollapsed,
    });
  };

  const startupBackgroundProbeService = new StartupBackgroundProbeService({
    enabled: backgroundProbesEnabled,
    maxWaitMs: DEFAULT_BACKGROUND_START_MAX_WAIT_MS,
    isShuttingDown: () => shuttingDown,
    waitForSettled: () => startupSequencer.waitForSettled(),
    settledObserved: () => startupSequencer.snapshot().settledObserved,
    refreshProcessUsage: (reason) =>
      void processUsageRefreshService.refresh(reason, _unsafeConversationMap),
    recordPerfEvent,
  });
  const startupBackgroundResumeService = new StartupBackgroundResumeService({
    enabled: backgroundResumePersisted,
    maxWaitMs: DEFAULT_BACKGROUND_START_MAX_WAIT_MS,
    waitForSettled: () => startupSequencer.waitForSettled(),
    settledObserved: () => startupSequencer.snapshot().settledObserved,
    queuePersistedConversationsInBackground,
    recordPerfEvent,
  });
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
  startupBackgroundProbeService.recordWaitPhase();
  void startupBackgroundProbeService.startWhenSettled();

  const eventPersistence = new EventPersistence({
    appendEvents: (events) => store.appendEvents(events),
    startPerfSpan,
    writeStderr: (text) => process.stderr.write(text),
  });
  const outputLoadSampler = new OutputLoadSampler({
    recordPerfEvent,
    getControlPlaneQueueMetrics: () => controlPlaneQueue.metrics(),
    getActiveConversationId: () => conversationManager.activeConversationId,
    getPendingPersistedEvents: () => eventPersistence.pendingCount(),
    onStatusRowChanged: markDirty,
  });
  outputLoadSampler.start();

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
    workspace.enterProjectPane(directoryId, repositoryGroupIdForDirectory(directoryId));
    noteGitActivity(directoryId);
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

  const activeRepositoryIds = (): readonly string[] => {
    return orderedActiveRepositoryRecords().map((repository) => repository.repositoryId);
  };

  const taskPaneSelectionActions = new TaskPaneSelectionActions<ControlPlaneTaskRecord>({
    workspace,
    taskRecordById: (taskId) => taskManager.getTask(taskId),
    hasTask: (taskId) => taskManager.hasTask(taskId),
    hasRepository: (repositoryId) => repositories.has(repositoryId),
    repositoryById: (repositoryId) => repositories.get(repositoryId),
    selectedRepositoryTasks: selectedRepositoryTaskRecords,
    activeRepositoryIds,
    flushTaskComposerPersist,
    markDirty,
  });

  const syncTaskPaneSelection = (): void => {
    taskPaneSelectionActions.syncTaskPaneSelection();
  };

  const syncTaskPaneRepositorySelection = (): void => {
    taskPaneSelectionActions.syncTaskPaneRepositorySelection();
  };

  const focusDraftComposer = (): void => {
    taskPaneSelectionActions.focusDraftComposer();
  };

  const focusTaskComposer = (taskId: string): void => {
    taskPaneSelectionActions.focusTaskComposer(taskId);
  };

  const selectedTaskRecord = (): ControlPlaneTaskRecord | null => {
    if (workspace.taskPaneSelectedTaskId === null) {
      return null;
    }
    return taskManager.getTask(workspace.taskPaneSelectedTaskId) ?? null;
  };

  const selectTaskById = (taskId: string): void => {
    taskPaneSelectionActions.selectTaskById(taskId);
  };

  const selectRepositoryById = (repositoryId: string): void => {
    taskPaneSelectionActions.selectRepositoryById(repositoryId);
  };

  const enterHomePane = (): void => {
    workspace.enterHomePane();
    selection = null;
    selectionDrag = null;
    releaseViewportPinForSelection();
    syncTaskPaneSelection();
    syncTaskPaneRepositorySelection();
    screen.resetFrameCache();
    markDirty();
  };

  const taskPlanningHydrationService = new TaskPlanningHydrationService<
    ControlPlaneRepositoryRecord,
    ControlPlaneTaskRecord
  >({
    controlPlaneService,
    clearRepositories: () => {
      repositories.clear();
    },
    setRepository: (repository) => {
      repositories.set(repository.repositoryId, repository);
    },
    syncTaskPaneRepositorySelection,
    clearTasks: () => {
      taskManager.clearTasks();
    },
    setTask: (task) => {
      taskManager.setTask(task);
    },
    syncTaskPaneSelection,
    markDirty,
    taskLimit: 1000,
  });

  async function hydrateTaskPlanningState(): Promise<void> {
    await taskPlanningHydrationService.hydrate();
  }

  const taskPlanningObservedEvents = new TaskPlanningObservedEvents<
    ControlPlaneRepositoryRecord,
    ControlPlaneTaskRecord
  >({
    parseRepositoryRecord,
    parseTaskRecord,
    getRepository: (repositoryId) => repositories.get(repositoryId),
    setRepository: (repositoryId, repository) => {
      repositories.set(repositoryId, repository);
    },
    setTask: (task) => {
      taskManager.setTask(task);
    },
    deleteTask: (taskId) => taskManager.deleteTask(taskId),
    syncTaskPaneRepositorySelection,
    syncTaskPaneSelection,
    markDirty,
  });

  const applyObservedTaskPlanningEvent = (observed: StreamObservedEvent): void => {
    taskPlanningObservedEvents.apply(observed);
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

  const runtimeConversationActivation = new RuntimeConversationActivation({
    getActiveConversationId: () => conversationManager.activeConversationId,
    setActiveConversationId: (sessionId) => {
      conversationManager.setActiveConversationId(sessionId);
    },
    isConversationPaneMode: () => workspace.mainPaneMode === 'conversation',
    enterConversationPaneForActiveSession: (sessionId) => {
      workspace.mainPaneMode = 'conversation';
      workspace.selectLeftNavConversation(sessionId);
      screen.resetFrameCache();
    },
    enterConversationPaneForSessionSwitch: (sessionId) => {
      workspace.mainPaneMode = 'conversation';
      workspace.selectLeftNavConversation(sessionId);
      workspace.homePaneDragState = null;
      workspace.taskPaneTaskEditClickState = null;
      workspace.taskPaneRepositoryEditClickState = null;
      workspace.projectPaneSnapshot = null;
      workspace.projectPaneScrollTop = 0;
      screen.resetFrameCache();
    },
    stopConversationTitleEditForOtherSession: (sessionId) => {
      if (conversationTitleEdit !== null && conversationTitleEdit.conversationId !== sessionId) {
        stopConversationTitleEdit(true);
      }
    },
    clearSelectionState: () => {
      selection = null;
      selectionDrag = null;
      releaseViewportPinForSelection();
    },
    detachConversation,
    conversationById: (sessionId) => conversationManager.get(sessionId),
    noteGitActivity,
    startConversation,
    attachConversation,
    isSessionNotFoundError,
    isSessionNotLiveError,
    markSessionUnavailable: (sessionId) => {
      conversationManager.markSessionUnavailable(sessionId);
    },
    schedulePtyResizeImmediate: () => {
      schedulePtyResize(
        {
          cols: layout.rightCols,
          rows: layout.paneRows,
        },
        true,
      );
    },
    markDirty,
  });
  const activateConversation = async (sessionId: string): Promise<void> => {
    await runtimeConversationActivation.activateConversation(sessionId);
  };

  const removeConversationState = (sessionId: string): void => {
    if (conversationTitleEdit?.conversationId === sessionId) {
      stopConversationTitleEdit(false);
    }
    conversationManager.remove(sessionId);
    ptySizeByConversationId.delete(sessionId);
    processUsageRefreshService.deleteSession(sessionId);
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

  const runtimeConversationActions = new RuntimeConversationActions({
    controlPlaneService,
    createConversationId: () => `conversation-${randomUUID()}`,
    ensureConversation,
    noteGitActivity,
    startConversation,
    activateConversation,
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
    conversationsHas: (sessionId) => conversationManager.has(sessionId),
    applyController: (sessionId, controller) => {
      conversationManager.setController(sessionId, controller);
    },
    setLastEventNow: (sessionId) => {
      conversationManager.setLastEventAt(sessionId, new Date().toISOString());
    },
    muxControllerId,
    muxControllerLabel,
    markDirty,
  });
  const runtimeDirectoryActions = new RuntimeDirectoryActions({
    controlPlaneService,
    conversations: () => _unsafeConversationMap,
    orderedConversationIds: () => conversationManager.orderedIds(),
    conversationDirectoryId: (sessionId) => conversationManager.directoryIdOf(sessionId),
    conversationLive: (sessionId) => conversationManager.isLive(sessionId),
    removeConversationState,
    unsubscribeConversationEvents,
    activeConversationId: () => conversationManager.activeConversationId,
    setActiveConversationId: (sessionId) => {
      conversationManager.setActiveConversationId(sessionId);
    },
    activateConversation,
    resolveActiveDirectoryId,
    enterProjectPane,
    markDirty,
    isSessionNotFoundError,
    isConversationNotFoundError,
    createDirectoryId: () => `directory-${randomUUID()}`,
    resolveWorkspacePathForMux: (rawPath) =>
      resolveWorkspacePathForMux(options.invocationDirectory, rawPath),
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
    directoriesHas: (directoryId) => directoryManager.hasDirectory(directoryId),
    deleteDirectory: (directoryId) => {
      directoryManager.deleteDirectory(directoryId);
    },
    deleteDirectoryGitState,
    projectPaneSnapshotDirectoryId: () => workspace.projectPaneSnapshot?.directoryId ?? null,
    clearProjectPaneSnapshot: () => {
      workspace.projectPaneSnapshot = null;
      workspace.projectPaneScrollTop = 0;
    },
    directoriesSize: () => directoryManager.directoriesSize(),
    invocationDirectory: options.invocationDirectory,
    activeDirectoryId: () => workspace.activeDirectoryId,
    firstDirectoryId: () => directoryManager.firstDirectoryId(),
  });
  const createAndActivateConversationInDirectory = async (
    directoryId: string,
    agentType: ThreadAgentType,
  ): Promise<void> => {
    await runtimeConversationActions.createAndActivateConversationInDirectory(
      directoryId,
      String(agentType),
    );
  };

  const openOrCreateCritiqueConversationInDirectory = async (
    directoryId: string,
  ): Promise<void> => {
    await runtimeConversationActions.openOrCreateCritiqueConversationInDirectory(directoryId);
  };

  const archiveConversation = async (sessionId: string): Promise<void> => {
    await runtimeDirectoryActions.archiveConversation(sessionId);
  };

  const takeoverConversation = async (sessionId: string): Promise<void> => {
    await runtimeConversationActions.takeoverConversation(sessionId);
  };

  const addDirectoryByPath = async (rawPath: string): Promise<void> => {
    await runtimeDirectoryActions.addDirectoryByPath(rawPath);
  };

  const closeDirectory = async (directoryId: string): Promise<void> => {
    await runtimeDirectoryActions.closeDirectory(directoryId);
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
      debugFooterNotice.set(scopedMessage);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const scopedMessage =
        muxSessionName === null ? `[profile] ${message}` : `[profile:${muxSessionName}] ${message}`;
      workspace.taskPaneNotice = scopedMessage;
      debugFooterNotice.set(scopedMessage);
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
    sessionProjectionInstrumentation.refreshSelectorSnapshot(
      'render',
      _unsafeDirectoryMap,
      _unsafeConversationMap,
      orderedIds,
    );
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
      processUsageBySessionId: processUsageRefreshService.readonlyUsage(),
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
    const statusNotice = debugFooterNotice.current();
    const statusFooter =
      statusNotice === null || statusNotice.length === 0
        ? baseStatusFooter
        : `${baseStatusFooter.length > 0 ? `${baseStatusFooter}  ` : ''}${statusNotice}`;
    const rows = buildRenderRows(
      layout,
      rail.ansiRows,
      rightRows,
      outputLoadSampler.currentStatusRow(),
      statusFooter,
    );
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
      startupPaintTracker.onRenderFlush({
        activeConversation: active,
        activeConversationId: conversationManager.activeConversationId,
        rightFrameVisible: rightFrame !== null,
        changedRowCount,
      });
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
    outputLoadSampler.recordRenderSample(renderDurationMs, changedRowCount);
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
      outputLoadSampler.recordOutputChunk(
        envelope.sessionId,
        chunk.length,
        conversationManager.activeConversationId === envelope.sessionId,
      );
      startupOutputTracker.onOutputChunk(envelope.sessionId, chunk.length);
      startupPaintTracker.onOutputChunk(envelope.sessionId);
      if (outputIngest.cursorRegressed) {
        recordPerfEvent('mux.output.cursor-regression', {
          sessionId: envelope.sessionId,
          previousCursor: outputIngest.previousCursor,
          cursor: envelope.cursor,
        });
      }

      const normalized = mapTerminalOutputToNormalizedEvent(chunk, conversation.scope, idFactory);
      eventPersistence.enqueue(normalized);
      conversation.lastEventAt = normalized.ts;
      if (conversationManager.activeConversationId === envelope.sessionId) {
        markDirty();
      }
      const outputHandledDurationMs = Number(perfNowNs() - outputHandledStartedAtNs) / 1e6;
      outputLoadSampler.recordOutputHandled(outputHandledDurationMs);
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
        eventPersistence.enqueue(normalized);
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
    startupSpanTracker.beginForSession(initialActiveId);
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
  void startupBackgroundResumeService.run(initialActiveId);

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
  const queueCloseDirectoryMouseAction = (directoryId: string, label: string): void => {
    queueControlPlaneOp(async () => {
      await closeDirectory(directoryId);
    }, label);
  };
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
    queueCloseDirectory: (directoryId) => queueCloseDirectoryMouseAction(directoryId, 'mouse-close-directory'),
    toggleRepositoryGroup,
    selectLeftNavRepository: (repositoryGroupId) => {
      workspace.selectLeftNavRepository(repositoryGroupId);
    },
    expandAllRepositoryGroups,
    collapseAllRepositoryGroups,
    enterHomePane,
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
  const mainPanePointerInput = new MainPanePointerInput({
    getMainPaneMode: () => workspace.mainPaneMode,
    getProjectPaneSnapshot: () => workspace.projectPaneSnapshot,
    getProjectPaneScrollTop: () => workspace.projectPaneScrollTop,
    projectPaneActionAtRow,
    openNewThreadPrompt,
    queueCloseDirectory: (directoryId) =>
      queueCloseDirectoryMouseAction(directoryId, 'project-pane-close-project'),
    actionAtCell: (rowIndex, colIndex) =>
      taskFocusedPaneActionAtCell(workspace.latestTaskPaneView, rowIndex, colIndex),
    actionAtRow: (rowIndex) => taskFocusedPaneActionAtRow(workspace.latestTaskPaneView, rowIndex),
    clearTaskEditClickState: () => {
      workspace.taskPaneTaskEditClickState = null;
    },
    clearRepositoryEditClickState: () => {
      workspace.taskPaneRepositoryEditClickState = null;
    },
    clearHomePaneDragState: () => {
      workspace.homePaneDragState = null;
    },
    getTaskRepositoryDropdownOpen: () => workspace.taskRepositoryDropdownOpen,
    setTaskRepositoryDropdownOpen: (open) => {
      workspace.taskRepositoryDropdownOpen = open;
    },
    taskIdAtRow: (rowIndex) => taskFocusedPaneTaskIdAtRow(workspace.latestTaskPaneView, rowIndex),
    repositoryIdAtRow: (rowIndex) =>
      taskFocusedPaneRepositoryIdAtRow(workspace.latestTaskPaneView, rowIndex),
    selectTaskById,
    selectRepositoryById,
    runTaskPaneAction,
    nowMs: () => Date.now(),
    homePaneEditDoubleClickWindowMs: HOME_PANE_EDIT_DOUBLE_CLICK_WINDOW_MS,
    getTaskEditClickState: () => workspace.taskPaneTaskEditClickState,
    getRepositoryEditClickState: () => workspace.taskPaneRepositoryEditClickState,
    clearTaskPaneNotice: () => {
      workspace.taskPaneNotice = null;
    },
    setTaskEditClickState: (next) => {
      workspace.taskPaneTaskEditClickState = next;
    },
    setRepositoryEditClickState: (next) => {
      workspace.taskPaneRepositoryEditClickState = next;
    },
    setHomePaneDragState: (next) => {
      workspace.homePaneDragState = next;
    },
    openTaskEditPrompt,
    openRepositoryPromptForEdit,
    markDirty,
  });
  const pointerRoutingInput = new PointerRoutingInput({
    getPaneDividerDragActive: () => paneDividerDragActive,
    setPaneDividerDragActive: (active) => {
      paneDividerDragActive = active;
    },
    applyPaneDividerAtCol,
    getHomePaneDragState: () => workspace.homePaneDragState,
    setHomePaneDragState: (next) => {
      workspace.homePaneDragState = next;
    },
    getMainPaneMode: () => workspace.mainPaneMode,
    taskIdAtRow: (index) => taskFocusedPaneTaskIdAtRow(workspace.latestTaskPaneView, index),
    repositoryIdAtRow: (index) =>
      taskFocusedPaneRepositoryIdAtRow(workspace.latestTaskPaneView, index),
    reorderTaskByDrop,
    reorderRepositoryByDrop,
    onProjectWheel: (delta) => {
      workspace.projectPaneScrollTop = Math.max(0, workspace.projectPaneScrollTop + delta);
    },
    onHomeWheel: (delta) => {
      workspace.taskPaneScrollTop = Math.max(0, workspace.taskPaneScrollTop + delta);
    },
    markDirty,
  });
  const conversationSelectionInput = new ConversationSelectionInput({
    getSelection: () => selection,
    setSelection: (next) => {
      selection = next;
    },
    getSelectionDrag: () => selectionDrag,
    setSelectionDrag: (next) => {
      selectionDrag = next;
    },
    pinViewportForSelection,
    releaseViewportPinForSelection,
    markDirty,
  });
  const globalShortcutInput = new GlobalShortcutInput({
    shortcutBindings,
    requestStop,
    resolveDirectoryForAction,
    openNewThreadPrompt,
    openOrCreateCritiqueConversationInDirectory,
    toggleGatewayProfile: async () => {
      await toggleGatewayProfiler();
    },
    getMainPaneMode: () => workspace.mainPaneMode,
    getActiveConversationId: () => conversationManager.activeConversationId,
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
    getActiveDirectoryId: () => workspace.activeDirectoryId,
    directoryExists: (directoryId) => directoryManager.hasDirectory(directoryId),
    closeDirectory,
    cycleLeftNavSelection: (direction) => {
      leftNavInput.cycleSelection(direction);
    },
  });
  const inputTokenRouter = new InputTokenRouter({
    getMainPaneMode: () => workspace.mainPaneMode,
    pointerRoutingInput,
    mainPanePointerInput,
    leftRailPointerInput,
    conversationSelectionInput,
  });
  const conversationInputForwarder = new ConversationInputForwarder({
    getInputRemainder: () => inputRemainder,
    setInputRemainder: (next) => {
      inputRemainder = next;
    },
    getMainPaneMode: () => workspace.mainPaneMode,
    getLayout: () => layout,
    inputTokenRouter,
    getActiveConversation: () => conversationManager.getActiveConversation(),
    markDirty,
    isControlledByLocalHuman: (input) => conversationManager.isControlledByLocalHuman(input),
    controllerId: muxControllerId,
    sendInputToSession: (sessionId, chunk) => {
      streamClient.sendInput(sessionId, chunk);
    },
    noteGitActivity,
  });
  const inputPreflight = new InputPreflight({
    isShuttingDown: () => shuttingDown,
    routeModalInput: (input) => inputRouter.routeModalInput(input),
    handleEscapeInput: (input) => {
      if (selection !== null || selectionDrag !== null) {
        selection = null;
        selectionDrag = null;
        releaseViewportPinForSelection();
        markDirty();
      }
      if (workspace.mainPaneMode === 'conversation') {
        const escapeTarget = conversationManager.getActiveConversation();
        if (escapeTarget !== null) {
          streamClient.sendInput(escapeTarget.sessionId, input);
        }
      }
    },
    onFocusIn: () => {
      inputModeManager.enable();
      markDirty();
    },
    onFocusOut: () => {
      markDirty();
    },
    handleRepositoryFoldInput: (input) =>
      repositoryFoldInput.handleRepositoryFoldChords(input) ||
      repositoryFoldInput.handleRepositoryTreeArrow(input),
    handleGlobalShortcutInput: (input) => globalShortcutInput.handleInput(input),
    handleTaskPaneShortcutInput: (input) => handleTaskPaneShortcutInput(input),
    handleCopyShortcutInput: (input) => {
      if (
        workspace.mainPaneMode !== 'conversation' ||
        selection === null ||
        !isCopyShortcutInput(input)
      ) {
        return false;
      }
      const active = conversationManager.getActiveConversation();
      if (active === null) {
        return true;
      }
      const selectedFrame = active.oracle.snapshotWithoutHash();
      const copied = writeTextToClipboard(selectionText(selectedFrame, selection));
      if (copied) {
        markDirty();
      }
      return true;
    },
  });

  const onInput = (chunk: Buffer): void => {
    const sanitized = inputPreflight.nextInput(chunk);
    if (sanitized === null) {
      return;
    }
    conversationInputForwarder.handleInput(sanitized);
  };

  const onResize = (): void => {
    const nextSize = terminalSize();
    queueResize(nextSize);
  };
  const runtimeProcessWiring = new RuntimeProcessWiring({
    onInput,
    onResize,
    requestStop,
    handleRuntimeFatal,
  });

  await hydrateStartupState();

  runtimeProcessWiring.attach();

  inputModeManager.enable();
  applyLayout(size, true);
  scheduleRender();
  const runtimeShutdownService = new RuntimeShutdownService({
    screen,
    outputLoadSampler,
    startupBackgroundProbeService,
    clearResizeTimer: () => {
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
      }
    },
    clearPtyResizeTimer: () => {
      if (ptyResizeTimer !== null) {
        clearTimeout(ptyResizeTimer);
        ptyResizeTimer = null;
      }
    },
    persistMuxUiStateNow,
    clearConversationTitleEditTimer: () => {
      if (conversationTitleEdit !== null) {
        clearConversationTitleEditTimer(conversationTitleEdit);
      }
    },
    flushTaskComposerPersist: () => {
      if (
        'taskId' in workspace.taskEditorTarget &&
        typeof workspace.taskEditorTarget.taskId === 'string'
      ) {
        flushTaskComposerPersist(workspace.taskEditorTarget.taskId);
      }
      for (const taskId of taskManager.autosaveTaskIds()) {
        flushTaskComposerPersist(taskId);
      }
    },
    clearRenderScheduled: () => {
      runtimeRenderLifecycle.clearRenderScheduled();
    },
    detachProcessListeners: () => {
      runtimeProcessWiring.detach();
    },
    removeEnvelopeListener,
    unsubscribeTaskPlanningEvents,
    closeKeyEventSubscription: async () => {
      if (keyEventSubscription !== null) {
        await keyEventSubscription.close();
        keyEventSubscription = null;
      }
    },
    clearRuntimeFatalExitTimer: () => {
      runtimeRenderLifecycle.clearRuntimeFatalExitTimer();
    },
    waitForControlPlaneDrain,
    controlPlaneClient,
    eventPersistence,
    recordingService,
    store,
    restoreTerminalState: () => {
      restoreTerminalState(true, inputModeManager.restore);
    },
    startupShutdownService,
    shutdownPerfCore,
  });

  try {
    while (!stop) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  } finally {
    shuttingDown = true;
    await runtimeShutdownService.finalize();
  }

  if (exit === null) {
    if (runtimeRenderLifecycle.hasFatal()) {
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

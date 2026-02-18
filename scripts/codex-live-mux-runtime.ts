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
import { StartupOrchestrator } from '../src/services/startup-orchestrator.ts';
import { StartupPersistedConversationQueueService } from '../src/services/startup-persisted-conversation-queue.ts';
import { RuntimeProcessWiring } from '../src/services/runtime-process-wiring.ts';
import { RuntimeConversationActions } from '../src/services/runtime-conversation-actions.ts';
import { RuntimeConversationActivation } from '../src/services/runtime-conversation-activation.ts';
import { RuntimeConversationStarter } from '../src/services/runtime-conversation-starter.ts';
import { RuntimeConversationTitleEditService } from '../src/services/runtime-conversation-title-edit.ts';
import { RuntimeDirectoryActions } from '../src/services/runtime-directory-actions.ts';
import { RuntimeEnvelopeHandler } from '../src/services/runtime-envelope-handler.ts';
import { RuntimeRenderFlush } from '../src/services/runtime-render-flush.ts';
import { RuntimeLeftRailRender } from '../src/services/runtime-left-rail-render.ts';
import { RuntimeRenderOrchestrator } from '../src/services/runtime-render-orchestrator.ts';
import { RuntimeRightPaneRender } from '../src/services/runtime-right-pane-render.ts';
import { RuntimeRenderState } from '../src/services/runtime-render-state.ts';
import { RuntimeRenderLifecycle } from '../src/services/runtime-render-lifecycle.ts';
import { RuntimeShutdownService } from '../src/services/runtime-shutdown.ts';
import { RuntimeTaskPaneActions } from '../src/services/runtime-task-pane-actions.ts';
import { RuntimeTaskPaneShortcuts } from '../src/services/runtime-task-pane-shortcuts.ts';
import { TaskPaneSelectionActions } from '../src/services/task-pane-selection-actions.ts';
import { TaskPlanningHydrationService } from '../src/services/task-planning-hydration.ts';
import { TaskPlanningObservedEvents } from '../src/services/task-planning-observed-events.ts';
import { StartupStateHydrationService } from '../src/services/startup-state-hydration.ts';
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
type ControlPlaneDirectoryRecord = Awaited<ReturnType<ControlPlaneService['upsertDirectory']>>;
type ControlPlaneRepositoryRecord = NonNullable<ReturnType<typeof parseRepositoryRecord>>;
type ControlPlaneTaskRecord = NonNullable<ReturnType<typeof parseTaskRecord>>;
type ControlPlaneSessionSummary = NonNullable<
  Awaited<ReturnType<ControlPlaneService['getSessionStatus']>>
>;
type ControlPlaneDirectoryGitStatusRecord = Awaited<
  ReturnType<ControlPlaneService['listDirectoryGitStatuses']>
>[number];

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
const HOME_PANE_BACKGROUND_INTERVAL_MS = 80;
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
  const directoryRecords = directoryManager.readonlyDirectories();
  const gitSummaryByDirectoryId = directoryManager.mutableGitSummaries();
  const repositoryManager = new RepositoryManager<
    ControlPlaneRepositoryRecord,
    GitRepositorySnapshot
  >();
  const repositories = repositoryManager.mutableRepositories();
  const repositoryAssociationByDirectoryId =
    repositoryManager.mutableDirectoryAssociations();
  const directoryRepositorySnapshotByDirectoryId =
    repositoryManager.mutableDirectorySnapshots();
  const muxControllerId = `human-mux-${process.pid}-${randomUUID()}`;
  const muxControllerLabel = `human mux ${process.pid}`;
  const conversationManager = new ConversationManager();
  const conversationRecords = conversationManager.readonlyConversations();
  const taskManager = new TaskManager<ControlPlaneTaskRecord, TaskComposerBuffer, NodeJS.Timeout>();
  let observedStreamSubscriptionId: string | null = null;
  let keyEventSubscription: Awaited<ReturnType<typeof subscribeControlPlaneKeyEvents>> | null =
    null;
  let hydrateStartupStateForStartupOrchestrator = async (
    _afterCursor: number | null,
  ): Promise<void> => {};
  let queuePersistedConversationsForStartupOrchestrator = (
    _activeSessionId: string | null,
  ): number => 0;
  let activateConversationForStartupOrchestrator = async (_sessionId: string): Promise<void> => {};
  let shuttingDown = false;
  const startupOrchestrator = new StartupOrchestrator({
    startupSettleQuietMs,
    startupSettleNonemptyFallbackMs: DEFAULT_STARTUP_SETTLE_NONEMPTY_FALLBACK_MS,
    backgroundWaitMaxMs: DEFAULT_BACKGROUND_START_MAX_WAIT_MS,
    backgroundProbeEnabled: backgroundProbesEnabled,
    backgroundResumeEnabled: backgroundResumePersisted,
    startPerfSpan,
    startupSpan,
    recordPerfEvent,
    getConversation: (sessionId) => conversationManager.get(sessionId),
    isShuttingDown: () => shuttingDown,
    refreshProcessUsage: (reason) =>
      void processUsageRefreshService.refresh(reason, conversationRecords),
    queuePersistedConversationsInBackground: (initialActiveId) =>
      queuePersistedConversationsForStartupOrchestrator(initialActiveId),
    hydrateStartupState: async (afterCursor) =>
      await hydrateStartupStateForStartupOrchestrator(afterCursor),
    activateConversation: async (sessionId) =>
      await activateConversationForStartupOrchestrator(sessionId),
    conversationCount: () => conversationManager.size(),
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
      conversations: conversationRecords,
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
      directoryRecords,
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
      directoryRecords,
      conversationRecords,
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
    firstPaintTargetSessionId: () => startupOrchestrator.firstPaintTargetSessionId,
    endStartCommandSpan: (input) => {
      startupOrchestrator.endStartCommandSpan(input);
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

  const startupPersistedConversationQueueService =
    new StartupPersistedConversationQueueService<ConversationState>({
      orderedConversationIds: () => conversationManager.orderedIds(),
      conversationById: (sessionId) => conversationManager.get(sessionId),
      queueBackgroundOp: (task, label) => {
        queueBackgroundControlPlaneOp(task, label);
      },
      startConversation,
      markDirty: () => {
        markDirty();
      },
    });
  const queuePersistedConversationsInBackground = (activeSessionId: string | null): number => {
    return startupPersistedConversationQueueService.queuePersistedConversationsInBackground(
      activeSessionId,
    );
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
  const startupStateHydrationService = new StartupStateHydrationService<
    ControlPlaneRepositoryRecord,
    GitSummary,
    GitRepositorySnapshot,
    ControlPlaneDirectoryGitStatusRecord
  >({
    hydrateConversationList,
    listRepositories: async () => {
      return await controlPlaneService.listRepositories();
    },
    clearRepositories: () => {
      repositories.clear();
    },
    setRepository: (repositoryId, repository) => {
      repositories.set(repositoryId, repository);
    },
    syncRepositoryAssociationsWithDirectorySnapshots,
    gitHydrationEnabled: configuredMuxGit.enabled,
    listDirectoryGitStatuses: async () => {
      return await controlPlaneService.listDirectoryGitStatuses();
    },
    setDirectoryGitSummary: (directoryId, summary) => {
      gitSummaryByDirectoryId.set(directoryId, summary);
    },
    setDirectoryRepositorySnapshot: (directoryId, snapshot) => {
      repositoryManager.setDirectoryRepositorySnapshot(directoryId, snapshot);
    },
    setDirectoryRepositoryAssociation: (directoryId, repositoryId) => {
      repositoryManager.setDirectoryRepositoryAssociation(directoryId, repositoryId);
    },
    hydrateTaskPlanningState,
    subscribeTaskPlanningEvents,
    ensureActiveConversationId: () => {
      conversationManager.ensureActiveConversationId();
    },
    activeConversationId: () => conversationManager.activeConversationId,
    selectLeftNavConversation: (sessionId) => {
      workspace.selectLeftNavConversation(sessionId);
    },
    enterHomePane: () => {
      workspace.enterHomePane();
    },
  });
  queuePersistedConversationsForStartupOrchestrator = queuePersistedConversationsInBackground;
  hydrateStartupStateForStartupOrchestrator = async (afterCursor) =>
    await startupStateHydrationService.hydrateStartupState(afterCursor);

  const ensureDirectoryGitState = (directoryId: string): void => {
    directoryManager.ensureGitSummary(directoryId, GIT_SUMMARY_LOADING);
  };

  const deleteDirectoryGitState = (directoryId: string): void => {
    deleteDirectoryGitStateFn(
      directoryId,
      gitSummaryByDirectoryId,
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
      gitSummaryByDirectoryId: gitSummaryByDirectoryId,
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
  const debugFooterNotice = new DebugFooterNotice({
    ttlMs: DEBUG_FOOTER_NOTICE_TTL_MS,
  });
  const modalManager = new ModalManager({
    theme: MUX_MODAL_THEME,
    resolveRepositoryName: (repositoryId) => repositories.get(repositoryId)?.name ?? null,
    getNewThreadPrompt: () => workspace.newThreadPrompt,
    getAddDirectoryPrompt: () => workspace.addDirectoryPrompt,
    getTaskEditorPrompt: () => workspace.taskEditorPrompt,
    getRepositoryPrompt: () => workspace.repositoryPrompt,
    getConversationTitleEdit: () => workspace.conversationTitleEdit,
  });
  let resizeTimer: NodeJS.Timeout | null = null;
  let pendingSize: { cols: number; rows: number } | null = null;
  let lastResizeApplyAtMs = 0;
  let ptyResizeTimer: NodeJS.Timeout | null = null;
  let homePaneBackgroundTimer: ReturnType<typeof setInterval> | null = null;
  let pendingPtySize: { cols: number; rows: number } | null = null;
  const ptySizeByConversationId = new Map<string, { cols: number; rows: number }>();

  const requestStop = (): void => {
    requestStopFn({
      stop,
      hasConversationTitleEdit: workspace.conversationTitleEdit !== null,
      stopConversationTitleEdit: () => stopConversationTitleEdit(true),
      activeTaskEditorTaskId:
        'taskId' in workspace.taskEditorTarget && typeof workspace.taskEditorTarget.taskId === 'string'
          ? workspace.taskEditorTarget.taskId
          : null,
      autosaveTaskIds: [...taskManager.autosaveTaskIds()],
      flushTaskComposerPersist,
      closeLiveSessionsOnClientStop,
      orderedConversationIds: conversationManager.orderedIds(),
      conversations: conversationRecords,
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
    directoryRecords,
    conversationRecords,
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
  startupOrchestrator.startBackgroundProbe();

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
  homePaneBackgroundTimer = setInterval(() => {
    if (shuttingDown || workspace.mainPaneMode !== 'home') {
      return;
    }
    markDirty();
  }, HOME_PANE_BACKGROUND_INTERVAL_MS);
  homePaneBackgroundTimer.unref?.();

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

  const runtimeConversationTitleEdit = new RuntimeConversationTitleEditService<ConversationState>({
    workspace,
    updateConversationTitle: async (input) => {
      return await controlPlaneService.updateConversationTitle(input);
    },
    conversationById: (conversationId) => conversationManager.get(conversationId),
    markDirty,
    queueControlPlaneOp,
    debounceMs: DEFAULT_CONVERSATION_TITLE_EDIT_DEBOUNCE_MS,
  });

  const scheduleConversationTitlePersist = (): void => {
    runtimeConversationTitleEdit.schedulePersist();
  };

  const stopConversationTitleEdit = (persistPending: boolean): void => {
    runtimeConversationTitleEdit.stop(persistPending);
  };

  const beginConversationTitleEdit = (conversationId: string): void => {
    runtimeConversationTitleEdit.begin(conversationId);
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
    workspace.selection = null;
    workspace.selectionDrag = null;
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

  async function subscribeTaskPlanningEvents(afterCursor: number | null): Promise<void> {
    if (observedStreamSubscriptionId !== null) {
      return;
    }
    observedStreamSubscriptionId = await subscribeObservedStream(
      streamClient,
      options.scope,
      afterCursor,
    );
  }

  async function unsubscribeTaskPlanningEvents(): Promise<void> {
    if (observedStreamSubscriptionId === null) {
      return;
    }
    const subscriptionId = observedStreamSubscriptionId;
    observedStreamSubscriptionId = null;
    await unsubscribeObservedStream(streamClient, subscriptionId);
  }

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
      if (workspace.conversationTitleEdit !== null && workspace.conversationTitleEdit.conversationId !== sessionId) {
        stopConversationTitleEdit(true);
      }
    },
    clearSelectionState: () => {
      workspace.selection = null;
      workspace.selectionDrag = null;
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
  activateConversationForStartupOrchestrator = activateConversation;

  const removeConversationState = (sessionId: string): void => {
    if (workspace.conversationTitleEdit?.conversationId === sessionId) {
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

  const openNewThreadPrompt = (directoryId: string): void => {
    openNewThreadPromptFn({
      directoryId,
      directoriesHas: (nextDirectoryId) => directoryManager.hasDirectory(nextDirectoryId),
      clearAddDirectoryPrompt: () => {
        workspace.addDirectoryPrompt = null;
      },
      clearRepositoryPrompt: () => {
        workspace.repositoryPrompt = null;
      },
      hasConversationTitleEdit: workspace.conversationTitleEdit !== null,
      stopConversationTitleEdit: () => {
        stopConversationTitleEdit(true);
      },
      clearConversationTitleEditClickState: () => {
        workspace.conversationTitleEditClickState = null;
      },
      createNewThreadPromptState,
      setNewThreadPrompt: (prompt) => {
        workspace.newThreadPrompt = prompt;
      },
      markDirty,
    });
  };

  const openRepositoryPromptForCreate = (): void => {
    openRepositoryPromptForCreateFn({
      clearNewThreadPrompt: () => {
        workspace.newThreadPrompt = null;
      },
      clearAddDirectoryPrompt: () => {
        workspace.addDirectoryPrompt = null;
      },
      hasConversationTitleEdit: workspace.conversationTitleEdit !== null,
      stopConversationTitleEdit: () => {
        stopConversationTitleEdit(true);
      },
      clearConversationTitleEditClickState: () => {
        workspace.conversationTitleEditClickState = null;
      },
      setRepositoryPrompt: (prompt) => {
        workspace.repositoryPrompt = prompt;
      },
      markDirty,
    });
  };

  const openRepositoryPromptForEdit = (repositoryId: string): void => {
    openRepositoryPromptForEditFn({
      repositoryId,
      repositories,
      clearNewThreadPrompt: () => {
        workspace.newThreadPrompt = null;
      },
      clearAddDirectoryPrompt: () => {
        workspace.addDirectoryPrompt = null;
      },
      hasConversationTitleEdit: workspace.conversationTitleEdit !== null,
      stopConversationTitleEdit: () => {
        stopConversationTitleEdit(true);
      },
      clearConversationTitleEditClickState: () => {
        workspace.conversationTitleEditClickState = null;
      },
      setRepositoryPrompt: (prompt) => {
        workspace.repositoryPrompt = prompt;
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

  const runtimeTaskPaneActions = new RuntimeTaskPaneActions<ControlPlaneTaskRecord>({
    workspace,
    controlPlaneService,
    repositoriesHas: (repositoryId) => repositories.has(repositoryId),
    getTask: (taskId) => taskManager.getTask(taskId),
    taskReorderPayloadIds: (orderedActiveTaskIds) =>
      taskManager.taskReorderPayloadIds({
        orderedActiveTaskIds,
        sortTasks: sortTasksByOrder,
        isCompleted: (task) => task.status === 'completed',
      }),
    reorderedActiveTaskIdsForDrop: (draggedTaskId, targetTaskId) =>
      taskManager.reorderedActiveTaskIdsForDrop({
        draggedTaskId,
        targetTaskId,
        sortTasks: sortTasksByOrder,
        isCompleted: (task) => task.status === 'completed',
      }),
    clearTaskAutosaveTimer,
    deleteTask: (taskId) => {
      taskManager.deleteTask(taskId);
    },
    deleteTaskComposer: (taskId) => {
      taskManager.deleteTaskComposer(taskId);
    },
    focusDraftComposer,
    focusTaskComposer,
    selectedTask: () => selectedTaskRecord(),
    orderedTaskRecords,
    queueControlPlaneOp,
    applyTaskRecord,
    applyTaskList: (tasks) => {
      applyTaskList(tasks);
    },
    syncTaskPaneSelection,
    syncTaskPaneRepositorySelection,
    openRepositoryPromptForCreate,
    openRepositoryPromptForEdit,
    archiveRepositoryById,
    markDirty,
  });
  const runtimeTaskPaneShortcuts = new RuntimeTaskPaneShortcuts<ControlPlaneTaskRecord>({
    workspace,
    taskScreenKeybindings,
    repositoriesHas: (repositoryId) => repositories.has(repositoryId),
    activeRepositoryIds,
    selectRepositoryById,
    taskComposerForTask,
    setTaskComposerForTask,
    scheduleTaskComposerPersist,
    selectedRepositoryTaskRecords,
    focusTaskComposer,
    focusDraftComposer,
    runTaskPaneAction: (shortcutAction) => {
      runtimeTaskPaneActions.runTaskPaneAction(shortcutAction);
    },
    queueControlPlaneOp,
    createTask: async (payload) => {
      return await controlPlaneService.createTask(payload);
    },
    applyTaskRecord,
    syncTaskPaneSelection,
    markDirty,
  });

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
    conversations: () => conversationRecords,
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
    if (workspace.selectionPinnedFollowOutput !== null) {
      return;
    }
    const active = conversationManager.getActiveConversation();
    if (active === null) {
      return;
    }
    const follow = active.oracle.snapshotWithoutHash().viewport.followOutput;
    workspace.selectionPinnedFollowOutput = follow;
    if (follow) {
      active.oracle.setFollowOutput(false);
    }
  };

  const releaseViewportPinForSelection = (): void => {
    if (workspace.selectionPinnedFollowOutput === null) {
      return;
    }
    const shouldRepin = workspace.selectionPinnedFollowOutput;
    workspace.selectionPinnedFollowOutput = null;
    if (shouldRepin) {
      const active = conversationManager.getActiveConversation();
      if (active === null) {
        return;
      }
      active.oracle.setFollowOutput(true);
    }
  };

  const runtimeRenderFlush = new RuntimeRenderFlush<
    ConversationState,
    ReturnType<TerminalSnapshotOracle['snapshotWithoutHash']>,
    PaneSelection,
    typeof layout,
    NonNullable<ReturnType<typeof buildCurrentModalOverlay>>,
    ReturnType<OutputLoadSampler['currentStatusRow']>
  >({
    perfNowNs,
    statusFooterForConversation: (conversation) => debugFooterForConversation(conversation),
    currentStatusNotice: () => debugFooterNotice.current(),
    currentStatusRow: () => outputLoadSampler.currentStatusRow(),
    buildRenderRows: (renderLayout, railRows, rightRows, statusRow, statusFooter) =>
      buildRenderRows(renderLayout, railRows, rightRows, statusRow, statusFooter),
    buildModalOverlay: () => buildCurrentModalOverlay(),
    applyModalOverlay: (rows, overlay) => {
      applyModalOverlay(rows, overlay);
    },
    renderSelectionOverlay: (renderLayout, frame, renderSelection) =>
      renderSelectionOverlay(renderLayout, frame, renderSelection),
    flush: ({ layout: renderLayout, rows, rightFrame, selectionRows, selectionOverlay }) =>
      screen.flush({
        layout: renderLayout,
        rows,
        rightFrame,
        selectionRows,
        selectionOverlay,
        validateAnsi,
      }),
    onFlushOutput: ({ activeConversation, rightFrame, rows, flushResult, changedRowCount }) => {
      startupOrchestrator.onRenderFlush({
        activeConversation,
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
    },
    recordRenderSample: (durationMs, changedRowCount) => {
      outputLoadSampler.recordRenderSample(durationMs, changedRowCount);
    },
  });

  const runtimeRightPaneRender = new RuntimeRightPaneRender<
    ControlPlaneRepositoryRecord,
    ControlPlaneTaskRecord
  >({
    workspace,
    repositories,
    taskManager,
    conversationPane,
    homePane,
    projectPane,
    refreshProjectPaneSnapshot: (directoryId) => {
      refreshProjectPaneSnapshot(directoryId);
      return workspace.projectPaneSnapshot;
    },
    emptyTaskPaneView: () => ({
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    }),
  });
  const runtimeLeftRailRender = new RuntimeLeftRailRender<
    ControlPlaneDirectoryRecord,
    ConversationState,
    ControlPlaneRepositoryRecord,
    GitRepositorySnapshot,
    GitSummary,
    ProcessUsageSample,
    ReturnType<typeof resolveMuxShortcutBindings>,
    ReturnType<typeof buildWorkspaceRailViewRows>
  >({
    leftRailPane,
    sessionProjectionInstrumentation,
    workspace,
    repositoryManager,
    repositories,
    repositoryAssociationByDirectoryId,
    directoryRepositorySnapshotByDirectoryId,
    directories: directoryRecords,
    conversations: conversationRecords,
    gitSummaryByDirectoryId: gitSummaryByDirectoryId,
    processUsageBySessionId: () => processUsageRefreshService.readonlyUsage(),
    shortcutBindings,
    loadingGitSummary: GIT_SUMMARY_LOADING,
    activeConversationId: () => conversationManager.activeConversationId,
    orderedConversationIds: () => conversationManager.orderedIds(),
  });
  const runtimeRenderState = new RuntimeRenderState<
    ConversationState,
    ReturnType<TerminalSnapshotOracle['snapshotWithoutHash']>
  >({
    workspace,
    hasDirectory: (directoryId) => directoryManager.hasDirectory(directoryId),
    activeConversationId: () => conversationManager.activeConversationId,
    activeConversation: () => conversationManager.getActiveConversation(),
    snapshotFrame: (conversation) => conversation.oracle.snapshotWithoutHash(),
    selectionVisibleRows,
  });
  const runtimeRenderOrchestrator = new RuntimeRenderOrchestrator<
    typeof layout,
    ConversationState,
    ReturnType<TerminalSnapshotOracle['snapshotWithoutHash']>,
    PaneSelection,
    PaneSelectionDrag,
    ReturnType<typeof buildWorkspaceRailViewRows>
  >({
    isScreenDirty: () => screen.isDirty(),
    clearDirty: () => {
      screen.clearDirty();
    },
    prepareRenderState: (renderSelection, renderSelectionDrag) =>
      runtimeRenderState.prepareRenderState(renderSelection, renderSelectionDrag),
    renderLeftRail: (renderLayout) => runtimeLeftRailRender.render(renderLayout),
    setLatestRailViewRows: (rows) => {
      workspace.latestRailViewRows = rows;
    },
    renderRightRows: (input) =>
      runtimeRightPaneRender.renderRightRows({
        layout: input.layout,
        rightFrame: input.rightFrame,
        homePaneActive: input.homePaneActive,
        projectPaneActive: input.projectPaneActive,
        activeDirectoryId: input.activeDirectoryId,
      }),
    flushRender: (input) => {
      runtimeRenderFlush.flushRender(input);
    },
    activeDirectoryId: () => workspace.activeDirectoryId,
  });

  const render = (): void => {
    runtimeRenderOrchestrator.render({
      shuttingDown,
      layout,
      selection: workspace.selection,
      selectionDrag: workspace.selectionDrag,
    });
  };

  const runtimeEnvelopeHandler = new RuntimeEnvelopeHandler<
    ConversationState,
    ReturnType<typeof mapTerminalOutputToNormalizedEvent>
  >({
    perfNowNs,
    isRemoved: (sessionId) => conversationManager.isRemoved(sessionId),
    ensureConversation,
    ingestOutputChunk: (input) => conversationManager.ingestOutputChunk(input),
    noteGitActivity,
    recordOutputChunk: (input) => {
      outputLoadSampler.recordOutputChunk(input.sessionId, input.chunkLength, input.active);
    },
    startupOutputChunk: (sessionId, chunkLength) => {
      startupOrchestrator.onOutputChunk(sessionId, chunkLength);
    },
    startupPaintOutputChunk: (sessionId) => {
      startupOrchestrator.onPaintOutputChunk(sessionId);
    },
    recordPerfEvent,
    mapTerminalOutputToNormalizedEvent: (chunk, scope, makeId) =>
      mapTerminalOutputToNormalizedEvent(
        chunk,
        scope as Parameters<typeof mapTerminalOutputToNormalizedEvent>[1],
        makeId,
      ),
    mapSessionEventToNormalizedEvent: (event, scope, makeId) =>
      mapSessionEventToNormalizedEvent(event as Parameters<typeof mapSessionEventToNormalizedEvent>[0], scope as Parameters<typeof mapSessionEventToNormalizedEvent>[1], makeId),
    observedAtFromSessionEvent: (event) =>
      observedAtFromSessionEvent(event as Parameters<typeof observedAtFromSessionEvent>[0]),
    mergeAdapterStateFromSessionEvent: (agentType, adapterState, event, observedAt) =>
      mergeAdapterStateFromSessionEvent(
        agentType,
        adapterState,
        event as Parameters<typeof mergeAdapterStateFromSessionEvent>[2],
        observedAt,
      ),
    enqueueEvent: (event) => {
      eventPersistence.enqueue(event);
    },
    activeConversationId: () => conversationManager.activeConversationId,
    markSessionExited: (input) => {
      conversationManager.markSessionExited(input);
    },
    deletePtySize: (sessionId) => {
      ptySizeByConversationId.delete(sessionId);
    },
    setExit: (nextExit) => {
      exit = nextExit;
    },
    markDirty,
    nowIso: () => new Date().toISOString(),
    recordOutputHandled: (durationMs) => {
      outputLoadSampler.recordOutputHandled(durationMs);
    },
    conversationById: (sessionId) => conversationManager.get(sessionId),
    applyObservedGitStatusEvent,
    applyObservedTaskPlanningEvent,
    idFactory,
  });
  const handleEnvelope = (envelope: StreamServerEnvelope): void => {
    runtimeEnvelopeHandler.handleEnvelope(envelope);
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
  await startupOrchestrator.activateInitialConversation(initialActiveId);
  startupOrchestrator.finalizeStartup(initialActiveId);

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
    conversations: conversationRecords,
    scheduleConversationTitlePersist,
    getTaskEditorPrompt: () => workspace.taskEditorPrompt,
    setTaskEditorPrompt: (next) => {
      workspace.taskEditorPrompt = next;
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
          workspace.taskEditorPrompt = null;
          workspace.taskPaneNotice = null;
        } catch (error: unknown) {
          if (workspace.taskEditorPrompt !== null) {
            workspace.taskEditorPrompt.error = error instanceof Error ? error.message : String(error);
          } else {
            workspace.taskPaneNotice = error instanceof Error ? error.message : String(error);
          }
        } finally {
          markDirty();
        }
      }, payload.commandLabel);
    },
    getConversationTitleEdit: () => workspace.conversationTitleEdit,
    getNewThreadPrompt: () => workspace.newThreadPrompt,
    setNewThreadPrompt: (prompt) => {
      workspace.newThreadPrompt = prompt;
    },
    getAddDirectoryPrompt: () => workspace.addDirectoryPrompt,
    setAddDirectoryPrompt: (next) => {
      workspace.addDirectoryPrompt = next;
    },
    getRepositoryPrompt: () => workspace.repositoryPrompt,
    setRepositoryPrompt: (next) => {
      workspace.repositoryPrompt = next;
    },
  });

  const leftNavInput = new LeftNavInput({
    getLatestRailRows: () => workspace.latestRailViewRows,
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
    conversations: conversationRecords,
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
    getLatestRailRows: () => workspace.latestRailViewRows,
    hasConversationTitleEdit: () => workspace.conversationTitleEdit !== null,
    conversationTitleEditConversationId: () => workspace.conversationTitleEdit?.conversationId ?? null,
    stopConversationTitleEdit: () => {
      stopConversationTitleEdit(true);
    },
    hasSelection: () => workspace.selection !== null || workspace.selectionDrag !== null,
    clearSelection: () => {
      workspace.selection = null;
      workspace.selectionDrag = null;
      releaseViewportPinForSelection();
    },
    activeConversationId: () => conversationManager.activeConversationId,
    repositoriesCollapsed: () => workspace.repositoriesCollapsed,
    clearConversationTitleEditClickState: () => {
      workspace.conversationTitleEditClickState = null;
    },
    resolveDirectoryForAction,
    openNewThreadPrompt,
    queueArchiveConversation: (conversationId) => {
      queueControlPlaneOp(async () => {
        await archiveConversation(conversationId);
      }, 'mouse-archive-conversation');
    },
    openAddDirectoryPrompt: () => {
      workspace.repositoryPrompt = null;
      workspace.addDirectoryPrompt = {
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
    previousConversationClickState: () => workspace.conversationTitleEditClickState,
    setConversationClickState: (next) => {
      workspace.conversationTitleEditClickState = next;
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
    runTaskPaneAction: (action) => {
      runtimeTaskPaneActions.runTaskPaneAction(action);
    },
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
    openTaskEditPrompt: (taskId) => {
      runtimeTaskPaneActions.openTaskEditPrompt(taskId);
    },
    openRepositoryPromptForEdit,
    markDirty,
  });
  const pointerRoutingInput = new PointerRoutingInput({
    getPaneDividerDragActive: () => workspace.paneDividerDragActive,
    setPaneDividerDragActive: (active) => {
      workspace.paneDividerDragActive = active;
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
    reorderTaskByDrop: (draggedTaskId, targetTaskId) => {
      runtimeTaskPaneActions.reorderTaskByDrop(draggedTaskId, targetTaskId);
    },
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
    getSelection: () => workspace.selection,
    setSelection: (next) => {
      workspace.selection = next;
    },
    getSelectionDrag: () => workspace.selectionDrag,
    setSelectionDrag: (next) => {
      workspace.selectionDrag = next;
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
      workspace.repositoryPrompt = null;
      workspace.addDirectoryPrompt = {
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
      if (workspace.selection !== null || workspace.selectionDrag !== null) {
        workspace.selection = null;
        workspace.selectionDrag = null;
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
    handleTaskPaneShortcutInput: (input) => runtimeTaskPaneShortcuts.handleInput(input),
    handleCopyShortcutInput: (input) => {
      if (
        workspace.mainPaneMode !== 'conversation' ||
        workspace.selection === null ||
        !isCopyShortcutInput(input)
      ) {
        return false;
      }
      const active = conversationManager.getActiveConversation();
      if (active === null) {
        return true;
      }
      const selectedFrame = active.oracle.snapshotWithoutHash();
      const copied = writeTextToClipboard(selectionText(selectedFrame, workspace.selection));
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

  await startupOrchestrator.hydrateStartupState(startupObservedCursor);

  runtimeProcessWiring.attach();

  inputModeManager.enable();
  applyLayout(size, true);
  scheduleRender();
  const runtimeShutdownService = new RuntimeShutdownService({
    screen,
    outputLoadSampler,
    startupBackgroundProbeService: startupOrchestrator,
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
    clearHomePaneBackgroundTimer: () => {
      if (homePaneBackgroundTimer !== null) {
        clearInterval(homePaneBackgroundTimer);
        homePaneBackgroundTimer = null;
      }
    },
    persistMuxUiStateNow,
    clearConversationTitleEditTimer: () => {
      runtimeConversationTitleEdit.clearCurrentTimer();
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
    startupShutdownService: startupOrchestrator,
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

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { startCodexLiveSession } from '../../codex/live-session.ts';
import {
  openCodexControlPlaneClient,
  subscribeControlPlaneKeyEvents,
  type ControlPlaneKeyEvent,
} from '../../control-plane/codex-session-stream.ts';
import { startControlPlaneStreamServer } from '../../control-plane/stream-server.ts';
import type {
  StreamServerEnvelope,
} from '../../control-plane/stream-protocol.ts';
import { SqliteEventStore } from '../../store/event-store.ts';
import { TerminalSnapshotOracle } from '../../terminal/snapshot-oracle.ts';
import type { PtyExit } from '../../pty/pty_host.ts';
import { computeDualPaneLayout } from '../../mux/dual-pane-core.ts';
import {
  loadHarnessConfig,
  updateHarnessConfig,
  updateHarnessMuxUiConfig,
  type HarnessMuxThemeConfig,
} from '../../config/config-core.ts';
import { resolveHarnessRuntimePath } from '../../config/harness-paths.ts';
import { migrateLegacyHarnessLayout } from '../../config/harness-runtime-migration.ts';
import { loadHarnessSecrets, upsertHarnessSecret } from '../../config/secrets-core.ts';
import {
  detectMuxGlobalShortcut,
  resolveMuxShortcutBindings,
} from '../../mux/input-shortcuts.ts';
import { createMuxInputModeManager } from '../../mux/terminal-input-modes.ts';
import type { buildWorkspaceRailViewRows } from '../../mux/workspace-rail-model.ts';
import {
  normalizeThreadAgentType,
  resolveNewThreadPromptAgentByRow,
} from '../../mux/new-thread-prompt.ts';
import {
  CommandMenuRegistry,
  createCommandMenuState,
  filterCommandMenuActionsForScope,
  resolveSelectedCommandMenuActionId,
  summarizeTaskForCommandMenu,
  type CommandMenuActionDescriptor,
  type RegisteredCommandMenuAction,
} from '../../mux/live-mux/command-menu.ts';
import {
  registerCommandMenuOpenInProvider,
  resolveCommandMenuOpenInCommand,
  resolveCommandMenuOpenInTargets,
  type ResolvedCommandMenuOpenInTarget,
} from '../../mux/live-mux/command-menu-open-in.ts';
import {
  buildProjectPaneSnapshotWithOptions,
  projectPaneActionAtRow,
  sortedRepositoryList,
  sortTasksByOrder,
} from '../../mux/harness-core-ui.ts';
import type {
  ProjectPaneGitHubPullRequestSummary,
  ProjectPaneGitHubReviewComment,
  ProjectPaneGitHubReviewSummary,
  ProjectPaneGitHubReviewThread,
} from '../../mux/project-pane-github-review.ts';
import {
  createTaskComposerBuffer,
  normalizeTaskComposerBuffer,
  taskFieldsFromComposerText,
  type TaskComposerBuffer,
} from '../../mux/task-composer.ts';
import { resolveTaskScreenKeybindings } from '../../mux/task-screen-keybindings.ts';
import {
  buildKeybindingCatalogEntries,
  SHORTCUT_CATALOG_ACTION_ID_PREFIX,
  SHOW_KEYBINDINGS_COMMAND_ACTION,
} from '../../mux/keybinding-catalog.ts';
import { applyMuxControlPlaneKeyEvent } from '../../mux/runtime-wiring.ts';
import {
  applyModalOverlay,
  buildRenderRows,
  renderCanonicalFrameAnsi,
} from '../../mux/render-frame.ts';
import { createTerminalRecordingWriter } from '../../recording/terminal-recording.ts';
import { renderTerminalRecordingToGif } from '../../recording/terminal-recording-gif-lib.ts';
import {
  buildAgentSessionStartArgs,
  mergeAdapterStateFromSessionEvent,
  normalizeAdapterState,
} from '../../adapters/agent-session-state.ts';
import {
  configurePerfCore,
  perfNowNs,
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan,
} from '../../perf/perf-core.ts';
import {
  type ControlPlaneConversationRecord,
  type ControlPlaneDirectoryRecord,
  type ControlPlaneRepositoryRecord,
  type ControlPlaneTaskRecord,
  parseRepositoryRecord,
} from '../../core/contracts/records.ts';
import {
  createHarnessSyncedStore,
} from '../../core/store/harness-synced-store.ts';
import {
  leftColsFromPaneWidthPercent,
  paneWidthPercentFromLayout,
} from '../../mux/live-mux/layout.ts';
import {
  normalizeGitHubRemoteUrl,
  resolveGitHubDefaultBranchForActions,
  repositoryNameFromGitHubRemoteUrl,
  resolveGitHubTrackedBranchForActions,
  shouldShowGitHubPrActions,
} from '../../mux/live-mux/git-parsing.ts';
import { readProcessUsageSample, runGitCommand } from '../../mux/live-mux/git-snapshot.ts';
import { probeTerminalPalette } from '../../mux/live-mux/terminal-palette.ts';
import {
  readObservedStreamCursorBaseline,
  subscribeObservedStream,
  unsubscribeObservedStream,
} from '../../mux/live-mux/observed-stream.ts';
import {
  composeDebugStatusFooter,
  createConversationState,
  formatCommandForDebugBar,
  launchCommandForAgent,
  type ConversationState,
} from '../../mux/live-mux/conversation-state.ts';
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
} from '../../mux/live-mux/startup-utils.ts';
import {
  normalizeExitCode,
  isSessionNotFoundError,
  isSessionNotLiveError,
  isConversationNotFoundError,
  mapTerminalOutputToNormalizedEvent,
  mapSessionEventToNormalizedEvent,
  observedAtFromSessionEvent,
} from '../../mux/live-mux/event-mapping.ts';
import { parseMuxArgs } from '../../mux/live-mux/args.ts';
import {
  renderSelectionOverlay,
  selectionText,
  selectionVisibleRows,
  writeTextToClipboard,
} from '../../mux/live-mux/selection.ts';
import { type GitRepositorySnapshot, type GitSummary } from '../../mux/live-mux/git-state.ts';
import { resolveDirectoryForAction as resolveDirectoryForActionFn } from '../../mux/live-mux/directory-resolution.ts';
import { requestStop as requestStopFn } from '../../mux/live-mux/runtime-shutdown.ts';
import {
  hasActiveProfileState,
  resolveProfileStatePath,
  toggleGatewayProfiler as toggleGatewayProfilerFn,
} from '../../mux/live-mux/gateway-profiler.ts';
import { toggleGatewayStatusTimeline as toggleGatewayStatusTimelineFn } from '../../mux/live-mux/gateway-status-timeline.ts';
import { toggleGatewayRenderTrace as toggleGatewayRenderTraceFn } from '../../mux/live-mux/gateway-render-trace.ts';
import { resolveStatusTimelineStatePath } from '../../mux/live-mux/status-timeline-state.ts';
import { resolveRenderTraceStatePath } from '../../mux/live-mux/render-trace-state.ts';
import {
  findRenderTraceControlIssues,
  renderTraceChunkPreview,
} from '../../mux/live-mux/render-trace-analysis.ts';
import {
  buildCritiqueReviewCommand,
  resolveCritiqueReviewAgent,
  resolveCritiqueReviewBaseBranch,
} from '../../mux/live-mux/critique-review.ts';
import { WorkspaceModel } from '../../domain/workspace.ts';
import { ConversationManager, type ConversationSeed } from '../../domain/conversations.ts';
import { RepositoryManager } from '../../domain/repositories.ts';
import { DirectoryManager } from '../../domain/directories.ts';
import { TaskManager } from '../../domain/tasks.ts';
import { ControlPlaneService } from '../../services/control-plane.ts';
import { ConversationLifecycle } from '../../services/conversation-lifecycle.ts';
import { DirectoryHydrationService } from '../../services/directory-hydration.ts';
import { EventPersistence } from '../../services/event-persistence.ts';
import { MuxUiStatePersistence } from '../../services/mux-ui-state-persistence.ts';
import { OutputLoadSampler } from '../../services/output-load-sampler.ts';
import { ProcessUsageRefreshService } from '../../services/process-usage-refresh.ts';
import { RecordingService } from '../../services/recording.ts';
import { SessionProjectionInstrumentation } from '../../services/session-projection-instrumentation.ts';
import { StartupOrchestrator } from '../../services/startup-orchestrator.ts';
import { attachRuntimeProcessWiring } from '../../services/runtime-process-wiring.ts';
import { RuntimeControlPlaneOps } from '../../services/runtime-control-plane-ops.ts';
import { RuntimeControlActions } from '../../services/runtime-control-actions.ts';
import { createRuntimeDirectoryActions } from '../../services/runtime-directory-actions.ts';
import { RuntimeEnvelopeHandler } from '../../services/runtime-envelope-handler.ts';
import {
  applyRuntimeObservedEventProjection,
  type RuntimeObservedEventProjectionPipelineOptions,
} from '../../services/runtime-observed-event-projection-pipeline.ts';
import { createRuntimeRenderPipeline } from '../../services/runtime-render-pipeline.ts';
import { RuntimeRepositoryActions } from '../../services/runtime-repository-actions.ts';
import { RuntimeGitState } from '../../services/runtime-git-state.ts';
import { RuntimeLayoutResize } from '../../services/runtime-layout-resize.ts';
import { RuntimeRenderLifecycle } from '../../services/runtime-render-lifecycle.ts';
import { finalizeRuntimeShutdown } from '../../services/runtime-shutdown.ts';
import { RuntimeTaskEditorActions } from '../../services/runtime-task-editor-actions.ts';
import { RuntimeTaskComposerPersistenceService } from '../../services/runtime-task-composer-persistence.ts';
import { RuntimeTaskPaneActions } from '../../services/runtime-task-pane-actions.ts';
import { RuntimeTaskPaneShortcuts } from '../../services/runtime-task-pane-shortcuts.ts';
import { RuntimeProjectPaneGitHubReviewCache } from '../../services/runtime-project-pane-github-review-cache.ts';
import { TaskPaneSelectionActions } from '../../services/task-pane-selection-actions.ts';
import { TaskPlanningHydrationService } from '../../services/task-planning-hydration.ts';
import { TaskPlanningSyncedProjection } from '../../services/task-planning-observed-events.ts';
import {
  RuntimeCommandMenuAgentTools,
  type InstallableAgentType,
} from '../../services/runtime-command-menu-agent-tools.ts';
import { WorkspaceSyncedProjection } from '../../services/workspace-observed-events.ts';
import { subscribeRuntimeWorkspaceObservedEvents } from '../../services/runtime-workspace-observed-events.ts';
import { StartupStateHydrationService } from '../../services/startup-state-hydration.ts';
import {
  StatusTimelineRecorder,
  type StatusTimelineLabels,
} from '../../services/status-timeline-recorder.ts';
import {
  RenderTraceRecorder,
  type RenderTraceLabels,
} from '../../services/render-trace-recorder.ts';
import {
  ProcessScreenWriter,
  Screen,
  type ScreenCursorStyle,
} from '../../../packages/harness-ui/src/screen.ts';
import { InputRouter } from '../../../packages/harness-ui/src/interaction/input.ts';
import { ConversationPane } from '../../ui/panes/conversation.ts';
import { DebugFooterNotice } from '../../ui/debug-footer-notice.ts';
import { HomePane } from '../../ui/panes/home.ts';
import { ProjectPane } from '../../ui/panes/project.ts';
import { LeftRailPane } from '../../ui/panes/left-rail.ts';
import { ModalManager } from '../../../packages/harness-ui/src/modal-manager.ts';
import { UiKit } from '../../../packages/harness-ui/src/kit.ts';
import {
  buildAddDirectoryModalOverlay as buildAddDirectoryModalOverlayFrame,
  buildApiKeyModalOverlay as buildApiKeyModalOverlayFrame,
  buildCommandMenuModalOverlay as buildCommandMenuModalOverlayFrame,
  buildConversationTitleModalOverlay as buildConversationTitleModalOverlayFrame,
  buildNewThreadModalOverlay as buildNewThreadModalOverlayFrame,
  buildReleaseNotesModalOverlay as buildReleaseNotesModalOverlayFrame,
  buildRepositoryModalOverlay as buildRepositoryModalOverlayFrame,
  buildTaskEditorModalOverlay as buildTaskEditorModalOverlayFrame,
} from '../../mux/live-mux/modal-overlays.ts';
import { dismissModalOnOutsideClick as dismissModalOnOutsideClickFrame } from '../../mux/live-mux/modal-pointer.ts';
import { handleCommandMenuInput } from '../../mux/live-mux/modal-command-menu-handler.ts';
import {
  handleConversationTitleEditInput,
  handleNewThreadPromptInput,
} from '../../mux/live-mux/modal-conversation-handlers.ts';
import {
  handleAddDirectoryPromptInput,
  handleApiKeyPromptInput,
  handleRepositoryPromptInput,
} from '../../mux/live-mux/modal-prompt-handlers.ts';
import { handleTaskEditorPromptInput } from '../../mux/live-mux/modal-task-editor-handler.ts';
import { handleReleaseNotesModalInput } from '../../mux/live-mux/modal-release-notes-handler.ts';
import {
  fetchReleaseNotesPrompt,
  readInstalledHarnessVersion,
  readReleaseNotesState,
  resolveReleaseNotesStatePath,
  writeReleaseNotesState,
  type ReleaseNotesPrompt,
  type ReleaseNotesState,
} from '../../mux/live-mux/release-notes.ts';
import { createTuiLeftRailInteractions } from '../../clients/tui/left-rail-interactions.ts';
import { createTuiMainPaneInteractions } from '../../clients/tui/main-pane-interactions.ts';
import {
  createTuiModalInputRemainderState,
  routeTuiModalInput,
} from '../../clients/tui/modal-input-routing.ts';
import { readTuiRenderSnapshot } from '../../clients/tui/render-snapshot-adapter.ts';
import {
  getActiveMuxTheme,
  muxThemePresetNames,
  resolveConfiguredMuxTheme,
  setActiveMuxTheme,
} from '../../ui/mux-theme.ts';

const UI_KIT = new UiKit();

type ControlPlaneSessionSummary = NonNullable<
  Awaited<ReturnType<ControlPlaneService['getSessionStatus']>>
>;
type ControlPlaneDirectoryGitStatusRecord = Awaited<
  ReturnType<ControlPlaneService['listDirectoryGitStatuses']>
>[number];

type ProcessUsageSample = Awaited<ReturnType<typeof readProcessUsageSample>>;

interface RuntimeCommandMenuContext {
  readonly activeDirectoryId: string | null;
  readonly activeConversationId: string | null;
  readonly selectedText: string;
  readonly linearEnabled: boolean;
  readonly leftNavSelectionKind: WorkspaceModel['leftNavSelection']['kind'];
  readonly taskPaneActive: boolean;
  readonly taskSelectedTaskId: string | null;
  readonly taskSelectedTaskStatus: ControlPlaneTaskRecord['status'] | null;
  readonly taskSelectedTaskSummary: string | null;
  readonly profileRunning: boolean;
  readonly statusTimelineRunning: boolean;
  readonly githubRepositoryId: string | null;
  readonly githubRepositoryUrl: string | null;
  readonly githubDefaultBranch: string | null;
  readonly githubTrackedBranch: string | null;
  readonly githubOpenPrUrl: string | null;
  readonly githubProjectPrLoading: boolean;
}

interface CommandMenuGitHubProjectPrState {
  readonly directoryId: string;
  readonly branchName: string | null;
  readonly openPrUrl: string | null;
  readonly loading: boolean;
}

interface GitHubDebugAuthState {
  enabled: boolean;
  token: 'env' | 'gh' | 'none';
  auth: 'ok' | 'no' | 'er' | 'na' | 'uk';
  projectPr: 'ok' | 'er' | 'na';
}

interface ThemePickerSessionState {
  readonly initialThemeConfig: HarnessMuxThemeConfig | null;
  committed: boolean;
  previewActionId: string | null;
}

interface AllowedCommandMenuApiKey {
  readonly actionIdSuffix: string;
  readonly envVar: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'LINEAR_API_KEY';
  readonly displayName: string;
  readonly aliases: readonly string[];
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
const HOME_PANE_BACKGROUND_INTERVAL_MS = 80;
const UI_STATE_PERSIST_DEBOUNCE_MS = 200;
const PROJECT_PANE_GITHUB_REVIEW_TTL_MS = 600_000;
const PROJECT_PANE_GITHUB_REVIEW_REFRESH_INTERVAL_MS = 300_000;
const UNTRACKED_REPOSITORY_GROUP_ID = 'untracked';
const THEME_PICKER_SCOPE = 'theme-select';
const SHORTCUTS_SCOPE = 'shortcuts';
const THEME_ACTION_ID_PREFIX = 'theme.set.';
const API_KEY_ACTION_ID_PREFIX = 'api-key.set.';
const RELEASE_NOTES_PREVIEW_LINE_COUNT = 6;
const RELEASE_NOTES_MAX_RELEASES = 3;
const COMMAND_MENU_ALLOWED_API_KEYS: readonly AllowedCommandMenuApiKey[] = [
  {
    actionIdSuffix: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    displayName: 'Anthropic API Key',
    aliases: ['anthropic api key', 'claude api key'],
  },
  {
    actionIdSuffix: 'openai',
    envVar: 'OPENAI_API_KEY',
    displayName: 'OpenAI API Key',
    aliases: ['openai api key', 'codex api key'],
  },
  {
    actionIdSuffix: 'linear',
    envVar: 'LINEAR_API_KEY',
    displayName: 'Linear API Key',
    aliases: ['linear api key'],
  },
];
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function parseGitHubReviewComment(value: unknown): ProjectPaneGitHubReviewComment | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const commentId = asStringOrNull(record['commentId']);
  const body = asStringOrNull(record['body']);
  const createdAt = asStringOrNull(record['createdAt']);
  const updatedAt = asStringOrNull(record['updatedAt']);
  if (commentId === null || body === null || createdAt === null || updatedAt === null) {
    return null;
  }
  return {
    commentId,
    authorLogin: asStringOrNull(record['authorLogin']),
    body,
    url: asStringOrNull(record['url']),
    createdAt,
    updatedAt,
  };
}

function parseGitHubReviewThread(value: unknown): ProjectPaneGitHubReviewThread | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const threadId = asStringOrNull(record['threadId']);
  const isResolved = record['isResolved'];
  const isOutdated = record['isOutdated'];
  const commentsRaw = record['comments'];
  if (
    threadId === null ||
    typeof isResolved !== 'boolean' ||
    typeof isOutdated !== 'boolean' ||
    !Array.isArray(commentsRaw)
  ) {
    return null;
  }
  const comments: ProjectPaneGitHubReviewComment[] = [];
  for (const value of commentsRaw) {
    const parsed = parseGitHubReviewComment(value);
    if (parsed === null) {
      continue;
    }
    comments.push(parsed);
  }
  return {
    threadId,
    isResolved,
    isOutdated,
    resolvedByLogin: asStringOrNull(record['resolvedByLogin']),
    comments,
  };
}

function parseGitHubReviewPrState(
  value: unknown,
): ProjectPaneGitHubPullRequestSummary['state'] | null {
  if (value === 'draft' || value === 'open' || value === 'merged' || value === 'closed') {
    return value;
  }
  return null;
}

function parseGitHubReviewPullRequest(value: unknown): ProjectPaneGitHubPullRequestSummary | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const number = record['number'];
  const title = asStringOrNull(record['title']);
  const url = asStringOrNull(record['url']);
  const headBranch = asStringOrNull(record['headBranch']);
  const baseBranch = asStringOrNull(record['baseBranch']);
  const state = parseGitHubReviewPrState(record['state']);
  const isDraft = record['isDraft'];
  const updatedAt = asStringOrNull(record['updatedAt']);
  const createdAt = asStringOrNull(record['createdAt']);
  if (
    typeof number !== 'number' ||
    title === null ||
    url === null ||
    headBranch === null ||
    baseBranch === null ||
    state === null ||
    typeof isDraft !== 'boolean' ||
    updatedAt === null ||
    createdAt === null
  ) {
    return null;
  }
  return {
    number,
    title,
    url,
    authorLogin: asStringOrNull(record['authorLogin']),
    headBranch,
    baseBranch,
    state,
    isDraft,
    mergedAt: asStringOrNull(record['mergedAt']),
    closedAt: asStringOrNull(record['closedAt']),
    updatedAt,
    createdAt,
  };
}

function parseGitHubProjectReviewState(
  result: Record<string, unknown>,
): ProjectPaneGitHubReviewSummary | null {
  const branchName = asStringOrNull(result['branchName']);
  const branchSourceRaw = result['branchSource'];
  const branchSource =
    branchSourceRaw === 'pinned' || branchSourceRaw === 'current' ? branchSourceRaw : null;
  const pr = parseGitHubReviewPullRequest(result['pr']);
  const openThreadsRaw = result['openThreads'];
  const resolvedThreadsRaw = result['resolvedThreads'];
  if (!Array.isArray(openThreadsRaw) || !Array.isArray(resolvedThreadsRaw)) {
    return null;
  }
  const openThreads: ProjectPaneGitHubReviewThread[] = [];
  for (const value of openThreadsRaw) {
    const parsed = parseGitHubReviewThread(value);
    if (parsed !== null) {
      openThreads.push(parsed);
    }
  }
  const resolvedThreads: ProjectPaneGitHubReviewThread[] = [];
  for (const value of resolvedThreadsRaw) {
    const parsed = parseGitHubReviewThread(value);
    if (parsed !== null) {
      resolvedThreads.push(parsed);
    }
  }
  return {
    status: 'ready',
    branchName,
    branchSource,
    pr,
    openThreads,
    resolvedThreads,
    errorMessage: null,
  };
}

function parseGitHubProjectPrState(
  directoryId: string,
  result: Record<string, unknown>,
): CommandMenuGitHubProjectPrState {
  const branchNameRaw = result['branchName'];
  const branchName = typeof branchNameRaw === 'string' ? branchNameRaw : null;
  const pr = asRecord(result['pr']);
  const prUrlRaw = pr?.['url'];
  const openPrUrl = typeof prUrlRaw === 'string' ? prUrlRaw : null;
  return {
    directoryId,
    branchName,
    openPrUrl,
    loading: false,
  };
}

function parseGitHubPrUrl(result: Record<string, unknown>): string | null {
  const pr = asRecord(result['pr']);
  if (pr === null) {
    return null;
  }
  const url = pr['url'];
  return typeof url === 'string' ? url : null;
}

function parseGitHubUrl(result: Record<string, unknown>): string | null {
  const url = result['url'];
  if (typeof url !== 'string') {
    return null;
  }
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractLinearIssueUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const urlMatches = trimmed.match(/https?:\/\/\S+/gu);
  const candidates = urlMatches ?? [trimmed];
  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/[),.;!?]+$/u, '');
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') {
      continue;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!(hostname === 'linear.app' || hostname.endsWith('.linear.app'))) {
      continue;
    }
    if (!parsed.pathname.toLowerCase().includes('/issue/')) {
      continue;
    }
    return parsed.toString();
  }
  return null;
}

function commandMenuProjectPathTail(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/').replace(/\/+$/u, '');
  if (normalized.length === 0) {
    return '(project)';
  }
  if (normalized === '/') {
    return '/';
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return normalized;
  }
  if (segments.length <= 2) {
    return segments.join('/');
  }
  return `…/${segments.slice(-2).join('/')}`;
}

function openUrlInBrowser(url: string): boolean {
  const target = url.trim();
  if (target.length === 0) {
    return false;
  }
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [target], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return true;
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    const child = spawn('xdg-open', [target], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function isMacApplicationInstalled(appName: string): boolean {
  const target = appName.trim();
  if (target.length === 0 || process.platform !== 'darwin') {
    return false;
  }
  try {
    execFileSync('open', ['-Ra', target], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function commandExistsOnPath(command: string): boolean {
  const normalized = command.trim();
  if (normalized.length === 0) {
    return false;
  }
  try {
    if (process.platform === 'win32') {
      execFileSync('where', [normalized], {
        stdio: 'ignore',
      });
      return true;
    }
    execFileSync('sh', ['-lc', `command -v ${normalized} >/dev/null 2>&1`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function readGhAuthTokenForDebug(): string | null {
  try {
    const stdout = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      windowsHide: true,
    });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function formatGitHubDebugTokens(state: GitHubDebugAuthState): string {
  if (!state.enabled) {
    return '[gh:off tk:na au:na pr:na]';
  }
  return `[gh:on tk:${state.token} au:${state.auth} pr:${state.projectPr}]`;
}

class CodexLiveMuxRuntimeApplication {
  async run(): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write('codex:live:mux requires a TTY stdin/stdout\n');
      return 2;
    }

    const invocationDirectory =
      process.env.HARNESS_INVOKE_CWD ?? process.env.INIT_CWD ?? process.cwd();
    migrateLegacyHarnessLayout(invocationDirectory, process.env);
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
    const perfFilePath = resolveHarnessRuntimePath(
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
    const keybindingCatalogEntries = buildKeybindingCatalogEntries({
      globalBindings: shortcutBindings,
      taskScreenKeybindings,
    });
    const modalDismissShortcutBindings = resolveMuxShortcutBindings({
      'mux.app.quit': ['escape'],
      'mux.app.interrupt-all': [],
      'mux.gateway.profile.toggle': [],
      'mux.gateway.status-timeline.toggle': [],
      'mux.conversation.new': [],
      'mux.conversation.critique.open-or-create': [],
      'mux.conversation.next': [],
      'mux.conversation.previous': [],
      'mux.conversation.interrupt': [],
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
    const showTasksEntry = configuredMuxUi.showTasks;
    const commandMenuOpenInTargets = resolveCommandMenuOpenInTargets({
      platform: process.platform,
      overrides: loadedConfig.config.mux.openIn.targets,
      isCommandAvailable: commandExistsOnPath,
      isMacApplicationInstalled,
    });
    let runtimeThemeConfig: HarnessMuxThemeConfig | null = configuredMuxUi.theme;
    const resolveAndApplyRuntimeTheme = (
      nextThemeConfig: HarnessMuxThemeConfig | null,
      writeErrorToStderr = false,
    ) => {
      const resolved = resolveConfiguredMuxTheme({
        config: nextThemeConfig,
        cwd: options.invocationDirectory,
      });
      if (resolved.error !== null && writeErrorToStderr) {
        process.stderr.write(`[theme] ${resolved.error}; using preset fallback\n`);
      }
      setActiveMuxTheme(resolved.theme);
      runtimeThemeConfig = nextThemeConfig;
      return resolved;
    };
    const resolvedMuxTheme = resolveAndApplyRuntimeTheme(runtimeThemeConfig, true);
    let currentModalTheme = resolvedMuxTheme.theme.modalTheme;
    const installedHarnessVersion = readInstalledHarnessVersion();
    const releaseNotesStatePath = resolveReleaseNotesStatePath(
      options.invocationDirectory,
      process.env,
    );
    let releaseNotesState = readReleaseNotesState(releaseNotesStatePath);
    let cachedReleaseNotesPrompt: ReleaseNotesPrompt | null = null;
    let releaseNotesPrompt: ReleaseNotesPrompt | null = null;
    const configuredMuxGit = loadedConfig.config.mux.git;
    const githubTokenEnvVar = loadedConfig.config.github.tokenEnvVar;
    const envGitHubTokenRaw = process.env[githubTokenEnvVar];
    const hasEnvGitHubToken =
      typeof envGitHubTokenRaw === 'string' && envGitHubTokenRaw.trim().length > 0;
    const githubDebugAuthState: GitHubDebugAuthState = {
      enabled: loadedConfig.config.github.enabled,
      token: hasEnvGitHubToken ? 'env' : 'none',
      auth: loadedConfig.config.github.enabled ? (hasEnvGitHubToken ? 'ok' : 'uk') : 'na',
      projectPr: 'na',
    };
    if (githubDebugAuthState.enabled && !hasEnvGitHubToken) {
      const ghToken = commandExistsOnPath('gh') ? readGhAuthTokenForDebug() : null;
      if (ghToken !== null) {
        githubDebugAuthState.token = 'gh';
        githubDebugAuthState.auth = 'ok';
      } else {
        githubDebugAuthState.token = 'none';
        githubDebugAuthState.auth = 'no';
      }
    }
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
    const resolvedTerminalForegroundHex =
      resolvedMuxTheme.theme.terminalForegroundHex ??
      process.env.HARNESS_TERM_FG ??
      probedPalette.foregroundHex;
    const resolvedTerminalBackgroundHex =
      resolvedMuxTheme.theme.terminalBackgroundHex ??
      process.env.HARNESS_TERM_BG ??
      probedPalette.backgroundHex;
    let muxRecordingWriter: ReturnType<typeof createTerminalRecordingWriter> | null = null;
    let muxRecordingOracle: TerminalSnapshotOracle | null = null;
    if (options.recordingPath !== null) {
      mkdirSync(dirname(options.recordingPath), { recursive: true });
      const recordIntervalMs = Math.max(1, Math.floor(1000 / options.recordingFps));
      const recordingWriterOptions: Parameters<typeof createTerminalRecordingWriter>[0] = {
        filePath: options.recordingPath,
        source: 'codex-live-mux',
        defaultForegroundHex: resolvedTerminalForegroundHex ?? 'd0d7de',
        defaultBackgroundHex: resolvedTerminalBackgroundHex ?? '0f1419',
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
          stateStorePath: resolveHarnessRuntimePath(
            options.invocationDirectory,
            '.harness/control-plane.sqlite',
          ),
          codexTelemetry: loadedConfig.config.codex.telemetry,
          codexHistory: loadedConfig.config.codex.history,
          critique: loadedConfig.config.critique,
          agentInstall: {
            codex: loadedConfig.config.codex.install,
            claude: loadedConfig.config.claude.install,
            cursor: loadedConfig.config.cursor.install,
            critique: loadedConfig.config.critique.install,
          },
          gitStatus: {
            enabled: loadedConfig.config.mux.git.enabled,
            pollMs: loadedConfig.config.mux.git.idlePollMs,
            maxConcurrency: loadedConfig.config.mux.git.maxConcurrency,
            minDirectoryRefreshMs: Math.max(loadedConfig.config.mux.git.idlePollMs, 30_000),
          },
          github: {
            enabled: loadedConfig.config.github.enabled,
            apiBaseUrl: loadedConfig.config.github.apiBaseUrl,
            tokenEnvVar: loadedConfig.config.github.tokenEnvVar,
            pollMs: loadedConfig.config.github.pollMs,
            maxConcurrency: loadedConfig.config.github.maxConcurrency,
            branchStrategy: loadedConfig.config.github.branchStrategy,
            viewerLogin: loadedConfig.config.github.viewerLogin,
          },
          linear: {
            enabled: loadedConfig.config.linear.enabled,
            apiBaseUrl: loadedConfig.config.linear.apiBaseUrl,
            tokenEnvVar: loadedConfig.config.linear.tokenEnvVar,
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
    const startupObservedCursor = await readObservedStreamCursorBaseline(
      streamClient,
      options.scope,
    );
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
      showDebugBar: configuredMuxUi.showDebugBar,
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

    const sessionEnv: Record<string, string> = {
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
    const repositoryAssociationByDirectoryId = repositoryManager.mutableDirectoryAssociations();
    const directoryRepositorySnapshotByDirectoryId = repositoryManager.mutableDirectorySnapshots();
    const muxControllerId = `human-mux-${process.pid}-${randomUUID()}`;
    const muxControllerLabel = `human mux ${process.pid}`;
    const conversationManager = new ConversationManager();
    const conversationRecords = conversationManager.readonlyConversations();
    const taskManager = new TaskManager<
      ControlPlaneTaskRecord,
      TaskComposerBuffer,
      NodeJS.Timeout
    >();
    const statusTimelineRecorder = new StatusTimelineRecorder({
      statePath: resolveStatusTimelineStatePath(options.invocationDirectory, muxSessionName),
    });
    const renderTraceRecorder = new RenderTraceRecorder({
      statePath: resolveRenderTraceStatePath(options.invocationDirectory, muxSessionName),
    });
    const resolveTraceLabels = (input: {
      sessionId: string | null;
      directoryId: string | null;
      conversationId: string | null;
    }): RenderTraceLabels => {
      const conversation =
        input.sessionId === null
          ? input.conversationId === null
            ? null
            : (conversationManager.get(input.conversationId) ?? null)
          : (conversationManager.get(input.sessionId) ?? null);
      const resolvedDirectoryId = input.directoryId ?? conversation?.directoryId ?? null;
      const directory =
        resolvedDirectoryId === null ? null : directoryManager.getDirectory(resolvedDirectoryId);
      const repositoryId =
        resolvedDirectoryId === null
          ? null
          : (repositoryAssociationByDirectoryId.get(resolvedDirectoryId) ?? null);
      const repository = repositoryId === null ? null : (repositories.get(repositoryId) ?? null);
      return {
        repositoryId,
        repositoryName: repository?.name ?? null,
        projectId: resolvedDirectoryId,
        projectPath: directory?.path ?? null,
        threadId: input.sessionId ?? conversation?.sessionId ?? null,
        threadTitle: conversation?.title ?? null,
        agentType: conversation?.agentType ?? null,
        conversationId: input.conversationId ?? conversation?.sessionId ?? null,
      };
    };
    const recordStatusTimeline = (input: {
      direction: 'incoming' | 'outgoing';
      source: string;
      eventType: string;
      labels: StatusTimelineLabels;
      payload: unknown;
      dedupeKey?: string;
      dedupeValue?: string;
    }): void => {
      const baseRecordInput = {
        direction: input.direction,
        source: input.source,
        eventType: input.eventType,
        labels: input.labels,
        payload: input.payload,
      };
      const recordInput: Parameters<StatusTimelineRecorder['record']>[0] =
        input.dedupeKey !== undefined && input.dedupeValue !== undefined
          ? {
              ...baseRecordInput,
              dedupeKey: input.dedupeKey,
              dedupeValue: input.dedupeValue,
            }
          : baseRecordInput;
      statusTimelineRecorder.record(recordInput);
    };
    const recordRenderTrace = (input: {
      direction: 'incoming' | 'outgoing';
      source: string;
      eventType: string;
      labels: RenderTraceLabels;
      payload: unknown;
      dedupeKey?: string;
      dedupeValue?: string;
    }): void => {
      const baseRecordInput = {
        direction: input.direction,
        source: input.source,
        eventType: input.eventType,
        labels: input.labels,
        payload: input.payload,
      };
      const recordInput: Parameters<RenderTraceRecorder['record']>[0] =
        input.dedupeKey !== undefined && input.dedupeValue !== undefined
          ? {
              ...baseRecordInput,
              dedupeKey: input.dedupeKey,
              dedupeValue: input.dedupeValue,
            }
          : baseRecordInput;
      renderTraceRecorder.record(recordInput);
    };
    let keyEventSubscription: Awaited<ReturnType<typeof subscribeControlPlaneKeyEvents>> | null =
      null;
    let hydrateStartupStateForStartupOrchestrator = async (
      _afterCursor: number | null,
    ): Promise<void> => {};
    let queuePersistedConversationsForStartupOrchestrator = (
      _activeSessionId: string | null,
    ): number => 0;
    let activateConversationForStartupOrchestrator = async (
      _sessionId: string,
    ): Promise<void> => {};
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
      workspace.activeDirectoryId = directoryManager.resolveActiveDirectoryId(
        workspace.activeDirectoryId,
      );
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
        existing === undefined
          ? null
          : sessionProjectionInstrumentation.snapshotForConversation(existing);
      const updated = applyMuxControlPlaneKeyEvent(event, {
        removedConversationIds: conversationManager.removedConversationIds,
        ensureConversation,
      });
      if (updated === null) {
        return;
      }
      if (event.type === 'session-status') {
        if (event.live) {
          void conversationLifecycle.subscribeConversationEvents(event.sessionId).catch(() => {});
        } else {
          void conversationLifecycle.unsubscribeConversationEvents(event.sessionId).catch(() => {});
        }
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
      repositoryManager.syncWithDirectories((directoryId) =>
        directoryManager.hasDirectory(directoryId),
      );
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

    const conversationLifecycle = new ConversationLifecycle<
      ConversationState,
      ControlPlaneSessionSummary,
      ConversationState['controller']
    >({
      streamSubscriptions: {
        subscribePtyEvents: async (sessionId) => {
          await controlPlaneService.subscribePtyEvents(sessionId);
        },
        unsubscribePtyEvents: async (sessionId) => {
          await controlPlaneService.unsubscribePtyEvents(sessionId);
        },
        isSessionNotFoundError,
        isSessionNotLiveError,
        subscribeObservedStream: async (afterCursor) => {
          return await subscribeObservedStream(streamClient, options.scope, afterCursor);
        },
        unsubscribeObservedStream: async (subscriptionId) => {
          await unsubscribeObservedStream(streamClient, subscriptionId);
        },
      },
      starter: {
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
        terminalForegroundHex: resolvedTerminalForegroundHex,
        terminalBackgroundHex: resolvedTerminalBackgroundHex,
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
      },
      startupHydration: {
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
      },
      startupQueue: {
        orderedConversationIds: () => conversationManager.orderedIds(),
        conversationById: (sessionId) => conversationManager.get(sessionId),
        queueBackgroundOp: (task, label) => {
          queueBackgroundControlPlaneOp(task, label);
        },
        markDirty: () => {
          markDirty();
        },
      },
      activation: {
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
          if (
            workspace.conversationTitleEdit !== null &&
            workspace.conversationTitleEdit.conversationId !== sessionId
          ) {
            stopConversationTitleEdit(true);
          }
        },
        clearSelectionState: () => {
          workspace.selection = null;
          workspace.selectionDrag = null;
          releaseViewportPinForSelection();
        },
        detachConversation: async (sessionId) => {
          await detachConversation(sessionId);
        },
        conversationById: (sessionId) => conversationManager.get(sessionId),
        noteGitActivity: (directoryId) => {
          noteGitActivity(directoryId);
        },
        attachConversation: async (sessionId) => {
          await attachConversation(sessionId);
        },
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
        markDirty: () => {
          markDirty();
        },
      },
      actions: {
        controlPlaneService,
        createConversationId: () => `conversation-${randomUUID()}`,
        ensureConversation,
        noteGitActivity: (directoryId) => {
          noteGitActivity(directoryId);
        },
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
        markDirty: () => {
          markDirty();
        },
      },
      titleEdit: {
        workspace,
        updateConversationTitle: async (input) => {
          return await controlPlaneService.updateConversationTitle(input);
        },
        conversationById: (conversationId) => conversationManager.get(conversationId),
        markDirty: () => {
          markDirty();
        },
        queueControlPlaneOp: (task, label) => {
          queueControlPlaneOp(task, label);
        },
        debounceMs: DEFAULT_CONVERSATION_TITLE_EDIT_DEBOUNCE_MS,
      },
    });

    const queuePersistedConversationsInBackground = (activeSessionId: string | null): number => {
      return conversationLifecycle.queuePersistedConversationsInBackground(activeSessionId);
    };

    const hydrateConversationList = async (): Promise<void> => {
      await conversationLifecycle.hydrateConversationList();
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
      subscribeTaskPlanningEvents: async (afterCursor) => {
        await conversationLifecycle.subscribeTaskPlanningEvents(afterCursor);
      },
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

    const runtimeGitState = new RuntimeGitState<ControlPlaneRepositoryRecord>({
      enabled: configuredMuxGit.enabled,
      directoryManager,
      directoryRepositorySnapshotByDirectoryId,
      repositoryAssociationByDirectoryId,
      repositories,
      parseRepositoryRecord,
      loadingSummary: GIT_SUMMARY_LOADING,
      emptyRepositorySnapshot: GIT_REPOSITORY_NONE,
      syncRepositoryAssociationsWithDirectorySnapshots,
      syncTaskPaneRepositorySelection: () => {
        syncTaskPaneRepositorySelection();
      },
      markDirty: () => {
        markDirty();
      },
    });
    const deleteDirectoryGitState = (directoryId: string): void => {
      runtimeGitState.deleteDirectoryGitState(directoryId);
    };
    const syncGitStateWithDirectories = (): void => {
      runtimeGitState.syncGitStateWithDirectories();
    };
    const noteGitActivity = (directoryId: string | null): void => {
      runtimeGitState.noteGitActivity(directoryId);
    };

    const idFactory = (): string => `event-${randomUUID()}`;
    let exit: PtyExit | null = null;
    class MuxScreenWriter extends ProcessScreenWriter {
      override writeError(output: string): void {
        super.writeError(output);
        const prefix = '[mux] ansi-integrity-failed ';
        const prefixIndex = output.indexOf(prefix);
        if (prefixIndex < 0) {
          return;
        }
        const issueText = output.slice(prefixIndex + prefix.length).trim();
        const issues = issueText
          .split(' | ')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        const activeConversationId = conversationManager.activeConversationId;
        const labels = resolveTraceLabels({
          sessionId: activeConversationId,
          directoryId: workspace.activeDirectoryId,
          conversationId: activeConversationId,
        });
        recordRenderTrace({
          direction: 'outgoing',
          source: 'screen',
          eventType: 'ansi-integrity-failed',
          labels,
          payload: {
            issues,
            message: issueText,
          },
          dedupeKey: 'ansi-integrity-failed',
          dedupeValue: issueText,
        });
      }
    }
    const screen = new Screen(new MuxScreenWriter());
    const conversationPane = new ConversationPane();
    const homePane = new HomePane();
    const projectPane = new ProjectPane();
    const leftRailPane = new LeftRailPane();
    let stop = false;
    const modalInputRemainderState = createTuiModalInputRemainderState();
    const debugFooterNotice = new DebugFooterNotice({
      ttlMs: DEBUG_FOOTER_NOTICE_TTL_MS,
    });
    const commandMenuRegistry = new CommandMenuRegistry<RuntimeCommandMenuContext>();
    let commandMenuGitHubProjectPrState: CommandMenuGitHubProjectPrState | null = null;
    const projectPaneGitHubReviewByDirectoryId = new Map<string, ProjectPaneGitHubReviewSummary>();
    const projectPaneGitHubExpandedNodeIdsByDirectoryId = new Map<string, Set<string>>();
    let commandMenuScopedDirectoryId: string | null = null;
    let themePickerSession: ThemePickerSessionState | null = null;
    const isThreadScopedCommandActionId = (actionId: string): boolean =>
      actionId.startsWith('thread.start.') || actionId.startsWith('thread.install.');
    const commandMenuContext = (
      input: {
        readonly preferThreadScope?: boolean;
      } = {},
    ): RuntimeCommandMenuContext => {
      const activeConversation = conversationManager.getActiveConversation();
      const scopedDirectoryId =
        (input.preferThreadScope === true || workspace.commandMenu?.scope === 'thread-start') &&
        commandMenuScopedDirectoryId !== null &&
        directoryManager.hasDirectory(commandMenuScopedDirectoryId)
          ? commandMenuScopedDirectoryId
          : null;
      const activeDirectoryId = scopedDirectoryId ?? resolveDirectoryForAction();
      const activeDirectoryRepositorySnapshot =
        activeDirectoryId === null
          ? null
          : (directoryRepositorySnapshotByDirectoryId.get(activeDirectoryId) ?? null);
      const snapshotRemoteUrl = activeDirectoryRepositorySnapshot?.normalizedRemoteUrl ?? null;
      let githubRepositoryUrl =
        snapshotRemoteUrl === null ? null : normalizeGitHubRemoteUrl(snapshotRemoteUrl);
      let githubRepositoryId =
        activeDirectoryId === null
          ? null
          : (repositoryAssociationByDirectoryId.get(activeDirectoryId) ?? null);
      if (githubRepositoryId !== null) {
        const associatedRepository = repositories.get(githubRepositoryId);
        if (associatedRepository === undefined || associatedRepository.archivedAt !== null) {
          githubRepositoryId = null;
        } else {
          const normalizedAssociatedRemote = normalizeGitHubRemoteUrl(
            associatedRepository.remoteUrl,
          );
          if (normalizedAssociatedRemote === null) {
            githubRepositoryId = null;
          } else if (githubRepositoryUrl === null) {
            githubRepositoryUrl = normalizedAssociatedRemote;
          }
        }
      }
      if (githubRepositoryId === null && snapshotRemoteUrl !== null) {
        const snapshotRemote = normalizeGitHubRemoteUrl(snapshotRemoteUrl);
        if (snapshotRemote !== null) {
          githubRepositoryUrl = snapshotRemote;
          for (const repository of repositories.values()) {
            if (repository.archivedAt !== null) {
              continue;
            }
            if (normalizeGitHubRemoteUrl(repository.remoteUrl) === snapshotRemote) {
              githubRepositoryId = repository.repositoryId;
              break;
            }
          }
        }
      }
      const githubRepositoryRecord =
        githubRepositoryId === null ? null : (repositories.get(githubRepositoryId) ?? null);
      const githubProjectPrState =
        activeDirectoryId !== null &&
        commandMenuGitHubProjectPrState !== null &&
        commandMenuGitHubProjectPrState.directoryId === activeDirectoryId
          ? commandMenuGitHubProjectPrState
          : null;
      const currentBranchForActions =
        activeDirectoryId === null
          ? null
          : (gitSummaryByDirectoryId.get(activeDirectoryId)?.branch ?? null);
      const trackedBranchForActions = resolveGitHubTrackedBranchForActions({
        projectTrackedBranch: githubProjectPrState?.branchName ?? null,
        currentBranch: currentBranchForActions,
      });
      const selectedText =
        workspace.selection === null
          ? ''
          : workspace.selection.text.length > 0
            ? workspace.selection.text
            : activeConversation === null
              ? ''
              : selectionText(activeConversation.oracle.snapshotWithoutHash(), workspace.selection);
      const taskSelectedTaskId = workspace.taskPaneSelectedTaskId;
      const taskSelectedTask =
        taskSelectedTaskId === null ? null : (taskManager.getTask(taskSelectedTaskId) ?? null);
      const taskSelectedTaskSummary =
        taskSelectedTask === null
          ? null
          : summarizeTaskForCommandMenu(taskSelectedTask.body, taskSelectedTask.title);
      return {
        activeDirectoryId,
        activeConversationId: conversationManager.activeConversationId,
        selectedText,
        linearEnabled: loadedConfig.config.linear.enabled,
        leftNavSelectionKind: workspace.leftNavSelection.kind,
        taskPaneActive: workspace.leftNavSelection.kind === 'tasks',
        taskSelectedTaskId,
        taskSelectedTaskStatus: taskSelectedTask?.status ?? null,
        taskSelectedTaskSummary,
        profileRunning: hasActiveProfileState(
          resolveProfileStatePath(options.invocationDirectory, muxSessionName),
        ),
        statusTimelineRunning: existsSync(
          resolveStatusTimelineStatePath(options.invocationDirectory, muxSessionName),
        ),
        githubRepositoryId,
        githubRepositoryUrl,
        githubDefaultBranch: resolveGitHubDefaultBranchForActions({
          repositoryDefaultBranch: githubRepositoryRecord?.defaultBranch ?? null,
          snapshotDefaultBranch: activeDirectoryRepositorySnapshot?.defaultBranch ?? null,
        }),
        githubTrackedBranch: trackedBranchForActions,
        githubOpenPrUrl: githubProjectPrState?.openPrUrl ?? null,
        githubProjectPrLoading: githubProjectPrState?.loading ?? false,
      };
    };
    const resolveVisibleCommandMenuActions = (
      context: RuntimeCommandMenuContext,
    ): readonly RegisteredCommandMenuAction<RuntimeCommandMenuContext>[] => {
      const actions = commandMenuRegistry.resolveActions(context);
      if (workspace.commandMenu?.scope === 'thread-start') {
        return actions.filter(
          (action) =>
            action.id.startsWith('thread.start.') || action.id.startsWith('thread.install.'),
        );
      }
      return filterCommandMenuActionsForScope(actions, workspace.commandMenu?.scope ?? 'all', {
        themeActionIdPrefix: THEME_ACTION_ID_PREFIX,
        shortcutsActionIdPrefix: SHORTCUT_CATALOG_ACTION_ID_PREFIX,
      });
    };
    const resolveCommandMenuActions = (): readonly CommandMenuActionDescriptor[] => {
      return resolveVisibleCommandMenuActions(commandMenuContext()).map((action) => ({
        id: action.id,
        title: action.title,
        ...(action.aliases === undefined
          ? {}
          : {
              aliases: action.aliases,
            }),
        ...(action.keywords === undefined
          ? {}
          : {
              keywords: action.keywords,
            }),
        ...(action.detail === undefined
          ? {}
          : {
              detail: action.detail,
            }),
        ...(action.screenLabel === undefined
          ? {}
          : {
              screenLabel: action.screenLabel,
            }),
        ...(action.sectionLabel === undefined
          ? {}
          : {
              sectionLabel: action.sectionLabel,
            }),
        ...(action.bindingHint === undefined
          ? {}
          : {
              bindingHint: action.bindingHint,
            }),
        ...(action.priority === undefined
          ? {}
          : {
              priority: action.priority,
            }),
      }));
    };
    const executeCommandMenuAction = (actionId: string): void => {
      const context = commandMenuContext({
        preferThreadScope: isThreadScopedCommandActionId(actionId),
      });
      const action =
        resolveVisibleCommandMenuActions(context).find((candidate) => candidate.id === actionId) ??
        null;
      if (action === null) {
        return;
      }
      void Promise.resolve(action.run(context)).catch((error: unknown) => {
        const message = formatErrorMessage(error);
        workspace.taskPaneNotice = `command menu failed: ${message}`;
        debugFooterNotice.set(`command menu failed: ${message}`);
        markDirty();
      });
    };
    const createModalManager = (): ModalManager =>
      new ModalManager(
        {
          theme: currentModalTheme,
          resolveRepositoryName: (repositoryId) => repositories.get(repositoryId)?.name ?? null,
          getCommandMenu: () => workspace.commandMenu,
          resolveCommandMenuActions,
          getNewThreadPrompt: () => workspace.newThreadPrompt,
          getAddDirectoryPrompt: () => workspace.addDirectoryPrompt,
          getApiKeyPrompt: () => workspace.apiKeyPrompt,
          getTaskEditorPrompt: () => workspace.taskEditorPrompt,
          getRepositoryPrompt: () => workspace.repositoryPrompt,
          getConversationTitleEdit: () => workspace.conversationTitleEdit,
        },
        {
          buildCommandMenuModalOverlay: buildCommandMenuModalOverlayFrame,
          buildNewThreadModalOverlay: buildNewThreadModalOverlayFrame,
          buildAddDirectoryModalOverlay: buildAddDirectoryModalOverlayFrame,
          buildTaskEditorModalOverlay: buildTaskEditorModalOverlayFrame,
          buildApiKeyModalOverlay: buildApiKeyModalOverlayFrame,
          buildRepositoryModalOverlay: buildRepositoryModalOverlayFrame,
          buildConversationTitleModalOverlay: buildConversationTitleModalOverlayFrame,
          dismissModalOnOutsideClick: dismissModalOnOutsideClickFrame,
          isOverlayHit: (overlay, col, row) => UI_KIT.isModalOverlayHit(overlay, col, row),
        },
      );
    let modalManager = createModalManager();
    let homePaneBackgroundTimer: ReturnType<typeof setInterval> | null = null;
    const ptySizeByConversationId = new Map<string, { cols: number; rows: number }>();

    const requestStop = (): void => {
      requestStopFn({
        stop,
        hasConversationTitleEdit: workspace.conversationTitleEdit !== null,
        stopConversationTitleEdit: () => stopConversationTitleEdit(true),
        activeTaskEditorTaskId:
          'taskId' in workspace.taskEditorTarget &&
          typeof workspace.taskEditorTarget.taskId === 'string'
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
        setStop: (next) => {
          stop = next;
        },
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
    const controlPlaneOps = new RuntimeControlPlaneOps({
      onFatal: (error: unknown) => {
        handleRuntimeFatal('control-plane-pump', error);
      },
      startPerfSpan,
      recordPerfEvent,
      writeStderr: (text) => process.stderr.write(text),
    });
    const waitForControlPlaneDrain = async (): Promise<void> => {
      await controlPlaneOps.waitForDrain();
    };
    const queueControlPlaneOp = (task: () => Promise<void>, label = 'interactive-op'): void => {
      controlPlaneOps.enqueueInteractive(task, label);
    };
    const queueLatestControlPlaneOp = (
      key: string,
      task: (options: { readonly signal: AbortSignal }) => Promise<void>,
      label = 'interactive-op',
    ): void => {
      controlPlaneOps.enqueueInteractiveLatest(key, task, label);
    };
    const queueLatestBackgroundControlPlaneOp = (
      key: string,
      task: (options: { readonly signal: AbortSignal }) => Promise<void>,
      label = 'background-op',
    ): void => {
      controlPlaneOps.enqueueBackgroundLatest(key, task, label);
    };
    const queueBackgroundControlPlaneOp = (
      task: () => Promise<void>,
      label = 'background-op',
    ): void => {
      controlPlaneOps.enqueueBackground(task, label);
    };
    const commandMenuAgentTools = new RuntimeCommandMenuAgentTools({
      sendCommand: async (command) => await streamClient.sendCommand(command),
      queueControlPlaneOp,
      getCommandMenu: () => workspace.commandMenu,
      markDirty,
    });
    const setCommandNotice = (message: string): void => {
      workspace.taskPaneNotice = message;
      debugFooterNotice.set(message);
      markDirty();
    };
    const openDirectoryInCommandMenuTarget = (
      target: ResolvedCommandMenuOpenInTarget,
      directoryPath: string,
    ): boolean => {
      const resolved = resolveCommandMenuOpenInCommand(target, directoryPath);
      if (resolved === null) {
        return false;
      }
      try {
        const child = spawn(resolved.command, [...resolved.args], {
          detached: true,
          stdio: 'ignore',
          ...(process.platform === 'win32'
            ? {
                windowsHide: true,
              }
            : {}),
        });
        child.unref();
        return true;
      } catch {
        return false;
      }
    };
    const persistReleaseNotesState = (nextState: ReleaseNotesState): void => {
      try {
        writeReleaseNotesState(releaseNotesStatePath, nextState);
        releaseNotesState = nextState;
      } catch (error: unknown) {
        setCommandNotice(`release notes state persist failed: ${formatErrorMessage(error)}`);
      }
    };
    const dismissReleaseNotesTag = (latestTag: string, neverShow: boolean): void => {
      persistReleaseNotesState({
        version: releaseNotesState.version,
        neverShow,
        dismissedLatestTag: latestTag,
      });
    };
    const queueReleaseNotesFetch = (
      onResolved: (prompt: ReleaseNotesPrompt | null) => void,
      label: string,
    ): void => {
      queueBackgroundControlPlaneOp(async () => {
        const prompt = await fetchReleaseNotesPrompt({
          currentVersion: installedHarnessVersion,
          previewLineCount: RELEASE_NOTES_PREVIEW_LINE_COUNT,
          maxReleases: RELEASE_NOTES_MAX_RELEASES,
        });
        if (prompt !== null) {
          cachedReleaseNotesPrompt = prompt;
        }
        onResolved(prompt);
      }, label);
    };
    const buildPresetThemeConfig = (preset: string): HarnessMuxThemeConfig => {
      return {
        preset,
        mode: runtimeThemeConfig?.mode ?? 'dark',
        customThemePath: null,
      };
    };
    const applyThemeConfig = (nextThemeConfig: HarnessMuxThemeConfig | null): void => {
      const resolved = resolveAndApplyRuntimeTheme(nextThemeConfig);
      currentModalTheme = resolved.theme.modalTheme;
      modalManager = createModalManager();
    };
    const persistThemeConfig = (nextThemeConfig: HarnessMuxThemeConfig): string | null => {
      if (loadedConfig.error !== null) {
        return 'config currently using last-known-good due to parse error';
      }
      try {
        const updated = updateHarnessConfig({
          filePath: loadedConfig.filePath,
          update: (current) => {
            return {
              ...current,
              mux: {
                ...current.mux,
                ui: {
                  ...current.mux.ui,
                  theme: nextThemeConfig,
                },
              },
            };
          },
        });
        runtimeThemeConfig = updated.mux.ui.theme;
        return null;
      } catch (error: unknown) {
        return formatErrorMessage(error);
      }
    };
    const applyThemePreset = (preset: string, persist: boolean): void => {
      const nextThemeConfig = buildPresetThemeConfig(preset);
      applyThemeConfig(nextThemeConfig);
      if (!persist) {
        markDirty();
        return;
      }
      const persistError = persistThemeConfig(nextThemeConfig);
      if (persistError === null) {
        setCommandNotice(`theme set to ${preset}`);
        return;
      }
      setCommandNotice(`theme set to ${preset} (not persisted: ${persistError})`);
    };
    const themePresetFromActionId = (actionId: string | null): string | null => {
      if (actionId === null || !actionId.startsWith(THEME_ACTION_ID_PREFIX)) {
        return null;
      }
      const preset = actionId.slice(THEME_ACTION_ID_PREFIX.length).trim();
      return preset.length > 0 ? preset : null;
    };
    const selectedCommandMenuActionId = (): string | null => {
      return resolveSelectedCommandMenuActionId(resolveCommandMenuActions(), workspace.commandMenu);
    };
    const startThemePickerSession = (): void => {
      const initialThemeConfig =
        runtimeThemeConfig === null
          ? null
          : {
              preset: runtimeThemeConfig.preset,
              mode: runtimeThemeConfig.mode,
              customThemePath: runtimeThemeConfig.customThemePath,
            };
      themePickerSession = {
        initialThemeConfig,
        committed: false,
        previewActionId: null,
      };
      commandMenuScopedDirectoryId = null;
      commandMenuGitHubProjectPrState = null;
      workspace.commandMenu = createCommandMenuState({
        scope: THEME_PICKER_SCOPE,
      });
      markDirty();
    };
    const syncThemePickerPreview = (): void => {
      if (themePickerSession === null) {
        return;
      }
      if (workspace.commandMenu?.scope !== THEME_PICKER_SCOPE) {
        if (!themePickerSession.committed) {
          applyThemeConfig(themePickerSession.initialThemeConfig);
        }
        themePickerSession = null;
        return;
      }
      const selectedActionId = selectedCommandMenuActionId();
      if (selectedActionId === themePickerSession.previewActionId) {
        return;
      }
      themePickerSession.previewActionId = selectedActionId;
      const preset = themePresetFromActionId(selectedActionId);
      if (preset === null) {
        return;
      }
      applyThemePreset(preset, false);
    };
    const githubAuthHintNotice =
      'GitHub PR actions become available after auth (`gh auth login`, `GITHUB_TOKEN`, or `HARNESS_GITHUB_OAUTH_ACCESS_TOKEN`).';
    const setGitHubDebugAuthState = (
      update: Partial<Pick<GitHubDebugAuthState, 'token' | 'auth' | 'projectPr'>>,
    ): void => {
      githubDebugAuthState.token = update.token ?? githubDebugAuthState.token;
      githubDebugAuthState.auth = update.auth ?? githubDebugAuthState.auth;
      githubDebugAuthState.projectPr = update.projectPr ?? githubDebugAuthState.projectPr;
    };
    const isGitHubAuthUnavailableError = (error: unknown): boolean => {
      const message = formatErrorMessage(error).toLowerCase();
      return (
        message.includes('github token not configured') ||
        message.includes('github integration is disabled')
      );
    };
    const refreshCommandMenuGitHubProjectPrState = (directoryId: string): void => {
      commandMenuGitHubProjectPrState = {
        directoryId,
        branchName: null,
        openPrUrl: null,
        loading: true,
      };
      markDirty();
      queueControlPlaneOp(async () => {
        try {
          const result = await streamClient.sendCommand({
            type: 'github.project-pr',
            directoryId,
          });
          commandMenuGitHubProjectPrState = parseGitHubProjectPrState(directoryId, result);
          setGitHubDebugAuthState({
            projectPr: 'ok',
          });
        } catch (error: unknown) {
          setGitHubDebugAuthState({
            projectPr: 'er',
            auth: isGitHubAuthUnavailableError(error) ? 'no' : githubDebugAuthState.auth,
          });
          commandMenuGitHubProjectPrState = {
            directoryId,
            branchName: null,
            openPrUrl: null,
            loading: false,
          };
        }
        if (workspace.commandMenu !== null) {
          markDirty();
        }
      }, 'command-menu-github-project-pr');
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
      onTransition: (transition) => {
        recordStatusTimeline({
          direction: 'outgoing',
          source: 'session-projection',
          eventType: 'projection-transition',
          labels: resolveTraceLabels({
            sessionId: transition.sessionId,
            directoryId: null,
            conversationId: transition.sessionId,
          }),
          payload: transition,
        });
      },
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
        recordStatusTimeline({
          direction: 'incoming',
          source: 'control-plane-key-events',
          eventType: event.type,
          labels: resolveTraceLabels({
            sessionId: event.sessionId,
            directoryId: event.directoryId,
            conversationId: event.conversationId,
          }),
          payload: event,
        });
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
        showDebugBar: configuredMuxUi.showDebugBar,
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
          showDebugBar: updated.mux.ui.showDebugBar,
        };
      },
      applyState: (state) => {
        workspace.repositoriesCollapsed = state.repositoriesCollapsed;
        workspace.shortcutsCollapsed = state.shortcutsCollapsed;
        workspace.showDebugBar = state.showDebugBar;
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
        showDebugBar: workspace.showDebugBar,
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
      getControlPlaneQueueMetrics: () => controlPlaneOps.metrics(),
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

    const runtimeLayoutResize = new RuntimeLayoutResize<ConversationState>({
      getSize: () => size,
      setSize: (nextSize) => {
        size = nextSize;
      },
      getLayout: () => layout,
      setLayout: (nextLayout) => {
        layout = nextLayout;
      },
      getLeftPaneColsOverride: () => leftPaneColsOverride,
      setLeftPaneColsOverride: (nextLeftPaneColsOverride) => {
        leftPaneColsOverride = nextLeftPaneColsOverride;
      },
      conversationManager,
      ptySizeByConversationId,
      sendResize: (sessionId, cols, rows) => {
        streamClient.sendResize(sessionId, cols, rows);
      },
      markDirty,
      resetFrameCache: () => {
        screen.resetFrameCache();
      },
      resizeRecordingOracle: (nextLayout) => {
        if (muxRecordingOracle !== null) {
          muxRecordingOracle.resize(nextLayout.cols, nextLayout.rows);
        }
      },
      queuePersistMuxUiState,
      resizeMinIntervalMs,
      ptyResizeSettleMs,
    });

    const schedulePtyResize = (
      ptySize: { cols: number; rows: number },
      immediate = false,
    ): void => {
      runtimeLayoutResize.schedulePtyResize(ptySize, immediate);
    };

    const applyLayout = (
      nextSize: { cols: number; rows: number },
      forceImmediatePtyResize = false,
    ): void => {
      runtimeLayoutResize.applyLayout(nextSize, forceImmediatePtyResize);
    };

    const queueResize = (nextSize: { cols: number; rows: number }): void => {
      runtimeLayoutResize.queueResize(nextSize);
    };

    const applyPaneDividerAtCol = (col: number): void => {
      runtimeLayoutResize.applyPaneDividerAtCol(col);
    };

    const scheduleConversationTitlePersist = (): void => {
      conversationLifecycle.scheduleConversationTitlePersist();
    };

    const stopConversationTitleEdit = (persistPending: boolean): void => {
      conversationLifecycle.stopConversationTitleEdit(persistPending);
    };

    const buildNewThreadModalOverlay = (viewportRows: number) => {
      return modalManager.buildNewThreadOverlay(layout.cols, viewportRows);
    };

    const buildCommandMenuModalOverlay = (viewportRows: number) => {
      return modalManager.buildCommandMenuOverlay(layout.cols, viewportRows);
    };

    const buildConversationTitleModalOverlay = (viewportRows: number) => {
      return modalManager.buildConversationTitleOverlay(layout.cols, viewportRows);
    };

    const buildReleaseNotesModalOverlay = (viewportRows: number) => {
      return buildReleaseNotesModalOverlayFrame(
        layout.cols,
        viewportRows,
        releaseNotesPrompt,
        currentModalTheme,
      );
    };

    const buildCurrentModalOverlay = () => {
      const releaseNotesOverlay = buildReleaseNotesModalOverlay(layout.rows);
      if (releaseNotesOverlay !== null) {
        return releaseNotesOverlay;
      }
      return modalManager.buildCurrentOverlay(layout.cols, layout.rows);
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
      workspace.projectPaneSnapshot = buildProjectPaneSnapshotWithOptions(
        directory.directoryId,
        directory.path,
        {
          githubReview: projectPaneGitHubReviewByDirectoryId.get(directory.directoryId) ?? null,
          expandedNodeIds:
            projectPaneGitHubExpandedNodeIdsByDirectoryId.get(directory.directoryId) ?? new Set(),
        },
      );
    };

    const projectPaneGitHubReviewCache = new RuntimeProjectPaneGitHubReviewCache({
      ttlMs: PROJECT_PANE_GITHUB_REVIEW_TTL_MS,
      refreshIntervalMs: PROJECT_PANE_GITHUB_REVIEW_REFRESH_INTERVAL_MS,
      queueLatestControlPlaneOp: queueLatestBackgroundControlPlaneOp,
      loadReview: async (directoryId, requestOptions) => {
        const result = await streamClient.sendCommand({
          type: 'github.project-review',
          directoryId,
          ...(requestOptions.forceRefresh === undefined
            ? {}
            : {
                forceRefresh: requestOptions.forceRefresh,
              }),
        });
        const parsedResult = asRecord(result);
        if (parsedResult === null) {
          throw new Error('github.project-review returned malformed response');
        }
        const parsedReview = parseGitHubProjectReviewState(parsedResult);
        if (parsedReview === null) {
          throw new Error('github.project-review returned malformed review state');
        }
        return parsedReview;
      },
      onUpdate: (directoryId, review) => {
        projectPaneGitHubReviewByDirectoryId.set(directoryId, review);
        if (workspace.mainPaneMode === 'project' && workspace.activeDirectoryId === directoryId) {
          refreshProjectPaneSnapshot(directoryId);
          markDirty();
        }
      },
      formatErrorMessage,
    });
    projectPaneGitHubReviewCache.startAutoRefresh(() => {
      if (workspace.mainPaneMode !== 'project') {
        return null;
      }
      return workspace.activeDirectoryId;
    });

    const refreshProjectPaneGitHubReviewState = (
      directoryId: string,
      options: {
        readonly forceRefresh?: boolean;
      } = {},
    ): void => {
      projectPaneGitHubReviewCache.request(directoryId, options);
    };

    const toggleProjectPaneGitHubNode = (directoryId: string, nodeId: string): boolean => {
      if (!directoryManager.hasDirectory(directoryId)) {
        return false;
      }
      const expanded =
        projectPaneGitHubExpandedNodeIdsByDirectoryId.get(directoryId) ?? new Set<string>();
      if (expanded.has(nodeId)) {
        expanded.delete(nodeId);
      } else {
        expanded.add(nodeId);
      }
      projectPaneGitHubExpandedNodeIdsByDirectoryId.set(directoryId, expanded);
      refreshProjectPaneSnapshot(directoryId);
      return true;
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

    const selectedRepositoryTaskRecords = (): readonly ControlPlaneTaskRecord[] => {
      return taskManager.tasksForRepository({
        repositoryId: workspace.taskPaneSelectedRepositoryId,
        sortTasks: sortTasksByOrder,
        taskRepositoryId: (task) => task.repositoryId,
      });
    };

    const applyTaskRecord = (task: ControlPlaneTaskRecord): ControlPlaneTaskRecord => {
      taskManager.setTask(task);
      workspace.taskPaneSelectedTaskId = task.taskId;
      if (task.repositoryId !== null && repositories.has(task.repositoryId)) {
        workspace.taskPaneSelectedRepositoryId = task.repositoryId;
      }
      workspace.taskPaneSelectionFocus = 'task';
      syncTaskPaneSelection();
      markDirty();
      return task;
    };

    const taskComposerPersistence = new RuntimeTaskComposerPersistenceService<
      ControlPlaneTaskRecord,
      TaskComposerBuffer
    >({
      getTask: (taskId) => taskManager.getTask(taskId),
      getTaskComposer: (taskId) => taskManager.getTaskComposer(taskId),
      setTaskComposer: (taskId, buffer) => {
        taskManager.setTaskComposer(taskId, buffer);
      },
      deleteTaskComposer: (taskId) => {
        taskManager.deleteTaskComposer(taskId);
      },
      getTaskAutosaveTimer: (taskId) => taskManager.getTaskAutosaveTimer(taskId),
      setTaskAutosaveTimer: (taskId, timer) => {
        taskManager.setTaskAutosaveTimer(taskId, timer);
      },
      deleteTaskAutosaveTimer: (taskId) => {
        taskManager.deleteTaskAutosaveTimer(taskId);
      },
      buildComposerFromTask: (task) =>
        createTaskComposerBuffer(task.body.length === 0 ? task.title : task.body),
      normalizeTaskComposerBuffer,
      taskFieldsFromComposerText,
      updateTask: async (input) => {
        return await controlPlaneService.updateTask(input);
      },
      applyTaskRecord: (task) => {
        applyTaskRecord(task);
      },
      queueControlPlaneOp,
      setTaskPaneNotice: (text) => {
        workspace.taskPaneNotice = text;
      },
      markDirty,
      autosaveDebounceMs: DEFAULT_TASK_EDITOR_AUTOSAVE_DEBOUNCE_MS,
    });

    const taskComposerForTask = (taskId: string): TaskComposerBuffer | null => {
      return taskComposerPersistence.taskComposerForTask(taskId);
    };

    const setTaskComposerForTask = (taskId: string, buffer: TaskComposerBuffer): void => {
      taskComposerPersistence.setTaskComposerForTask(taskId, buffer);
    };

    const clearTaskAutosaveTimer = (taskId: string): void => {
      taskComposerPersistence.clearTaskAutosaveTimer(taskId);
    };

    const scheduleTaskComposerPersist = (taskId: string): void => {
      taskComposerPersistence.scheduleTaskComposerPersist(taskId);
    };

    const flushTaskComposerPersist = (taskId: string): void => {
      taskComposerPersistence.flushTaskComposerPersist(taskId);
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

    const enterTasksPane = (): void => {
      workspace.enterTasksPane();
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

    const taskPlanningSyncedProjection = new TaskPlanningSyncedProjection<
      ControlPlaneRepositoryRecord,
      ControlPlaneTaskRecord
    >({
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

    const harnessSyncedStore = createHarnessSyncedStore();

    const workspaceSyncedProjection = new WorkspaceSyncedProjection<
      ControlPlaneDirectoryRecord,
      ControlPlaneConversationRecord
    >({
      setDirectory: (directoryId, directory) => {
        directoryManager.setDirectory(directoryId, directory);
      },
      deleteDirectory: (directoryId) => {
        if (!directoryManager.hasDirectory(directoryId)) {
          return false;
        }
        directoryManager.deleteDirectory(directoryId);
        return true;
      },
      deleteDirectoryGitState,
      syncGitStateWithDirectories,
      upsertConversationFromPersistedRecord: (record) => {
        conversationManager.upsertFromPersistedRecord({
          record,
          ensureConversation,
        });
      },
      removeConversation: (sessionId) => {
        if (!conversationManager.has(sessionId)) {
          return false;
        }
        removeConversationState(sessionId);
        return true;
      },
    });

    const stopWorkspaceObservedEvents = subscribeRuntimeWorkspaceObservedEvents({
      store: harnessSyncedStore,
      orderedConversationIds: () => conversationManager.orderedIds(),
      transitionPolicy: {
        workspace,
        getActiveConversationId: () => conversationManager.activeConversationId,
        setActiveConversationId: (sessionId) => {
          conversationManager.setActiveConversationId(sessionId);
        },
        resolveActiveDirectoryId,
        stopConversationTitleEdit: (persistPending) => {
          stopConversationTitleEdit(persistPending);
        },
        enterProjectPane,
        enterHomePane,
      },
      effectQueue: {
        enqueueQueuedReaction: queueControlPlaneOp,
        unsubscribeConversationEvents: async (sessionId) => {
          await conversationLifecycle.unsubscribeConversationEvents(sessionId);
        },
        activateConversation: async (sessionId) => {
          await conversationLifecycle.activateConversation(sessionId);
        },
      },
      markDirty,
    });

    const runtimeObservedEventProjection: RuntimeObservedEventProjectionPipelineOptions = {
      syncedStore: harnessSyncedStore,
      applyWorkspaceProjection: (reduction) => {
        workspaceSyncedProjection.apply(reduction);
      },
      applyDirectoryGitProjection: (event) => {
        runtimeGitState.applyObservedGitStatusEvent(event);
      },
      applyTaskPlanningProjection: (reduction) => {
        taskPlanningSyncedProjection.apply(reduction);
      },
    };

    activateConversationForStartupOrchestrator = async (sessionId: string): Promise<void> => {
      await conversationLifecycle.activateConversation(sessionId);
    };

    const removeConversationState = (sessionId: string): void => {
      if (workspace.conversationTitleEdit?.conversationId === sessionId) {
        stopConversationTitleEdit(false);
      }
      conversationManager.remove(sessionId);
      ptySizeByConversationId.delete(sessionId);
      processUsageRefreshService.deleteSession(sessionId);
    };

    const openNewThreadPrompt = (directoryId: string): void => {
      if (!directoryManager.hasDirectory(directoryId)) {
        return;
      }
      workspace.newThreadPrompt = null;
      workspace.addDirectoryPrompt = null;
      workspace.apiKeyPrompt = null;
      workspace.taskEditorPrompt = null;
      workspace.repositoryPrompt = null;
      if (workspace.conversationTitleEdit !== null) {
        stopConversationTitleEdit(true);
      }
      workspace.conversationTitleEditClickState = null;
      commandMenuGitHubProjectPrState = null;
      commandMenuScopedDirectoryId = directoryId;
      workspace.commandMenu = createCommandMenuState({
        scope: 'thread-start',
      });
      commandMenuAgentTools.refresh();
      markDirty();
    };

    const runtimeRepositoryActions = new RuntimeRepositoryActions<ControlPlaneRepositoryRecord>({
      workspace,
      repositories,
      controlPlaneService,
      normalizeGitHubRemoteUrl,
      repositoryNameFromGitHubRemoteUrl,
      createRepositoryId: () => `repository-${randomUUID()}`,
      stopConversationTitleEdit: () => {
        stopConversationTitleEdit(true);
      },
      syncRepositoryAssociationsWithDirectorySnapshots,
      syncTaskPaneRepositorySelection,
      queueControlPlaneOp,
      markDirty,
    });

    const runtimeTaskPaneActions = new RuntimeTaskPaneActions<ControlPlaneTaskRecord>({
      workspace,
      controlPlaneService,
      repositoriesHas: (repositoryId) => repositories.has(repositoryId),
      setTask: (task) => {
        taskManager.setTask(task);
      },
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
      syncTaskPaneSelection,
      syncTaskPaneRepositorySelection,
      openRepositoryPromptForCreate: () => {
        runtimeRepositoryActions.openRepositoryPromptForCreate();
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        runtimeRepositoryActions.openRepositoryPromptForEdit(repositoryId);
      },
      archiveRepositoryById: async (repositoryId) => {
        await runtimeRepositoryActions.archiveRepositoryById(repositoryId);
      },
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
      queueControlPlaneOp,
      createTask: async (payload) => {
        return await controlPlaneService.createTask(payload);
      },
      taskReady: async (taskId) => {
        return await controlPlaneService.taskReady(taskId);
      },
      syncTaskPaneSelection,
      runTaskPaneAction: (action) => {
        runtimeTaskPaneActions.runTaskPaneAction(action);
      },
      applyTaskRecord: (task) => runtimeTaskPaneActions.applyTaskRecord(task),
      markDirty,
    });
    const runtimeTaskEditorActions = new RuntimeTaskEditorActions<ControlPlaneTaskRecord>({
      workspace,
      controlPlaneService,
      applyTaskRecord: (task) => runtimeTaskPaneActions.applyTaskRecord(task),
      queueControlPlaneOp,
      markDirty,
    });

    const runtimeDirectoryActions = createRuntimeDirectoryActions({
      controlPlaneService,
      conversations: {
        records: () => conversationRecords,
        orderedIds: () => conversationManager.orderedIds(),
        directoryIdOf: (sessionId) => conversationManager.directoryIdOf(sessionId),
        isLive: (sessionId) => conversationManager.isLive(sessionId),
        removeState: removeConversationState,
        unsubscribeEvents: async (sessionId) => {
          await conversationLifecycle.unsubscribeConversationEvents(sessionId);
        },
        activeId: () => conversationManager.activeConversationId,
        setActiveId: (sessionId) => {
          conversationManager.setActiveConversationId(sessionId);
        },
        activate: async (sessionId) => {
          await conversationLifecycle.activateConversation(sessionId);
        },
        findIdByDirectory: (directoryId) =>
          conversationManager.findConversationIdByDirectory(
            directoryId,
            conversationManager.orderedIds(),
          ),
      },
      directories: {
        createId: () => `directory-${randomUUID()}`,
        resolveWorkspacePath: (rawPath) =>
          resolveWorkspacePathForMux(options.invocationDirectory, rawPath),
        setRecord: (directory) => {
          directoryManager.setDirectory(directory.directoryId, directory);
        },
        idOf: (directory) => directory.directoryId,
        setActiveId: (directoryId) => {
          workspace.activeDirectoryId = directoryId;
        },
        activeId: () => workspace.activeDirectoryId,
        resolveActiveId: resolveActiveDirectoryId,
        has: (directoryId) => directoryManager.hasDirectory(directoryId),
        remove: (directoryId) => {
          directoryManager.deleteDirectory(directoryId);
        },
        removeGitState: deleteDirectoryGitState,
        projectPaneSnapshotDirectoryId: () => workspace.projectPaneSnapshot?.directoryId ?? null,
        clearProjectPaneSnapshot: () => {
          workspace.projectPaneSnapshot = null;
          workspace.projectPaneScrollTop = 0;
        },
        size: () => directoryManager.directoriesSize(),
        firstId: () => directoryManager.firstDirectoryId(),
        syncGitStateWithDirectories,
        noteGitActivity,
        hydratePersistedConversations: hydratePersistedConversationsForDirectory,
      },
      ui: {
        enterProjectPane,
        markDirty,
      },
      errors: {
        isSessionNotFoundError,
        isConversationNotFoundError,
      },
      invocationDirectory: options.invocationDirectory,
    });
    const runtimeControlActions = new RuntimeControlActions({
      conversationById: (sessionId) => conversationManager.get(sessionId),
      interruptSession: async (sessionId) => {
        return await controlPlaneService.interruptSession(sessionId);
      },
      nowIso: () => new Date().toISOString(),
      markDirty,
      toggleGatewayProfiler: async (input) => {
        return await toggleGatewayProfilerFn(input);
      },
      toggleGatewayStatusTimeline: async (input) => {
        return await toggleGatewayStatusTimelineFn(input);
      },
      toggleGatewayRenderTrace: async (input) => {
        return await toggleGatewayRenderTraceFn(input);
      },
      invocationDirectory: options.invocationDirectory,
      sessionName: muxSessionName,
      setTaskPaneNotice: (message) => {
        workspace.taskPaneNotice = message;
        recordStatusTimeline({
          direction: 'outgoing',
          source: 'task-pane-notice',
          eventType: 'status-notice',
          labels: resolveTraceLabels({
            sessionId: conversationManager.activeConversationId,
            directoryId: workspace.activeDirectoryId,
            conversationId: conversationManager.activeConversationId,
          }),
          payload: {
            message,
          },
        });
      },
      setDebugFooterNotice: (message) => {
        debugFooterNotice.set(message);
        recordStatusTimeline({
          direction: 'outgoing',
          source: 'debug-footer-notice',
          eventType: 'status-notice',
          labels: resolveTraceLabels({
            sessionId: conversationManager.activeConversationId,
            directoryId: workspace.activeDirectoryId,
            conversationId: conversationManager.activeConversationId,
          }),
          payload: {
            message,
          },
        });
      },
      listConversationIdsForTitleRefresh: () => conversationManager.orderedIds(),
      conversationAgentTypeForTitleRefresh: (sessionId) =>
        conversationManager.get(sessionId)?.agentType ?? null,
      refreshConversationTitle: async (sessionId) => {
        return await controlPlaneService.refreshConversationTitle(sessionId);
      },
    });
    const reorderRepositoryByDrop = (
      draggedRepositoryId: string,
      targetRepositoryId: string,
    ): void => {
      runtimeRepositoryActions.reorderRepositoryByDrop(
        draggedRepositoryId,
        targetRepositoryId,
        orderedActiveRepositoryRecords().map((repository) => repository.repositoryId),
      );
    };

    const openCommandMenuForScope = (scope: 'all' | 'shortcuts'): void => {
      workspace.newThreadPrompt = null;
      workspace.addDirectoryPrompt = null;
      workspace.apiKeyPrompt = null;
      workspace.taskEditorPrompt = null;
      workspace.repositoryPrompt = null;
      if (workspace.conversationTitleEdit !== null) {
        stopConversationTitleEdit(true);
      }
      commandMenuScopedDirectoryId = null;
      workspace.commandMenu = createCommandMenuState({
        scope,
      });
      if (scope === 'all') {
        commandMenuAgentTools.refresh();
        const directoryId = resolveDirectoryForAction();
        if (directoryId === null) {
          commandMenuGitHubProjectPrState = null;
        } else {
          refreshCommandMenuGitHubProjectPrState(directoryId);
        }
      } else {
        commandMenuGitHubProjectPrState = null;
      }
      markDirty();
    };
    const openShortcutsMenu = (): void => {
      openCommandMenuForScope(SHORTCUTS_SCOPE);
    };
    const toggleCommandMenu = (): void => {
      if (workspace.commandMenu !== null) {
        workspace.commandMenu = null;
        commandMenuGitHubProjectPrState = null;
        commandMenuScopedDirectoryId = null;
        markDirty();
        return;
      }
      openCommandMenuForScope('all');
    };

    const openApiKeyPrompt = (apiKey: AllowedCommandMenuApiKey): void => {
      workspace.newThreadPrompt = null;
      workspace.addDirectoryPrompt = null;
      workspace.taskEditorPrompt = null;
      workspace.repositoryPrompt = null;
      if (workspace.conversationTitleEdit !== null) {
        stopConversationTitleEdit(true);
      }
      workspace.conversationTitleEditClickState = null;
      const existingRaw = sessionEnv[apiKey.envVar] ?? process.env[apiKey.envVar];
      const hasExistingValue = typeof existingRaw === 'string' && existingRaw.trim().length > 0;
      workspace.apiKeyPrompt = {
        keyName: apiKey.envVar,
        displayName: apiKey.displayName,
        value: '',
        error: null,
        hasExistingValue,
      };
      markDirty();
    };

    const persistApiKey = (keyName: string, value: string): void => {
      const result = upsertHarnessSecret({
        cwd: options.invocationDirectory,
        key: keyName,
        value,
      });
      sessionEnv[keyName] = value;
      process.env[keyName] = value;
      const action = result.replacedExisting ? 'updated' : 'saved';
      setCommandNotice(`${keyName} ${action}`);
    };

    const openReleaseNotesPrompt = (prompt: ReleaseNotesPrompt): void => {
      workspace.commandMenu = null;
      workspace.newThreadPrompt = null;
      workspace.addDirectoryPrompt = null;
      workspace.apiKeyPrompt = null;
      workspace.taskEditorPrompt = null;
      workspace.repositoryPrompt = null;
      if (workspace.conversationTitleEdit !== null) {
        stopConversationTitleEdit(true);
      }
      commandMenuScopedDirectoryId = null;
      commandMenuGitHubProjectPrState = null;
      releaseNotesPrompt = prompt;
      markDirty();
    };

    const resolveUpdateDirectoryId = (): string | null => {
      const actionDirectoryId = resolveDirectoryForAction();
      if (actionDirectoryId !== null) {
        return actionDirectoryId;
      }
      return directoryManager.firstDirectoryId();
    };

    const openReleaseNotesFromMenu = (): void => {
      if (cachedReleaseNotesPrompt !== null) {
        openReleaseNotesPrompt(cachedReleaseNotesPrompt);
        return;
      }
      queueReleaseNotesFetch((prompt) => {
        if (prompt === null) {
          setCommandNotice('no newer release notes since installed version');
          return;
        }
        openReleaseNotesPrompt(prompt);
      }, 'command-menu-release-notes');
    };

    const startThreadFromCommandMenu = (
      directoryId: string,
      agentType: ReturnType<typeof normalizeThreadAgentType>,
    ): void => {
      queueControlPlaneOp(async () => {
        await conversationLifecycle.createAndActivateConversationInDirectory(
          directoryId,
          agentType,
        );
      }, `command-menu-start-thread:${agentType}`);
    };

    const installAgentToolFromCommandMenu = (
      directoryId: string,
      agentType: InstallableAgentType,
      installCommand: string,
    ): void => {
      queueControlPlaneOp(async () => {
        await runCommandInNewTerminalThread(directoryId, installCommand);
        commandMenuAgentTools.refresh();
      }, `command-menu-install-agent-tool:${agentType}`);
    };

    const runCommandInNewTerminalThread = async (
      directoryId: string,
      commandText: string,
    ): Promise<void> => {
      const priorSessionIds = new Set(conversationManager.orderedIds());
      await conversationLifecycle.createAndActivateConversationInDirectory(directoryId, 'terminal');
      const terminalSessionId =
        conversationManager.orderedIds().find((sessionId) => !priorSessionIds.has(sessionId)) ??
        conversationManager.activeConversationId;
      if (terminalSessionId === null) {
        throw new Error('failed to locate terminal session for command');
      }
      await controlPlaneService.respondToSession(terminalSessionId, `${commandText}\n`);
    };

    const runHarnessUpdateFromMenu = (): void => {
      const directoryId = resolveUpdateDirectoryId();
      if (directoryId === null) {
        setCommandNotice('update unavailable: add a project first');
        return;
      }
      queueControlPlaneOp(async () => {
        await runCommandInNewTerminalThread(directoryId, 'harness update');
        setCommandNotice('running harness update in a new terminal thread');
      }, 'command-menu-harness-update');
    };

    const runOAuthLoginFromMenu = (provider: 'github' | 'linear'): void => {
      const directoryId = resolveUpdateDirectoryId();
      if (directoryId === null) {
        setCommandNotice('oauth login unavailable: add a project first');
        return;
      }
      const providerLabel = provider === 'github' ? 'GitHub' : 'Linear';
      queueControlPlaneOp(async () => {
        await runCommandInNewTerminalThread(directoryId, `harness auth login ${provider}`);
        setCommandNotice(`running ${providerLabel} oauth login in a new terminal thread`);
      }, `command-menu-oauth-login:${provider}`);
    };

    const resolveCritiqueReviewAgentFromEnvironment = (): 'claude' | 'opencode' | null => {
      const claudeAvailable =
        commandMenuAgentTools.statusForAgent('claude')?.available === true ||
        commandExistsOnPath('claude');
      const opencodeAvailable = commandExistsOnPath('opencode');
      return resolveCritiqueReviewAgent({
        claudeAvailable,
        opencodeAvailable,
      });
    };

    const resolveCritiqueReviewBaseBranchForDirectory = async (
      directoryId: string,
    ): Promise<string> => {
      const directory = directoryManager.getDirectory(directoryId);
      if (directory === undefined || directory === null) {
        return 'main';
      }
      return await resolveCritiqueReviewBaseBranch(directory.path, runGitCommand);
    };

    const runCritiqueReviewFromCommandMenu = (
      directoryId: string,
      mode: 'unstaged' | 'staged' | 'base-branch',
    ): void => {
      queueControlPlaneOp(async () => {
        const agent = resolveCritiqueReviewAgentFromEnvironment();
        if (mode !== 'base-branch') {
          const commandText = buildCritiqueReviewCommand({
            mode,
            agent,
          });
          await runCommandInNewTerminalThread(directoryId, commandText);
          const reviewLabelByMode: Readonly<Record<'unstaged' | 'staged', string>> = {
            unstaged: 'unstaged',
            staged: 'staged',
          };
          setCommandNotice(
            `running critique ${reviewLabelByMode[mode]} review (${agent ?? 'default'})`,
          );
          return;
        }
        const baseBranch = await resolveCritiqueReviewBaseBranchForDirectory(directoryId);
        const commandText = buildCritiqueReviewCommand({
          mode: 'base-branch',
          baseBranch,
          agent,
        });
        await runCommandInNewTerminalThread(directoryId, commandText);
        setCommandNotice(`running critique review vs ${baseBranch} (${agent ?? 'default'})`);
      }, `command-menu-critique-review:${mode}`);
    };

    commandMenuRegistry.registerProvider('critique.review', (context) => {
      const directoryId = context.activeDirectoryId;
      if (directoryId === null) {
        return [];
      }
      const critiqueStatus = commandMenuAgentTools.statusForAgent('critique');
      if (critiqueStatus !== null && !critiqueStatus.available) {
        return [];
      }
      return [
        {
          id: 'critique.review.unstaged',
          title: 'Critique AI Review: Unstaged Changes (git)',
          aliases: ['critique unstaged review', 'review unstaged diff', 'ai review unstaged'],
          keywords: ['critique', 'review', 'unstaged', 'diff', 'ai'],
          detail: 'runs critique review',
          run: () => {
            runCritiqueReviewFromCommandMenu(directoryId, 'unstaged');
          },
        },
        {
          id: 'critique.review.staged',
          title: 'Critique AI Review: Staged Changes (git)',
          aliases: ['critique staged review', 'review staged diff', 'ai review staged'],
          keywords: ['critique', 'review', 'staged', 'diff', 'ai'],
          detail: 'runs critique review --staged',
          run: () => {
            runCritiqueReviewFromCommandMenu(directoryId, 'staged');
          },
        },
        {
          id: 'critique.review.base-branch',
          title: 'Critique AI Review: Current Branch vs Base (git)',
          aliases: ['critique base review', 'review against base branch', 'ai review base'],
          keywords: ['critique', 'review', 'base', 'branch', 'diff', 'ai'],
          detail: 'runs critique review <base> HEAD',
          run: () => {
            runCritiqueReviewFromCommandMenu(directoryId, 'base-branch');
          },
        },
      ];
    });

    commandMenuRegistry.registerProvider('task.actions', (context) => {
      if (!context.taskPaneActive || context.taskSelectedTaskId === null) {
        return [];
      }
      const selectedTaskDetail = `${context.taskSelectedTaskSummary ?? 'selected task'} (${context.taskSelectedTaskStatus ?? 'unknown'})`;
      const taskSummaryAliases =
        context.taskSelectedTaskSummary === null ? [] : [context.taskSelectedTaskSummary];
      const actionPriority = 200;
      return [
        {
          id: 'task.selected.ready',
          title: 'Task: Set Ready',
          aliases: [
            'task ready',
            'set task ready',
            'task read',
            'set task read',
            ...taskSummaryAliases,
          ],
          keywords: ['task', 'status', 'ready', 'read', 'set'],
          detail: selectedTaskDetail,
          priority: actionPriority,
          run: () => {
            runtimeTaskPaneActions.runTaskPaneAction('task.ready');
          },
        },
        {
          id: 'task.selected.draft',
          title: 'Task: Set Draft (Uncomplete)',
          aliases: ['task draft', 'uncomplete task', 'undo complete task', ...taskSummaryAliases],
          keywords: ['task', 'status', 'draft', 'queue', 'uncomplete', 'undo'],
          detail: selectedTaskDetail,
          priority: actionPriority,
          run: () => {
            runtimeTaskPaneActions.runTaskPaneAction('task.draft');
          },
        },
        {
          id: 'task.selected.complete',
          title: 'Task: Set Complete',
          aliases: ['complete task', 'mark task complete', ...taskSummaryAliases],
          keywords: ['task', 'status', 'complete', 'done'],
          detail: selectedTaskDetail,
          priority: actionPriority,
          run: () => {
            runtimeTaskPaneActions.runTaskPaneAction('task.complete');
          },
        },
        {
          id: 'task.selected.reorder-up',
          title: 'Task: Move Up',
          aliases: ['task move up', 'task reorder up', ...taskSummaryAliases],
          keywords: ['task', 'reorder', 'move', 'up'],
          detail: selectedTaskDetail,
          priority: actionPriority,
          run: () => {
            runtimeTaskPaneActions.runTaskPaneAction('task.reorder-up');
          },
        },
        {
          id: 'task.selected.reorder-down',
          title: 'Task: Move Down',
          aliases: ['task move down', 'task reorder down', ...taskSummaryAliases],
          keywords: ['task', 'reorder', 'move', 'down'],
          detail: selectedTaskDetail,
          priority: actionPriority,
          run: () => {
            runtimeTaskPaneActions.runTaskPaneAction('task.reorder-down');
          },
        },
        {
          id: 'task.selected.delete',
          title: 'Task: Delete',
          aliases: ['delete task', 'remove task', ...taskSummaryAliases],
          keywords: ['task', 'delete', 'remove'],
          detail: selectedTaskDetail,
          priority: actionPriority,
          run: () => {
            runtimeTaskPaneActions.runTaskPaneAction('task.delete');
          },
        },
      ];
    });

    commandMenuRegistry.registerProvider('thread.start', (context) => {
      const directoryId = context.activeDirectoryId;
      if (directoryId === null) {
        return [];
      }
      const actions: RegisteredCommandMenuAction<RuntimeCommandMenuContext>[] = [
        {
          id: 'thread.start.codex',
          title: 'Start Codex thread',
          aliases: ['codex', 'start codex'],
          keywords: ['start', 'thread', 'codex', 'new'],
          run: () => {
            startThreadFromCommandMenu(directoryId, 'codex');
          },
        },
        {
          id: 'thread.start.claude',
          title: 'Start Claude thread',
          aliases: ['claude', 'start claude'],
          keywords: ['start', 'thread', 'claude', 'new'],
          run: () => {
            startThreadFromCommandMenu(directoryId, 'claude');
          },
        },
        {
          id: 'thread.start.cursor',
          title: 'Start Cursor thread',
          aliases: ['cursor', 'cur', 'start cursor'],
          keywords: ['start', 'thread', 'cursor', 'new'],
          run: () => {
            startThreadFromCommandMenu(directoryId, 'cursor');
          },
        },
        {
          id: 'thread.start.terminal',
          title: 'Start Terminal thread',
          aliases: ['terminal', 'shell', 'start terminal'],
          keywords: ['start', 'thread', 'terminal', 'shell', 'new'],
          run: () => {
            startThreadFromCommandMenu(directoryId, 'terminal');
          },
        },
        {
          id: 'thread.start.critique',
          title: 'Start Critique thread (diff)',
          aliases: ['critique', 'start critique', 'critique diff'],
          keywords: ['start', 'thread', 'critique', 'diff', 'new'],
          run: () => {
            startThreadFromCommandMenu(directoryId, 'critique');
          },
        },
      ];
      const installableByAgent: Readonly<
        Record<InstallableAgentType, { startId: string; installId: string; installTitle: string }>
      > = {
        codex: {
          startId: 'thread.start.codex',
          installId: 'thread.install.codex',
          installTitle: 'Install Codex CLI',
        },
        claude: {
          startId: 'thread.start.claude',
          installId: 'thread.install.claude',
          installTitle: 'Install Claude CLI',
        },
        cursor: {
          startId: 'thread.start.cursor',
          installId: 'thread.install.cursor',
          installTitle: 'Install Cursor CLI',
        },
        critique: {
          startId: 'thread.start.critique',
          installId: 'thread.install.critique',
          installTitle: 'Install Critique CLI',
        },
      };
      const adjusted: RegisteredCommandMenuAction<RuntimeCommandMenuContext>[] = [];
      for (const action of actions) {
        adjusted.push(action);
      }
      for (const agentType of ['codex', 'claude', 'cursor', 'critique'] as const) {
        const status = commandMenuAgentTools.statusForAgent(agentType);
        if (status === null || status.available || status.installCommand === null) {
          continue;
        }
        const installCommand = status.installCommand;
        const mapping = installableByAgent[agentType];
        const startIndex = adjusted.findIndex((action) => action.id === mapping.startId);
        if (startIndex < 0) {
          continue;
        }
        adjusted.splice(startIndex, 1, {
          id: mapping.installId,
          title: mapping.installTitle,
          aliases: [`install ${agentType}`, `${agentType} install`, `setup ${agentType}`],
          keywords: ['install', 'thread', agentType, 'setup'],
          detail: installCommand,
          run: () => {
            installAgentToolFromCommandMenu(directoryId, agentType, installCommand);
          },
        });
      }
      return adjusted;
    });

    commandMenuRegistry.registerAction({
      id: 'thread.close.active',
      title: 'Close active thread',
      aliases: ['close thread', 'archive thread'],
      keywords: ['close', 'thread', 'archive'],
      when: (context) => context.activeConversationId !== null,
      run: async (context) => {
        const conversationId = context.activeConversationId;
        if (conversationId === null) {
          return;
        }
        queueControlPlaneOp(async () => {
          await runtimeDirectoryActions.archiveConversation(conversationId);
        }, 'command-menu-close-thread');
      },
    });

    commandMenuRegistry.registerAction({
      id: 'theme.choose',
      title: 'Set a Theme',
      aliases: ['theme', 'change theme', 'set theme'],
      keywords: ['theme', 'appearance', 'colors'],
      run: () => {
        startThemePickerSession();
      },
    });

    commandMenuRegistry.registerAction({
      id: 'release-notes.show',
      title: "Show What's New",
      aliases: ['release notes', 'whats new', 'what is new', 'changelog'],
      keywords: ['release', 'notes', 'changes', 'changelog', 'new'],
      run: () => {
        openReleaseNotesFromMenu();
      },
    });

    commandMenuRegistry.registerAction({
      id: 'harness.update',
      title: 'Update Harness',
      aliases: ['update', 'upgrade', 'self update', 'self upgrade'],
      keywords: ['update', 'upgrade', 'install', 'latest'],
      detail: 'runs `harness update` in a terminal thread',
      run: () => {
        runHarnessUpdateFromMenu();
      },
    });

    commandMenuRegistry.registerAction({
      id: SHOW_KEYBINDINGS_COMMAND_ACTION.id,
      title: SHOW_KEYBINDINGS_COMMAND_ACTION.title,
      aliases: SHOW_KEYBINDINGS_COMMAND_ACTION.aliases,
      keywords: SHOW_KEYBINDINGS_COMMAND_ACTION.keywords,
      detail: SHOW_KEYBINDINGS_COMMAND_ACTION.detail,
      run: () => {
        openShortcutsMenu();
      },
    });

    commandMenuRegistry.registerProvider('api-key.set', () => {
      return COMMAND_MENU_ALLOWED_API_KEYS.map(
        (apiKey): RegisteredCommandMenuAction<RuntimeCommandMenuContext> => ({
          id: `${API_KEY_ACTION_ID_PREFIX}${apiKey.actionIdSuffix}`,
          title: `Set ${apiKey.displayName}`,
          aliases: [...apiKey.aliases],
          keywords: ['api', 'key', 'set', apiKey.envVar.toLowerCase()],
          detail: apiKey.envVar,
          run: () => {
            openApiKeyPrompt(apiKey);
          },
        }),
      );
    });

    commandMenuRegistry.registerProvider('auth.login', (context) => {
      const actions: RegisteredCommandMenuAction<RuntimeCommandMenuContext>[] = [
        {
          id: 'auth.login.github',
          title: 'Log In to GitHub (OAuth)',
          aliases: ['log in to github', 'login github', 'github oauth login', 'connect github'],
          keywords: ['auth', 'oauth', 'login', 'github'],
          detail: 'runs `harness auth login github` in a terminal thread',
          run: () => {
            runOAuthLoginFromMenu('github');
          },
        },
      ];
      if (context.linearEnabled) {
        actions.push({
          id: 'auth.login.linear',
          title: 'Log In to Linear (OAuth)',
          aliases: ['log in to linear', 'login linear', 'linear oauth login', 'connect linear'],
          keywords: ['auth', 'oauth', 'login', 'linear'],
          detail: 'runs `harness auth login linear` in a terminal thread',
          run: () => {
            runOAuthLoginFromMenu('linear');
          },
        });
      }
      return actions;
    });

    commandMenuRegistry.registerProvider('linear.issue.import', (context) => {
      if (!context.linearEnabled) {
        return [];
      }
      const issueUrl = extractLinearIssueUrl(context.selectedText);
      if (issueUrl === null) {
        return [];
      }
      return [
        {
          id: 'linear.issue.import.selected',
          title: 'Create Task from Linear Ticket URL',
          aliases: ['linear ticket', 'import linear issue', 'linear issue to task'],
          keywords: ['linear', 'issue', 'ticket', 'task', 'import', 'url'],
          detail: issueUrl,
          run: async () => {
            queueControlPlaneOp(async () => {
              const result = await streamClient.sendCommand({
                type: 'linear.issue.import',
                url: issueUrl,
                ...(context.githubRepositoryId === null
                  ? {}
                  : {
                      repositoryId: context.githubRepositoryId,
                    }),
                ...(context.activeDirectoryId === null
                  ? {}
                  : {
                      projectId: context.activeDirectoryId,
                    }),
              });
              const parsedResult = asRecord(result);
              if (parsedResult === null) {
                setCommandNotice('linear import result unavailable');
                return;
              }
              const issue = asRecord(parsedResult['issue']);
              const task = asRecord(parsedResult['task']);
              const identifier =
                typeof issue?.['identifier'] === 'string' ? issue['identifier'] : null;
              const taskId = typeof task?.['taskId'] === 'string' ? task['taskId'] : null;
              if (identifier === null || taskId === null) {
                setCommandNotice('linear import result malformed');
                return;
              }
              setCommandNotice(`imported ${identifier} as ${taskId}`);
            }, 'command-menu-linear-issue-import');
          },
        },
      ];
    });

    commandMenuRegistry.registerProvider('theme.set', () => {
      const selectedThemeName = getActiveMuxTheme().name;
      return muxThemePresetNames().map(
        (preset): RegisteredCommandMenuAction<RuntimeCommandMenuContext> => ({
          id: `${THEME_ACTION_ID_PREFIX}${preset}`,
          title: preset,
          aliases: [preset, `theme ${preset}`],
          keywords: ['theme', 'preset', preset],
          ...(selectedThemeName === preset ||
          (preset === 'default' && selectedThemeName === 'legacy-default')
            ? {
                detail: 'current',
              }
            : {}),
          run: () => {
            if (themePickerSession !== null) {
              themePickerSession.committed = true;
            }
            applyThemePreset(preset, true);
          },
        }),
      );
    });

    commandMenuRegistry.registerProvider('shortcuts.catalog', () => {
      return keybindingCatalogEntries.map(
        (entry): RegisteredCommandMenuAction<RuntimeCommandMenuContext> => ({
          id: entry.id,
          title: entry.title,
          aliases: entry.aliases,
          keywords: entry.keywords,
          detail: entry.detail,
          screenLabel: entry.screenLabel,
          sectionLabel: entry.sectionLabel,
          bindingHint: entry.bindingHint,
          run: () => {},
        }),
      );
    });

    registerCommandMenuOpenInProvider<RuntimeCommandMenuContext>({
      registerProvider: (providerId, provider) =>
        commandMenuRegistry.registerProvider(providerId, provider),
      resolveDirectories: (context) => {
        const directoryId = context.activeDirectoryId;
        if (directoryId === null) {
          return [];
        }
        const directory = directoryRecords.get(directoryId);
        return directory === undefined ? [] : [directory];
      },
      resolveTargets: () => commandMenuOpenInTargets,
      projectPathTail: commandMenuProjectPathTail,
      openInTarget: openDirectoryInCommandMenuTarget,
      copyPath: (directoryPath) => writeTextToClipboard(directoryPath),
      setNotice: setCommandNotice,
    });

    commandMenuRegistry.registerProvider('github.repo.open', (context) => {
      const repositoryUrl = context.githubRepositoryUrl;
      if (repositoryUrl === null) {
        return [];
      }
      const actions: RegisteredCommandMenuAction<RuntimeCommandMenuContext>[] = [
        {
          id: 'github.repo.open',
          title: 'Open GitHub for This Repo (git)',
          aliases: ['open github for this repo', 'open github repo', 'open repository on github'],
          keywords: ['github', 'repository', 'repo', 'open'],
          detail: repositoryUrl,
          run: () => {
            const opened = openUrlInBrowser(repositoryUrl);
            setCommandNotice(
              opened
                ? 'opened github repository in browser'
                : `open github repository: ${repositoryUrl}`,
            );
          },
        },
      ];
      if (context.githubRepositoryId !== null) {
        const repositoryId = context.githubRepositoryId;
        actions.push({
          id: 'github.repo.my-prs.open',
          title: 'Show My Open Pull Requests (git)',
          aliases: ['show my open pull requests', 'my open pull requests', 'show my prs', 'my prs'],
          keywords: ['github', 'pr', 'pull-request', 'open', 'my'],
          detail: repositoryUrl,
          run: async () => {
            queueControlPlaneOp(async () => {
              const result = await streamClient.sendCommand({
                type: 'github.repo-my-prs-url',
                repositoryId,
              });
              const parsedResult = asRecord(result);
              if (parsedResult === null) {
                setCommandNotice('github my open pull requests url unavailable');
                return;
              }
              const myPrsUrl = parseGitHubUrl(parsedResult);
              if (myPrsUrl === null) {
                setCommandNotice('github my open pull requests url unavailable');
                return;
              }
              const opened = openUrlInBrowser(myPrsUrl);
              setCommandNotice(
                opened
                  ? 'opened my open pull requests in browser'
                  : `open pull requests: ${myPrsUrl}`,
              );
            }, 'command-menu-open-my-open-prs');
          },
        });
      }
      return actions;
    });

    commandMenuRegistry.registerProvider('github.project-pr', (context) => {
      const directoryId = context.activeDirectoryId;
      if (
        directoryId === null ||
        context.githubProjectPrLoading ||
        context.githubRepositoryId === null ||
        context.githubRepositoryUrl === null
      ) {
        return [];
      }
      const showPrActions = shouldShowGitHubPrActions({
        trackedBranch: context.githubTrackedBranch,
        defaultBranch: context.githubDefaultBranch,
      });
      if (!showPrActions) {
        return [];
      }
      if (context.githubOpenPrUrl !== null) {
        return [
          {
            id: 'github.pr.open',
            title: 'Open PR (git)',
            aliases: ['open pull request', 'open pr'],
            keywords: ['github', 'pr', 'open', 'pull-request'],
            detail: context.githubTrackedBranch ?? 'current project',
            run: async () => {
              queueControlPlaneOp(async () => {
                let result: unknown;
                try {
                  result = await streamClient.sendCommand({
                    type: 'github.project-pr',
                    directoryId,
                  });
                } catch (error: unknown) {
                  if (isGitHubAuthUnavailableError(error)) {
                    setGitHubDebugAuthState({
                      auth: 'no',
                      projectPr: 'er',
                    });
                    setCommandNotice(githubAuthHintNotice);
                    return;
                  }
                  setGitHubDebugAuthState({
                    auth: 'er',
                    projectPr: 'er',
                  });
                  throw error;
                }
                const parsedResult = asRecord(result);
                if (parsedResult === null) {
                  setCommandNotice('github project PR state unavailable');
                  return;
                }
                const state = parseGitHubProjectPrState(directoryId, parsedResult);
                setGitHubDebugAuthState({
                  projectPr: 'ok',
                });
                commandMenuGitHubProjectPrState = state;
                if (state.openPrUrl === null) {
                  setCommandNotice('no open pull request for tracked branch');
                  return;
                }
                const opened = openUrlInBrowser(state.openPrUrl);
                setCommandNotice(
                  opened
                    ? 'opened pull request in browser'
                    : `open pull request: ${state.openPrUrl}`,
                );
              }, 'command-menu-open-pr');
            },
          },
        ];
      }
      if (context.githubTrackedBranch !== null) {
        return [
          {
            id: 'github.pr.create',
            title: 'Create PR (git)',
            aliases: ['create pull request', 'new pr'],
            keywords: ['github', 'pr', 'create', 'pull-request'],
            detail: context.githubTrackedBranch,
            run: async () => {
              queueControlPlaneOp(async () => {
                let result: unknown;
                try {
                  result = await streamClient.sendCommand({
                    type: 'github.pr-create',
                    directoryId,
                  });
                } catch (error: unknown) {
                  if (isGitHubAuthUnavailableError(error)) {
                    setGitHubDebugAuthState({
                      auth: 'no',
                    });
                    setCommandNotice(githubAuthHintNotice);
                    return;
                  }
                  setGitHubDebugAuthState({
                    auth: 'er',
                  });
                  throw error;
                }
                const parsedResult = asRecord(result);
                if (parsedResult === null) {
                  setCommandNotice('github PR creation result unavailable');
                  return;
                }
                const prUrl = parseGitHubPrUrl(parsedResult);
                if (prUrl === null) {
                  throw new Error('github.pr-create returned malformed pr url');
                }
                setGitHubDebugAuthState({
                  auth: 'ok',
                  projectPr: 'ok',
                });
                refreshCommandMenuGitHubProjectPrState(directoryId);
                const opened = openUrlInBrowser(prUrl);
                setCommandNotice(
                  opened ? 'opened pull request in browser' : `open pull request: ${prUrl}`,
                );
              }, 'command-menu-create-pr');
            },
          },
        ];
      }
      return [];
    });

    commandMenuRegistry.registerProvider('profile.toggle', (context) => {
      const title = context.profileRunning ? 'Stop profiler' : 'Start profiler';
      const aliases = context.profileRunning
        ? ['stop profile', 'stop profiler']
        : ['start profile', 'start profiler'];
      return [
        {
          id: context.profileRunning ? 'profile.stop' : 'profile.start',
          title,
          aliases,
          keywords: ['profile', 'profiler'],
          run: async () => {
            queueControlPlaneOp(async () => {
              await runtimeControlActions.toggleGatewayProfiler();
            }, 'command-menu-toggle-profile');
          },
        },
      ];
    });

    commandMenuRegistry.registerProvider('status-timeline.toggle', (context) => {
      const title = context.statusTimelineRunning ? 'Stop status logging' : 'Start status logging';
      const aliases = context.statusTimelineRunning
        ? ['stop status logging', 'stop status']
        : ['start status logging', 'start status'];
      return [
        {
          id: context.statusTimelineRunning ? 'status.stop' : 'status.start',
          title,
          aliases,
          keywords: ['status', 'timeline', 'logging'],
          run: async () => {
            queueControlPlaneOp(async () => {
              await runtimeControlActions.toggleGatewayStatusTimeline();
            }, 'command-menu-toggle-status-timeline');
          },
        },
      ];
    });

    commandMenuRegistry.registerAction({
      id: 'app.quit',
      title: 'Quit',
      aliases: ['quit app', 'exit'],
      keywords: ['quit', 'shutdown', 'exit'],
      run: () => {
        requestStop();
      },
    });

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

    let latestRailViewRows = [] as ReturnType<typeof buildWorkspaceRailViewRows>;
    const renderRuntimePipeline = createRuntimeRenderPipeline<
      ConversationState,
      ControlPlaneRepositoryRecord,
      ControlPlaneTaskRecord,
      ControlPlaneDirectoryRecord,
      GitRepositorySnapshot,
      GitSummary,
      ProcessUsageSample,
      ReturnType<typeof buildWorkspaceRailViewRows>,
      NonNullable<ReturnType<typeof buildCurrentModalOverlay>>,
      ReturnType<OutputLoadSampler['currentStatusRow']>
    >({
      renderFlush: {
        perfNowNs,
        statusFooterForConversation: (conversation) =>
          composeDebugStatusFooter(
            workspace.showDebugBar,
            formatGitHubDebugTokens(githubDebugAuthState),
            conversation,
          ),
        currentStatusNotice: () => debugFooterNotice.current(),
        currentStatusRow: () => outputLoadSampler.currentStatusRow(),
        onStatusLineComposed: (input) => {
          const activeConversationId =
            input.activeConversation === null ? null : input.activeConversation.sessionId;
          const payload = {
            statusFooter: input.statusFooter,
            statusRow: input.statusRow,
            projectPaneActive: input.projectPaneActive,
            homePaneActive: input.homePaneActive,
            activeConversationId,
          };
          recordStatusTimeline({
            direction: 'outgoing',
            source: 'render-status-line',
            eventType: 'status-line',
            labels: resolveTraceLabels({
              sessionId: activeConversationId,
              directoryId: workspace.activeDirectoryId,
              conversationId: activeConversationId,
            }),
            payload,
            dedupeKey: 'render-status-line',
            dedupeValue: JSON.stringify(payload),
          });
        },
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
      },
      rightPaneRender: {
        workspace,
        showTasks: showTasksEntry,
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
      },
      leftRailRender: {
        leftRailPane,
        sessionProjectionInstrumentation,
        workspace,
        repositoryManager,
        repositoryAssociationByDirectoryId,
        directoryRepositorySnapshotByDirectoryId,
        gitSummaryByDirectoryId: gitSummaryByDirectoryId,
        loadingGitSummary: GIT_SUMMARY_LOADING,
        showTasksEntry,
      },
      renderState: {
        workspace,
        directories: directoryManager,
        conversations: conversationManager,
        snapshotFrame: (conversation) => conversation.oracle.snapshotWithoutHash(),
        selectionVisibleRows,
      },
      isScreenDirty: () => screen.isDirty(),
      clearDirty: () => {
        screen.clearDirty();
      },
      readRenderSnapshot: () =>
        readTuiRenderSnapshot<
          ControlPlaneDirectoryRecord,
          ConversationState,
          ControlPlaneRepositoryRecord,
          ControlPlaneTaskRecord,
          ProcessUsageSample
        >({
          directories: directoryManager,
          conversations: conversationManager,
          repositories: repositoryManager,
          tasks: taskManager,
          processUsage: processUsageRefreshService,
        }),
      setLatestRailViewRows: (rows) => {
        latestRailViewRows = rows;
      },
      activeDirectoryId: () => workspace.activeDirectoryId,
    });

    const render = (): void => {
      syncThemePickerPreview();
      renderRuntimePipeline({
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
        mapSessionEventToNormalizedEvent(
          event as Parameters<typeof mapSessionEventToNormalizedEvent>[0],
          scope as Parameters<typeof mapSessionEventToNormalizedEvent>[1],
          makeId,
        ),
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
      applyObservedEvent: (input) => {
        applyRuntimeObservedEventProjection(input, runtimeObservedEventProjection);
      },
      idFactory,
    });
    const handleEnvelope = (envelope: StreamServerEnvelope): void => {
      if (envelope.kind === 'pty.output') {
        const conversation = conversationManager.get(envelope.sessionId);
        const labels = resolveTraceLabels({
          sessionId: envelope.sessionId,
          directoryId: conversation?.directoryId ?? null,
          conversationId: envelope.sessionId,
        });
        if (renderTraceRecorder.shouldCaptureConversation(labels.conversationId)) {
          const chunk = Buffer.from(envelope.chunkBase64, 'base64');
          const issues = findRenderTraceControlIssues(chunk);
          if (issues.length > 0) {
            const issueSignature = issues
              .map((issue) => `${issue.kind}:${issue.sequence}`)
              .join('|');
            recordRenderTrace({
              direction: 'incoming',
              source: 'terminal-output',
              eventType: 'control-sequence-risk',
              labels,
              payload: {
                cursor: envelope.cursor,
                chunkBytes: chunk.length,
                chunkPreview: renderTraceChunkPreview(chunk, 320),
                issues: issues.map((issue) => ({
                  ...issue,
                  sequencePreview: renderTraceChunkPreview(issue.sequence, 160),
                })),
              },
              dedupeKey: `render-trace-sequence:${envelope.sessionId}`,
              dedupeValue: issueSignature,
            });
          }
        }
      }
      if (envelope.kind !== 'pty.output') {
        let eventType: string = envelope.kind;
        let directoryId: string | null = null;
        let conversationId: string | null = null;
        if (envelope.kind === 'pty.event') {
          eventType = `pty.event.${envelope.event.type}`;
        } else if (envelope.kind === 'stream.event') {
          eventType = `stream.event.${envelope.event.type}`;
          const observedRecord = envelope.event as Record<string, unknown>;
          directoryId =
            typeof observedRecord['directoryId'] === 'string'
              ? observedRecord['directoryId']
              : null;
          conversationId =
            typeof observedRecord['conversationId'] === 'string'
              ? observedRecord['conversationId']
              : null;
        }
        recordStatusTimeline({
          direction: 'incoming',
          source: 'stream-envelope',
          eventType,
          labels: resolveTraceLabels({
            sessionId: 'sessionId' in envelope ? envelope.sessionId : null,
            directoryId,
            conversationId,
          }),
          payload: envelope,
        });
      }
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
    if (!releaseNotesState.neverShow) {
      queueReleaseNotesFetch((prompt) => {
        if (prompt === null) {
          return;
        }
        if (releaseNotesState.dismissedLatestTag === prompt.latestTag) {
          return;
        }
        openReleaseNotesPrompt(prompt);
      }, 'startup-release-notes-check');
    }

    const routeReleaseNotesModalInput = (input: Buffer): boolean => {
      return handleReleaseNotesModalInput({
        input,
        prompt: releaseNotesPrompt,
        isQuitShortcut: (rawInput) =>
          detectMuxGlobalShortcut(rawInput, modalDismissShortcutBindings) === 'mux.app.quit',
        dismissOnOutsideClick: (rawInput, dismiss, onInsidePointerPress) =>
          modalInputRemainderState.dismissModalOnOutsideClick({
            modalManager,
            layoutCols: layout.cols,
            viewportRows: layout.rows,
            input: rawInput,
            dismiss,
            ...(onInsidePointerPress === undefined
              ? {}
              : {
                  onInsidePointerPress,
                }),
          }),
        buildReleaseNotesModalOverlay: () => buildReleaseNotesModalOverlay(layout.rows),
        setPrompt: (next) => {
          releaseNotesPrompt = next;
        },
        markDirty,
        onDismiss: (latestTag) => {
          dismissReleaseNotesTag(latestTag, false);
        },
        onNeverShowAgain: (latestTag) => {
          dismissReleaseNotesTag(latestTag, true);
        },
        onOpenLatest: (prompt) => {
          const releaseUrl = prompt.releases[0]?.url ?? prompt.releasesPageUrl;
          const opened = openUrlInBrowser(releaseUrl);
          setCommandNotice(
            opened ? 'opened release notes in browser' : `open release notes: ${releaseUrl}`,
          );
        },
        onUpdate: () => {
          runHarnessUpdateFromMenu();
        },
      });
    };

    const modalInputRouter = new InputRouter(
      {
        shortcuts: {
          isModalDismissShortcut: (input) =>
            detectMuxGlobalShortcut(input, modalDismissShortcutBindings) === 'mux.app.quit',
          isCommandMenuToggleShortcut: (input) =>
            detectMuxGlobalShortcut(input, shortcutBindings) === 'mux.command-menu.toggle',
          isArchiveConversationShortcut: (input) => {
            const action = detectMuxGlobalShortcut(input, shortcutBindings);
            return action === 'mux.conversation.archive' || action === 'mux.conversation.delete';
          },
        },
        overlays: {
          dismissOnOutsideClick: (rawInput, dismiss, onInsidePointerPress) =>
            modalInputRemainderState.dismissModalOnOutsideClick({
              modalManager,
              layoutCols: layout.cols,
              viewportRows: layout.rows,
              input: rawInput,
              dismiss,
              ...(onInsidePointerPress === undefined
                ? {}
                : {
                    onInsidePointerPress,
                  }),
            }),
          buildCommandMenuModalOverlay: () => buildCommandMenuModalOverlay(layout.rows),
          buildConversationTitleModalOverlay: () => buildConversationTitleModalOverlay(layout.rows),
          buildNewThreadModalOverlay: () => buildNewThreadModalOverlay(layout.rows),
          resolveNewThreadPromptAgentByRow,
        },
        actions: {
          stopConversationTitleEdit,
          queueControlPlaneOp,
          archiveConversation: async (sessionId) => {
            await runtimeDirectoryActions.archiveConversation(sessionId);
          },
          createAndActivateConversationInDirectory: async (directoryId, agentType) => {
            await conversationLifecycle.createAndActivateConversationInDirectory(
              directoryId,
              agentType,
            );
          },
          addDirectoryByPath: async (rawPath) => {
            await runtimeDirectoryActions.addDirectoryByPath(rawPath);
          },
          normalizeGitHubRemoteUrl,
          upsertRepositoryByRemoteUrl: async (remoteUrl, existingRepositoryId) => {
            await runtimeRepositoryActions.upsertRepositoryByRemoteUrl(
              remoteUrl,
              existingRepositoryId,
            );
          },
          repositoriesHas: (repositoryId) => repositories.has(repositoryId),
          submitTaskEditorPayload: runtimeTaskEditorActions.submitTaskEditorPayload,
          resolveCommandMenuActions,
          executeCommandMenuAction,
          ...(persistApiKey === undefined ? {} : { persistApiKey }),
        },
        state: {
          markDirty,
          conversations: conversationRecords,
          scheduleConversationTitlePersist,
          getTaskEditorPrompt: () => workspace.taskEditorPrompt,
          setTaskEditorPrompt: (next) => {
            workspace.taskEditorPrompt = next;
          },
          ...(persistApiKey === undefined
            ? {}
            : {
                getApiKeyPrompt: () => workspace.apiKeyPrompt,
                setApiKeyPrompt: (next) => {
                  workspace.apiKeyPrompt = next;
                },
              }),
          getConversationTitleEdit: () => workspace.conversationTitleEdit,
          getCommandMenu: () => workspace.commandMenu,
          setCommandMenu: (menu) => {
            workspace.commandMenu = menu;
          },
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
        },
      },
      {
        handleCommandMenuInput,
        handleTaskEditorPromptInput,
        handleApiKeyPromptInput,
        handleConversationTitleEditInput,
        handleNewThreadPromptInput,
        handleAddDirectoryPromptInput,
        handleRepositoryPromptInput,
      },
    );

    const { handleRepositoryFoldInput, handleGlobalShortcutInput, leftRailPointerInput } =
      createTuiLeftRailInteractions({
        workspace,
        railViewState: {
          readLatestRows: () => latestRailViewRows,
        },
        directories: directoryRecords,
        conversationRecords,
        repositories,
        conversationLookup: conversationManager,
        directoryLookup: directoryManager,
        repositoryManager,
        repositoryGroupFallbackId: UNTRACKED_REPOSITORY_GROUP_ID,
        queueControlPlaneOps: {
          queueControlPlaneOp,
          queueLatestControlPlaneOp,
        },
        conversationLifecycle,
        runtimeDirectoryActions,
        runtimeRepositoryActions,
        runtimeControlActions,
        navigation: {
          enterHomePane,
          enterProjectPane,
          ...(showTasksEntry
            ? {
                enterTasksPane,
              }
            : {}),
          resolveDirectoryForAction,
          openNewThreadPrompt,
          toggleCommandMenu,
          requestStop,
          markDirty,
          queuePersistMuxUiState,
          resetFrameCache: () => {
            screen.resetFrameCache();
          },
          releaseViewportPinForSelection,
        },
        shortcutBindings,
        showTasksEntry,
      });

    const routeModalInput = (input: Buffer): boolean => {
      return routeTuiModalInput({
        input,
        routeReleaseNotesModalInput,
        routeModalInput: (modalInput) => modalInputRouter.routeModalInput(modalInput),
      });
    };
    const { handleInput } = createTuiMainPaneInteractions({
      workspace,
      controllerId: muxControllerId,
      getLayout: () => layout,
      noteGitActivity,
      getInputRemainder: () => modalInputRemainderState.getInputRemainder(),
      setInputRemainder: (next) => {
        modalInputRemainderState.setInputRemainder(next);
      },
      leftRailPointerInput,
      project: {
        projectPaneActionAtRow,
        refreshGitHubReview: (directoryId) => {
          refreshProjectPaneGitHubReviewState(directoryId, {
            forceRefresh: true,
          });
        },
        toggleGitHubNode: toggleProjectPaneGitHubNode,
        openNewThreadPrompt,
        queueCloseDirectory: (directoryId) => {
          queueControlPlaneOp(async () => {
            await runtimeDirectoryActions.closeDirectory(directoryId);
          }, 'project-pane-close-project');
        },
      },
      task: {
        selectTaskById,
        selectRepositoryById,
        runTaskPaneAction: (action) => {
          runtimeTaskPaneActions.runTaskPaneAction(action);
        },
        openTaskEditPrompt: (taskId) => {
          runtimeTaskPaneActions.openTaskEditPrompt(taskId);
        },
        reorderTaskByDrop: (draggedTaskId, targetTaskId) => {
          runtimeTaskPaneActions.reorderTaskByDrop(draggedTaskId, targetTaskId);
        },
        reorderRepositoryByDrop,
        handleShortcutInput: (input) => runtimeTaskPaneShortcuts.handleInput(input),
      },
      repository: {
        openRepositoryPromptForEdit: (repositoryId) => {
          runtimeRepositoryActions.openRepositoryPromptForEdit(repositoryId);
        },
      },
      selection: {
        pinViewportForSelection,
        releaseViewportPinForSelection,
      },
      runtime: {
        isShuttingDown: () => shuttingDown,
        getActiveConversation: () => conversationManager.getActiveConversation(),
        sendInputToSession: (sessionId, input) => {
          streamClient.sendInput(sessionId, input);
        },
        isControlledByLocalHuman: (input) => conversationManager.isControlledByLocalHuman(input),
        enableInputMode: () => {
          inputModeManager.enable();
        },
      },
      modal: {
        routeModalInput,
      },
      shortcuts: {
        handleRepositoryFoldInput,
        handleGlobalShortcutInput,
      },
      layout: {
        applyPaneDividerAtCol,
      },
      markDirty,
    });
    const onResize = (): void => {
      const nextSize = terminalSize();
      queueResize(nextSize);
    };
    const detachRuntimeProcessWiring = attachRuntimeProcessWiring({
      onInput: handleInput,
      onResize,
      requestStop,
      handleRuntimeFatal,
    });

    await startupOrchestrator.hydrateStartupState(startupObservedCursor);

    inputModeManager.enable();
    applyLayout(size, true);
    scheduleRender();
    const runtimeShutdownOptions = {
      screen,
      outputLoadSampler,
      startupBackgroundProbeService: startupOrchestrator,
      clearResizeTimer: () => {
        runtimeLayoutResize.clearResizeTimer();
      },
      clearPtyResizeTimer: () => {
        runtimeLayoutResize.clearPtyResizeTimer();
      },
      clearHomePaneBackgroundTimer: () => {
        if (homePaneBackgroundTimer !== null) {
          clearInterval(homePaneBackgroundTimer);
          homePaneBackgroundTimer = null;
        }
      },
      clearProjectPaneGitHubReviewRefreshTimer: () => {
        projectPaneGitHubReviewCache.stopAutoRefresh();
      },
      persistMuxUiStateNow,
      clearConversationTitleEditTimer: () => {
        conversationLifecycle.clearConversationTitleEditTimer();
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
        detachRuntimeProcessWiring();
      },
      removeEnvelopeListener,
      stopWorkspaceObservedEvents: () => {
        stopWorkspaceObservedEvents();
      },
      unsubscribeTaskPlanningEvents: async () => {
        await conversationLifecycle.unsubscribeTaskPlanningEvents();
      },
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
    };

    try {
      while (!stop) {
        await new Promise((resolve) => {
          setTimeout(resolve, 50);
        });
      }
    } finally {
      shuttingDown = true;
      statusTimelineRecorder.close();
      renderTraceRecorder.close();
      await finalizeRuntimeShutdown(runtimeShutdownOptions);
    }

    if (exit === null) {
      if (runtimeRenderLifecycle.hasFatal()) {
        return 1;
      }
      return 0;
    }
    return normalizeExitCode(exit);
  }
}

async function runCodexLiveMuxRuntimeMain(): Promise<number> {
  return await new CodexLiveMuxRuntimeApplication().run();
}

export async function runCodexLiveMuxRuntimeProcess(): Promise<void> {
  try {
    const code = await runCodexLiveMuxRuntimeMain();
    process.exitCode = code;
  } catch (error: unknown) {
    shutdownPerfCore();
    restoreTerminalState(true);
    process.stderr.write(`codex:live:mux fatal error: ${formatErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

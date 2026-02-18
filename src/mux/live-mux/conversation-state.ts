import { resolveTerminalCommandForEnvironment } from '../../control-plane/stream-server.ts';
import type { parseSessionSummaryRecord } from '../../control-plane/session-summary.ts';
import type { StreamSessionController } from '../../control-plane/stream-protocol.ts';
import type { EventScope } from '../../events/normalized-events.ts';
import type { PtyExit } from '../../pty/pty_host.ts';
import { TerminalSnapshotOracle } from '../../terminal/snapshot-oracle.ts';
import { type ConversationRailSessionSummary } from '../conversation-rail.ts';
import { normalizeThreadAgentType } from '../new-thread-prompt.ts';
import { applyTelemetrySummaryToConversation } from '../runtime-wiring.ts';

type SessionSummaryRecord = NonNullable<ReturnType<typeof parseSessionSummaryRecord>>;

export interface ConversationState {
  readonly sessionId: string;
  directoryId: string | null;
  title: string;
  agentType: string;
  adapterState: Record<string, unknown>;
  turnId: string;
  scope: EventScope;
  oracle: TerminalSnapshotOracle;
  status: ConversationRailSessionSummary['status'];
  attentionReason: string | null;
  startedAt: string;
  lastEventAt: string | null;
  exitedAt: string | null;
  lastExit: PtyExit | null;
  processId: number | null;
  live: boolean;
  attached: boolean;
  launchCommand: string | null;
  lastOutputCursor: number;
  lastKnownWork: string | null;
  lastKnownWorkAt: string | null;
  lastTelemetrySource: string | null;
  controller: StreamSessionController | null;
}

function createConversationScope(
  baseScope: EventScope,
  conversationId: string,
  turnId: string,
): EventScope {
  return {
    tenantId: baseScope.tenantId,
    userId: baseScope.userId,
    workspaceId: baseScope.workspaceId,
    worktreeId: baseScope.worktreeId,
    conversationId,
    turnId,
  };
}

export function createConversationState(
  sessionId: string,
  directoryId: string | null,
  title: string,
  agentType: string,
  adapterState: Record<string, unknown>,
  turnId: string,
  baseScope: EventScope,
  cols: number,
  rows: number,
): ConversationState {
  return {
    sessionId,
    directoryId,
    title,
    agentType,
    adapterState,
    turnId,
    scope: createConversationScope(baseScope, sessionId, turnId),
    oracle: new TerminalSnapshotOracle(cols, rows),
    status: 'running',
    attentionReason: null,
    startedAt: new Date().toISOString(),
    lastEventAt: null,
    exitedAt: null,
    lastExit: null,
    processId: null,
    live: true,
    attached: false,
    launchCommand: null,
    lastOutputCursor: 0,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    lastTelemetrySource: null,
    controller: null,
  };
}

export function applySummaryToConversation(
  target: ConversationState,
  summary: SessionSummaryRecord | null,
): void {
  if (summary === null) {
    return;
  }
  target.scope.tenantId = summary.tenantId;
  target.scope.userId = summary.userId;
  target.scope.workspaceId = summary.workspaceId;
  target.scope.worktreeId = summary.worktreeId;
  target.directoryId = summary.directoryId;
  target.status = summary.status;
  target.attentionReason = summary.attentionReason;
  target.startedAt = summary.startedAt;
  target.lastEventAt = summary.lastEventAt;
  target.exitedAt = summary.exitedAt;
  target.lastExit = summary.lastExit;
  target.processId = summary.processId;
  target.live = summary.live;
  target.controller = summary.controller;
  applyTelemetrySummaryToConversation(target, summary.telemetry);
}

export function conversationSummary(conversation: ConversationState): ConversationRailSessionSummary {
  return {
    sessionId: conversation.sessionId,
    status: conversation.status,
    attentionReason: conversation.attentionReason,
    live: conversation.live,
    startedAt: conversation.startedAt,
    lastEventAt: conversation.lastEventAt,
  };
}

export function compactDebugText(value: string | null): string {
  if (value === null) {
    return '';
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= 160) {
    return normalized;
  }
  return `${normalized.slice(0, 159)}…`;
}

function shellQuoteToken(token: string): string {
  if (token.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(token)) {
    return token;
  }
  return `'${token.replaceAll("'", "'\"'\"'")}'`;
}

export function formatCommandForDebugBar(command: string, args: readonly string[]): string {
  const tokens = [command, ...args].map(shellQuoteToken);
  return tokens.join(' ');
}

export function launchCommandForAgent(agentType: string): string {
  const normalized = normalizeThreadAgentType(agentType);
  if (normalized === 'claude') {
    return 'claude';
  }
  if (normalized === 'critique') {
    return 'critique';
  }
  if (normalized === 'terminal') {
    return resolveTerminalCommandForEnvironment(process.env, process.platform);
  }
  return 'codex';
}

export function debugFooterForConversation(conversation: ConversationState): string {
  const launchCommand =
    conversation.launchCommand === null
      ? '(launch command unavailable)'
      : compactDebugText(conversation.launchCommand);
  return `[dbg] ${launchCommand}`;
}

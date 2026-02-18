import { resolve } from 'node:path';

const RENDER_TRACE_STATE_FILE_NAME = 'active-render-trace.json';
export const RENDER_TRACE_STATE_VERSION = 1;
export const RENDER_TRACE_MODE = 'live-mux-render-trace';
export const DEFAULT_RENDER_TRACE_ROOT_PATH = '.harness/render-traces';
export const RENDER_TRACE_FILE_NAME = 'render-trace.log';

export interface ActiveRenderTraceState {
  version: typeof RENDER_TRACE_STATE_VERSION;
  mode: typeof RENDER_TRACE_MODE;
  outputPath: string;
  sessionName: string | null;
  conversationId: string | null;
  startedAt: string;
}

export function resolveRenderTraceStatePath(
  invocationDirectory: string,
  sessionName: string | null,
): string {
  if (sessionName === null) {
    return resolve(invocationDirectory, '.harness', RENDER_TRACE_STATE_FILE_NAME);
  }
  return resolve(invocationDirectory, '.harness', 'sessions', sessionName, RENDER_TRACE_STATE_FILE_NAME);
}

export function resolveDefaultRenderTraceOutputPath(
  invocationDirectory: string,
  sessionName: string | null,
): string {
  if (sessionName === null) {
    return resolve(invocationDirectory, DEFAULT_RENDER_TRACE_ROOT_PATH, RENDER_TRACE_FILE_NAME);
  }
  return resolve(invocationDirectory, DEFAULT_RENDER_TRACE_ROOT_PATH, sessionName, RENDER_TRACE_FILE_NAME);
}

export function parseActiveRenderTraceState(raw: unknown): ActiveRenderTraceState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate['version'] !== RENDER_TRACE_STATE_VERSION) {
    return null;
  }
  if (candidate['mode'] !== RENDER_TRACE_MODE) {
    return null;
  }
  const outputPath = candidate['outputPath'];
  const sessionName = candidate['sessionName'];
  const conversationId = candidate['conversationId'];
  const startedAt = candidate['startedAt'];
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    return null;
  }
  if (sessionName !== null && typeof sessionName !== 'string') {
    return null;
  }
  if (conversationId !== null && typeof conversationId !== 'string') {
    return null;
  }
  if (typeof startedAt !== 'string' || startedAt.length === 0) {
    return null;
  }
  return {
    version: RENDER_TRACE_STATE_VERSION,
    mode: RENDER_TRACE_MODE,
    outputPath,
    sessionName,
    conversationId,
    startedAt,
  };
}

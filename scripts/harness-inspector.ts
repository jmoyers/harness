import { existsSync, readFileSync } from 'node:fs';
import { loadHarnessConfig } from '../src/config/config-core.ts';

export const DEFAULT_PROFILE_INSPECT_TIMEOUT_MS = 5000;
const PROFILE_RUNTIME_STATE_KEY = '__HARNESS_GATEWAY_CPU_PROFILE_STATE__';

interface InspectorPendingCommand {
  method: string;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export class InspectorWebSocketClient {
  private readonly pending = new Map<number, InspectorPendingCommand>();
  private nextId = 1;
  private closed = false;

  private constructor(
    private readonly socket: WebSocket,
    private readonly endpoint: string,
  ) {
    socket.addEventListener('message', (event) => {
      const payload = this.parseMessagePayload(event.data);
      if (payload === null) {
        return;
      }
      const idValue = payload['id'];
      if (typeof idValue !== 'number') {
        return;
      }
      const pending = this.pending.get(idValue);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(idValue);
      clearTimeout(pending.timeoutHandle);
      const errorValue = payload['error'];
      if (typeof errorValue === 'object' && errorValue !== null) {
        const code = (errorValue as Record<string, unknown>)['code'];
        const message = (errorValue as Record<string, unknown>)['message'];
        const codeText = typeof code === 'number' ? String(code) : 'unknown';
        const messageText = typeof message === 'string' ? message : 'unknown inspector error';
        pending.reject(new Error(`${pending.method} failed (${codeText}): ${messageText}`));
        return;
      }
      const resultValue = payload['result'];
      if (typeof resultValue !== 'object' || resultValue === null) {
        pending.resolve({});
        return;
      }
      pending.resolve(resultValue as Record<string, unknown>);
    });
    socket.addEventListener('error', () => {
      this.closeWithError(new Error(`inspector websocket error (${this.endpoint})`));
    });
    socket.addEventListener('close', () => {
      this.closeWithError(new Error(`inspector websocket closed (${this.endpoint})`));
    });
  }

  static async connect(endpoint: string, timeoutMs: number): Promise<InspectorWebSocketClient> {
    return await new Promise<InspectorWebSocketClient>((resolveClient, rejectClient) => {
      let settled = false;
      const socket = new WebSocket(endpoint);
      const timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          socket.close();
        } catch {
          // Best-effort cleanup only.
        }
        rejectClient(new Error(`inspector websocket connect timeout (${endpoint})`));
      }, timeoutMs);

      const onOpen = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        resolveClient(new InspectorWebSocketClient(socket, endpoint));
      };

      const onError = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        rejectClient(new Error(`inspector websocket connect failed (${endpoint})`));
      };

      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
    });
  }

  async sendCommand(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_PROFILE_INSPECT_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new Error(`inspector websocket is closed (${this.endpoint})`);
    }
    const id = this.nextId;
    this.nextId += 1;
    return await new Promise<Record<string, unknown>>((resolveCommand, rejectCommand) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(
          new Error(`${method} timed out after ${String(timeoutMs)}ms (${this.endpoint})`),
        );
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolveCommand,
        reject: rejectCommand,
        timeoutHandle,
      });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error: unknown) {
        this.pending.delete(id);
        clearTimeout(timeoutHandle);
        rejectCommand(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // Best-effort cleanup only.
    }
    this.closeWithError(new Error(`inspector websocket closed (${this.endpoint})`));
  }

  private closeWithError(error: Error): void {
    if (this.closed && this.pending.size === 0) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private parseMessagePayload(rawData: unknown): Record<string, unknown> | null {
    const rawText = typeof rawData === 'string' ? rawData : String(rawData);
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export interface InspectorProfileState {
  status: string;
  error: string | null;
  written: boolean;
}

export function buildInspectorProfileStartExpression(): string {
  return `(() => {
    const key = ${JSON.stringify(PROFILE_RUNTIME_STATE_KEY)};
    const current = globalThis[key];
    if (current !== undefined && current !== null) {
      const status = typeof current.status === 'string' ? current.status : 'unknown';
      if (status === 'starting' || status === 'running' || status === 'stopping') {
        return JSON.stringify({ ok: false, reason: status });
      }
      if (current.session) {
        try { current.session.disconnect(); } catch {}
      }
    }
    const state = {
      status: 'starting',
      error: null,
      written: false,
      session: null,
    };
    globalThis[key] = state;
    import('node:inspector').then((inspectorMod) => {
      const inspector = inspectorMod.default ?? inspectorMod;
      const session = new inspector.Session();
      state.session = session;
      session.connect();
      session.post('Profiler.enable', (enableError) => {
        if (enableError) {
          state.status = 'failed';
          state.error = String(enableError);
          return;
        }
        session.post('Profiler.start', (startError) => {
          if (startError) {
            state.status = 'failed';
            state.error = String(startError);
            return;
          }
          state.status = 'running';
        });
      });
    }).catch((error) => {
      state.status = 'failed';
      state.error = String(error);
    });
    return JSON.stringify({ ok: true });
  })()`;
}

export function buildInspectorProfileStopExpression(
  gatewayProfilePath: string,
  gatewayProfileDir: string,
): string {
  return `(() => {
    const key = ${JSON.stringify(PROFILE_RUNTIME_STATE_KEY)};
    const targetPath = ${JSON.stringify(gatewayProfilePath)};
    const targetDir = ${JSON.stringify(gatewayProfileDir)};
    const state = globalThis[key];
    if (state === undefined || state === null) {
      return JSON.stringify({ ok: false, reason: 'missing' });
    }
    if (state.status !== 'running' || !state.session) {
      return JSON.stringify({ ok: false, reason: String(state.status ?? 'unknown') });
    }
    state.status = 'stopping';
    state.error = null;
    state.written = false;
    state.session.post('Profiler.stop', (stopError, stopResult) => {
      if (stopError) {
        state.status = 'failed';
        state.error = String(stopError);
        return;
      }
      const profile = stopResult?.profile;
      if (profile === undefined) {
        state.status = 'failed';
        state.error = 'missing profile payload';
        return;
      }
      import('node:fs').then((fs) => {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(profile) + '\\n', 'utf8');
        state.written = true;
        state.status = 'stopped';
        try { state.session.disconnect(); } catch {}
        state.session = null;
      }).catch((error) => {
        state.status = 'failed';
        state.error = String(error);
      });
    });
    return JSON.stringify({ ok: true });
  })()`;
}

function buildInspectorProfileStatusExpression(): string {
  return `(() => {
    const key = ${JSON.stringify(PROFILE_RUNTIME_STATE_KEY)};
    const state = globalThis[key];
    if (state === undefined || state === null) {
      return JSON.stringify(null);
    }
    return JSON.stringify({
      status: typeof state.status === 'string' ? state.status : 'unknown',
      error: typeof state.error === 'string' ? state.error : null,
      written: state.written === true,
    });
  })()`;
}

function normalizeInspectorProfileState(rawValue: unknown): InspectorProfileState | null {
  if (typeof rawValue !== 'string') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  const status = candidate['status'];
  const error = candidate['error'];
  const written = candidate['written'];
  if (typeof status !== 'string') {
    return null;
  }
  if (error !== null && typeof error !== 'string') {
    return null;
  }
  if (typeof written !== 'boolean') {
    return null;
  }
  return {
    status,
    error,
    written,
  };
}

export async function evaluateInspectorExpression(
  client: InspectorWebSocketClient,
  expression: string,
  timeoutMs: number,
): Promise<unknown> {
  const result = await client.sendCommand(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
    },
    timeoutMs,
  );
  const wasThrown = result['wasThrown'];
  if (wasThrown === true) {
    const exceptionDetails = result['exceptionDetails'];
    if (typeof exceptionDetails === 'object' && exceptionDetails !== null) {
      const text = (exceptionDetails as Record<string, unknown>)['text'];
      if (typeof text === 'string' && text.length > 0) {
        throw new Error(`inspector runtime evaluate failed: ${text}`);
      }
    }
    throw new Error('inspector runtime evaluate failed');
  }
  const remoteValue = result['result'];
  if (typeof remoteValue !== 'object' || remoteValue === null) {
    return null;
  }
  return (remoteValue as Record<string, unknown>)['value'];
}

export async function readInspectorProfileState(
  client: InspectorWebSocketClient,
  timeoutMs: number,
): Promise<InspectorProfileState | null> {
  const rawState = await evaluateInspectorExpression(
    client,
    buildInspectorProfileStatusExpression(),
    timeoutMs,
  );
  return normalizeInspectorProfileState(rawState);
}

function parseInspectorWebSocketUrlsFromGatewayLog(logPath: string): readonly string[] {
  if (!existsSync(logPath)) {
    return [];
  }
  let logText = '';
  try {
    logText = readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  const matches = logText.match(/ws:\/\/[^\s]+/gu) ?? [];
  const urls: string[] = [];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const rawUrl = matches[index]!;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'ws:') {
        continue;
      }
    } catch {
      continue;
    }
    if (!urls.includes(rawUrl)) {
      urls.push(rawUrl);
    }
  }
  return urls;
}

function resolveInspectorWebSocketCandidates(
  invocationDirectory: string,
  logPath: string,
): readonly string[] {
  const urls = [...parseInspectorWebSocketUrlsFromGatewayLog(logPath)];
  const loadedConfig = loadHarnessConfig({ cwd: invocationDirectory });
  const debugConfig = loadedConfig.config.debug;
  if (debugConfig.enabled && debugConfig.inspect.enabled) {
    const configuredUrl = `ws://localhost:${String(debugConfig.inspect.gatewayPort)}/harness-gateway`;
    if (!urls.includes(configuredUrl)) {
      urls.push(configuredUrl);
    }
  }
  return urls;
}

export async function connectGatewayInspector(
  invocationDirectory: string,
  logPath: string,
  timeoutMs: number,
): Promise<{ client: InspectorWebSocketClient; endpoint: string }> {
  const candidates = resolveInspectorWebSocketCandidates(invocationDirectory, logPath);
  if (candidates.length === 0) {
    throw new Error(
      'gateway inspector endpoint unavailable; enable debug.inspect, restart gateway, then retry `harness profile start`',
    );
  }
  let lastError: string | null = null;
  for (const candidate of candidates) {
    let client: InspectorWebSocketClient | null = null;
    try {
      client = await InspectorWebSocketClient.connect(candidate, timeoutMs);
      await client.sendCommand('Runtime.enable', {}, timeoutMs);
      return {
        client,
        endpoint: candidate,
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
      client?.close();
    }
  }
  throw new Error(
    `gateway inspector endpoint unavailable; enable debug.inspect, restart gateway, then retry \`harness profile start\` (${lastError ?? 'unknown error'})`,
  );
}

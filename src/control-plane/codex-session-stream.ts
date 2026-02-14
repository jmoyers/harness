import { connectControlPlaneStreamClient, type ControlPlaneStreamClient } from './stream-client.ts';
import type { ControlPlaneStreamServer } from './stream-server.ts';

interface BaseControlPlaneAddress {
  host: string;
  port: number;
  authToken?: string;
}

interface EmbeddedControlPlaneOptions {
  mode: 'embedded';
}

interface RemoteControlPlaneOptions extends BaseControlPlaneAddress {
  mode: 'remote';
}

type CodexControlPlaneMode = EmbeddedControlPlaneOptions | RemoteControlPlaneOptions;

interface OpenCodexControlPlaneSessionOptions {
  controlPlane: CodexControlPlaneMode;
  sessionId: string;
  args: string[];
  env: Record<string, string>;
  initialCols: number;
  initialRows: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
}

interface OpenCodexControlPlaneSessionResult {
  client: ControlPlaneStreamClient;
  close: () => Promise<void>;
}

interface OpenCodexControlPlaneClientResult {
  client: ControlPlaneStreamClient;
  close: () => Promise<void>;
}

interface OpenCodexControlPlaneSessionDependencies {
  startEmbeddedServer?: () => Promise<ControlPlaneStreamServer>;
}

export async function openCodexControlPlaneClient(
  controlPlane: CodexControlPlaneMode,
  dependencies: OpenCodexControlPlaneSessionDependencies = {}
): Promise<OpenCodexControlPlaneClientResult> {
  let controlPlaneAddress: BaseControlPlaneAddress;
  let embeddedServer: ControlPlaneStreamServer | null = null;
  if (controlPlane.mode === 'embedded') {
    const startEmbeddedServer = dependencies.startEmbeddedServer;
    if (startEmbeddedServer === undefined) {
      throw new Error('embedded mode requires a startEmbeddedServer dependency');
    }
    embeddedServer = await startEmbeddedServer();
    const embeddedAddress = embeddedServer.address();
    controlPlaneAddress = {
      host: '127.0.0.1',
      port: embeddedAddress.port
    };
  } else {
    controlPlaneAddress = controlPlane;
  }

  const clientConnectOptions: {
    host: string;
    port: number;
    authToken?: string;
  } = {
    host: controlPlaneAddress.host,
    port: controlPlaneAddress.port
  };
  if (controlPlaneAddress.authToken !== undefined) {
    clientConnectOptions.authToken = controlPlaneAddress.authToken;
  }
  const client = await connectControlPlaneStreamClient(clientConnectOptions);

  return {
    client,
    close: async () => {
      client.close();
      if (embeddedServer !== null) {
        await embeddedServer.close();
      }
    }
  };
}

export async function openCodexControlPlaneSession(
  options: OpenCodexControlPlaneSessionOptions,
  dependencies: OpenCodexControlPlaneSessionDependencies = {}
): Promise<OpenCodexControlPlaneSessionResult> {
  const opened = await openCodexControlPlaneClient(options.controlPlane, dependencies);
  const client = opened.client;

  try {
    const startCommand: {
      type: 'pty.start';
      sessionId: string;
      args: string[];
      env: Record<string, string>;
      initialCols: number;
      initialRows: number;
      terminalForegroundHex?: string;
      terminalBackgroundHex?: string;
    } = {
      type: 'pty.start',
      sessionId: options.sessionId,
      args: options.args,
      env: options.env,
      initialCols: options.initialCols,
      initialRows: options.initialRows
    };
    if (options.terminalForegroundHex !== undefined) {
      startCommand.terminalForegroundHex = options.terminalForegroundHex;
    }
    if (options.terminalBackgroundHex !== undefined) {
      startCommand.terminalBackgroundHex = options.terminalBackgroundHex;
    }

    const startResult = await client.sendCommand(startCommand);
    if (startResult['sessionId'] !== options.sessionId) {
      throw new Error('control-plane pty.start returned unexpected session id');
    }

    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: options.sessionId
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: options.sessionId,
      sinceCursor: 0
    });
  } catch (error: unknown) {
    await opened.close();
    throw error;
  }

  return {
    client,
    close: async () => {
      try {
        await client.sendCommand({
          type: 'pty.close',
          sessionId: options.sessionId
        });
      } catch {
        // Best-effort close only.
      }
      await opened.close();
    }
  };
}

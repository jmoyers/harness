interface RuntimeProcessTarget {
  readonly stdin: Pick<NodeJS.ReadStream, 'on' | 'off'>;
  readonly stdout: Pick<NodeJS.WriteStream, 'on' | 'off'>;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): RuntimeProcessTarget;
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): RuntimeProcessTarget;
  once(event: 'uncaughtException', listener: (error: Error) => void): RuntimeProcessTarget;
  once(event: 'unhandledRejection', listener: (reason: unknown) => void): RuntimeProcessTarget;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): RuntimeProcessTarget;
  off(event: 'uncaughtException', listener: (error: Error) => void): RuntimeProcessTarget;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): RuntimeProcessTarget;
}

export interface RuntimeProcessWiringOptions {
  readonly onInput: (chunk: Buffer) => void;
  readonly onResize: () => void;
  readonly requestStop: () => void;
  readonly handleRuntimeFatal: (origin: string, error: unknown) => void;
  readonly target?: RuntimeProcessTarget;
}

export function attachRuntimeProcessWiring(options: RuntimeProcessWiringOptions): () => void {
  const target = options.target ?? process;
  const onInputSafe = (chunk: Buffer): void => {
    try {
      options.onInput(chunk);
    } catch (error: unknown) {
      options.handleRuntimeFatal('stdin-data', error);
    }
  };

  const onResizeSafe = (): void => {
    try {
      options.onResize();
    } catch (error: unknown) {
      options.handleRuntimeFatal('stdout-resize', error);
    }
  };

  const onUncaughtException = (error: Error): void => {
    options.handleRuntimeFatal('uncaught-exception', error);
  };

  const onUnhandledRejection = (reason: unknown): void => {
    options.handleRuntimeFatal('unhandled-rejection', reason);
  };

  target.stdin.on('data', onInputSafe);
  target.stdout.on('resize', onResizeSafe);
  target.on('SIGINT', options.requestStop);
  target.on('SIGTERM', options.requestStop);
  target.once('uncaughtException', onUncaughtException);
  target.once('unhandledRejection', onUnhandledRejection);

  return (): void => {
    target.stdin.off('data', onInputSafe);
    target.stdout.off('resize', onResizeSafe);
    target.off('SIGINT', options.requestStop);
    target.off('SIGTERM', options.requestStop);
    target.off('uncaughtException', onUncaughtException);
    target.off('unhandledRejection', onUnhandledRejection);
  };
}

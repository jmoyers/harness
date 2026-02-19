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

interface RuntimeProcessWiringOptions {
  readonly onInput: (chunk: Buffer) => void;
  readonly onResize: () => void;
  readonly requestStop: () => void;
  readonly handleRuntimeFatal: (origin: string, error: unknown) => void;
  readonly target?: RuntimeProcessTarget;
}

export class RuntimeProcessWiring {
  private readonly target: RuntimeProcessTarget;

  constructor(private readonly options: RuntimeProcessWiringOptions) {
    this.target = options.target ?? process;
  }

  attach(): void {
    this.target.stdin.on('data', this.onInputSafe);
    this.target.stdout.on('resize', this.onResizeSafe);
    this.target.on('SIGINT', this.options.requestStop);
    this.target.on('SIGTERM', this.options.requestStop);
    this.target.once('uncaughtException', this.onUncaughtException);
    this.target.once('unhandledRejection', this.onUnhandledRejection);
  }

  detach(): void {
    this.target.stdin.off('data', this.onInputSafe);
    this.target.stdout.off('resize', this.onResizeSafe);
    this.target.off('SIGINT', this.options.requestStop);
    this.target.off('SIGTERM', this.options.requestStop);
    this.target.off('uncaughtException', this.onUncaughtException);
    this.target.off('unhandledRejection', this.onUnhandledRejection);
  }

  private readonly onInputSafe = (chunk: Buffer): void => {
    try {
      this.options.onInput(chunk);
    } catch (error: unknown) {
      this.options.handleRuntimeFatal('stdin-data', error);
    }
  };

  private readonly onResizeSafe = (): void => {
    try {
      this.options.onResize();
    } catch (error: unknown) {
      this.options.handleRuntimeFatal('stdout-resize', error);
    }
  };

  private readonly onUncaughtException = (error: Error): void => {
    this.options.handleRuntimeFatal('uncaught-exception', error);
  };

  private readonly onUnhandledRejection = (reason: unknown): void => {
    this.options.handleRuntimeFatal('unhandled-rejection', reason);
  };
}

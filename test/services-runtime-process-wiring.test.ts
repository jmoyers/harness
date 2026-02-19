import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeProcessWiring } from '../src/services/runtime-process-wiring.ts';

class FakeInputStream {
  private listener: ((chunk: Buffer) => void) | null = null;

  on(event: 'data', listener: (chunk: Buffer) => void): FakeInputStream {
    if (event === 'data') {
      this.listener = listener;
    }
    return this;
  }

  off(event: 'data', listener: (chunk: Buffer) => void): FakeInputStream {
    if (event === 'data' && this.listener === listener) {
      this.listener = null;
    }
    return this;
  }

  emitData(chunk: Buffer): void {
    this.listener?.(chunk);
  }
}

class FakeOutputStream {
  private listener: (() => void) | null = null;

  on(event: 'resize', listener: () => void): FakeOutputStream {
    if (event === 'resize') {
      this.listener = listener;
    }
    return this;
  }

  off(event: 'resize', listener: () => void): FakeOutputStream {
    if (event === 'resize' && this.listener === listener) {
      this.listener = null;
    }
    return this;
  }

  emitResize(): void {
    this.listener?.();
  }
}

class FakeProcessTarget {
  readonly stdin = new FakeInputStream() as unknown as Pick<NodeJS.ReadStream, 'on' | 'off'>;
  readonly stdout = new FakeOutputStream() as unknown as Pick<NodeJS.WriteStream, 'on' | 'off'>;

  private sigintListener: (() => void) | null = null;
  private sigtermListener: (() => void) | null = null;
  private uncaughtListener: ((error: Error) => void) | null = null;
  private unhandledListener: ((reason: unknown) => void) | null = null;

  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): FakeProcessTarget {
    if (event === 'SIGINT') {
      this.sigintListener = listener;
    } else {
      this.sigtermListener = listener;
    }
    return this;
  }

  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): FakeProcessTarget;
  once(event: 'uncaughtException', listener: (error: Error) => void): FakeProcessTarget;
  once(event: 'unhandledRejection', listener: (reason: unknown) => void): FakeProcessTarget;
  once(
    event: 'SIGINT' | 'SIGTERM' | 'uncaughtException' | 'unhandledRejection',
    listener: (() => void) | ((error: Error) => void) | ((reason: unknown) => void),
  ): FakeProcessTarget {
    if (event === 'uncaughtException') {
      this.uncaughtListener = listener as (error: Error) => void;
    } else if (event === 'unhandledRejection') {
      this.unhandledListener = listener as (reason: unknown) => void;
    } else if (event === 'SIGINT') {
      const onceListener = listener as () => void;
      this.sigintListener = () => {
        this.sigintListener = null;
        onceListener();
      };
    } else {
      const onceListener = listener as () => void;
      this.sigtermListener = () => {
        this.sigtermListener = null;
        onceListener();
      };
    }
    return this;
  }

  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): FakeProcessTarget;
  off(event: 'uncaughtException', listener: (error: Error) => void): FakeProcessTarget;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): FakeProcessTarget;
  off(
    event: 'SIGINT' | 'SIGTERM' | 'uncaughtException' | 'unhandledRejection',
    listener: (() => void) | ((error: Error) => void) | ((reason: unknown) => void),
  ): FakeProcessTarget {
    if (event === 'SIGINT' && this.sigintListener === listener) {
      this.sigintListener = null;
    } else if (event === 'SIGTERM' && this.sigtermListener === listener) {
      this.sigtermListener = null;
    } else if (event === 'uncaughtException' && this.uncaughtListener === listener) {
      this.uncaughtListener = null;
    } else if (event === 'unhandledRejection' && this.unhandledListener === listener) {
      this.unhandledListener = null;
    }
    return this;
  }

  emitSigint(): void {
    this.sigintListener?.();
  }

  emitSigterm(): void {
    this.sigtermListener?.();
  }

  emitUncaught(error: Error): void {
    const listener = this.uncaughtListener;
    this.uncaughtListener = null;
    listener?.(error);
  }

  emitUnhandled(reason: unknown): void {
    const listener = this.unhandledListener;
    this.unhandledListener = null;
    listener?.(reason);
  }
}

void test('runtime process wiring attaches and detaches listeners', () => {
  const target = new FakeProcessTarget();
  const inputStream = target.stdin as unknown as FakeInputStream;
  const outputStream = target.stdout as unknown as FakeOutputStream;
  let inputCalls = 0;
  let resizeCalls = 0;
  let stopCalls = 0;
  const fatalCalls: string[] = [];
  const wiring = new RuntimeProcessWiring({
    target,
    onInput: () => {
      inputCalls += 1;
    },
    onResize: () => {
      resizeCalls += 1;
    },
    requestStop: () => {
      stopCalls += 1;
    },
    handleRuntimeFatal: (origin) => {
      fatalCalls.push(origin);
    },
  });

  wiring.attach();

  inputStream.emitData(Buffer.from('x'));
  outputStream.emitResize();
  target.emitSigint();
  target.emitSigint();
  target.emitSigterm();

  assert.equal(inputCalls, 1);
  assert.equal(resizeCalls, 1);
  assert.equal(stopCalls, 3);
  assert.deepEqual(fatalCalls, []);

  wiring.detach();
  inputStream.emitData(Buffer.from('y'));
  outputStream.emitResize();
  target.emitSigint();
  target.emitSigterm();

  assert.equal(inputCalls, 1);
  assert.equal(resizeCalls, 1);
  assert.equal(stopCalls, 3);
});

void test('runtime process wiring reports runtime-fatal origins for protected handlers', () => {
  const target = new FakeProcessTarget();
  const inputStream = target.stdin as unknown as FakeInputStream;
  const outputStream = target.stdout as unknown as FakeOutputStream;
  const fatalOrigins: string[] = [];
  const fatalPayloads: unknown[] = [];
  const inputError = new Error('input failed');
  const resizeError = new Error('resize failed');
  const uncaughtError = new Error('uncaught failed');
  const unhandledReason = { reason: 'rejection' };

  const wiring = new RuntimeProcessWiring({
    target,
    onInput: () => {
      throw inputError;
    },
    onResize: () => {
      throw resizeError;
    },
    requestStop: () => {},
    handleRuntimeFatal: (origin, error) => {
      fatalOrigins.push(origin);
      fatalPayloads.push(error);
    },
  });

  wiring.attach();
  inputStream.emitData(Buffer.from('z'));
  outputStream.emitResize();
  target.emitUncaught(uncaughtError);
  target.emitUnhandled(unhandledReason);

  assert.deepEqual(fatalOrigins, [
    'stdin-data',
    'stdout-resize',
    'uncaught-exception',
    'unhandled-rejection',
  ]);
  assert.deepEqual(fatalPayloads, [inputError, resizeError, uncaughtError, unhandledReason]);
});

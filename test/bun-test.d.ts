declare module 'bun:test' {
  type DoneCallback = (err?: unknown) => void;
  type TestCallback = (() => void | Promise<unknown>) | ((done: DoneCallback) => void);

  interface TestOptions {
    timeout?: number;
    retry?: number;
    repeats?: number;
  }

  interface Test {
    (name: string, fn: TestCallback, options?: number | TestOptions): void;
    (name: string, options: TestOptions, fn: TestCallback): void;
    only: Test;
    skip: Test;
    todo: Test;
    failing: Test;
    concurrent: Test;
    if(condition: boolean): Test;
  }

  export const test: Test;
  export const it: Test;

  export function beforeAll(fn: TestCallback): void;
  export function afterAll(fn: TestCallback): void;
  export function beforeEach(fn: TestCallback): void;
  export function afterEach(fn: TestCallback): void;
}

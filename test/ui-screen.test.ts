import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  Screen,
  type ScreenFlushInput,
  type ScreenWriter,
} from '../packages/harness-ui/src/screen.ts';

function createInput(overrides?: Partial<ScreenFlushInput>): ScreenFlushInput {
  return {
    layout: {
      paneRows: 2,
      rightCols: 8,
      rightStartCol: 5,
    },
    rows: ['left|abcd', 'left|efgh', 'status'],
    rightFrame: null,
    selectionRows: [],
    selectionOverlay: '',
    validateAnsi: false,
    ...overrides,
  };
}

void test('screen tracks dirty state and clears it after flush', () => {
  const outputs: string[] = [];
  const writer: ScreenWriter = {
    writeOutput(value: string): void {
      outputs.push(value);
    },
    writeError(): void {},
  };
  const screen = new Screen(writer);

  assert.equal(screen.isDirty(), true);
  const first = screen.flush(createInput());
  assert.equal(first.wroteOutput, true);
  assert.equal(screen.isDirty(), false);

  const second = screen.flush(createInput());
  assert.equal(second.wroteOutput, false);
  assert.equal(second.changedRowCount, 0);

  screen.markDirty();
  assert.equal(screen.isDirty(), true);
  screen.clearDirty();
  assert.equal(screen.isDirty(), false);
  screen.resetFrameCache();
  assert.equal(outputs.length > 0, true);
});

void test('screen flushes frame diff, selection overlay cleanup, and cursor visibility', () => {
  const outputs: string[] = [];
  const screen = new Screen({
    writeOutput(value: string): void {
      outputs.push(value);
    },
    writeError(): void {},
  });

  const first = screen.flush(
    createInput({
      rightFrame: {
        modes: {
          bracketedPaste: true,
        },
        cursor: {
          style: {
            shape: 'underline',
            blinking: true,
          },
          visible: true,
          row: 0,
          col: 1,
        },
        viewport: {
          followOutput: true,
        },
      },
      selectionRows: [0],
      selectionOverlay: 'SEL',
    }),
  );
  assert.equal(first.wroteOutput, true);
  assert.equal(first.shouldShowCursor, true);
  assert.equal(first.changedRowCount > 0, true);

  screen.markDirty();
  const second = screen.flush(
    createInput({
      rightFrame: {
        modes: {
          bracketedPaste: false,
        },
        cursor: {
          style: {
            shape: 'bar',
            blinking: false,
          },
          visible: false,
          row: 20,
          col: 20,
        },
        viewport: {
          followOutput: false,
        },
      },
      selectionRows: [],
      selectionOverlay: '',
    }),
  );
  assert.equal(second.wroteOutput, true);
  assert.equal(second.shouldShowCursor, false);

  const combined = outputs.join('');
  assert.equal(combined.includes('\u001b[?2004h'), true);
  assert.equal(combined.includes('\u001b[?2004l'), true);
  assert.equal(combined.includes('\u001b[?25h'), true);
  assert.equal(combined.includes('\u001b[1;1H\u001b[2K'), true);
});

void test('screen ansi validation reports at most once', () => {
  const errors: string[] = [];
  const screen = new Screen(
    {
      writeOutput(): void {},
      writeError(value: string): void {
        errors.push(value);
      },
    },
    {
      findIssues: () => ['bad ansi'],
    },
  );

  screen.flush(createInput({ validateAnsi: true }));
  screen.markDirty();
  screen.flush(createInput({ validateAnsi: true }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.includes('ansi-integrity-failed'), true);
});

void test('screen merges previous and current selection row sets when both are non-empty', () => {
  const screen = new Screen({
    writeOutput(): void {},
    writeError(): void {},
  });

  screen.flush(
    createInput({
      selectionRows: [1],
    }),
  );

  screen.markDirty();
  screen.flush(
    createInput({
      selectionRows: [0],
    }),
  );
});

void test('screen default io dependency fallbacks are exercised', () => {
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  (process.stdout.write as unknown as (value: string) => boolean) = ((value: string) => {
    stdoutWrites.push(value);
    return true;
  }) as unknown as typeof process.stdout.write;
  (process.stderr.write as unknown as (value: string) => boolean) = ((value: string) => {
    stderrWrites.push(value);
    return true;
  }) as unknown as typeof process.stderr.write;

  try {
    const screenWithAllDefaults = new Screen();
    screenWithAllDefaults.flush(createInput());

    const screenWithDefaultWriters = new Screen(undefined, {
      findIssues: () => ['bad ansi'],
    });
    screenWithDefaultWriters.flush(createInput({ validateAnsi: true }));
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  assert.equal(stdoutWrites.length > 0, true);
  assert.equal(stderrWrites.length > 0, true);
});

void test('screen wraps frame writes in synchronized terminal update mode', () => {
  const outputs: string[] = [];
  const screen = new Screen({
    writeOutput(value: string): void {
      outputs.push(value);
    },
    writeError(): void {},
  });

  screen.flush(createInput());
  const first = outputs[0] ?? '';
  assert.equal(first.startsWith('\u001b[?2026h'), true);
  assert.equal(first.endsWith('\u001b[?2026l'), true);
});

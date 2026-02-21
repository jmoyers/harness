import type { Screen, ScreenWriter } from '../../packages/harness-ui/src/screen.ts';
import { renderDiffUiViewport, resolveDiffUiTheme } from './render.ts';
import { reduceDiffUiState } from './state.ts';
import type {
  DiffUiCliOptions,
  DiffUiCommand,
  DiffUiEvent,
  DiffUiModel,
  DiffUiState,
} from './types.ts';
import { diffUiCommandToStateAction } from './commands.ts';

const TOP_BOTTOM_SCROLL_DELTA = 1_000_000;

type DiffUiPagerEvent =
  | {
      readonly type: 'input';
      readonly input: Buffer;
    }
  | {
      readonly type: 'resize';
      readonly width: number;
      readonly height: number;
    };

interface DiffUiPagerEventSource {
  readEvent: () => Promise<DiffUiPagerEvent | null>;
  close: () => void;
}

export interface DiffUiPagerInputStream {
  readonly isTTY: boolean | undefined;
  setRawMode?: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
  on: (event: 'data' | 'end', listener: (chunk?: unknown) => void) => void;
  off: (event: 'data' | 'end', listener: (chunk?: unknown) => void) => void;
}

export interface DiffUiPagerOutputStream {
  readonly isTTY: boolean | undefined;
  readonly columns: number | undefined;
  readonly rows: number | undefined;
  on: (event: 'resize', listener: () => void) => void;
  off: (event: 'resize', listener: () => void) => void;
}

interface RunDiffUiPagerSessionInput {
  readonly model: DiffUiModel;
  readonly options: DiffUiCliOptions;
  readonly initialState: DiffUiState;
  readonly initialWidth: number;
  readonly initialHeight: number;
  readonly eventSource: DiffUiPagerEventSource;
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
  readonly createScreen: (writer: ScreenWriter) => Pick<Screen, 'markDirty' | 'flush'>;
}

interface DiffUiPagerSessionResult {
  readonly events: readonly DiffUiEvent[];
  readonly renderedLines: readonly string[];
  readonly state: DiffUiState;
}

function clampWidth(value: number): number {
  return Math.max(40, Math.floor(value));
}

function clampHeight(value: number): number {
  return Math.max(6, Math.floor(value));
}

function pushEvent(events: DiffUiEvent[], event: DiffUiEvent): void {
  events.push(event);
}

function pushRenderEvents(input: {
  readonly events: DiffUiEvent[];
  readonly state: DiffUiState;
  readonly renderedLines: readonly string[];
  readonly width: number;
  readonly height: number;
}): void {
  pushEvent(input.events, {
    type: 'state.changed',
    state: input.state,
  });
  pushEvent(input.events, {
    type: 'render.completed',
    rows: input.renderedLines.length,
    width: input.width,
    height: input.height,
    view: input.state.effectiveViewMode,
  });
}

function normalizeInputBuffer(input: Buffer): string {
  return input.toString('utf8');
}

export function decodeDiffUiPagerInput(input: Buffer): readonly DiffUiCommand[] {
  const text = normalizeInputBuffer(input);
  if (text === '\u0003' || text === 'q' || text === 'Q') {
    return [{ type: 'session.quit' }];
  }
  if (text === '\u001b') {
    return [{ type: 'finder.close' }];
  }
  if (text === '\u001b[A' || text === 'k') {
    return [{ type: 'nav.scroll', delta: -1 }];
  }
  if (text === '\u001b[B' || text === 'j') {
    return [{ type: 'nav.scroll', delta: 1 }];
  }
  if (text === '\u001b[5~' || text === 'b') {
    return [{ type: 'nav.page', delta: -1 }];
  }
  if (text === '\u001b[6~' || text === ' ') {
    return [{ type: 'nav.page', delta: 1 }];
  }
  if (text === '\u001b[H' || text === '\u001b[1~' || text === 'g') {
    return [{ type: 'nav.scroll', delta: -TOP_BOTTOM_SCROLL_DELTA }];
  }
  if (text === '\u001b[F' || text === '\u001b[4~' || text === 'G') {
    return [{ type: 'nav.scroll', delta: TOP_BOTTOM_SCROLL_DELTA }];
  }
  if (text === 'u') {
    return [{ type: 'view.setMode', mode: 'unified' }];
  }
  if (text === 's') {
    return [{ type: 'view.setMode', mode: 'split' }];
  }
  if (text === 'a') {
    return [{ type: 'view.setMode', mode: 'auto' }];
  }
  if (text === '/') {
    return [{ type: 'finder.open' }];
  }
  if (text === '\r' || text === '\n') {
    return [{ type: 'finder.accept' }];
  }
  return [];
}

export async function runDiffUiPagerSession(
  input: RunDiffUiPagerSessionInput,
): Promise<DiffUiPagerSessionResult> {
  const theme = resolveDiffUiTheme(input.options.theme);
  const screen = input.createScreen({
    writeOutput(output: string): void {
      input.writeStdout(output);
    },
    writeError(output: string): void {
      input.writeStderr(output);
    },
  });
  const events: DiffUiEvent[] = [];
  let width = clampWidth(input.initialWidth);
  let height = clampHeight(input.initialHeight);
  let state = input.initialState;
  let renderedLines = renderDiffUiViewport({
    model: input.model,
    state,
    width,
    height,
    viewMode: input.options.viewMode,
    syntaxMode: input.options.syntaxMode,
    wordDiffMode: input.options.wordDiffMode,
    color: input.options.color,
    theme,
  }).lines;

  screen.markDirty();
  screen.flush({
    layout: {
      paneRows: renderedLines.length,
      rightCols: width,
      rightStartCol: 1,
    },
    rows: renderedLines,
    rightFrame: null,
    selectionRows: [],
    selectionOverlay: '',
    validateAnsi: false,
  });
  pushRenderEvents({
    events,
    state,
    renderedLines,
    width,
    height,
  });

  while (true) {
    const pagerEvent = await input.eventSource.readEvent();
    if (pagerEvent === null) {
      pushEvent(events, { type: 'session.quit' });
      break;
    }
    if (pagerEvent.type === 'resize') {
      width = clampWidth(pagerEvent.width);
      height = clampHeight(pagerEvent.height);
      state = reduceDiffUiState({
        model: input.model,
        state,
        action: {
          type: 'viewport.changed',
          width,
        },
        viewportWidth: width,
        viewportHeight: height,
      });
    } else {
      const commands = decodeDiffUiPagerInput(pagerEvent.input);
      let shouldQuit = false;
      for (const command of commands) {
        if (command.type === 'session.quit') {
          shouldQuit = true;
          break;
        }
        state = reduceDiffUiState({
          model: input.model,
          state,
          action: diffUiCommandToStateAction(command, Math.max(1, height - 2)),
          viewportWidth: width,
          viewportHeight: height,
        });
      }
      if (shouldQuit) {
        pushEvent(events, { type: 'session.quit' });
        break;
      }
      if (commands.length === 0) {
        continue;
      }
    }

    renderedLines = renderDiffUiViewport({
      model: input.model,
      state,
      width,
      height,
      viewMode: input.options.viewMode,
      syntaxMode: input.options.syntaxMode,
      wordDiffMode: input.options.wordDiffMode,
      color: input.options.color,
      theme,
    }).lines;
    screen.markDirty();
    screen.flush({
      layout: {
        paneRows: renderedLines.length,
        rightCols: width,
        rightStartCol: 1,
      },
      rows: renderedLines,
      rightFrame: null,
      selectionRows: [],
      selectionOverlay: '',
      validateAnsi: false,
    });
    pushRenderEvents({
      events,
      state,
      renderedLines,
      width,
      height,
    });
  }

  return {
    events,
    renderedLines,
    state,
  };
}

function pushQueuedEvent(
  queue: (DiffUiPagerEvent | null)[],
  waiter: { current: ((event: DiffUiPagerEvent | null) => void) | null },
  event: DiffUiPagerEvent | null,
): void {
  if (waiter.current !== null) {
    const resolve = waiter.current;
    waiter.current = null;
    resolve(event);
    return;
  }
  queue.push(event);
}

export function createDiffUiPagerEventSource(input: {
  readonly stdin: DiffUiPagerInputStream;
  readonly stdout: DiffUiPagerOutputStream;
}): DiffUiPagerEventSource {
  const queue: (DiffUiPagerEvent | null)[] = [];
  let closed = false;
  const waiter: { current: ((event: DiffUiPagerEvent | null) => void) | null } = {
    current: null,
  };

  const onData = (chunk?: unknown): void => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
    if (next.length === 0) {
      return;
    }
    pushQueuedEvent(queue, waiter, {
      type: 'input',
      input: next,
    });
  };
  const onEnd = (): void => {
    pushQueuedEvent(queue, waiter, null);
  };
  const onResize = (): void => {
    pushQueuedEvent(queue, waiter, {
      type: 'resize',
      width: input.stdout.columns ?? 120,
      height: input.stdout.rows ?? 40,
    });
  };

  input.stdin.on('data', onData);
  input.stdin.on('end', onEnd);
  input.stdout.on('resize', onResize);

  return {
    readEvent: async () => {
      if (closed) {
        return null;
      }
      if (queue.length > 0) {
        return queue.shift() ?? null;
      }
      return await new Promise<DiffUiPagerEvent | null>((resolve) => {
        waiter.current = resolve;
      });
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      input.stdin.off('data', onData);
      input.stdin.off('end', onEnd);
      input.stdout.off('resize', onResize);
      if (waiter.current !== null) {
        const resolve = waiter.current;
        waiter.current = null;
        resolve(null);
      }
    },
  };
}

export function enterDiffUiPagerTerminal(input: {
  readonly stdin: DiffUiPagerInputStream;
  readonly stdout: DiffUiPagerOutputStream;
  readonly writeStdout: (text: string) => void;
}): () => void {
  if (input.stdin.isTTY !== true || input.stdout.isTTY !== true) {
    throw new Error('--pager requires interactive TTY stdin/stdout');
  }

  input.stdin.setRawMode?.(true);
  input.stdin.resume();
  input.writeStdout('\u001b[?1049h');

  return () => {
    input.writeStdout('\u001b[?1049l\u001b[?25h\u001b[?2004l');
    input.stdin.pause();
    input.stdin.setRawMode?.(false);
  };
}

export async function runDiffUiPagerProcess(input: {
  readonly model: DiffUiModel;
  readonly options: DiffUiCliOptions;
  readonly initialState: DiffUiState;
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
  readonly stdin: DiffUiPagerInputStream;
  readonly stdout: DiffUiPagerOutputStream;
  readonly createScreen: RunDiffUiPagerSessionInput['createScreen'];
}): Promise<DiffUiPagerSessionResult> {
  const cleanupTerminal = enterDiffUiPagerTerminal({
    stdin: input.stdin,
    stdout: input.stdout,
    writeStdout: input.writeStdout,
  });
  const eventSource = createDiffUiPagerEventSource({
    stdin: input.stdin,
    stdout: input.stdout,
  });
  try {
    return await runDiffUiPagerSession({
      model: input.model,
      options: input.options,
      initialState: input.initialState,
      initialWidth: input.stdout.columns ?? 120,
      initialHeight: input.stdout.rows ?? 40,
      eventSource,
      writeStdout: input.writeStdout,
      writeStderr: input.writeStderr,
      createScreen: input.createScreen,
    });
  } finally {
    eventSource.close();
    cleanupTerminal();
  }
}

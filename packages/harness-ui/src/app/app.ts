import { Widget } from '../widget/widget.ts';
import { renderWidgetTreeIncremental } from '../widget/renderer.ts';
import { FrameBuffer } from '../core/frame-buffer.ts';
import { FocusManager } from '../widget/focus.ts';
import { parseInput } from '../widget/input.ts';
import { dispatchKeyToBindings } from '../widget/keybinding.ts';
import { DEFAULT_CELL_STYLE, type CellStyle } from '../core/color.ts';
import { setupTerminal, restoreTerminal, type TerminalState } from './lifecycle.ts';
import type { KeyEvent } from '../widget/input.ts';

const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

class RootWidget extends Widget {
  render(): void {}
}

export interface AppOptions {
  readonly title?: string;
  readonly alternateScreen?: boolean;
  readonly mouse?: boolean;
  readonly exitOnCtrlC?: boolean;
  readonly baseStyle?: CellStyle;
}

export class App {
  readonly root: RootWidget;
  readonly focusManager: FocusManager;
  private _cols: number;
  private _rows: number;
  private _baseStyle: CellStyle;
  private _destroyed = false;
  private _exitOnCtrlC: boolean;
  private _frameBuffer: FrameBuffer;
  private _prevRows: readonly string[] = [];
  private _terminalState: TerminalState | null = null;
  private _stdinDataHandler: ((data: Buffer) => void) | null = null;
  private _sigwinchHandler: (() => void) | null = null;
  private _onDestroy: (() => void) | null = null;
  private _firstRender = true;

  constructor(options: AppOptions = {}) {
    this._cols = process.stdout.columns ?? 80;
    this._rows = process.stdout.rows ?? 24;
    this._baseStyle = options.baseStyle ?? DEFAULT_CELL_STYLE;
    this._exitOnCtrlC = options.exitOnCtrlC ?? true;
    this._frameBuffer = new FrameBuffer(this._cols, this._rows, this._baseStyle);
    this.root = new RootWidget('app-root');
    this.focusManager = new FocusManager();
    this.focusManager.setRoot(this.root);
    this.root._mountRecursive();
    this._installDirtyScheduler();
  }

  get cols(): number {
    return this._cols;
  }
  get rows(): number {
    return this._rows;
  }
  get destroyed(): boolean {
    return this._destroyed;
  }
  get frameBuffer(): FrameBuffer {
    return this._frameBuffer;
  }

  start(): void {
    if (this._destroyed) return;

    this._terminalState = setupTerminal((data) => this.writeStdout(data), process.stdin, {
      alternateScreen: true,
      mouse: true,
    });

    this._stdinDataHandler = (data: Buffer) => this._handleInput(data);
    process.stdin.on('data', this._stdinDataHandler);
    if (typeof process.stdin.ref === 'function') process.stdin.ref();
    if (typeof process.stdin.resume === 'function') process.stdin.resume();

    this._sigwinchHandler = () => {
      this._cols = process.stdout.columns ?? 80;
      this._rows = process.stdout.rows ?? 24;
      this._frameBuffer.resize(this._cols, this._rows, this._baseStyle);
      this._firstRender = true;
      this._prevRows = [];
      this.render();
    };
    process.on('SIGWINCH', this._sigwinchHandler);

    this.writeStdout('\x1b[2J\x1b[H');
    this.render();
  }

  render(): void {
    if (this._destroyed) return;

    const result = renderWidgetTreeIncremental(
      this.root,
      this._frameBuffer,
      this._cols,
      this._rows,
      this._baseStyle,
    );

    const rows = result.rows;

    if (this._firstRender || result.diff.fullRedraw) {
      this._firstRender = false;
      let output = SYNC_BEGIN;
      output += '\x1b[H';
      for (let i = 0; i < rows.length; i += 1) {
        output += rows[i]!;
        if (i < rows.length - 1) output += '\r\n';
      }
      output += '\x1b[?25l';
      output += SYNC_END;
      this.writeStdout(output);
      this._prevRows = rows;
      return;
    }

    if (result.diff.changedCount === 0) return;

    let output = SYNC_BEGIN;
    for (const changed of result.changedRows) {
      output += `\x1b[${changed.row + 1};1H`;
      output += `\x1b[2K`;
      output += changed.ansi;
    }
    output += '\x1b[?25l';
    output += SYNC_END;
    this.writeStdout(output);
    this._prevRows = rows;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._stdinDataHandler !== null) {
      process.stdin.removeListener('data', this._stdinDataHandler);
      this._stdinDataHandler = null;
    }
    if (this._sigwinchHandler !== null) {
      process.removeListener('SIGWINCH', this._sigwinchHandler);
      this._sigwinchHandler = null;
    }

    if (this._terminalState !== null) {
      restoreTerminal((data) => this.writeStdout(data), process.stdin, this._terminalState);
      this._terminalState = null;
    }

    this.root._unmountRecursive();
    this._onDestroy?.();
  }

  onDestroy(callback: () => void): void {
    this._onDestroy = callback;
  }

  private _renderScheduled = false;

  private _installDirtyScheduler(): void {
    this.root.setOnDirty(() => {
      if (this._destroyed || this._renderScheduled) return;
      this._renderScheduled = true;
      queueMicrotask(() => {
        this._renderScheduled = false;
        if (!this._destroyed) this.render();
      });
    });
  }

  private writeStdout(data: string): void {
    process.stdout.write(data);
  }

  private _handleInput(data: Buffer): void {
    if (this._exitOnCtrlC && data.length === 1 && data[0] === 0x03) {
      this.destroy();
      return;
    }

    const event = parseInput(data);
    if (event === null) {
      if (data.length === 1) {
        const byte = data[0]!;
        if (byte >= 0x20 && byte < 0x7f) {
          const char = String.fromCharCode(byte);
          const synth: KeyEvent = {
            key: char,
            raw: data,
            ctrl: false,
            alt: false,
            shift: char >= 'A' && char <= 'Z',
          };
          this._dispatchKey(synth);
          return;
        }
      }
      return;
    }

    if (event.type === 'key') {
      this._dispatchKey(event.event);
    }
  }

  private _dispatchKey(event: KeyEvent): void {
    const handled = dispatchKeyToBindings(this.focusManager.focused, event);
    if (!handled) {
      const focused = this.focusManager.focused;
      if (focused !== null) {
        const handler = (focused as unknown as Record<string, unknown>)['handleKeypress'];
        if (typeof handler === 'function') {
          (handler as (e: KeyEvent) => boolean).call(focused, event);
        }
      }
    }
    this.render();
  }
}

export function createApp(options: AppOptions = {}): App {
  return new App(options);
}

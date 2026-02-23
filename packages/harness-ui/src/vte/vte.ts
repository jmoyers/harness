import { StringDecoder } from 'node:string_decoder';
import { measureDisplayWidth } from '../text-layout.ts';
import {
  defaultCellStyle,
  cloneCursorStyle,
  DEFAULT_CURSOR_STYLE,
  type ParserMode,
  type ActiveScreen,
  type TerminalCursorStyle,
  type TerminalCellStyle,
  type TerminalModeState,
  type TerminalQueryState,
  type TerminalQueryHooks,
  type ScreenCursor,
  type TerminalSnapshotFrame,
  type TerminalSnapshotFrameCore,
  type TerminalBufferTail,
  type TerminalSelectionPoint,
} from './types.ts';
import { ScreenBuffer } from './screen-buffer.ts';
import { applySgrParams, parseOscRgbColor } from './sgr.ts';

export class Vte {
  private readonly decoder = new StringDecoder('utf8');
  private readonly primary: ScreenBuffer;
  private readonly alternate: ScreenBuffer;
  private queryHooks: TerminalQueryHooks | null;
  private activeScreen: ActiveScreen = 'primary';
  private cursor: ScreenCursor = { row: 0, col: 0 };
  private savedCursor: ScreenCursor | null = null;
  private mode: ParserMode = 'normal';
  private csiBuffer = '';
  private oscBuffer = '';
  private dcsBuffer = '';
  private cursorVisible = true;
  private cursorStyle: TerminalCursorStyle = cloneCursorStyle(DEFAULT_CURSOR_STYLE);
  private bracketedPasteMode = false;
  private decMouseX10Mode = false;
  private decMouseButtonEventMode = false;
  private decMouseAnyEventMode = false;
  private decFocusTrackingMode = false;
  private decMouseSgrEncodingMode = false;
  private readonly indexedPaletteOverrides = new Map<number, { r: number; g: number; b: number }>();
  private style: TerminalCellStyle = defaultCellStyle();
  private originMode = false;
  private pendingWrap = false;
  private tabStops = new Set<number>();

  constructor(
    cols: number,
    rows: number,
    scrollbackLimit = 5000,
    queryHooks: TerminalQueryHooks | null = null,
  ) {
    this.primary = new ScreenBuffer(cols, rows, true, scrollbackLimit);
    this.alternate = new ScreenBuffer(cols, rows, false, 0);
    this.queryHooks = queryHooks;
    this.resetTabStops(cols);
  }

  ingest(chunk: string | Uint8Array): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(Buffer.from(chunk));
    const len = text.length;
    let i = 0;
    while (i < len) {
      const code = text.charCodeAt(i);
      if (code < 0xd800 || code > 0xdfff) {
        this.processChar(text[i]!);
        i += 1;
      } else if (code <= 0xdbff && i + 1 < len) {
        this.processChar(text[i]! + text[i + 1]!);
        i += 2;
      } else {
        i += 1;
      }
    }
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    this.primary.resize(cols, rows, this.style);
    this.alternate.resize(cols, rows, this.style);
    this.cursor.row = Math.max(0, Math.min(rows - 1, this.cursor.row));
    this.cursor.col = Math.max(0, Math.min(cols - 1, this.cursor.col));
    this.resetTabStops(cols);
    if (this.pendingWrap && this.cursor.col !== cols - 1) this.pendingWrap = false;
  }

  setFollowOutput(follow: boolean): void {
    this.screen().setFollowOutput(follow);
  }
  scrollViewport(delta: number): void {
    this.screen().scrollViewport(delta);
  }
  setQueryHooks(hooks: TerminalQueryHooks | null): void {
    this.queryHooks = hooks;
  }

  queryState(): TerminalQueryState {
    const s = this.screen();
    return { rows: s.rows, cols: s.cols, cursor: { row: this.cursor.row, col: this.cursor.col } };
  }

  snapshot(): TerminalSnapshotFrame {
    return this.screen().snapshot(
      this.cursor,
      this.cursorVisible,
      this.cursorStyle,
      this.activeScreen,
      this.modes(),
      true,
    );
  }

  snapshotWithoutHash(): TerminalSnapshotFrameCore {
    return this.screen().snapshot(
      this.cursor,
      this.cursorVisible,
      this.cursorStyle,
      this.activeScreen,
      this.modes(),
      false,
    );
  }

  isMouseTrackingEnabled(): boolean {
    return this.decMouseX10Mode || this.decMouseButtonEventMode || this.decMouseAnyEventMode;
  }

  isFocusTrackingEnabled(): boolean {
    return this.decFocusTrackingMode;
  }
  isSgrMouseEncodingEnabled(): boolean {
    return this.decMouseSgrEncodingMode;
  }

  bufferTail(tailLines?: number): TerminalBufferTail {
    const n =
      typeof tailLines === 'number' && Number.isFinite(tailLines)
        ? Math.max(1, Math.floor(tailLines))
        : null;
    return this.screen().bufferTail(n);
  }

  selectionText(start: TerminalSelectionPoint, end: TerminalSelectionPoint): string {
    return this.screen().selectionText(start, end);
  }

  private screen(): ScreenBuffer {
    return this.activeScreen === 'primary' ? this.primary : this.alternate;
  }

  private modes(): TerminalModeState {
    return {
      bracketedPaste: this.bracketedPasteMode,
      decMouseX10: this.decMouseX10Mode,
      decMouseButtonEvent: this.decMouseButtonEventMode,
      decMouseAnyEvent: this.decMouseAnyEventMode,
      decFocusTracking: this.decFocusTrackingMode,
      decMouseSgrEncoding: this.decMouseSgrEncodingMode,
    };
  }

  private processChar(ch: string): void {
    if (this.mode === 'normal') {
      this.processNormal(ch);
      return;
    }
    if (this.mode === 'esc') {
      this.processEsc(ch);
      return;
    }
    if (this.mode === 'esc-intermediate') {
      this.processEscIntermediate(ch);
      return;
    }
    if (this.mode === 'csi') {
      this.processCsi(ch);
      return;
    }
    if (this.mode === 'osc') {
      this.processOsc(ch);
      return;
    }
    if (this.mode === 'osc-esc') {
      this.processOscEsc(ch);
      return;
    }
    if (this.mode === 'dcs') {
      this.processDcs(ch);
      return;
    }
    this.processDcsEsc(ch);
  }

  private processNormal(ch: string): void {
    const cp = ch.codePointAt(0)!;
    if (ch === '\u001b') {
      this.mode = 'esc';
      return;
    }
    if (ch === '\r') {
      this.cursor.col = 0;
      this.pendingWrap = false;
      return;
    }
    if (ch === '\n') {
      this.screen().lineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      return;
    }
    if (ch === '\t') {
      if (this.pendingWrap) {
        this.screen().lineFeed(this.cursor, this.style);
        this.cursor.col = 0;
        this.pendingWrap = false;
      }
      this.cursor.col = this.nextTabStop(this.cursor.col, this.screen().cols);
      return;
    }
    if (ch === '\b') {
      this.cursor.col = Math.max(0, this.cursor.col - 1);
      this.pendingWrap = false;
      return;
    }
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return;
    if (cp >= 0x20 && cp < 0x7f) {
      if (this.pendingWrap) {
        this.screen().lineFeed(this.cursor, this.style);
        this.cursor.col = 0;
        this.pendingWrap = false;
      }
      this.pendingWrap = this.screen().putGlyph(this.cursor, ch, 1, this.style);
      return;
    }
    if (this.pendingWrap) {
      this.screen().lineFeed(this.cursor, this.style);
      this.cursor.col = 0;
      this.pendingWrap = false;
    }
    const width = measureDisplayWidth(ch);
    if (width === 0) {
      this.screen().appendCombining(this.cursor, ch);
      return;
    }
    this.pendingWrap = this.screen().putGlyph(this.cursor, ch, width, this.style);
  }

  private processEsc(ch: string): void {
    const code = ch.charCodeAt(0);
    if (ch === '[') {
      this.mode = 'csi';
      this.csiBuffer = '';
      return;
    }
    if (ch === ']') {
      this.mode = 'osc';
      this.oscBuffer = '';
      return;
    }
    if (ch === 'P') {
      this.mode = 'dcs';
      this.dcsBuffer = '';
      return;
    }
    if (ch === '7') {
      this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
      this.mode = 'normal';
      return;
    }
    if (ch === '8') {
      if (this.savedCursor !== null) this.cursor = { ...this.savedCursor };
      this.mode = 'normal';
      return;
    }
    if (ch === 'D') {
      this.screen().lineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      this.mode = 'normal';
      return;
    }
    if (ch === 'E') {
      this.cursor.col = 0;
      this.screen().lineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      this.mode = 'normal';
      return;
    }
    if (ch === 'M') {
      this.screen().reverseLineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      this.mode = 'normal';
      return;
    }
    if (ch === 'H') {
      this.tabStops.add(this.cursor.col);
      this.mode = 'normal';
      return;
    }
    if (ch === 'c') {
      this.hardReset();
      this.mode = 'normal';
      return;
    }
    if (code >= 0x20 && code <= 0x2f) {
      this.mode = 'esc-intermediate';
      return;
    }
    this.mode = 'normal';
  }

  private processEscIntermediate(ch: string): void {
    if (ch === '\u001b') {
      this.mode = 'esc';
      return;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code <= 0x2f) return;
    this.mode = 'normal';
  }

  private processCsi(ch: string): void {
    const code = ch.charCodeAt(0);
    if (code >= 0x40 && code <= 0x7e) {
      const raw = this.csiBuffer;
      this.mode = 'normal';
      this.csiBuffer = '';
      this.queryHooks?.onCsiQuery?.(`${raw}${ch}`, () => this.queryState());
      this.applyCsi(raw, ch);
      return;
    }
    if (ch === '\u001b') {
      this.mode = 'esc';
      this.csiBuffer = '';
      return;
    }
    this.csiBuffer += ch;
  }

  private processOsc(ch: string): void {
    if (ch === '\u0007') {
      this.emitOsc(true);
      this.mode = 'normal';
      return;
    }
    if (ch === '\u001b') {
      this.mode = 'osc-esc';
      return;
    }
    this.oscBuffer += ch;
  }

  private processOscEsc(ch: string): void {
    if (ch === '\\') {
      this.emitOsc(false);
      this.mode = 'normal';
      return;
    }
    this.oscBuffer += '\u001b' + ch;
    this.mode = 'osc';
  }

  private processDcs(ch: string): void {
    if (ch === '\u001b') {
      this.mode = 'dcs-esc';
      return;
    }
    this.dcsBuffer += ch;
  }

  private processDcsEsc(ch: string): void {
    if (ch === '\\') {
      this.queryHooks?.onDcsQuery?.(this.dcsBuffer);
      this.dcsBuffer = '';
      this.mode = 'normal';
      return;
    }
    this.dcsBuffer += '\u001b' + ch;
    this.mode = 'dcs';
  }

  private applyCsi(raw: string, final: string): void {
    const priv = raw.startsWith('?');
    const privKbd = raw.startsWith('>');
    const params = (priv ? raw.slice(1) : raw)
      .split(';')
      .map((p) => (p.length === 0 ? NaN : Number(p)));
    const first = Number.isFinite(params[0]) ? (params[0] as number) : 1;

    if (priv && final === 'h') {
      this.applyPrivateMode(params, true);
      return;
    }
    if (priv && final === 'l') {
      this.applyPrivateMode(params, false);
      return;
    }
    if (final === 'q' && raw.endsWith(' ')) {
      const v = raw.slice(0, -1).trim();
      const n = v.length === 0 ? 0 : Number(v);
      if (Number.isFinite(n)) this.applyCursorStyle(n);
      return;
    }
    if (privKbd && (final === 'm' || final === 'u')) return;
    if (final === 'm') {
      this.style = applySgrParams(
        this.style,
        params.filter(Number.isFinite),
        this.indexedPaletteOverrides,
      );
      return;
    }

    const s = this.screen();
    if (final === 'A') {
      const b = this.rowBounds();
      this.cursor.row = Math.max(b.top, this.cursor.row - first);
      this.pendingWrap = false;
      return;
    }
    if (final === 'B') {
      const b = this.rowBounds();
      this.cursor.row = Math.min(b.bottom, this.cursor.row + first);
      this.pendingWrap = false;
      return;
    }
    if (final === 'C') {
      this.cursor.col = Math.min(s.cols - 1, this.cursor.col + first);
      this.pendingWrap = false;
      return;
    }
    if (final === 'D') {
      this.cursor.col = Math.max(0, this.cursor.col - first);
      this.pendingWrap = false;
      return;
    }
    if (final === 'G') {
      this.cursor.col = Math.max(0, Math.min(s.cols - 1, first - 1));
      this.pendingWrap = false;
      return;
    }
    if (final === 'H' || final === 'f') {
      const r = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      const c = Number.isFinite(params[1]) ? (params[1] as number) : 1;
      const b = this.rowBounds();
      const tr = this.originMode ? b.top + r - 1 : r - 1;
      this.cursor.row = Math.max(b.top, Math.min(b.bottom, tr));
      this.cursor.col = Math.max(0, Math.min(s.cols - 1, c - 1));
      this.pendingWrap = false;
      return;
    }
    if (final === 'J') {
      s.clearScreen(
        this.cursor,
        Number.isFinite(params[0]) ? (params[0] as number) : 0,
        this.style,
      );
      return;
    }
    if (final === 'K') {
      s.clearLine(this.cursor, Number.isFinite(params[0]) ? (params[0] as number) : 0, this.style);
      return;
    }
    if (final === 'S') {
      const rg = s.scrollRegion();
      s.scrollUp(first, this.style, rg.top, rg.bottom);
      return;
    }
    if (final === 'T') {
      const rg = s.scrollRegion();
      s.scrollDown(first, this.style, rg.top, rg.bottom);
      return;
    }
    if (final === 'L') {
      s.insertLines(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (final === 'M') {
      s.deleteLines(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (final === '@') {
      s.insertChars(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (final === 'P') {
      s.deleteChars(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (final === 'g') {
      const m = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      if (m === 0) this.tabStops.delete(this.cursor.col);
      else if (m === 3) this.tabStops.clear();
      return;
    }
    if (final === 'r') {
      const t = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      const b = Number.isFinite(params[1]) ? (params[1] as number) : s.rows;
      if (s.setScrollRegion(t, b)) this.homeCursor();
      this.pendingWrap = false;
      return;
    }
    if (final === 's') {
      this.savedCursor = { ...this.cursor };
      return;
    }
    if (final === 'u') {
      if (raw.length > 0 && raw !== '0') return;
      if (this.savedCursor !== null) {
        this.cursor = { ...this.savedCursor };
        this.pendingWrap = false;
      }
    }
  }

  private emitOsc(bell: boolean): void {
    const payload = this.oscBuffer;
    this.oscBuffer = '';
    this.applyOscEffects(payload);
    this.queryHooks?.onOscQuery?.(payload, bell);
  }

  private applyOscEffects(payload: string): void {
    const sep = payload.indexOf(';');
    const cmd = sep >= 0 ? payload.slice(0, sep).trim() : payload.trim();
    const val = sep >= 0 ? payload.slice(sep + 1) : '';
    if (cmd === '4') {
      const parts = val.split(';');
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const idx = Number.parseInt(parts[i]?.trim() ?? '', 10);
        if (!Number.isFinite(idx)) continue;
        const c = parseOscRgbColor(parts[i + 1] ?? '');
        if (c !== null) this.indexedPaletteOverrides.set(idx, c);
      }
      return;
    }
    if (cmd === '104') {
      const t = val.trim();
      if (t.length === 0) {
        this.indexedPaletteOverrides.clear();
        return;
      }
      for (const tok of t.split(';')) {
        const idx = Number.parseInt(tok.trim(), 10);
        if (Number.isFinite(idx)) this.indexedPaletteOverrides.delete(idx);
      }
    }
  }

  private applyPrivateMode(params: number[], enabled: boolean): void {
    for (const v of params) {
      if (!Number.isFinite(v)) continue;
      if (v === 25) {
        this.cursorVisible = enabled;
        continue;
      }
      if (v === 2004) {
        this.bracketedPasteMode = enabled;
        continue;
      }
      if (v === 1000) {
        this.decMouseX10Mode = enabled;
        continue;
      }
      if (v === 1002) {
        this.decMouseButtonEventMode = enabled;
        continue;
      }
      if (v === 1003) {
        this.decMouseAnyEventMode = enabled;
        continue;
      }
      if (v === 1004) {
        this.decFocusTrackingMode = enabled;
        continue;
      }
      if (v === 1006) {
        this.decMouseSgrEncodingMode = enabled;
        continue;
      }
      if (v === 1047) {
        this.activeScreen = enabled ? 'alternate' : 'primary';
        if (enabled) {
          this.originMode = false;
          this.alternate.clear(this.style);
          this.alternate.resetScrollRegion();
          this.cursor = { row: 0, col: 0 };
        }
        this.pendingWrap = false;
        continue;
      }
      if (v === 1048) {
        if (enabled) this.savedCursor = { ...this.cursor };
        else if (this.savedCursor !== null) this.cursor = { ...this.savedCursor };
        this.pendingWrap = false;
        continue;
      }
      if (v === 1049) {
        if (enabled) {
          this.savedCursor = { ...this.cursor };
          this.originMode = false;
          this.activeScreen = 'alternate';
          this.alternate.clear(this.style);
          this.alternate.resetScrollRegion();
          this.cursor = { row: 0, col: 0 };
        } else {
          this.activeScreen = 'primary';
          if (this.savedCursor !== null) this.cursor = { ...this.savedCursor };
        }
        this.pendingWrap = false;
        continue;
      }
      if (v === 6) {
        this.originMode = enabled;
        this.homeCursor();
        this.pendingWrap = false;
      }
    }
  }

  private applyCursorStyle(v: number): void {
    const map: Record<number, TerminalCursorStyle> = {
      0: { shape: 'block', blinking: true },
      1: { shape: 'block', blinking: true },
      2: { shape: 'block', blinking: false },
      3: { shape: 'underline', blinking: true },
      4: { shape: 'underline', blinking: false },
      5: { shape: 'bar', blinking: true },
      6: { shape: 'bar', blinking: false },
    };
    const s = map[v];
    if (s !== undefined) this.cursorStyle = s;
  }

  private hardReset(): void {
    const s = defaultCellStyle();
    this.mode = 'normal';
    this.csiBuffer = '';
    this.oscBuffer = '';
    this.dcsBuffer = '';
    this.activeScreen = 'primary';
    this.cursor = { row: 0, col: 0 };
    this.savedCursor = null;
    this.cursorVisible = true;
    this.cursorStyle = cloneCursorStyle(DEFAULT_CURSOR_STYLE);
    this.bracketedPasteMode = false;
    this.decMouseX10Mode = false;
    this.decMouseButtonEventMode = false;
    this.decMouseAnyEventMode = false;
    this.decFocusTrackingMode = false;
    this.decMouseSgrEncodingMode = false;
    this.indexedPaletteOverrides.clear();
    this.style = s;
    this.originMode = false;
    this.pendingWrap = false;
    this.primary.clear(s);
    this.primary.resetScrollRegion();
    this.primary.setFollowOutput(true);
    this.alternate.clear(s);
    this.alternate.resetScrollRegion();
    this.alternate.setFollowOutput(true);
    this.resetTabStops(this.primary.cols);
  }

  private rowBounds(): { top: number; bottom: number } {
    if (!this.originMode) return { top: 0, bottom: this.screen().rows - 1 };
    return this.screen().scrollRegion();
  }

  private homeCursor(): void {
    const b = this.rowBounds();
    this.cursor.row = b.top;
    this.cursor.col = 0;
    this.pendingWrap = false;
  }

  private resetTabStops(cols: number): void {
    this.tabStops.clear();
    for (let c = 8; c < cols; c += 8) this.tabStops.add(c);
  }

  private nextTabStop(col: number, cols: number): number {
    for (const s of [...this.tabStops].sort((a, b) => a - b)) {
      if (s > col) return Math.min(cols - 1, s);
    }
    return cols - 1;
  }
}

export function replayTerminalSteps(
  steps: readonly { kind: 'output' | 'resize'; chunk?: string; cols?: number; rows?: number }[],
  initialCols: number,
  initialRows: number,
): TerminalSnapshotFrame[] {
  const vte = new Vte(initialCols, initialRows);
  const snaps: TerminalSnapshotFrame[] = [];
  for (const step of steps) {
    if (step.kind === 'output') {
      vte.ingest(step.chunk ?? '');
      snaps.push(vte.snapshot());
    } else {
      vte.resize(step.cols ?? initialCols, step.rows ?? initialRows);
      snaps.push(vte.snapshot());
    }
  }
  return snaps;
}

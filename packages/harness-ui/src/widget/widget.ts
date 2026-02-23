import type { CellBuffer, ClippedCellBuffer } from '../core/cell-buffer.ts';
import { createReactiveProxy } from './reactive.ts';
import {
  emitWithListeners,
  addMessageListener,
  type Message,
  type MessageType,
} from './message.ts';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const ZERO_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export type LayoutValue = number | `${number}%` | 'auto';
export type FlexDirection = 'row' | 'column';
export type AlignItems = 'start' | 'center' | 'end' | 'stretch';
export type JustifyContent = 'start' | 'center' | 'end' | 'space-between';
export type Overflow = 'hidden' | 'visible' | 'scroll';

export interface EdgeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function edgeInsets(
  top: number,
  right: number = top,
  bottom: number = top,
  left: number = right,
): EdgeInsets {
  return {
    top: Math.max(0, Math.floor(top)),
    right: Math.max(0, Math.floor(right)),
    bottom: Math.max(0, Math.floor(bottom)),
    left: Math.max(0, Math.floor(left)),
  };
}

let nextAutoId = 1;

function generateId(prefix: string): string {
  const id = `${prefix}-${String(nextAutoId)}`;
  nextAutoId += 1;
  return id;
}

export function resetAutoIdCounter(): void {
  nextAutoId = 1;
}

export abstract class Widget {
  readonly id: string;
  private _parent: Widget | null = null;
  private _children: Widget[] = [];
  private _mounted = false;
  private _dirty = true;

  width: LayoutValue = 'auto';
  height: LayoutValue = 'auto';
  flexDirection: FlexDirection = 'column';
  flexGrow: number = 0;
  flexShrink: number = 1;
  gap: number = 0;
  padding: EdgeInsets = ZERO_INSETS;
  margin: EdgeInsets = ZERO_INSETS;
  alignItems: AlignItems = 'stretch';
  justifyContent: JustifyContent = 'start';
  position: 'relative' | 'absolute' = 'relative';
  left: number | undefined = undefined;
  top: number | undefined = undefined;
  zIndex: number = 0;
  private _visible: boolean = true;
  overflow: Overflow = 'hidden';
  focusable: boolean = false;
  manualChildRendering: boolean = false;

  private _focused = false;
  private _onDirty: (() => void) | null = null;

  computedRect: Rect = ZERO_RECT;
  absoluteRect: Rect = ZERO_RECT;

  constructor(id?: string) {
    this.id = id ?? generateId('widget');
    return createReactiveProxy(this);
  }

  get parent(): Widget | null {
    return this._parent;
  }

  get children(): readonly Widget[] {
    return this._children;
  }

  get mounted(): boolean {
    return this._mounted;
  }

  get dirty(): boolean {
    return this._dirty;
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(value: boolean) {
    if (this._visible === value) return;
    this._visible = value;
    if (!value) {
      this._blurDescendants();
    }
    this.markDirty();
  }

  get focused(): boolean {
    return this._focused;
  }

  isEffectivelyVisible(): boolean {
    let current: Widget | null = this as Widget;
    while (current !== null) {
      if (!current._visible) return false;
      current = current._parent;
    }
    return true;
  }

  focus(): void {
    if (!this.focusable) return;
    this._focused = true;
    this.markDirty();
  }

  blur(): void {
    this._focused = false;
    this.markDirty();
  }

  setOnDirty(callback: (() => void) | null): void {
    this._onDirty = callback;
  }

  markDirty(): void {
    if (this._dirty) return;
    this._dirty = true;
    if (this._parent !== null) {
      this._parent.markDirty();
    }
    this._onDirty?.();
  }

  private _blurDescendants(): void {
    if (this._focused) {
      this._focused = false;
    }
    for (const child of this._children) {
      child._blurDescendants();
    }
  }

  clearDirty(): void {
    this._dirty = false;
  }

  emit(message: Message): void {
    emitWithListeners(this, message);
  }

  on<T extends Message>(type: MessageType<T>, handler: (msg: T) => void): void {
    addMessageListener(this, type, handler);
  }

  add(...children: Widget[]): void {
    for (const child of children) {
      if (child._parent !== null) {
        child._parent.remove(child);
      }
      child._parent = this;
      this._children.push(child);
      if (this._mounted) {
        child._mountRecursive();
      }
      this.markDirty();
    }
  }

  remove(child: Widget | string): void {
    const target = typeof child === 'string' ? child : child.id;
    const index = this._children.findIndex((c) => c.id === target);
    if (index === -1) return;
    const removed = this._children.splice(index, 1)[0]!;
    if (removed._mounted) {
      removed._unmountRecursive();
    }
    removed._parent = null;
    this.markDirty();
  }

  removeAll(): void {
    for (const child of this._children) {
      if (child._mounted) {
        child._unmountRecursive();
      }
      child._parent = null;
    }
    this._children = [];
    this.markDirty();
  }

  queryOne<T extends Widget>(selector: string): T | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this._findById<T>(id);
    }
    return null;
  }

  queryAll<T extends Widget>(selector: string): T[] {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      const result = this._findById<T>(id);
      return result !== null ? [result] : [];
    }
    return [];
  }

  ancestors(): Widget[] {
    const result: Widget[] = [];
    let current = this._parent;
    while (current !== null) {
      result.push(current);
      current = current._parent;
    }
    return result;
  }

  root(): Widget {
    return this._parent === null ? this : this._parent.root();
  }

  abstract render(buffer: CellBuffer | ClippedCellBuffer): void;

  onMount(): void {}
  onUnmount(): void {}

  _mountRecursive(): void {
    if (this._mounted) return;
    this._mounted = true;
    this._dirty = true;
    this.onMount();
    for (const child of this._children) {
      child._mountRecursive();
    }
  }

  _unmountRecursive(): void {
    if (!this._mounted) return;
    for (const child of this._children) {
      child._unmountRecursive();
    }
    this._mounted = false;
    this._focused = false;
    this.onUnmount();
  }

  private _findById<T extends Widget>(id: string): T | null {
    if (this.id === id) return this as unknown as T;
    for (const child of this._children) {
      const found = child._findById<T>(id);
      if (found !== null) return found;
    }
    return null;
  }
}

import type { Widget } from './widget.ts';

function collectFocusable(widget: Widget, out: Widget[]): void {
  if (!widget.visible) return;
  if (widget.focusable) out.push(widget);
  for (const child of widget.children) {
    collectFocusable(child, out);
  }
}

export class FocusManager {
  private _focused: Widget | null = null;
  private _root: Widget | null = null;

  get focused(): Widget | null {
    if (this._focused !== null && !this._focused.isEffectivelyVisible()) {
      this._focused.blur();
      this._focused = null;
    }
    return this._focused;
  }

  setRoot(root: Widget): void {
    this._root = root;
  }

  focus(widget: Widget): void {
    if (!widget.focusable || !widget.isEffectivelyVisible()) return;
    if (this._focused === widget) return;
    if (this._focused !== null) {
      this._focused.blur();
    }
    this._focused = widget;
    widget.focus();
  }

  blur(): void {
    if (this._focused !== null) {
      this._focused.blur();
      this._focused = null;
    }
  }

  focusNext(): Widget | null {
    if (this._root === null) return null;
    const order = this.focusOrder();
    if (order.length === 0) return null;
    const currentIndex = this._focused !== null ? order.indexOf(this._focused) : -1;
    const nextIndex = (currentIndex + 1) % order.length;
    this.focus(order[nextIndex]!);
    return order[nextIndex]!;
  }

  focusPrevious(): Widget | null {
    if (this._root === null) return null;
    const order = this.focusOrder();
    if (order.length === 0) return null;
    const currentIndex = this._focused !== null ? order.indexOf(this._focused) : 0;
    const prevIndex = (currentIndex - 1 + order.length) % order.length;
    this.focus(order[prevIndex]!);
    return order[prevIndex]!;
  }

  focusOrder(): Widget[] {
    if (this._root === null) return [];
    const order: Widget[] = [];
    collectFocusable(this._root, order);
    return order;
  }

  handleRemovedWidget(widget: Widget): void {
    if (this._focused === widget) {
      this._focused = null;
    }
  }
}

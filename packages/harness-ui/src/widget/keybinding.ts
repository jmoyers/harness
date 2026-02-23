import type { Widget } from './widget.ts';
import type { KeyEvent } from './input.ts';

export interface Binding {
  readonly key: string;
  readonly action: string;
  readonly description?: string;
}

const BINDINGS_KEY = 'BINDINGS';

function getBindings(widget: Widget): readonly Binding[] {
  const ctor = widget.constructor as unknown as Record<string, unknown>;
  const bindings = ctor[BINDINGS_KEY];
  if (!Array.isArray(bindings)) return [];
  return bindings as Binding[];
}

function normalizeKeyString(key: string): string {
  const parts = key
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const modifiers: string[] = [];
  let base = '';
  for (const part of parts) {
    if (part === 'ctrl' || part === 'alt' || part === 'shift') {
      modifiers.push(part);
    } else {
      base = part;
    }
  }
  modifiers.sort();
  return [...modifiers, base].join('+');
}

function keyEventToString(event: KeyEvent): string {
  const parts: string[] = [];
  if (event.ctrl) parts.push('ctrl');
  if (event.alt) parts.push('alt');
  if (event.shift && event.key.length > 1) parts.push('shift');
  parts.push(event.key.toLowerCase());
  parts.sort((a, b) => {
    const order = ['alt', 'ctrl', 'shift'];
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return 0;
  });
  return parts.join('+');
}

function actionMethodName(action: string): string {
  const parts = action.split(/[-_.]/);
  const camel = parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p[0]!.toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
  return `action${camel[0]!.toUpperCase()}${camel.slice(1)}`;
}

export interface ResolvedBinding {
  readonly widget: Widget;
  readonly binding: Binding;
  readonly actionMethod: string;
}

export function resolveKeybinding(focused: Widget | null, event: KeyEvent): ResolvedBinding | null {
  if (focused === null) return null;

  const eventKey = keyEventToString(event);
  let current: Widget | null = focused;

  while (current !== null) {
    const bindings = getBindings(current);
    for (const binding of bindings) {
      const normalizedBindingKey = normalizeKeyString(binding.key);
      if (normalizedBindingKey === eventKey) {
        return {
          widget: current,
          binding,
          actionMethod: actionMethodName(binding.action),
        };
      }
    }
    current = current.parent;
  }

  return null;
}

export function executeBinding(resolved: ResolvedBinding): boolean {
  const method = (resolved.widget as unknown as Record<string, unknown>)[resolved.actionMethod];
  if (typeof method === 'function') {
    (method as () => void).call(resolved.widget);
    return true;
  }
  return false;
}

export function dispatchKeyToBindings(focused: Widget | null, event: KeyEvent): boolean {
  const resolved = resolveKeybinding(focused, event);
  if (resolved === null) return false;
  return executeBinding(resolved);
}

export function collectAllBindings(
  root: Widget,
): ReadonlyArray<{ widget: Widget; binding: Binding }> {
  const result: Array<{ widget: Widget; binding: Binding }> = [];
  function walk(w: Widget): void {
    for (const b of getBindings(w)) {
      result.push({ widget: w, binding: b });
    }
    for (const child of w.children) {
      walk(child);
    }
  }
  walk(root);
  return result;
}

const LEADER_PLACEHOLDER = '<leader>';

function expandLeader(key: string, leader: string): string {
  const lower = key.toLowerCase();
  if (!lower.includes(LEADER_PLACEHOLDER)) return key;
  return lower.replace(LEADER_PLACEHOLDER, leader);
}

function splitLeaderBinding(
  key: string,
  leader: string,
): { leaderKey: string; actionKey: string } | null {
  const expanded = expandLeader(key, leader);
  const leaderNorm = normalizeKeyString(leader);
  if (!expanded.startsWith(leaderNorm + ' ') && !expanded.startsWith(leader + ' ')) return null;
  const spaceIdx = expanded.indexOf(' ');
  if (spaceIdx === -1) return null;
  return {
    leaderKey: normalizeKeyString(expanded.slice(0, spaceIdx)),
    actionKey: normalizeKeyString(expanded.slice(spaceIdx + 1).trim()),
  };
}

export class LeaderKeyState {
  private _leader: string;
  private _pending = false;
  private _timeoutMs: number;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(leader = 'ctrl+x', timeoutMs = 1500) {
    this._leader = normalizeKeyString(leader);
    this._timeoutMs = timeoutMs;
  }

  get leader(): string {
    return this._leader;
  }
  get pending(): boolean {
    return this._pending;
  }

  setLeader(leader: string): void {
    this._leader = normalizeKeyString(leader);
  }

  dispatch(focused: Widget | null, event: KeyEvent): boolean {
    const eventKey = keyEventToString(event);

    if (this._pending) {
      this.cancelTimeout();
      this._pending = false;
      return this.resolveLeaderAction(focused, eventKey);
    }

    if (eventKey === this._leader) {
      this._pending = true;
      this.startTimeout();
      return true;
    }

    return dispatchKeyToBindings(focused, event);
  }

  cancel(): void {
    this._pending = false;
    this.cancelTimeout();
  }

  private resolveLeaderAction(focused: Widget | null, actionKey: string): boolean {
    if (focused === null) return false;
    let current: Widget | null = focused;
    while (current !== null) {
      const bindings = getBindings(current);
      for (const binding of bindings) {
        const split = splitLeaderBinding(binding.key, this._leader);
        if (split !== null && split.actionKey === actionKey) {
          const method = actionMethodName(binding.action);
          const fn = (current as unknown as Record<string, unknown>)[method];
          if (typeof fn === 'function') {
            (fn as () => void).call(current);
            return true;
          }
        }
      }
      current = current.parent;
    }
    return false;
  }

  private startTimeout(): void {
    this.cancelTimeout();
    this._timer = setTimeout(() => {
      this._pending = false;
      this._timer = null;
    }, this._timeoutMs);
  }

  private cancelTimeout(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

export { normalizeKeyString, keyEventToString, actionMethodName };

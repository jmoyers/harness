import type { Widget } from './widget.ts';

export class Message {
  private _stopped = false;
  private _sender: Widget | null = null;

  get stopped(): boolean {
    return this._stopped;
  }

  get sender(): Widget | null {
    return this._sender;
  }

  stop(): void {
    this._stopped = true;
  }

  _setSender(sender: Widget): void {
    this._sender = sender;
  }
}

export interface MessageType<T extends Message> {
  new (...args: never[]): T;
}

function handlerName(messageClass: Function): string {
  return `on${messageClass.name}`;
}

export function emitMessage(source: Widget, message: Message): void {
  message._setSender(source);
  const name = handlerName(message.constructor);

  let current: Widget | null = source;
  while (current !== null && !message.stopped) {
    const handler = (current as unknown as Record<string, unknown>)[name];
    if (typeof handler === 'function') {
      (handler as (msg: Message) => void).call(current, message);
    }
    current = current.parent;
  }
}

type MessageCallback<T extends Message> = (msg: T) => void;

interface ListenerEntry {
  readonly name: string;
  readonly callback: MessageCallback<Message>;
}

const LISTENER_STORAGE = Symbol('message_listeners');

interface ListenerHost {
  [LISTENER_STORAGE]?: ListenerEntry[];
}

export function addMessageListener<T extends Message>(
  widget: Widget,
  type: MessageType<T>,
  callback: MessageCallback<T>,
): void {
  const host = widget as unknown as ListenerHost;
  if (host[LISTENER_STORAGE] === undefined) {
    host[LISTENER_STORAGE] = [];
  }
  host[LISTENER_STORAGE]!.push({
    name: handlerName(type),
    callback: callback as MessageCallback<Message>,
  });
}

export function dispatchToListeners(widget: Widget, message: Message): boolean {
  const host = widget as unknown as ListenerHost;
  const listeners = host[LISTENER_STORAGE];
  if (listeners === undefined) return false;
  const name = handlerName(message.constructor);
  let handled = false;
  for (const entry of listeners) {
    if (entry.name === name) {
      entry.callback(message);
      handled = true;
    }
  }
  return handled;
}

export function emitWithListeners(source: Widget, message: Message): void {
  message._setSender(source);
  const name = handlerName(message.constructor);

  let current: Widget | null = source;
  while (current !== null && !message.stopped) {
    const handler = (current as unknown as Record<string, unknown>)[name];
    if (typeof handler === 'function') {
      (handler as (msg: Message) => void).call(current, message);
    }
    dispatchToListeners(current, message);
    current = current.parent;
  }
}

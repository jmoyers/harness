const REACTIVE_MARKER = Symbol('reactive_marker');
const REACTIVE_STORAGE = Symbol('reactive_storage');

interface ReactiveMarker<T> {
  readonly [REACTIVE_MARKER]: true;
  readonly defaultValue: T;
}

interface ReactiveHost {
  markDirty(): void;
  [REACTIVE_STORAGE]?: Map<string, unknown>;
}

function isReactiveMarker(value: unknown): value is ReactiveMarker<unknown> {
  return value !== null && typeof value === 'object' && REACTIVE_MARKER in value;
}

function getStorage(host: ReactiveHost): Map<string, unknown> {
  if (host[REACTIVE_STORAGE] === undefined) {
    host[REACTIVE_STORAGE] = new Map();
  }
  return host[REACTIVE_STORAGE]!;
}

function watchMethodName(key: string): string {
  return `watch${key[0]!.toUpperCase()}${key.slice(1)}`;
}

function validateMethodName(key: string): string {
  return `validate${key[0]!.toUpperCase()}${key.slice(1)}`;
}

function installReactiveProperty(host: ReactiveHost, key: string, defaultValue: unknown): void {
  const storage = getStorage(host);
  storage.set(key, defaultValue);

  const watchName = watchMethodName(key);
  const validateName = validateMethodName(key);

  Object.defineProperty(host, key, {
    get(): unknown {
      return getStorage(this as ReactiveHost).get(key);
    },
    set(newValue: unknown): void {
      const self = this as ReactiveHost;
      const store = getStorage(self);
      const oldValue = store.get(key);

      const validator = (self as unknown as Record<string, unknown>)[validateName];
      if (typeof validator === 'function') {
        newValue = (validator as (v: unknown) => unknown).call(self, newValue);
      }

      if (Object.is(oldValue, newValue)) return;

      store.set(key, newValue);

      const watcher = (self as unknown as Record<string, unknown>)[watchName];
      if (typeof watcher === 'function') {
        (watcher as (o: unknown, n: unknown) => void).call(self, oldValue, newValue);
      }

      self.markDirty();
    },
    enumerable: true,
    configurable: true,
  });
}

export function reactive<T>(defaultValue: T): T {
  return { [REACTIVE_MARKER]: true, defaultValue } as unknown as T;
}

export function createReactiveProxy<T extends ReactiveHost>(target: T): T {
  return new Proxy(target, {
    get(obj: T, prop: string | symbol, receiver: unknown): unknown {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof prop === 'string' && isReactiveMarker(value)) {
        installReactiveProperty(obj, prop, value.defaultValue);
        return Reflect.get(obj, prop, receiver);
      }
      return value;
    },
    set(obj: T, prop: string | symbol, value: unknown, receiver: unknown): boolean {
      if (typeof prop === 'string' && isReactiveMarker(value)) {
        installReactiveProperty(obj, prop, value.defaultValue);
        return true;
      }
      if (typeof prop === 'string') {
        const desc = Object.getOwnPropertyDescriptor(obj, prop);
        if (desc !== undefined && !('get' in desc) && isReactiveMarker(desc.value)) {
          installReactiveProperty(obj, prop, (desc.value as ReactiveMarker<unknown>).defaultValue);
        }
      }
      return Reflect.set(obj, prop, value, receiver);
    },
  });
}

export { REACTIVE_MARKER, REACTIVE_STORAGE };

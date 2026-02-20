import type { NimProviderRouter } from './provider-router.ts';
import { InMemoryNimRuntime } from './runtime.ts';
import { NimSqliteEventStore } from './event-store.ts';
import { NimSqliteSessionStore } from './session-store.ts';
import { NimJsonlTelemetrySink, type NimJsonlTelemetrySinkInput } from './telemetry.ts';

export type CreateSqliteBackedNimRuntimeInput = {
  readonly eventStorePath: string;
  readonly sessionStorePath: string;
  readonly telemetry?: Omit<NimJsonlTelemetrySinkInput, 'filePath'> & {
    readonly filePath: string;
  };
  readonly providerRouter?: NimProviderRouter;
};

export type SqliteBackedNimRuntimeHandle = {
  readonly runtime: InMemoryNimRuntime;
  close(): void;
};

export function createSqliteBackedNimRuntime(
  input: CreateSqliteBackedNimRuntimeInput,
): SqliteBackedNimRuntimeHandle {
  const eventStore = new NimSqliteEventStore(input.eventStorePath);
  const sessionStore = new NimSqliteSessionStore(input.sessionStorePath);
  const telemetrySinks =
    input.telemetry !== undefined
      ? [
          new NimJsonlTelemetrySink({
            filePath: input.telemetry.filePath,
            ...(input.telemetry.mode !== undefined ? { mode: input.telemetry.mode } : {}),
          }),
        ]
      : [];
  const runtime = new InMemoryNimRuntime({
    ...(input.providerRouter !== undefined ? { providerRouter: input.providerRouter } : {}),
    eventStore,
    sessionStore,
    telemetrySinks,
  });

  return {
    runtime,
    close() {
      eventStore.close();
      sessionStore.close();
    },
  };
}

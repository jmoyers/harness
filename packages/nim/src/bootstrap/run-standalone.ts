import { createApp } from '../../../harness-ui/src/app/app.ts';
import { loadHarnessSecrets, upsertHarnessSecret } from '../../../../src/config/secrets-core.ts';
import { NimApp } from '../app/nim-app.ts';
import {
  createRuntimeFromEnv,
  type CreateRuntimeFromEnvInput,
  type NimRuntimeHandle,
} from '../runtime/runtime-factory.ts';

export interface RunNimStandaloneOptions {
  readonly runtimeInput?: CreateRuntimeFromEnvInput;
  readonly runtimeHandle?: NimRuntimeHandle;
  readonly secretsFile?: string;
}

export function runNimStandalone(options: RunNimStandaloneOptions = {}): number {
  let runtimeHandle: NimRuntimeHandle | null = null;
  try {
    loadHarnessSecrets({
      ...(options.runtimeInput?.cwd === undefined
        ? {}
        : {
            cwd: options.runtimeInput.cwd,
          }),
      ...(options.runtimeInput?.env === undefined
        ? {}
        : {
            env: options.runtimeInput.env,
          }),
      ...(options.secretsFile === undefined
        ? {}
        : {
            filePath: options.secretsFile,
          }),
    });
    runtimeHandle = options.runtimeHandle ?? createRuntimeFromEnv(options.runtimeInput);

    const app = createApp({ title: 'nim', exitOnCtrlC: true });
    app.onDestroy(() => {
      try {
        runtimeHandle?.close();
      } finally {
        process.exit(0);
      }
    });

    const nim = new NimApp({
      runtime: runtimeHandle.runtime,
      model: runtimeHandle.model,
      tenantId: runtimeHandle.tenantId,
      userId: runtimeHandle.userId,
      requiredApiKey: runtimeHandle.requiredApiKey,
      hasRequiredApiKey: () => runtimeHandle?.hasRequiredApiKey() ?? true,
      configureRequiredApiKey: (apiKey) => {
        runtimeHandle?.configureRequiredApiKey(apiKey);
      },
      saveRequiredApiKey: (input) => {
        upsertHarnessSecret({
          cwd: options.runtimeInput?.cwd ?? process.cwd(),
          key: input.envVar,
          value: input.value,
        });
        process.env[input.envVar] = input.value;
      },
    });
    nim.setFocusManager(app.focusManager);
    nim.setRequestRender(() => app.render());

    app.root.add(nim);
    const composer = nim.queryOne('#composer');
    if (composer !== null) {
      app.focusManager.focus(composer);
    }
    app.start();
    return 0;
  } catch (error: unknown) {
    runtimeHandle?.close();
    process.stderr.write(
      `nim startup error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

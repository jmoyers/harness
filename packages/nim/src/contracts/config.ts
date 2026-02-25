export const nimVersion = '0.1.0';

export const CONTEXT_WINDOW_TOKENS = 200_000;

export const LANDING_TIPS: readonly string[] = [
  'Use @path to include files directly in your prompt.',
  'Press tab to switch between Build and Plan modes.',
  'Press ctrl+p to run commands from the palette.',
  'Shift+enter inserts new lines without sending.',
];

export interface NimRuntimeDefaults {
  readonly tenantId: string;
  readonly userId: string;
}

export const DEFAULT_RUNTIME_IDS: NimRuntimeDefaults = {
  tenantId: 'nim-standalone',
  userId: 'user',
};

import { renderTerminalRecordingToGif } from '../src/recording/terminal-recording-gif-lib.ts';

interface CliOptions {
  inputPath: string;
  outputPath: string;
  cellWidthPx: number;
  cellHeightPx: number;
  fontSizePx: number;
  fontFamily: string | null;
  frameMs: number;
  maxColors: number;
  includeCursor: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath = '';
  let outputPath = '';
  let cellWidthPx = 9;
  let cellHeightPx = 18;
  let fontSizePx = 14;
  let fontFamily: string | null = null;
  let frameMs = 66;
  let maxColors = 256;
  let includeCursor = true;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--input') {
      inputPath = argv[idx + 1] ?? inputPath;
      idx += 1;
      continue;
    }
    if (arg === '--output') {
      outputPath = argv[idx + 1] ?? outputPath;
      idx += 1;
      continue;
    }
    if (arg === '--cell-width') {
      cellWidthPx = parsePositiveInt(argv[idx + 1], cellWidthPx);
      idx += 1;
      continue;
    }
    if (arg === '--cell-height') {
      cellHeightPx = parsePositiveInt(argv[idx + 1], cellHeightPx);
      idx += 1;
      continue;
    }
    if (arg === '--font-size') {
      fontSizePx = parsePositiveInt(argv[idx + 1], fontSizePx);
      idx += 1;
      continue;
    }
    if (arg === '--font-family') {
      fontFamily = argv[idx + 1] ?? fontFamily;
      idx += 1;
      continue;
    }
    if (arg === '--frame-ms') {
      frameMs = parsePositiveInt(argv[idx + 1], frameMs);
      idx += 1;
      continue;
    }
    if (arg === '--max-colors') {
      maxColors = parsePositiveInt(argv[idx + 1], maxColors);
      idx += 1;
      continue;
    }
    if (arg === '--no-cursor') {
      includeCursor = false;
    }
  }

  if (inputPath.length === 0 || outputPath.length === 0) {
    process.stderr.write(
      'usage: bun run terminal:recording:gif -- --input <recording.jsonl> --output <out.gif> [--cell-width 9 --cell-height 18 --font-size 14 --font-family "Menlo, monospace" --frame-ms 66 --max-colors 256 --no-cursor]\n',
    );
    process.exit(2);
  }

  return {
    inputPath,
    outputPath,
    cellWidthPx,
    cellHeightPx,
    fontSizePx,
    fontFamily,
    frameMs,
    maxColors,
    includeCursor,
  };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const renderOptions: Parameters<typeof renderTerminalRecordingToGif>[0] = {
    recordingPath: options.inputPath,
    outputPath: options.outputPath,
    cellWidthPx: options.cellWidthPx,
    cellHeightPx: options.cellHeightPx,
    fontSizePx: options.fontSizePx,
    defaultFrameDurationMs: options.frameMs,
    maxColors: options.maxColors,
    includeCursor: options.includeCursor,
  };
  if (options.fontFamily !== null) {
    renderOptions.fontFamily = options.fontFamily;
  }
  const result = await renderTerminalRecordingToGif(renderOptions);

  process.stdout.write(
    `[recording->gif] input=${result.recordingPath} output=${result.outputPath} frames=${String(result.frameCount)} size=${String(result.width)}x${String(result.height)} bytes=${String(result.bytes)}\n`,
  );
  return 0;
}

const code = await main();
process.exitCode = code;

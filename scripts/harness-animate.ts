import { setTimeout as delay } from 'node:timers/promises';

const TAU = Math.PI * 2;
const DEFAULT_FPS = 60;
const DEFAULT_SEED = 1337;
const MIN_WIDTH = 40;
const MIN_HEIGHT = 16;
const ANIMATE_COLOR_INDEX = 109;
const SHADING_CHARS = ' .,:;irsXA253hMHGS#9B&@';
const HARNESS_LOGO_LINES = [
  ' _   _    _    ____  _   _ _____ ____ ____ ',
  '| | | |  / \\  |  _ \\| \\ | | ____/ ___/ ___|',
  '| |_| | / _ \\ | |_) |  \\| |  _| \\___ \\___ \\',
  '|  _  |/ ___ \\|  _ <| |\\  | |___ ___) |__) |',
  '|_| |_/_/   \\_\\_| \\_\\_| \\_|_____|____/____/',
  '                 HARNESS'
];

interface AnimateOptions {
  fps: number;
  frames: number | null;
  durationMs: number | null;
  seed: number;
  color: boolean;
}

interface TunnelState {
  width: number;
  height: number;
  intensity: Float32Array;
  chars: string[];
  stars: StarField;
}

interface StarField {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  speed: Float32Array;
}

function readCliValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parsePositiveIntFlag(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function parseAnimateOptions(argv: readonly string[]): AnimateOptions {
  const options: AnimateOptions = {
    fps: DEFAULT_FPS,
    frames: null,
    durationMs: null,
    seed: DEFAULT_SEED,
    color: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--fps') {
      options.fps = parsePositiveIntFlag(readCliValue(argv, index, '--fps'), '--fps');
      index += 1;
      continue;
    }
    if (arg === '--frames') {
      options.frames = parsePositiveIntFlag(readCliValue(argv, index, '--frames'), '--frames');
      index += 1;
      continue;
    }
    if (arg === '--duration-ms') {
      options.durationMs = parsePositiveIntFlag(readCliValue(argv, index, '--duration-ms'), '--duration-ms');
      index += 1;
      continue;
    }
    if (arg === '--seed') {
      options.seed = parsePositiveIntFlag(readCliValue(argv, index, '--seed'), '--seed');
      index += 1;
      continue;
    }
    if (arg === '--no-color') {
      options.color = false;
      continue;
    }
    throw new Error(`unknown animate option: ${arg}`);
  }
  return options;
}

function printUsage(): void {
  process.stdout.write(
    [
      'usage:',
      '  harness animate [--fps <fps>] [--frames <count>] [--duration-ms <ms>] [--seed <seed>] [--no-color]',
      '',
      'notes:',
      '  - `harness animate` runs forever until Ctrl+C in a TTY.',
      '  - In non-TTY mode, provide --frames or --duration-ms to avoid unbounded output.'
    ].join('\n') + '\n'
  );
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createStarField(count: number, random: () => number): StarField {
  const stars: StarField = {
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    speed: new Float32Array(count)
  };
  for (let index = 0; index < count; index += 1) {
    resetStar(stars, index, random);
  }
  return stars;
}

function resetStar(stars: StarField, index: number, random: () => number): void {
  const angle = random() * TAU;
  const radius = Math.pow(random(), 0.65);
  stars.x[index] = Math.cos(angle) * radius;
  stars.y[index] = Math.sin(angle) * radius * 0.6;
  stars.z[index] = 0.2 + random() * 0.8;
  stars.speed[index] = 0.24 + random() * 0.8;
}

function buildState(width: number, height: number, random: () => number): TunnelState {
  const starCount = Math.max(120, Math.floor((width * height) / 18));
  return {
    width,
    height,
    intensity: new Float32Array(width * height),
    chars: new Array<string>(width * height).fill(' '),
    stars: createStarField(starCount, random)
  };
}

function writePixel(
  intensity: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const index = y * width + x;
  if (value > intensity[index]!) {
    intensity[index] = value;
  }
}

function drawTunnelLayer(state: TunnelState, elapsedSeconds: number): void {
  const { width, height, intensity } = state;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxRadius = Math.min(width * 0.46, height * 0.95);
  const layers = Math.max(34, Math.floor(Math.min(width, height) * 1.4));
  const verticalScale = 0.62 + Math.sin(elapsedSeconds * 0.7) * 0.11;

  for (let layer = 0; layer < layers; layer += 1) {
    const depth = (elapsedSeconds * 0.48 + layer / layers) % 1;
    const radius = Math.pow(depth, 1.45) * maxRadius;
    const twist = elapsedSeconds * 1.1 + layer * 0.27 + Math.sin(elapsedSeconds + layer * 0.08) * 0.33;
    const samples = Math.max(22, Math.floor(radius * 5.3));
    const brightness = 0.2 + (1 - depth) * 0.85;

    for (let sample = 0; sample < samples; sample += 1) {
      const angle = (sample / samples) * TAU + twist;
      const x = Math.round(centerX + Math.cos(angle) * radius * 1.36);
      const y = Math.round(centerY + Math.sin(angle) * radius * verticalScale);
      writePixel(intensity, width, height, x, y, brightness);
      if ((sample & 7) === 0) {
        writePixel(intensity, width, height, x + 1, y, brightness * 0.72);
      }
    }
  }

  const spokes = 14;
  for (let spoke = 0; spoke < spokes; spoke += 1) {
    const baseAngle = (spoke / spokes) * TAU + elapsedSeconds * 0.94;
    for (let depth = 0.18; depth < 1; depth += 0.14) {
      const radius = Math.pow(depth, 1.3) * maxRadius;
      const x = Math.round(centerX + Math.cos(baseAngle) * radius * 1.3);
      const y = Math.round(centerY + Math.sin(baseAngle) * radius * verticalScale);
      writePixel(intensity, width, height, x, y, 0.12 + (1 - depth) * 0.25);
    }
  }
}

function drawStars(state: TunnelState, elapsedSeconds: number, random: () => number): void {
  const { width, height, intensity, stars } = state;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const depthScaleX = width * 0.62;
  const depthScaleY = height * 0.58;
  const pulse = 0.8 + Math.sin(elapsedSeconds * 3.1) * 0.2;
  const count = stars.x.length;

  for (let index = 0; index < count; index += 1) {
    const depth = (stars.z[index] ?? 1) - (stars.speed[index] ?? 0.24) * 0.011;
    stars.z[index] = depth;
    if (depth <= 0.015) {
      resetStar(stars, index, random);
      continue;
    }
    const inverse = 1 / depth;
    const x = Math.round(centerX + (stars.x[index] ?? 0) * inverse * depthScaleX);
    const y = Math.round(centerY + (stars.y[index] ?? 0) * inverse * depthScaleY);
    const value = (1 - depth) * 0.95 * pulse;
    writePixel(intensity, width, height, x, y, value);
    if (value > 0.6) {
      writePixel(intensity, width, height, x + 1, y, value * 0.65);
    }
  }
}

function writeCenteredText(chars: string[], width: number, height: number, row: number, text: string): void {
  if (row < 0 || row >= height || text.length === 0) {
    return;
  }
  const startX = Math.floor((width - text.length) / 2);
  for (let index = 0; index < text.length; index += 1) {
    const x = startX + index;
    if (x < 0 || x >= width) {
      continue;
    }
    chars[row * width + x] = text[index]!;
  }
}

function drawHarnessLogo(
  chars: string[],
  width: number,
  height: number,
  elapsedSeconds: number
): { top: number; bottom: number } {
  const logoWidth = HARNESS_LOGO_LINES.reduce((max, line) => Math.max(max, line.length), 0);
  const panelPaddingX = 2;
  const panelPaddingY = 1;
  const panelWidth = logoWidth + panelPaddingX * 2;
  const panelHeight = HARNESS_LOGO_LINES.length + panelPaddingY * 2;
  const wobble = Math.round(Math.sin(elapsedSeconds * 1.15) * 1);
  const panelTop = Math.max(1, Math.floor(height * 0.56) - Math.floor(panelHeight / 2) + wobble);
  const panelLeft = Math.floor((width - panelWidth) / 2);
  const panelBottom = panelTop + panelHeight - 1;
  const panelRight = panelLeft + panelWidth - 1;
  const sweepCenter = Math.floor(((elapsedSeconds * 20) % (panelWidth + 20)) + panelLeft - 10);

  for (let y = panelTop; y <= panelBottom; y += 1) {
    if (y < 0 || y >= height) {
      continue;
    }
    for (let x = panelLeft; x <= panelRight; x += 1) {
      if (x < 0 || x >= width) {
        continue;
      }
      chars[y * width + x] = ' ';
    }
  }

  for (let y = panelTop; y <= panelBottom; y += 1) {
    if (y < 0 || y >= height) {
      continue;
    }
    for (let x = panelLeft; x <= panelRight; x += 1) {
      if (x < 0 || x >= width) {
        continue;
      }
      const isTop = y === panelTop;
      const isBottom = y === panelBottom;
      const isLeft = x === panelLeft;
      const isRight = x === panelRight;
      if (!(isTop || isBottom || isLeft || isRight)) {
        continue;
      }
      if ((isTop || isBottom) && !isLeft && !isRight) {
        chars[y * width + x] = Math.abs(x - sweepCenter) <= 1 ? '=' : '-';
        continue;
      }
      chars[y * width + x] = isLeft || isRight ? '|' : '+';
    }
  }

  const logoLeft = panelLeft + panelPaddingX;
  const logoTop = panelTop + panelPaddingY;
  for (let lineIndex = 0; lineIndex < HARNESS_LOGO_LINES.length; lineIndex += 1) {
    const y = logoTop + lineIndex;
    if (y < 0 || y >= height) {
      continue;
    }
    const line = HARNESS_LOGO_LINES[lineIndex]!;
    for (let index = 0; index < line.length; index += 1) {
      const glyph = line[index]!;
      if (glyph === ' ') {
        continue;
      }
      const x = logoLeft + index;
      if (x < 0 || x >= width) {
        continue;
      }
      chars[y * width + x] = glyph;
    }
  }

  return {
    top: panelTop,
    bottom: panelBottom
  };
}

function renderFrame(state: TunnelState, elapsedSeconds: number, color: boolean, random: () => number): string {
  const { width, height, intensity, chars } = state;
  intensity.fill(0);
  chars.fill(' ');

  drawTunnelLayer(state, elapsedSeconds);
  drawStars(state, elapsedSeconds, random);

  const scanlineOffset = elapsedSeconds * 8.2;
  const maxShadeIndex = SHADING_CHARS.length - 1;
  for (let y = 0; y < height; y += 1) {
    const scanline = 0.83 + Math.sin(scanlineOffset + y * 0.7) * 0.17;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = Math.max(0, Math.min(1, intensity[index]! * scanline));
      if (value < 0.02) {
        continue;
      }
      const shade = Math.floor(value * maxShadeIndex);
      chars[index] = SHADING_CHARS[shade] ?? SHADING_CHARS[maxShadeIndex]!;
    }
  }

  const logo = drawHarnessLogo(chars, width, height, elapsedSeconds);
  writeCenteredText(chars, width, height, logo.bottom + 1, 'HIGH FPS TERMINAL BENCH');
  writeCenteredText(chars, width, height, logo.bottom + 2, 'CTRL+C TO EXIT');

  const lines: string[] = [];
  for (let y = 0; y < height; y += 1) {
    const start = y * width;
    lines.push(chars.slice(start, start + width).join(''));
  }
  const prefix = color ? `\u001b[H\u001b[38;5;${String(ANIMATE_COLOR_INDEX)}m` : '\u001b[H';
  return `${prefix}${lines.join('\n')}${color ? '\u001b[0m' : ''}`;
}

export async function runHarnessAnimate(argv: readonly string[]): Promise<number> {
  if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
    printUsage();
    return 0;
  }

  const options = parseAnimateOptions(argv);
  const hasBoundedRun = options.frames !== null || options.durationMs !== null;
  const isTty = process.stdout.isTTY === true;
  if (!isTty && !hasBoundedRun) {
    throw new Error('harness animate requires a TTY or explicit --frames/--duration-ms bounds');
  }

  const random = createMulberry32(options.seed);
  const targetIntervalMs = 1000 / options.fps;
  let frameIndex = 0;
  let stopSignal: NodeJS.Signals | null = null;
  let stopRequested = false;

  const onSigInt = (): void => {
    stopSignal = 'SIGINT';
    stopRequested = true;
  };
  const onSigTerm = (): void => {
    stopSignal = 'SIGTERM';
    stopRequested = true;
  };
  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  let usingAltScreen = false;
  try {
    if (isTty) {
      process.stdout.write('\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l');
      usingAltScreen = true;
    }

    const startedAt = process.hrtime.bigint();
    let state = buildState(
      Math.max(MIN_WIDTH, process.stdout.columns ?? 0),
      Math.max(MIN_HEIGHT, process.stdout.rows ?? 0),
      random
    );
    let nextFrameAt = Date.now();

    while (!stopRequested) {
      const frameStart = process.hrtime.bigint();
      const elapsedSeconds = Number(frameStart - startedAt) / 1_000_000_000;
      const width = Math.max(MIN_WIDTH, process.stdout.columns ?? state.width);
      const height = Math.max(MIN_HEIGHT, process.stdout.rows ?? state.height);
      if (width !== state.width || height !== state.height) {
        state = buildState(width, height, random);
      }
      process.stdout.write(renderFrame(state, elapsedSeconds, options.color, random));
      frameIndex += 1;

      if (options.frames !== null && frameIndex >= options.frames) {
        break;
      }
      if (options.durationMs !== null && elapsedSeconds * 1000 >= options.durationMs) {
        break;
      }

      nextFrameAt += targetIntervalMs;
      const waitMs = nextFrameAt - Date.now();
      if (waitMs > 0) {
        await delay(waitMs);
      } else if (waitMs < -targetIntervalMs * 2) {
        nextFrameAt = Date.now();
      }
    }
  } finally {
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    if (usingAltScreen) {
      process.stdout.write('\u001b[0m\u001b[?25h\u001b[?1049l');
    } else {
      process.stdout.write('\u001b[0m\n');
    }
  }

  if (stopSignal === 'SIGINT') {
    return 130;
  }
  if (stopSignal === 'SIGTERM') {
    return 143;
  }
  return 0;
}

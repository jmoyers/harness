const ESC = '\u001b';

const SUPPORTED_ESC_SINGLE = new Set(['7', '8', 'D', 'E', 'M', 'H', 'c']);
const SUPPORTED_CSI_FINALS = new Set([
  'm',
  'A',
  'B',
  'C',
  'D',
  'G',
  'H',
  'f',
  'J',
  'K',
  'S',
  'T',
  'L',
  'M',
  '@',
  'P',
  'g',
  'r',
  's',
  'u',
]);
const SUPPORTED_PRIVATE_MODE_PARAMS = new Set([6, 25, 2004, 1047, 1048, 1049]);

type RenderTraceControlIssueKind =
  | 'unsupported-esc'
  | 'unsupported-csi'
  | 'unsupported-dcs';

interface RenderTraceControlIssue {
  readonly kind: RenderTraceControlIssueKind;
  readonly offset: number;
  readonly sequence: string;
  readonly finalByte?: string;
  readonly rawParams?: string;
}

function isLikelyCsiQueryPayload(payload: string): boolean {
  if (/^(?:c|0c|>c|>0c)$/u.test(payload)) {
    return true;
  }
  if (/^[0-9]*n$/u.test(payload)) {
    return true;
  }
  if (/^(?:14|16|18)t$/u.test(payload)) {
    return true;
  }
  if (/^>0q$/u.test(payload)) {
    return true;
  }
  if (/^\?[0-9;]*\$p$/u.test(payload)) {
    return true;
  }
  if (payload === '?u') {
    return true;
  }
  return false;
}

function csiSupported(rawParams: string, finalByte: string): boolean {
  const payload = `${rawParams}${finalByte}`;
  if (isLikelyCsiQueryPayload(payload)) {
    return true;
  }

  const privateMode = rawParams.startsWith('?');
  if (privateMode && (finalByte === 'h' || finalByte === 'l')) {
    const params = rawParams
      .slice(1)
      .split(';')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
    if (params.length === 0) {
      return false;
    }
    return params.every((value) => SUPPORTED_PRIVATE_MODE_PARAMS.has(value));
  }
  if (finalByte === 'q' && rawParams.endsWith(' ')) {
    return true;
  }
  return SUPPORTED_CSI_FINALS.has(finalByte);
}

export function renderTraceChunkPreview(chunk: Buffer | string, maxChars = 200): string {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const replaced = text
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')
    .replaceAll(ESC, '\\u001b');
  if (replaced.length <= maxChars) {
    return replaced;
  }
  return `${replaced.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function findRenderTraceControlIssues(
  chunk: Buffer | string,
  maxIssues = 12,
): readonly RenderTraceControlIssue[] {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  const issues: RenderTraceControlIssue[] = [];

  let index = 0;
  while (index < text.length && issues.length < maxIssues) {
    if (text[index] !== ESC) {
      index += 1;
      continue;
    }
    const next = text[index + 1];
    if (next === undefined) {
      break;
    }

    if (next === '[') {
      let cursor = index + 2;
      let resolved = false;
      while (cursor < text.length) {
        const code = text.charCodeAt(cursor);
        if (code >= 0x40 && code <= 0x7e) {
          const finalByte = text[cursor]!;
          const rawParams = text.slice(index + 2, cursor);
          const sequence = text.slice(index, cursor + 1);
          if (!csiSupported(rawParams, finalByte)) {
            issues.push({
              kind: 'unsupported-csi',
              offset: index,
              sequence,
              finalByte,
              rawParams,
            });
          }
          index = cursor + 1;
          resolved = true;
          break;
        }
        if (text[cursor] === ESC) {
          index = cursor;
          resolved = true;
          break;
        }
        cursor += 1;
      }
      if (!resolved) {
        break;
      }
      continue;
    }

    if (next === ']') {
      let cursor = index + 2;
      let resolved = false;
      while (cursor < text.length) {
        if (text[cursor] === '\u0007') {
          index = cursor + 1;
          resolved = true;
          break;
        }
        if (text[cursor] === ESC && text[cursor + 1] === '\\') {
          index = cursor + 2;
          resolved = true;
          break;
        }
        cursor += 1;
      }
      if (resolved) {
        continue;
      }
      break;
    }

    if (next === 'P') {
      let cursor = index + 2;
      let resolved = false;
      while (cursor < text.length) {
        if (text[cursor] === ESC && text[cursor + 1] === '\\') {
          issues.push({
            kind: 'unsupported-dcs',
            offset: index,
            sequence: text.slice(index, cursor + 2),
          });
          index = cursor + 2;
          resolved = true;
          break;
        }
        cursor += 1;
      }
      if (resolved) {
        continue;
      }
      break;
    }

    if (SUPPORTED_ESC_SINGLE.has(next)) {
      index += 2;
      continue;
    }

    issues.push({
      kind: 'unsupported-esc',
      offset: index,
      sequence: `${ESC}${next}`,
    });
    index += 2;
  }

  return issues;
}

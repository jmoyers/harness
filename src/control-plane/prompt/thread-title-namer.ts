import { createAnthropic, generateText } from '../../../packages/harness-ai/src/index.ts';
import type { StreamSessionPromptRecord } from '../stream-protocol.ts';

const THREAD_TITLE_ADAPTER_STATE_KEY = 'harnessThreadTitle';
const MAX_SANITIZED_PROMPT_CHARS = 1200;
const IMAGE_DATA_URL_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/giu;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/gu;
const HTML_IMAGE_PATTERN = /<img\b[^>]*>/giu;
const LONG_BASE64_LINE_PATTERN = /^[A-Za-z0-9+/=\s]{160,}$/u;
const TITLE_WORD_PATTERN = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g;
const TARGET_TITLE_WORD_COUNT = 2;
const FALLBACK_FILL_WORDS = ['current', 'thread'] as const;
const FALLBACK_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'build',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'up',
  'with',
]);
const DEFAULT_HAIKU_MODEL_ID = 'claude-3-5-haiku-latest';

interface ThreadTitlePromptHistoryEntry {
  readonly text: string;
  readonly observedAt: string;
  readonly hash: string;
}

interface ThreadTitleNamerInput {
  readonly conversationId: string;
  readonly agentType: string;
  readonly currentTitle: string;
  readonly promptHistory: readonly ThreadTitlePromptHistoryEntry[];
}

export interface ThreadTitleNamer {
  suggest(input: ThreadTitleNamerInput): Promise<string | null>;
}

interface AnthropicThreadTitleNamerOptions {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function historyEntriesFromAdapterState(
  adapterState: Record<string, unknown>,
): readonly ThreadTitlePromptHistoryEntry[] {
  const stored = asRecord(adapterState[THREAD_TITLE_ADAPTER_STATE_KEY]);
  if (stored === null) {
    return [];
  }
  const promptsRaw = stored['prompts'];
  if (!Array.isArray(promptsRaw)) {
    return [];
  }
  const parsed: ThreadTitlePromptHistoryEntry[] = [];
  for (const item of promptsRaw) {
    const record = asRecord(item);
    if (record === null) {
      continue;
    }
    const text = trimmedString(record['text']);
    const observedAt = trimmedString(record['observedAt']);
    const hash = trimmedString(record['hash']);
    if (text === null || observedAt === null || hash === null) {
      continue;
    }
    parsed.push({
      text,
      observedAt,
      hash,
    });
  }
  return parsed;
}

function serializePromptHistory(
  entries: readonly ThreadTitlePromptHistoryEntry[],
): Readonly<Record<string, unknown>> {
  return {
    prompts: entries.map((entry) => ({
      text: entry.text,
      observedAt: entry.observedAt,
      hash: entry.hash,
    })),
  };
}

function sanitizePromptLine(line: string): string | null {
  const withoutDataUrl = line
    .replace(IMAGE_DATA_URL_PATTERN, ' ')
    .replace(MARKDOWN_IMAGE_PATTERN, ' ')
    .replace(HTML_IMAGE_PATTERN, ' ')
    .trim();
  if (withoutDataUrl.length === 0) {
    return null;
  }
  if (LONG_BASE64_LINE_PATTERN.test(withoutDataUrl)) {
    return null;
  }
  return withoutDataUrl;
}

export function sanitizePromptForThreadTitle(text: string): string | null {
  const normalized = text
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .split('\n')
    .map((line) => sanitizePromptLine(line))
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length <= MAX_SANITIZED_PROMPT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SANITIZED_PROMPT_CHARS).trimEnd()}...`;
}

export function normalizeThreadTitleCandidate(value: string): string | null {
  const compact = value.trim();
  if (compact.length === 0) {
    return null;
  }
  const words = compact.match(TITLE_WORD_PATTERN)?.map((word) => word.trim()) ?? [];
  if (words.length < TARGET_TITLE_WORD_COUNT) {
    return null;
  }
  const filtered = words
    .map((word) => word.toLowerCase())
    .filter((word) => word !== 'title' && word.length > 0);
  if (filtered.length < TARGET_TITLE_WORD_COUNT) {
    return null;
  }
  return filtered.slice(0, TARGET_TITLE_WORD_COUNT).join(' ');
}

export function fallbackThreadTitleFromPromptHistory(
  promptHistory: readonly ThreadTitlePromptHistoryEntry[],
): string {
  const selected: string[] = [];
  for (let index = promptHistory.length - 1; index >= 0; index -= 1) {
    const entry = promptHistory[index];
    if (entry === undefined) {
      continue;
    }
    const words = entry.text.match(TITLE_WORD_PATTERN) ?? [];
    for (const rawWord of words) {
      const normalized = rawWord.toLowerCase();
      if (normalized.length < 3 || FALLBACK_STOP_WORDS.has(normalized)) {
        continue;
      }
      if (selected.includes(normalized)) {
        continue;
      }
      selected.push(normalized);
      if (selected.length >= TARGET_TITLE_WORD_COUNT) {
        return selected.join(' ');
      }
    }
  }
  for (const fallback of FALLBACK_FILL_WORDS) {
    selected.push(fallback);
    if (selected.length >= TARGET_TITLE_WORD_COUNT) {
      break;
    }
  }
  return selected.slice(0, TARGET_TITLE_WORD_COUNT).join(' ');
}

export function readThreadTitlePromptHistory(
  adapterState: Record<string, unknown>,
): readonly ThreadTitlePromptHistoryEntry[] {
  return historyEntriesFromAdapterState(adapterState);
}

export function appendThreadTitlePromptHistory(
  adapterState: Record<string, unknown>,
  prompt: StreamSessionPromptRecord,
): {
  readonly nextAdapterState: Record<string, unknown>;
  readonly promptHistory: readonly ThreadTitlePromptHistoryEntry[];
  readonly added: boolean;
} {
  const text = prompt.text === null ? null : sanitizePromptForThreadTitle(prompt.text);
  const existing = historyEntriesFromAdapterState(adapterState);
  if (text === null) {
    return {
      nextAdapterState: adapterState,
      promptHistory: existing,
      added: false,
    };
  }
  const nextHistory: ThreadTitlePromptHistoryEntry[] = [
    ...existing,
    {
      text,
      observedAt: prompt.observedAt,
      hash: prompt.hash,
    },
  ];
  const nextAdapterState: Record<string, unknown> = {
    ...adapterState,
    [THREAD_TITLE_ADAPTER_STATE_KEY]: serializePromptHistory(nextHistory),
  };
  return {
    nextAdapterState,
    promptHistory: nextHistory,
    added: true,
  };
}

export function createAnthropicThreadTitleNamer(
  options: AnthropicThreadTitleNamerOptions,
): ThreadTitleNamer {
  const anthropic = createAnthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const model = anthropic(options.modelId ?? DEFAULT_HAIKU_MODEL_ID);
  return {
    async suggest(input: ThreadTitleNamerInput): Promise<string | null> {
      if (input.promptHistory.length === 0) {
        return null;
      }
      const promptLines = input.promptHistory.map(
        (entry, index) => `${String(index + 1)}. ${entry.text}`,
      );
      const response = await generateText({
        model,
        system: [
          'You name active coding-agent threads.',
          'Use the full user prompt history to keep titles relevant and fresh.',
          'Stay high-level and avoid low-level implementation details.',
          'Return exactly 2 words in lowercase with no punctuation and no extra text.',
        ].join(' '),
        prompt: [
          `Agent: ${input.agentType}`,
          `Current title: ${input.currentTitle}`,
          `Conversation id: ${input.conversationId}`,
          'Prompt history (oldest to newest):',
          ...promptLines,
          'Return a new title now.',
        ].join('\n'),
        maxOutputTokens: 16,
        temperature: 0,
      });
      const normalized = normalizeThreadTitleCandidate(response.text);
      return normalized ?? fallbackThreadTitleFromPromptHistory(input.promptHistory);
    },
  };
}

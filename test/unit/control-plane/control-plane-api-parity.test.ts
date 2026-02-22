import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'bun:test';
import { DEFAULT_STREAM_COMMAND_PARSERS } from '../../../src/control-plane/stream-command-parser.ts';

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

function matchAllGroups(source: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (typeof value === 'string' && value.length > 0) {
      matches.push(value);
    }
  }
  return matches;
}

const parserCommandTypes = sortedUnique(Object.keys(DEFAULT_STREAM_COMMAND_PARSERS));
const parserCommandTypeSet = new Set(parserCommandTypes);

function readServerCommandTypes(): string[] {
  const sources = [
    readSource('src/control-plane/stream-server.ts'),
    readSource('src/control-plane/stream-server-command.ts'),
  ];
  return sortedUnique(
    sources.flatMap((source) =>
      matchAllGroups(source, /command\.type === '([a-z]+(?:\.[a-z-]+)+)'/g),
    ),
  );
}

function readTuiCommandTypes(): string[] {
  const source = readSource('scripts/codex-live-mux.ts');
  return sortedUnique(matchAllGroups(source, /type:\s*'([a-z]+(?:\.[a-z-]+)+)'/g));
}

function readAgentHelperCommandTypes(): string[] {
  const source = readSource('src/control-plane/agent-realtime-api.ts');
  const allCommandLike = sortedUnique(matchAllGroups(source, /type:\s*'([a-z]+(?:\.[a-z-]+)+)'/g));
  return allCommandLike.filter((type) => parserCommandTypeSet.has(type));
}

function asSet(values: readonly string[]): Set<string> {
  return new Set(values);
}

function setDifference(left: Set<string>, right: Set<string>): string[] {
  const missing: string[] = [];
  for (const value of left) {
    if (!right.has(value)) {
      missing.push(value);
    }
  }
  return missing.sort();
}

void test('parser registry command types stay in exact parity with stream server dispatch checks', () => {
  const serverCommandTypes = readServerCommandTypes();
  assert.deepEqual(serverCommandTypes, parserCommandTypes);
});

void test('tui control-plane command types are all covered by high-level agent API helpers', () => {
  const tuiCommandTypes = readTuiCommandTypes();
  const agentCommandTypes = readAgentHelperCommandTypes();

  const missingInAgent = setDifference(asSet(tuiCommandTypes), asSet(agentCommandTypes));
  assert.deepEqual(missingInAgent, []);
});

void test('tui and high-level agent command types stay grounded in parser registry', () => {
  const tuiCommandTypes = readTuiCommandTypes();
  const agentCommandTypes = readAgentHelperCommandTypes();

  const tuiUnknown = tuiCommandTypes.filter((type) => !parserCommandTypeSet.has(type));
  const agentUnknown = agentCommandTypes.filter((type) => !parserCommandTypeSet.has(type));

  assert.deepEqual(tuiUnknown, []);
  assert.deepEqual(agentUnknown, []);
});

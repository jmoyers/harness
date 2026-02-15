import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_STREAM_COMMAND_PARSERS,
  parseStreamCommand,
  type StreamCommandParserRegistry
} from '../src/control-plane/stream-command-parser.ts';

void test('parseStreamCommand parses known commands with default registry', () => {
  const parsed = parseStreamCommand({
    type: 'directory.upsert',
    directoryId: 'directory-1',
    path: '/tmp/project'
  });
  assert.deepEqual(parsed, {
    type: 'directory.upsert',
    directoryId: 'directory-1',
    path: '/tmp/project'
  });
});

void test('parseStreamCommand rejects unknown or malformed command shapes', () => {
  assert.equal(parseStreamCommand(null), null);
  assert.equal(
    parseStreamCommand({
      type: 'missing.command'
    }),
    null
  );
  assert.equal(
    parseStreamCommand({
      type: 'directory.list',
      limit: 0
    }),
    null
  );
  assert.equal(
    parseStreamCommand({
      type: 'conversation.create',
      directoryId: 'directory-1',
      title: 'title',
      agentType: 'codex',
      conversationId: 1
    }),
    null
  );
  assert.equal(
    parseStreamCommand({
      type: 'session.release',
      sessionId: 'session-1',
      reason: 1
    }),
    null
  );
  assert.equal(
    parseStreamCommand({
      type: 'pty.start',
      args: [],
      initialCols: 120,
      initialRows: 40
    }),
    null
  );
  assert.equal(
    parseStreamCommand({
      type: 'pty.attach'
    }),
    null
  );
});

void test('parseStreamCommand supports injected parser registry overrides', () => {
  const calls: Array<Record<string, unknown>> = [];
  const parsers: StreamCommandParserRegistry = {
    ...DEFAULT_STREAM_COMMAND_PARSERS,
    'custom.test': (record) => {
      calls.push(record);
      return {
        type: 'attention.list'
      };
    }
  };

  const parsed = parseStreamCommand(
    {
      type: 'custom.test',
      marker: 'ok'
    },
    parsers
  );

  assert.deepEqual(parsed, {
    type: 'attention.list'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.['marker'], 'ok');
});

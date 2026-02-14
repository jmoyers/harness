import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  parseServerEnvelope,
  type StreamClientEnvelope,
  type StreamServerEnvelope
} from '../src/control-plane/stream-protocol.ts';

void test('stream protocol encodes envelopes and consumes newline-delimited json', () => {
  const encoded = encodeStreamEnvelope({
    kind: 'command.accepted',
    commandId: 'command-1'
  });
  assert.equal(encoded.endsWith('\n'), true);

  const consumed = consumeJsonLines(`${encoded}{"oops"\n\n{"kind":"pty.exit","sessionId":"s1","exit":{"code":0,"signal":null}}\npartial`);
  assert.equal(consumed.messages.length, 2);
  assert.equal(consumed.remainder, 'partial');
});

void test('parseClientEnvelope accepts valid command and stream envelopes', () => {
  const validClientEnvelopes: unknown[] = [
    {
      kind: 'command',
      commandId: 'c1',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: ['--help'],
        env: {
          TERM: 'xterm-256color'
        },
        initialCols: 120,
        initialRows: 40,
        terminalForegroundHex: 'd0d7de',
        terminalBackgroundHex: '0f1419'
      }
    },
    {
      kind: 'command',
      commandId: 'c2',
      command: {
        type: 'pty.attach',
        sessionId: 's1',
        sinceCursor: 5
      }
    },
    {
      kind: 'command',
      commandId: 'c3',
      command: {
        type: 'pty.detach',
        sessionId: 's1'
      }
    },
    {
      kind: 'command',
      commandId: 'c4',
      command: {
        type: 'pty.subscribe-events',
        sessionId: 's1'
      }
    },
    {
      kind: 'command',
      commandId: 'c5',
      command: {
        type: 'pty.unsubscribe-events',
        sessionId: 's1'
      }
    },
    {
      kind: 'command',
      commandId: 'c6',
      command: {
        type: 'pty.close',
        sessionId: 's1'
      }
    },
    {
      kind: 'pty.input',
      sessionId: 's1',
      dataBase64: Buffer.from('hello', 'utf8').toString('base64')
    },
    {
      kind: 'pty.resize',
      sessionId: 's1',
      cols: 100,
      rows: 35
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'interrupt'
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'eof'
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'terminate'
    }
  ];

  for (const value of validClientEnvelopes) {
    const parsed = parseClientEnvelope(value);
    assert.notEqual(parsed, null);
  }
});

void test('parseClientEnvelope rejects malformed envelopes', () => {
  const invalidValues: unknown[] = [
    null,
    'text',
    {},
    {
      kind: 'command',
      commandId: 1,
      command: {
        type: 'pty.close',
        sessionId: 's1'
      }
    },
    {
      kind: 'command',
      commandId: 'c1',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: ['ok', 1],
        initialCols: 80,
        initialRows: 24
      }
    },
    {
      kind: 'command',
      commandId: 'c2',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: [],
        env: {
          TERM: 1
        },
        initialCols: 80,
        initialRows: 24
      }
    },
    {
      kind: 'command',
      commandId: 'c3',
      command: {
        type: 'pty.attach',
        sessionId: 's1',
        sinceCursor: 'x'
      }
    },
    {
      kind: 'command',
      commandId: 'c4',
      command: {
        type: 'unknown',
        sessionId: 's1'
      }
    },
    {
      kind: 'pty.input',
      sessionId: 's1'
    },
    {
      kind: 'pty.resize',
      sessionId: 's1',
      cols: '100',
      rows: 24
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'boom'
    }
  ];

  for (const value of invalidValues) {
    assert.equal(parseClientEnvelope(value), null);
  }
});

void test('parseServerEnvelope accepts valid server envelopes', () => {
  const validServerEnvelopes: unknown[] = [
    {
      kind: 'command.accepted',
      commandId: 'c1'
    },
    {
      kind: 'command.completed',
      commandId: 'c1',
      result: {
        ok: true
      }
    },
    {
      kind: 'command.failed',
      commandId: 'c1',
      error: 'bad'
    },
    {
      kind: 'pty.output',
      sessionId: 's1',
      cursor: 9,
      chunkBase64: Buffer.from('x', 'utf8').toString('base64')
    },
    {
      kind: 'pty.exit',
      sessionId: 's1',
      exit: {
        code: 0,
        signal: null
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'notify',
        record: {
          ts: new Date(0).toISOString(),
          payload: {
            type: 'x'
          }
        }
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'turn-completed',
        record: {
          ts: new Date(0).toISOString(),
          payload: {
            type: 'agent-turn-complete'
          }
        }
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'attention-required',
        reason: 'approval',
        record: {
          ts: new Date(0).toISOString(),
          payload: {
            type: 'approval'
          }
        }
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'session-exit',
        exit: {
          code: null,
          signal: 'SIGTERM'
        }
      }
    }
  ];

  for (const value of validServerEnvelopes) {
    const parsed = parseServerEnvelope(value);
    assert.notEqual(parsed, null);
  }
});

void test('parseServerEnvelope rejects malformed envelopes', () => {
  const invalidValues: unknown[] = [
    null,
    {
      kind: 'command.accepted',
      commandId: 1
    },
    {
      kind: 'command.completed',
      commandId: 'c1',
      result: 'not-record'
    },
    {
      kind: 'command.failed',
      commandId: 'c1',
      error: 9
    },
    {
      kind: 'pty.output',
      sessionId: 's1',
      cursor: 'x',
      chunkBase64: 'abc'
    },
    {
      kind: 'pty.exit',
      sessionId: 's1',
      exit: {
        code: 'x',
        signal: null
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'notify',
        record: {
          ts: 5,
          payload: {}
        }
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'attention-required',
        record: {
          ts: new Date(0).toISOString(),
          payload: {}
        }
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'session-exit',
        exit: {
          code: null,
          signal: '9'
        }
      }
    },
    {
      kind: 'unknown'
    }
  ];

  for (const value of invalidValues) {
    assert.equal(parseServerEnvelope(value), null);
  }
});

void test('protocol parse helpers round-trip encoded envelopes', () => {
  const client: StreamClientEnvelope = {
    kind: 'pty.signal',
    sessionId: 'session-1',
    signal: 'terminate'
  };
  const server: StreamServerEnvelope = {
    kind: 'pty.event',
    sessionId: 'session-1',
    event: {
        type: 'session-exit',
        exit: {
          code: 130,
          signal: 'SIGINT'
        }
      }
  };

  const clientParsed = parseClientEnvelope(JSON.parse(encodeStreamEnvelope(client).trim()));
  const serverParsed = parseServerEnvelope(JSON.parse(encodeStreamEnvelope(server).trim()));

  assert.deepEqual(clientParsed, client);
  assert.deepEqual(serverParsed, server);
});

void test('protocol parsers cover remaining guard branches', () => {
  const extraInvalidClient: unknown[] = [
    {
      kind: 'command',
      commandId: 'c-guard',
      command: null
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {}
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80
      }
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80,
        initialRows: 24,
        env: 3
      }
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80,
        initialRows: 24,
        terminalForegroundHex: 10
      }
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80,
        initialRows: 24,
        terminalBackgroundHex: 10
      }
    },
    {
      kind: 'mystery-kind',
      sessionId: 's-guard'
    }
  ];

  for (const value of extraInvalidClient) {
    assert.equal(parseClientEnvelope(value), null);
  }

  const extraInvalidServer: unknown[] = [
    {
      kind: 5
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: null
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: {}
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: {
        type: 'notify'
      }
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: {
        type: 'unknown-event',
        record: {
          ts: new Date(0).toISOString(),
          payload: {}
        }
      }
    },
    {
      kind: 'pty.exit',
      sessionId: 's-guard',
      exit: {
        code: null,
        signal: 9
      }
    },
    {
      kind: 'mystery-kind',
      sessionId: 's-guard'
    }
  ];

  for (const value of extraInvalidServer) {
    assert.equal(parseServerEnvelope(value), null);
  }
});

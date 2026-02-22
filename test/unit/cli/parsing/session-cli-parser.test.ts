import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  parseGlobalCliOptions,
  parseSessionName,
  SessionCliParser,
} from '../../../../src/cli/parsing/session.ts';

test('session cli parser normalizes valid session names and rejects invalid values', () => {
  assert.equal(parseSessionName('session-a'), 'session-a');
  assert.equal(parseSessionName('  session_a  '), 'session_a');
  assert.throws(() => parseSessionName(''), /invalid --session value/u);
  assert.throws(() => parseSessionName('bad space'), /invalid --session value/u);
  assert.throws(() => parseSessionName('-bad'), /invalid --session value/u);
});

test('session cli parser extracts global --session envelope only when it is the leading option', () => {
  assert.deepEqual(parseGlobalCliOptions([]), {
    sessionName: null,
    argv: [],
  });
  assert.deepEqual(parseGlobalCliOptions(['gateway', 'status']), {
    sessionName: null,
    argv: ['gateway', 'status'],
  });
  assert.deepEqual(parseGlobalCliOptions(['--session', 'alpha', 'gateway', 'status']), {
    sessionName: 'alpha',
    argv: ['gateway', 'status'],
  });
  assert.deepEqual(parseGlobalCliOptions(['gateway', '--session', 'alpha']), {
    sessionName: null,
    argv: ['gateway', '--session', 'alpha'],
  });
});

test('SessionCliParser class exposes equivalent parsing behavior', () => {
  const parser = new SessionCliParser();
  assert.equal(parser.parseSessionName('demo-1'), 'demo-1');
  assert.deepEqual(parser.parseGlobalCliOptions(['--session', 'demo-1', 'profile']), {
    sessionName: 'demo-1',
    argv: ['profile'],
  });
  assert.deepEqual(parser.parseGlobalCliOptions(['--session']), {
    sessionName: null,
    argv: ['--session'],
  });
});

test('session cli parser surfaces missing --session values and invalid class inputs', () => {
  assert.throws(
    () => parseGlobalCliOptions(['--session', 'bad space']),
    /invalid --session value/u,
  );
  const parser = new SessionCliParser();
  assert.throws(() => parser.parseGlobalCliOptions(['--session', '']), /invalid --session value/u);
});

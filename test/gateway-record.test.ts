import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GATEWAY_DB_PATH,
  DEFAULT_GATEWAY_HOST,
  DEFAULT_GATEWAY_LOG_PATH,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_GATEWAY_RECORD_PATH,
  GATEWAY_RECORD_VERSION,
  isLoopbackHost,
  normalizeGatewayHost,
  normalizeGatewayPort,
  normalizeGatewayStateDbPath,
  parseGatewayRecordText,
  resolveGatewayLogPath,
  resolveGatewayRecordPath,
  resolveInvocationDirectory,
  serializeGatewayRecord,
  type GatewayRecord
} from '../src/cli/gateway-record.ts';

void test('gateway record parsing accepts valid records with auth token', () => {
  const parsed = parseGatewayRecordText(
    JSON.stringify({
      version: GATEWAY_RECORD_VERSION,
      pid: 12345,
      host: '127.0.0.1',
      port: 7777,
      authToken: 'secret-token',
      stateDbPath: '/tmp/control-plane.sqlite',
      startedAt: '2026-02-16T00:00:00.000Z',
      workspaceRoot: '/tmp/workspace'
    })
  );
  assert.notEqual(parsed, null);
  assert.equal(parsed?.authToken, 'secret-token');
  assert.equal(parsed?.pid, 12345);
});

void test('gateway record parsing accepts records with null auth token', () => {
  const parsed = parseGatewayRecordText(
    JSON.stringify({
      version: GATEWAY_RECORD_VERSION,
      pid: 12345,
      host: '127.0.0.1',
      port: 7777,
      authToken: null,
      stateDbPath: '/tmp/control-plane.sqlite',
      startedAt: '2026-02-16T00:00:00.000Z',
      workspaceRoot: '/tmp/workspace'
    })
  );
  assert.notEqual(parsed, null);
  assert.equal(parsed?.authToken, null);
});

void test('gateway record parsing rejects malformed records', () => {
  assert.equal(parseGatewayRecordText('not-json'), null);
  assert.equal(parseGatewayRecordText(JSON.stringify([])), null);
  assert.equal(
    parseGatewayRecordText(
      JSON.stringify({
        version: 999,
        pid: 1,
        host: '127.0.0.1',
        port: 7777,
        authToken: null,
        stateDbPath: '/tmp/db.sqlite',
        startedAt: '2026-02-16T00:00:00.000Z',
        workspaceRoot: '/tmp/ws'
      })
    ),
    null
  );
  assert.equal(
    parseGatewayRecordText(
      JSON.stringify({
        version: GATEWAY_RECORD_VERSION,
        pid: 0,
        host: '127.0.0.1',
        port: 7777,
        authToken: null,
        stateDbPath: '/tmp/db.sqlite',
        startedAt: '2026-02-16T00:00:00.000Z',
        workspaceRoot: '/tmp/ws'
      })
    ),
    null
  );
  assert.equal(
    parseGatewayRecordText(
      JSON.stringify({
        version: GATEWAY_RECORD_VERSION,
        pid: '1',
        host: '127.0.0.1',
        port: 7777,
        authToken: null,
        stateDbPath: '/tmp/db.sqlite',
        startedAt: '2026-02-16T00:00:00.000Z',
        workspaceRoot: '/tmp/ws'
      })
    ),
    null
  );
  assert.equal(
    parseGatewayRecordText(
      JSON.stringify({
        version: GATEWAY_RECORD_VERSION,
        pid: 1,
        host: '127.0.0.1',
        port: '7777',
        authToken: null,
        stateDbPath: '/tmp/db.sqlite',
        startedAt: '2026-02-16T00:00:00.000Z',
        workspaceRoot: '/tmp/ws'
      })
    ),
    null
  );
  assert.equal(
    parseGatewayRecordText(
      JSON.stringify({
        version: GATEWAY_RECORD_VERSION,
        pid: 1,
        host: '127.0.0.1',
        port: 70000,
        authToken: null,
        stateDbPath: '/tmp/db.sqlite',
        startedAt: '2026-02-16T00:00:00.000Z',
        workspaceRoot: '/tmp/ws'
      })
    ),
    null
  );
  assert.equal(
    parseGatewayRecordText(
      JSON.stringify({
        version: GATEWAY_RECORD_VERSION,
        pid: 1,
        host: '',
        port: 7777,
        authToken: null,
        stateDbPath: '/tmp/db.sqlite',
        startedAt: '2026-02-16T00:00:00.000Z',
        workspaceRoot: '/tmp/ws'
      })
    ),
    null
  );
  assert.equal(
    parseGatewayRecordText(
      JSON.stringify({
        version: GATEWAY_RECORD_VERSION,
        pid: 1,
        host: '127.0.0.1',
        port: 7777,
        authToken: 42,
        stateDbPath: '/tmp/db.sqlite',
        startedAt: '2026-02-16T00:00:00.000Z',
        workspaceRoot: '/tmp/ws'
      })
    ),
    null
  );
});

void test('gateway record serializer writes a trailing newline', () => {
  const record: GatewayRecord = {
    version: GATEWAY_RECORD_VERSION,
    pid: 12345,
    host: '127.0.0.1',
    port: 7777,
    authToken: 'secret-token',
    stateDbPath: '/tmp/control-plane.sqlite',
    startedAt: '2026-02-16T00:00:00.000Z',
    workspaceRoot: '/tmp/workspace'
  };
  const serialized = serializeGatewayRecord(record);
  assert.equal(serialized.endsWith('\n'), true);
  const parsedBack = parseGatewayRecordText(serialized);
  assert.deepEqual(parsedBack, record);
});

void test('invocation directory and gateway paths resolve deterministically', () => {
  assert.equal(resolveInvocationDirectory({}, '/tmp/cwd'), '/tmp/cwd');
  assert.equal(resolveInvocationDirectory({ INIT_CWD: '/tmp/init' }, '/tmp/cwd'), '/tmp/init');
  assert.equal(
    resolveInvocationDirectory(
      {
        HARNESS_INVOKE_CWD: '/tmp/invoke',
        INIT_CWD: '/tmp/init'
      },
      '/tmp/cwd'
    ),
    '/tmp/invoke'
  );

  assert.equal(resolveGatewayRecordPath('/tmp/workspace'), '/tmp/workspace/.harness/gateway.json');
  assert.equal(resolveGatewayLogPath('/tmp/workspace'), '/tmp/workspace/.harness/gateway.log');
  assert.equal(DEFAULT_GATEWAY_RECORD_PATH, '.harness/gateway.json');
  assert.equal(DEFAULT_GATEWAY_LOG_PATH, '.harness/gateway.log');
});

void test('gateway host normalization keeps explicit values and falls back otherwise', () => {
  assert.equal(normalizeGatewayHost('localhost'), 'localhost');
  assert.equal(normalizeGatewayHost('  0.0.0.0  '), '0.0.0.0');
  assert.equal(normalizeGatewayHost('   '), DEFAULT_GATEWAY_HOST);
  assert.equal(normalizeGatewayHost(null), DEFAULT_GATEWAY_HOST);
  assert.equal(normalizeGatewayHost(undefined, '::1'), '::1');
  assert.equal(DEFAULT_GATEWAY_HOST, '127.0.0.1');
});

void test('gateway port normalization handles numbers and strings', () => {
  assert.equal(normalizeGatewayPort(1234), 1234);
  assert.equal(normalizeGatewayPort('1234'), 1234);
  assert.equal(normalizeGatewayPort(' 4567 '), 4567);
  assert.equal(normalizeGatewayPort('   '), DEFAULT_GATEWAY_PORT);
  assert.equal(normalizeGatewayPort('0'), DEFAULT_GATEWAY_PORT);
  assert.equal(normalizeGatewayPort(-1), DEFAULT_GATEWAY_PORT);
  assert.equal(normalizeGatewayPort('90000'), DEFAULT_GATEWAY_PORT);
  assert.equal(normalizeGatewayPort(undefined, 5151), 5151);
  assert.equal(DEFAULT_GATEWAY_PORT, 7777);
});

void test('gateway db path normalization keeps explicit values and falls back otherwise', () => {
  assert.equal(normalizeGatewayStateDbPath('/tmp/custom.sqlite'), '/tmp/custom.sqlite');
  assert.equal(normalizeGatewayStateDbPath('   /tmp/trim.sqlite   '), '/tmp/trim.sqlite');
  assert.equal(normalizeGatewayStateDbPath('   '), DEFAULT_GATEWAY_DB_PATH);
  assert.equal(normalizeGatewayStateDbPath(undefined, '/tmp/fallback.sqlite'), '/tmp/fallback.sqlite');
  assert.equal(DEFAULT_GATEWAY_DB_PATH, '.harness/control-plane.sqlite');
});

void test('loopback host detection recognizes loopback aliases', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost(' localhost '), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
});

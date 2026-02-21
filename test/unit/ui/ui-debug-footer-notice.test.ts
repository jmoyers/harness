import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { DebugFooterNotice } from '../../../src/ui/debug-footer-notice.ts';

void test('debug footer notice normalizes text and returns active notice before ttl', () => {
  let nowMs = 100;
  const notice = new DebugFooterNotice({
    ttlMs: 50,
    nowMs: () => nowMs,
  });

  notice.set('  hello world  ');
  assert.equal(notice.current(), 'hello world');

  nowMs = 149;
  assert.equal(notice.current(), 'hello world');
});

void test('debug footer notice clears empty text and expires stale notices', () => {
  let nowMs = 10;
  const notice = new DebugFooterNotice({
    ttlMs: 20,
    nowMs: () => nowMs,
  });

  assert.equal(notice.current(), null);

  notice.set('kept');
  nowMs = 31;
  assert.equal(notice.current(), null);

  notice.set('   ');
  assert.equal(notice.current(), null);
});

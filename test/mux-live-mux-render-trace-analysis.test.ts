import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  findRenderTraceControlIssues,
  renderTraceChunkPreview,
} from '../src/mux/live-mux/render-trace-analysis.ts';

void test('render trace analysis escapes control bytes in preview and truncates long chunks', () => {
  const preview = renderTraceChunkPreview('\u001b[31mhello\nworld\r', 80);
  assert.equal(preview.includes('\\u001b[31mhello\\n'), true);
  assert.equal(preview.includes('\\r'), true);

  const longPreview = renderTraceChunkPreview('x'.repeat(100), 10);
  assert.equal(longPreview.endsWith('…'), true);
  assert.equal(longPreview.length <= 10, true);
});

void test('render trace analysis treats known CSI and ESC controls as supported', () => {
  const issues = findRenderTraceControlIssues(
    Buffer.from('\u001b[31mcolor\u001b[?25l\u001b[18t\u001b7x\u001b8', 'utf8'),
  );
  assert.deepEqual(issues, []);
});

void test('render trace analysis treats supported query payload variants as safe', () => {
  const issues = findRenderTraceControlIssues(
    Buffer.from(
      '\u001b[c\u001b[0c\u001b[>c\u001b[>0c\u001b[5n\u001b[>0q\u001b[?1;2$p\u001b[?u\u001b[0 q',
      'utf8',
    ),
  );
  assert.deepEqual(issues, []);
});

void test('render trace analysis surfaces unsupported CSI, ESC, and DCS sequences', () => {
  const issues = findRenderTraceControlIssues(
    Buffer.from('a\u001b[?1045ha\u001b=\u001bP$qm\u001b\\', 'utf8'),
  );
  assert.equal(issues.length, 3);
  assert.equal(issues[0]?.kind, 'unsupported-csi');
  assert.equal(issues[1]?.kind, 'unsupported-esc');
  assert.equal(issues[2]?.kind, 'unsupported-dcs');
});

void test('render trace analysis marks empty private mode params as unsupported CSI', () => {
  const issues = findRenderTraceControlIssues(Buffer.from('\u001b[?h', 'utf8'));
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.kind, 'unsupported-csi');
});

void test('render trace analysis handles OSC terminators and interrupted CSI safely', () => {
  const issues = findRenderTraceControlIssues(
    Buffer.from('a\u001b]0;title\u0007b\u001b]1;next\u001b\\c\u001b[31\u001b=', 'utf8'),
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.kind, 'unsupported-esc');
  assert.equal(issues[0]?.sequence, '\u001b=');
});

void test('render trace analysis ignores incomplete trailing control sequences', () => {
  const issues = findRenderTraceControlIssues(Buffer.from('a\u001b[31', 'utf8'));
  assert.deepEqual(issues, []);
});

void test('render trace analysis ignores incomplete trailing OSC controls', () => {
  const issues = findRenderTraceControlIssues(Buffer.from('a\u001b]0;unterminated', 'utf8'));
  assert.deepEqual(issues, []);
});

void test('render trace analysis ignores incomplete trailing DCS controls', () => {
  const issues = findRenderTraceControlIssues(Buffer.from('a\u001bP$qm', 'utf8'));
  assert.deepEqual(issues, []);
});

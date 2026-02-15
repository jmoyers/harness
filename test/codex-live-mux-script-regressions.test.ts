import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

void test('codex-live-mux script no longer references removed inline control-plane queue bindings', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('interactiveControlPlaneQueue.length'), false);
  assert.equal(source.includes('backgroundControlPlaneQueue.length'), false);
  assert.equal(source.includes('controlPlaneOpRunning ? 1 : 0'), false);
  assert.equal(source.includes('controlPlaneQueue.metrics()'), true);
});

void test('codex-live-mux project pane row padding helper remains imported', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('viewport.map((row) => padOrTrimDisplay(row, safeCols))'), true);
  assert.equal(source.includes('padOrTrimDisplay,'), true);
});

void test('codex-live-mux conversation title edit uses double click across title and meta rows', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS'), true);
  assert.equal(source.includes('detectConversationDoubleClick('), true);
  assert.equal(source.includes("selectedRowKind === 'conversation-meta'"), true);
  assert.equal(source.includes("if (selectedRowKind === 'conversation-title')"), false);
  assert.equal(source.includes('mouse-activate-edit-conversation'), true);
});

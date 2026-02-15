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

  assert.equal(source.includes('viewport.map((row) => padOrTrimDisplay(row.text, safeCols))'), true);
  assert.equal(source.includes('padOrTrimDisplay,'), true);
});

void test('codex-live-mux conversation title edit uses double click on both thread rows', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS'), true);
  assert.equal(source.includes('detectConversationDoubleClick('), true);
  assert.equal(source.includes("selectedRowKind === 'conversation-title'"), true);
  assert.equal(source.includes("selectedRowKind === 'conversation-body'"), true);
  assert.equal(source.includes('mouse-activate-edit-conversation'), true);
});

void test('codex-live-mux persists mux ui state through config core hooks', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('updateHarnessMuxUiConfig'), true);
  assert.equal(source.includes('queuePersistMuxUiState();'), true);
  assert.equal(source.includes('persistMuxUiStateNow();'), true);
  assert.equal(source.includes('const configuredMuxUi = loadedConfig.config.mux.ui;'), true);
});

void test('codex-live-mux no longer seeds untitled task placeholder titles', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('untitled task'), false);
  assert.equal(source.includes("const initialTitle = '';"), true);
  assert.equal(source.includes("const title = '';"), true);
});

void test('codex-live-mux enforces selection-gated close/archive shortcuts and inline project actions', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes("mainPaneMode === 'project'"), true);
  assert.equal(source.includes("mainPaneMode === 'conversation' ? activeConversationId : null"), true);
  assert.equal(source.includes('projectPaneActionAtRow('), true);
  assert.equal(source.includes('PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL'), true);
  assert.equal(source.includes('CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL'), true);
});

void test('codex-live-mux creates threads through a type-selection modal and supports terminal threads', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('type ThreadAgentType = ReturnType<typeof normalizeThreadAgentType>;'), true);
  assert.equal(source.includes('type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;'), true);
  assert.equal(source.includes('let newThreadPrompt: NewThreadPromptState | null = null;'), true);
  assert.equal(source.includes('const openNewThreadPrompt = (directoryId: string): void => {'), true);
  assert.equal(source.includes('const buildNewThreadModalOverlay = (viewportRows: number)'), true);
  assert.equal(source.includes('handleNewThreadPromptInput(chunk)'), true);
  assert.equal(source.includes('createAndActivateConversationInDirectory = async ('), true);
  assert.equal(source.includes('agentType: ThreadAgentType'), true);
  assert.equal(source.includes('createAndActivateConversationInDirectory(targetDirectoryId, selectedAgentType)'), true);
  assert.equal(source.includes('agentType === \'codex\' ? options.codexArgs : []'), true);
});

void test('codex-live-mux keeps event subscriptions for inactive live conversations', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');
  const detachSection = source.slice(
    source.indexOf('const detachConversation = async'),
    source.indexOf('const refreshProjectPaneSnapshot')
  );

  assert.equal(
    source.includes('async function subscribeConversationEvents(sessionId: string): Promise<void>'),
    true
  );
  assert.equal(source.includes('await subscribeConversationEvents(sessionId);'), true);
  assert.equal(source.includes('await subscribeConversationEvents(summary.sessionId);'), true);
  assert.equal(source.includes("type: 'pty.unsubscribe-events'"), true);
  assert.equal(detachSection.includes("type: 'pty.unsubscribe-events'"), false);
});

void test('codex-live-mux status is driven by control-plane key events instead of local submit heuristics', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('subscribeControlPlaneKeyEvents'), true);
  assert.equal(source.includes('applyControlPlaneKeyEvent'), true);
  assert.equal(source.includes('inputContainsTurnSubmission('), false);
  assert.equal(source.includes("inputConversation.status = 'running';"), false);
});

void test('codex-live-mux rail rendering consumes per-project git summary map and removes legacy single-summary path', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('const gitSummaryByDirectoryId = new Map<string, GitSummary>();'), true);
  assert.equal(source.includes('gitSummaryByDirectoryId.get(directory.directoryId)'), true);
  assert.equal(source.includes('gitSummaryByDirectoryId,'), true);
  assert.equal(source.includes('let gitSummary:'), false);
  assert.equal(source.includes('const refreshGitSummary = async'), false);
});

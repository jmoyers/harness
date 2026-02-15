import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNewThreadPromptState,
  newThreadPromptBodyLines,
  nextThreadAgentType,
  normalizeThreadAgentType,
  reduceNewThreadPromptInput,
  resolveNewThreadPromptAgentByRow
} from '../src/mux/new-thread-prompt.ts';

void test('new thread prompt defaults and normalization are stable', () => {
  const state = createNewThreadPromptState('directory-1');
  assert.equal(state.directoryId, 'directory-1');
  assert.equal(state.selectedAgentType, 'codex');
  assert.equal(normalizeThreadAgentType('terminal'), 'terminal');
  assert.equal(normalizeThreadAgentType('codex'), 'codex');
  assert.equal(normalizeThreadAgentType('other'), 'codex');
  assert.equal(nextThreadAgentType('codex'), 'terminal');
  assert.equal(nextThreadAgentType('terminal'), 'codex');
});

void test('new thread prompt reduces keyboard input into selection and submit', () => {
  const initial = createNewThreadPromptState('directory-1');
  const toggled = reduceNewThreadPromptInput(initial, Uint8Array.from([0x09]));
  assert.equal(toggled.nextState.selectedAgentType, 'terminal');
  assert.equal(toggled.submit, false);

  const codexFromShortcut = reduceNewThreadPromptInput(
    toggled.nextState,
    Uint8Array.from([0x63, 0x43, 0x31])
  );
  assert.equal(codexFromShortcut.nextState.selectedAgentType, 'codex');
  assert.equal(codexFromShortcut.submit, false);

  const terminalFromShortcut = reduceNewThreadPromptInput(
    codexFromShortcut.nextState,
    Uint8Array.from([0x74, 0x54, 0x32])
  );
  assert.equal(terminalFromShortcut.nextState.selectedAgentType, 'terminal');
  assert.equal(terminalFromShortcut.submit, false);

  const submitted = reduceNewThreadPromptInput(terminalFromShortcut.nextState, Uint8Array.from([0x0d]));
  assert.equal(submitted.submit, true);
  assert.equal(submitted.nextState.selectedAgentType, 'terminal');
});

void test('new thread prompt row mapping and body lines remain deterministic', () => {
  const state = createNewThreadPromptState('directory-2');
  const body = newThreadPromptBodyLines(state, {
    codexButtonLabel: '[ codex ]',
    terminalButtonLabel: '[ terminal ]'
  });
  assert.equal(body[2], '● [ codex ]');
  assert.equal(body[3], '○ [ terminal ]');

  const withTerminal = reduceNewThreadPromptInput(state, Uint8Array.from([0x20])).nextState;
  const bodyTerminal = newThreadPromptBodyLines(withTerminal, {
    codexButtonLabel: '[ codex ]',
    terminalButtonLabel: '[ terminal ]'
  });
  assert.equal(bodyTerminal[2], '○ [ codex ]');
  assert.equal(bodyTerminal[3], '● [ terminal ]');

  assert.equal(resolveNewThreadPromptAgentByRow(10, 15), 'codex');
  assert.equal(resolveNewThreadPromptAgentByRow(10, 16), 'terminal');
  assert.equal(resolveNewThreadPromptAgentByRow(10, 14), null);
});

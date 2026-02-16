import assert from 'node:assert/strict';
import { test } from 'bun:test';
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
  assert.equal(normalizeThreadAgentType('claude'), 'claude');
  assert.equal(normalizeThreadAgentType('terminal'), 'terminal');
  assert.equal(normalizeThreadAgentType('codex'), 'codex');
  assert.equal(normalizeThreadAgentType('other'), 'codex');
  assert.equal(nextThreadAgentType('codex'), 'claude');
  assert.equal(nextThreadAgentType('claude'), 'terminal');
  assert.equal(nextThreadAgentType('terminal'), 'codex');
});

void test('new thread prompt reduces keyboard input into selection and submit', () => {
  const initial = createNewThreadPromptState('directory-1');
  const toggled = reduceNewThreadPromptInput(initial, Uint8Array.from([0x09]));
  assert.equal(toggled.nextState.selectedAgentType, 'claude');
  assert.equal(toggled.submit, false);

  const codexFromShortcut = reduceNewThreadPromptInput(
    toggled.nextState,
    Uint8Array.from([0x63, 0x43, 0x31])
  );
  assert.equal(codexFromShortcut.nextState.selectedAgentType, 'codex');
  assert.equal(codexFromShortcut.submit, false);

  const claudeFromShortcut = reduceNewThreadPromptInput(
    codexFromShortcut.nextState,
    Uint8Array.from([0x61, 0x41, 0x32])
  );
  assert.equal(claudeFromShortcut.nextState.selectedAgentType, 'claude');
  assert.equal(claudeFromShortcut.submit, false);

  const terminalFromShortcut = reduceNewThreadPromptInput(
    claudeFromShortcut.nextState,
    Uint8Array.from([0x74, 0x54, 0x33])
  );
  assert.equal(terminalFromShortcut.nextState.selectedAgentType, 'terminal');
  assert.equal(terminalFromShortcut.submit, false);

  const submitted = reduceNewThreadPromptInput(terminalFromShortcut.nextState, Uint8Array.from([0x0d]));
  assert.equal(submitted.submit, true);
  assert.equal(submitted.nextState.selectedAgentType, 'terminal');
});

void test('new thread prompt decodes encoded key protocols and ignores unrelated escape sequences', () => {
  const initial = createNewThreadPromptState('directory-encoded');
  const kittyTerminal = reduceNewThreadPromptInput(initial, Buffer.from('\u001b[116u', 'utf8'));
  assert.equal(kittyTerminal.nextState.selectedAgentType, 'terminal');
  assert.equal(kittyTerminal.submit, false);

  const modifyOtherCodex = reduceNewThreadPromptInput(
    kittyTerminal.nextState,
    Buffer.from('\u001b[27;1;99~', 'utf8')
  );
  assert.equal(modifyOtherCodex.nextState.selectedAgentType, 'codex');
  assert.equal(modifyOtherCodex.submit, false);

  const modifyOtherClaude = reduceNewThreadPromptInput(
    modifyOtherCodex.nextState,
    Buffer.from('\u001b[27;1;97~', 'utf8')
  );
  assert.equal(modifyOtherClaude.nextState.selectedAgentType, 'claude');
  assert.equal(modifyOtherClaude.submit, false);

  const ignoredMouseEscape = reduceNewThreadPromptInput(
    modifyOtherClaude.nextState,
    Buffer.from('\u001b[<64;77;3M', 'utf8')
  );
  assert.equal(ignoredMouseEscape.nextState.selectedAgentType, 'claude');
  assert.equal(ignoredMouseEscape.submit, false);

  const ignoredOutOfRangeKitty = reduceNewThreadPromptInput(
    ignoredMouseEscape.nextState,
    Buffer.from('\u001b[1000u', 'utf8')
  );
  assert.equal(ignoredOutOfRangeKitty.nextState.selectedAgentType, 'claude');
  assert.equal(ignoredOutOfRangeKitty.submit, false);

  const ignoredMalformedKittyPayload = reduceNewThreadPromptInput(
    ignoredOutOfRangeKitty.nextState,
    Buffer.from('\u001b[116;badu', 'utf8')
  );
  assert.equal(ignoredMalformedKittyPayload.nextState.selectedAgentType, 'claude');
  assert.equal(ignoredMalformedKittyPayload.submit, false);

  const ignoredMalformedModifyOtherKeysPayload = reduceNewThreadPromptInput(
    ignoredMalformedKittyPayload.nextState,
    Buffer.from('\u001b[27;1;bad~', 'utf8')
  );
  assert.equal(ignoredMalformedModifyOtherKeysPayload.nextState.selectedAgentType, 'claude');
  assert.equal(ignoredMalformedModifyOtherKeysPayload.submit, false);

  const newlineSubmit = reduceNewThreadPromptInput(
    ignoredMalformedModifyOtherKeysPayload.nextState,
    Uint8Array.from([0x0a])
  );
  assert.equal(newlineSubmit.nextState.selectedAgentType, 'claude');
  assert.equal(newlineSubmit.submit, true);
});

void test('new thread prompt accepts numeric claude and terminal shortcut keys', () => {
  const initial = createNewThreadPromptState('directory-numeric');
  const claudeSelected = reduceNewThreadPromptInput(initial, Uint8Array.from([0x32]));
  assert.equal(claudeSelected.nextState.selectedAgentType, 'claude');
  assert.equal(claudeSelected.submit, false);

  const selected = reduceNewThreadPromptInput(claudeSelected.nextState, Uint8Array.from([0x33]));
  assert.equal(selected.nextState.selectedAgentType, 'terminal');
  assert.equal(selected.submit, false);
});

void test('new thread prompt row mapping and body lines remain deterministic', () => {
  const state = createNewThreadPromptState('directory-2');
  const body = newThreadPromptBodyLines(state, {
    codexButtonLabel: '[ codex ]',
    claudeButtonLabel: '[ claude ]',
    terminalButtonLabel: '[ terminal ]'
  });
  assert.equal(body[2], '● [ codex ]');
  assert.equal(body[3], '○ [ claude ]');
  assert.equal(body[4], '○ [ terminal ]');

  const withTerminal = reduceNewThreadPromptInput(state, Uint8Array.from([0x20])).nextState;
  const bodyTerminal = newThreadPromptBodyLines(withTerminal, {
    codexButtonLabel: '[ codex ]',
    claudeButtonLabel: '[ claude ]',
    terminalButtonLabel: '[ terminal ]'
  });
  assert.equal(bodyTerminal[2], '○ [ codex ]');
  assert.equal(bodyTerminal[3], '● [ claude ]');
  assert.equal(bodyTerminal[4], '○ [ terminal ]');

  assert.equal(resolveNewThreadPromptAgentByRow(10, 15), 'codex');
  assert.equal(resolveNewThreadPromptAgentByRow(10, 16), 'claude');
  assert.equal(resolveNewThreadPromptAgentByRow(10, 17), 'terminal');
  assert.equal(resolveNewThreadPromptAgentByRow(10, 14), null);
});

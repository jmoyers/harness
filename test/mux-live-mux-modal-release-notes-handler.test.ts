import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RELEASE_NOTES_UPDATE_ACTION_ROW_OFFSET } from '../src/mux/live-mux/modal-overlays.ts';
import type { ReleaseNotesPrompt } from '../src/mux/live-mux/release-notes.ts';
import { handleReleaseNotesModalInput } from '../src/mux/live-mux/modal-release-notes-handler.ts';

const PROMPT: ReleaseNotesPrompt = {
  currentVersion: '1.0.0',
  latestTag: 'v1.0.2',
  releasesPageUrl: 'https://github.com/jmoyers/harness/releases',
  releases: [
    {
      tag: 'v1.0.2',
      name: 'latest',
      url: 'https://github.com/jmoyers/harness/releases/tag/v1.0.2',
      previewLines: ['line 1', 'line 2'],
      previewTruncated: false,
    },
  ],
};

void test('release notes modal handler short-circuits null prompt and ctrl+c passthrough', () => {
  const calls: string[] = [];
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('x', 'utf8'),
      prompt: null,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildReleaseNotesModalOverlay: () => ({ top: 10 }),
      setPrompt: () => {
        calls.push('set');
      },
      markDirty: () => {
        calls.push('dirty');
      },
      onDismiss: () => {
        calls.push('dismiss');
      },
      onNeverShowAgain: () => {
        calls.push('never');
      },
      onOpenLatest: () => {
        calls.push('open');
      },
      onUpdate: () => {
        calls.push('update');
      },
    }),
    false,
  );
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from([0x03]),
      prompt: PROMPT,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildReleaseNotesModalOverlay: () => ({ top: 10 }),
      setPrompt: () => {
        calls.push('set');
      },
      markDirty: () => {
        calls.push('dirty');
      },
      onDismiss: () => {
        calls.push('dismiss');
      },
      onNeverShowAgain: () => {
        calls.push('never');
      },
      onOpenLatest: () => {
        calls.push('open');
      },
      onUpdate: () => {
        calls.push('update');
      },
    }),
    false,
  );
  assert.deepEqual(calls, []);
});

void test('release notes modal handler supports quit dismiss outside-click and action keys', () => {
  const calls: string[] = [];
  let prompt: ReleaseNotesPrompt | null = PROMPT;
  const common = {
    setPrompt: (next: ReleaseNotesPrompt | null) => {
      prompt = next;
      calls.push(`set:${next === null ? 'null' : next.latestTag}`);
    },
    markDirty: () => {
      calls.push('dirty');
    },
    onDismiss: (latestTag: string) => {
      calls.push(`dismiss:${latestTag}`);
    },
    onNeverShowAgain: (latestTag: string) => {
      calls.push(`never:${latestTag}`);
    },
    onOpenLatest: (inputPrompt: ReleaseNotesPrompt) => {
      calls.push(`open:${inputPrompt.latestTag}`);
    },
    onUpdate: () => {
      calls.push('update');
    },
    buildReleaseNotesModalOverlay: () => ({ top: 10 }),
  };

  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('q', 'utf8'),
      prompt,
      isQuitShortcut: () => true,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(prompt, null);
  assert.deepEqual(calls, ['set:null', 'dismiss:v1.0.2', 'dirty']);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('\u001b[<0;1;1M', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
      ...common,
    }),
    true,
  );
  assert.equal(prompt, null);
  assert.deepEqual(calls, ['set:null', 'dismiss:v1.0.2', 'dirty']);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('\n', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(prompt, null);
  assert.deepEqual(calls, ['set:null', 'dismiss:v1.0.2', 'dirty']);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('N', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(prompt, null);
  assert.deepEqual(calls, ['set:null', 'never:v1.0.2', 'dirty']);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('u', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(prompt, null);
  assert.deepEqual(calls, ['set:null', 'dismiss:v1.0.2', 'update', 'dirty']);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('o', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(prompt, PROMPT);
  assert.deepEqual(calls, ['open:v1.0.2', 'dirty']);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from(
        `\u001b[<0;10;${10 + RELEASE_NOTES_UPDATE_ACTION_ROW_OFFSET + 1}M`,
        'utf8',
      ),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        return onInsidePointerPress?.(10, 10 + RELEASE_NOTES_UPDATE_ACTION_ROW_OFFSET + 1) ?? false;
      },
      ...common,
    }),
    true,
  );
  assert.equal(prompt, null);
  assert.deepEqual(calls, ['set:null', 'dismiss:v1.0.2', 'update', 'dirty']);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        return onInsidePointerPress?.(10, 10) ?? false;
      },
      ...common,
      buildReleaseNotesModalOverlay: () => null,
    }),
    true,
  );
  assert.equal(prompt, PROMPT);
  assert.deepEqual(calls, []);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        return onInsidePointerPress?.(10, 10) ?? false;
      },
      ...common,
      buildReleaseNotesModalOverlay: () => ({ top: 50 }),
    }),
    true,
  );
  assert.equal(prompt, PROMPT);
  assert.deepEqual(calls, []);

  calls.length = 0;
  prompt = PROMPT;
  assert.equal(
    handleReleaseNotesModalInput({
      input: Buffer.from('x', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(prompt, PROMPT);
  assert.deepEqual(calls, []);
});

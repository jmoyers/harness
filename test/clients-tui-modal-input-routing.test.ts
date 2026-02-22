import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createTuiModalInputRemainderState,
  routeTuiModalInput,
} from '../src/clients/tui/modal-input-routing.ts';

void test('modal input remainder state updates remainder from outside-click dismissal', () => {
  const state = createTuiModalInputRemainderState();
  state.setInputRemainder('carry');

  let dismissed = 0;
  const handled = state.dismissModalOnOutsideClick({
    modalManager: {
      dismissOnOutsideClick: (input) => {
        assert.equal(input.inputRemainder, 'carry');
        input.dismiss();
        return {
          handled: true,
          inputRemainder: 'next',
        };
      },
    },
    layoutCols: 120,
    viewportRows: 40,
    input: Buffer.from('x'),
    dismiss: () => {
      dismissed += 1;
    },
  });

  assert.equal(handled, true);
  assert.equal(dismissed, 1);
  assert.equal(state.getInputRemainder(), 'next');
});

void test('routeTuiModalInput prioritizes release notes routing before regular modal routing', () => {
  const calls: string[] = [];
  const handledByReleaseNotes = routeTuiModalInput({
    input: Buffer.from('a'),
    routeReleaseNotesModalInput: () => {
      calls.push('release');
      return true;
    },
    routeModalInput: () => {
      calls.push('modal');
      return true;
    },
  });

  assert.equal(handledByReleaseNotes, true);
  assert.deepEqual(calls, ['release']);

  calls.length = 0;
  const handledByModal = routeTuiModalInput({
    input: Buffer.from('b'),
    routeReleaseNotesModalInput: () => {
      calls.push('release');
      return false;
    },
    routeModalInput: () => {
      calls.push('modal');
      return true;
    },
  });

  assert.equal(handledByModal, true);
  assert.deepEqual(calls, ['release', 'modal']);
});

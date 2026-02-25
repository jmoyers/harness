import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../../packages/harness-ui/src/widget/widget.ts';
import { createTestPilot } from '../../../packages/harness-ui/src/testing/pilot.ts';
import { ConversationView } from '../../../packages/nim/src/ui/views/conversation-view.ts';

class RootWidget extends Widget {
  render(): void {}
}

function root(children: Widget[]): RootWidget {
  const value = new RootWidget('root');
  value.flexDirection = 'column';
  value.width = '100%';
  value.height = '100%';
  value.add(...children);
  return value;
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('nim conversation view', () => {
  test('renders markdown table and list content in assistant messages', () => {
    const conversation = new ConversationView();
    conversation.flexGrow = 1;
    conversation.messages = [
      {
        role: 'nim',
        text: [
          '# Query results',
          '- latest rows',
          '',
          '| Name | Value |',
          '| --- | --- |',
          '| Alpha | 100 |',
          '| Beta | 200 |',
        ].join('\n'),
        tools: [],
        ts: Date.now(),
        duration: 19,
      },
    ];

    const pilot = createTestPilot(root([conversation]), { cols: 80, rows: 20 });
    pilot.expectScreen().toContainRow('Query results');
    pilot.expectScreen().toContainRow('• latest rows');
    pilot.expectScreen().toContainRow('┌');
    pilot.expectScreen().toContainRow('Name');
    pilot.expectScreen().toContainRow('Alpha');
    pilot.expectScreen().toContainRow('▣ Build');
  });

  test('shows in-progress turn status and tool-call visuals', () => {
    const conversation = new ConversationView();
    conversation.flexGrow = 1;
    conversation.messages = [
      {
        role: 'nim',
        text: 'Collecting workspace state...',
        tools: [
          { id: 'tool-1', name: 'directory.list', args: '{"path":"."}', status: 'pending' },
          { id: 'tool-2', name: 'thread.list', args: '', status: 'done' },
        ],
        ts: Date.now(),
        pending: true,
        state: 'tool-calling',
      },
    ];

    const pilot = createTestPilot(root([conversation]), { cols: 90, rows: 22 });
    pilot.expectScreen().toContainRow('running tools');
    pilot.expectScreen().toContainRow('1/2 complete');
    pilot.expectScreen().toContainRow('directory.list');
    pilot.expectScreen().toContainRow('thread.list');
    pilot.expectScreen().toContainRow('in progress');
    const rows = pilot.allRowText().filter((row) => row.includes('↳'));
    assert.equal(rows.length >= 2, true);
  });
});

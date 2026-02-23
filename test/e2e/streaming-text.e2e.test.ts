import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import {
  StreamingText,
  StreamingTextWidget,
} from '../../packages/harness-ui/src/widgets/streaming-text.ts';
import { createTestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';

class RootWidget extends Widget {
  render(): void {}
}
function root(children: Widget[]): RootWidget {
  const r = new RootWidget('root');
  r.flexDirection = 'column';
  r.add(...children);
  return r;
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('StreamingText rendering', () => {
  test('renders appended text', () => {
    const st = StreamingText({ id: 'st', flexGrow: 1 });
    st.append('hello');
    const pilot = createTestPilot(root([st]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('hello');
  });

  test('multiple appends accumulate', () => {
    const st = StreamingText({ id: 'st', flexGrow: 1 });
    st.append('hello ');
    st.append('world');
    const pilot = createTestPilot(root([st]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('hello world');
  });

  test('newlines create multiple rows', () => {
    const st = StreamingText({ id: 'st', flexGrow: 1 });
    st.append('line1\nline2\nline3');
    const pilot = createTestPilot(root([st]), { cols: 20, rows: 5 });
    pilot.expectRow(0).toContain('line1');
    pilot.expectRow(1).toContain('line2');
    pilot.expectRow(2).toContain('line3');
  });

  test('shows cursor while streaming', () => {
    const st = StreamingText({ id: 'st', flexGrow: 1 });
    st.append('abc');
    const pilot = createTestPilot(root([st]), { cols: 20, rows: 3 });
    pilot.expectCell(3, 0).toHaveStyle({ inverse: true });
  });

  test('hides cursor after finish', () => {
    const st = StreamingText({ id: 'st', flexGrow: 1 });
    st.append('abc');
    st.finish();
    const pilot = createTestPilot(root([st]), { cols: 20, rows: 3 });
    pilot.expectCell(3, 0).not.toHaveStyle({ inverse: true });
  });

  test('reset clears content', () => {
    const st = StreamingText({ id: 'st', flexGrow: 1 });
    st.append('old content');
    st.reset();
    const pilot = createTestPilot(root([st]), { cols: 20, rows: 3 });
    pilot.expectRow(0).not.toContain('old');
  });

  test('auto-scrolls to bottom when content exceeds viewport', () => {
    const st = StreamingText({ id: 'st', flexGrow: 1 });
    for (let i = 0; i < 20; i += 1) st.append(`line${i}\n`);
    const pilot = createTestPilot(root([st]), { cols: 20, rows: 5 });
    pilot.expectScreen().toContainRow('line19');
    pilot.expectScreen().not.toContainRow('line0');
  });
});

describe('StreamingText factory', () => {
  test('returns StreamingTextWidget', () => {
    const st = StreamingText({});
    if (!(st instanceof StreamingTextWidget)) throw new Error('should be StreamingTextWidget');
  });
});

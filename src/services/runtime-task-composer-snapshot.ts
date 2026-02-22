import type { TaskComposerBuffer } from '../mux/task-composer.ts';

export function snapshotTaskComposerBuffers(
  buffers: ReadonlyMap<string, TaskComposerBuffer>,
): ReadonlyMap<string, TaskComposerBuffer> {
  const snapshot = new Map<string, TaskComposerBuffer>();
  for (const [taskId, buffer] of buffers) {
    snapshot.set(taskId, {
      text: buffer.text,
      cursor: buffer.cursor,
    });
  }
  return snapshot;
}

interface RecordingWriter {
  close(): Promise<void>;
}

interface RenderTerminalRecordingToGifInput {
  readonly recordingPath: string;
  readonly outputPath: string;
}

export interface RecordingServiceOptions {
  readonly recordingWriter: RecordingWriter | null;
  readonly recordingPath: string | null;
  readonly recordingGifOutputPath: string | null;
  readonly renderTerminalRecordingToGif: (
    input: RenderTerminalRecordingToGifInput,
  ) => Promise<unknown>;
  readonly writeStderr: (text: string) => void;
}

export interface RecordingService {
  closeWriter(): Promise<unknown | null>;
  finalizeAfterShutdown(recordingCloseError: unknown | null): Promise<void>;
}

export function createRecordingService(options: RecordingServiceOptions): RecordingService {
  function formatCloseError(recordingCloseError: unknown): string {
    if (recordingCloseError instanceof Error) {
      return recordingCloseError.message;
    }
    if (typeof recordingCloseError === 'string') {
      return recordingCloseError;
    }
    return 'unknown error';
  }

  async function closeWriter(): Promise<unknown | null> {
    if (options.recordingWriter === null) {
      return null;
    }
    try {
      await options.recordingWriter.close();
      return null;
    } catch (error: unknown) {
      return error;
    }
  }

  async function finalizeAfterShutdown(recordingCloseError: unknown | null): Promise<void> {
    if (
      options.recordingGifOutputPath !== null &&
      options.recordingPath !== null &&
      recordingCloseError === null
    ) {
      try {
        await options.renderTerminalRecordingToGif({
          recordingPath: options.recordingPath,
          outputPath: options.recordingGifOutputPath,
        });
        options.writeStderr(
          `[mux-recording] jsonl=${options.recordingPath} gif=${options.recordingGifOutputPath}\n`,
        );
      } catch (error: unknown) {
        options.writeStderr(
          `[mux-recording] gif-export-failed ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
      return;
    }

    if (recordingCloseError !== null) {
      options.writeStderr(
        `[mux-recording] close-failed ${formatCloseError(recordingCloseError)}\n`,
      );
    }
  }

  return {
    closeWriter,
    finalizeAfterShutdown,
  };
}

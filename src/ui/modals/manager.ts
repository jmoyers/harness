import {
  buildAddDirectoryModalOverlay as buildAddDirectoryModalOverlayFrame,
  buildConversationTitleModalOverlay as buildConversationTitleModalOverlayFrame,
  buildNewThreadModalOverlay as buildNewThreadModalOverlayFrame,
  buildRepositoryModalOverlay as buildRepositoryModalOverlayFrame,
  buildTaskEditorModalOverlay as buildTaskEditorModalOverlayFrame,
} from '../../mux/live-mux/modal-overlays.ts';
import { dismissModalOnOutsideClick as dismissModalOnOutsideClickFrame } from '../../mux/live-mux/modal-pointer.ts';
import type { createNewThreadPromptState } from '../../mux/new-thread-prompt.ts';
import type {
  ConversationTitleEditState,
  RepositoryPromptState,
  TaskEditorPromptState,
} from '../../domain/workspace.ts';
import { isUiModalOverlayHit } from '../kit.ts';

type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type AddDirectoryPromptState = { value: string; error: string | null };
type ModalOverlay = Exclude<ReturnType<typeof buildNewThreadModalOverlayFrame>, null>;
type ModalTheme = Parameters<typeof buildNewThreadModalOverlayFrame>[3];
type DismissModalOnOutsideClickInput = Parameters<typeof dismissModalOnOutsideClickFrame>[0];

interface ModalManagerOptions {
  readonly theme: ModalTheme;
  readonly resolveRepositoryName: (repositoryId: string) => string | null;
  readonly getNewThreadPrompt: () => NewThreadPromptState | null;
  readonly getAddDirectoryPrompt: () => AddDirectoryPromptState | null;
  readonly getTaskEditorPrompt: () => TaskEditorPromptState | null;
  readonly getRepositoryPrompt: () => RepositoryPromptState | null;
  readonly getConversationTitleEdit: () => ConversationTitleEditState | null;
}

interface ModalManagerDependencies {
  readonly buildNewThreadModalOverlay?: typeof buildNewThreadModalOverlayFrame;
  readonly buildAddDirectoryModalOverlay?: typeof buildAddDirectoryModalOverlayFrame;
  readonly buildTaskEditorModalOverlay?: typeof buildTaskEditorModalOverlayFrame;
  readonly buildRepositoryModalOverlay?: typeof buildRepositoryModalOverlayFrame;
  readonly buildConversationTitleModalOverlay?: typeof buildConversationTitleModalOverlayFrame;
  readonly dismissModalOnOutsideClick?: typeof dismissModalOnOutsideClickFrame;
  readonly isOverlayHit?: typeof isUiModalOverlayHit;
}

interface ModalDismissInput {
  readonly input: Buffer;
  readonly inputRemainder: string;
  readonly layoutCols: number;
  readonly viewportRows: number;
  readonly dismiss: () => void;
  readonly onInsidePointerPress?: (col: number, row: number) => boolean;
}

interface ModalDismissResult {
  readonly handled: boolean;
  readonly inputRemainder: string;
}

export class ModalManager {
  private readonly buildNewThreadModalOverlay: typeof buildNewThreadModalOverlayFrame;
  private readonly buildAddDirectoryModalOverlay: typeof buildAddDirectoryModalOverlayFrame;
  private readonly buildTaskEditorModalOverlay: typeof buildTaskEditorModalOverlayFrame;
  private readonly buildRepositoryModalOverlay: typeof buildRepositoryModalOverlayFrame;
  private readonly buildConversationTitleModalOverlay: typeof buildConversationTitleModalOverlayFrame;
  private readonly dismissModalOnOutsideClick: typeof dismissModalOnOutsideClickFrame;
  private readonly isOverlayHit: typeof isUiModalOverlayHit;

  constructor(
    private readonly options: ModalManagerOptions,
    dependencies: ModalManagerDependencies = {},
  ) {
    this.buildNewThreadModalOverlay =
      dependencies.buildNewThreadModalOverlay ?? buildNewThreadModalOverlayFrame;
    this.buildAddDirectoryModalOverlay =
      dependencies.buildAddDirectoryModalOverlay ?? buildAddDirectoryModalOverlayFrame;
    this.buildTaskEditorModalOverlay =
      dependencies.buildTaskEditorModalOverlay ?? buildTaskEditorModalOverlayFrame;
    this.buildRepositoryModalOverlay =
      dependencies.buildRepositoryModalOverlay ?? buildRepositoryModalOverlayFrame;
    this.buildConversationTitleModalOverlay =
      dependencies.buildConversationTitleModalOverlay ?? buildConversationTitleModalOverlayFrame;
    this.dismissModalOnOutsideClick =
      dependencies.dismissModalOnOutsideClick ?? dismissModalOnOutsideClickFrame;
    this.isOverlayHit = dependencies.isOverlayHit ?? isUiModalOverlayHit;
  }

  buildNewThreadOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.buildNewThreadModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getNewThreadPrompt(),
      this.options.theme,
    );
  }

  buildAddDirectoryOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.buildAddDirectoryModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getAddDirectoryPrompt(),
      this.options.theme,
    );
  }

  buildTaskEditorOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.buildTaskEditorModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getTaskEditorPrompt(),
      this.options.resolveRepositoryName,
      this.options.theme,
    );
  }

  buildRepositoryOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.buildRepositoryModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getRepositoryPrompt(),
      this.options.theme,
    );
  }

  buildConversationTitleOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.buildConversationTitleModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getConversationTitleEdit(),
      this.options.theme,
    );
  }

  buildCurrentOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    const newThreadOverlay = this.buildNewThreadOverlay(layoutCols, viewportRows);
    if (newThreadOverlay !== null) {
      return newThreadOverlay;
    }
    const addDirectoryOverlay = this.buildAddDirectoryOverlay(layoutCols, viewportRows);
    if (addDirectoryOverlay !== null) {
      return addDirectoryOverlay;
    }
    const taskEditorOverlay = this.buildTaskEditorOverlay(layoutCols, viewportRows);
    if (taskEditorOverlay !== null) {
      return taskEditorOverlay;
    }
    const repositoryOverlay = this.buildRepositoryOverlay(layoutCols, viewportRows);
    if (repositoryOverlay !== null) {
      return repositoryOverlay;
    }
    return this.buildConversationTitleOverlay(layoutCols, viewportRows);
  }

  dismissOnOutsideClick(input: ModalDismissInput): ModalDismissResult {
    const dismissInput: DismissModalOnOutsideClickInput = {
      input: input.input,
      inputRemainder: input.inputRemainder,
      dismiss: input.dismiss,
      buildCurrentModalOverlay: () => this.buildCurrentOverlay(input.layoutCols, input.viewportRows),
      isOverlayHit: this.isOverlayHit,
      ...(input.onInsidePointerPress === undefined
        ? {}
        : {
            onInsidePointerPress: input.onInsidePointerPress,
          }),
    };
    return this.dismissModalOnOutsideClick(dismissInput);
  }
}

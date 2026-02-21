import type { UiModalOverlay, UiModalTheme } from './kit.ts';
import type {
  ApiKeyPromptState,
  CommandMenuActionDescriptor,
  CommandMenuState,
  ConversationTitleEditState,
  NewThreadPromptState,
  RepositoryPromptState,
  TaskEditorPromptState,
} from './interaction/input.ts';

type AddDirectoryPromptState = { value: string; error: string | null };
type ModalOverlay = UiModalOverlay;
type ModalTheme = Partial<UiModalTheme>;

interface ModalManagerOptions {
  readonly theme: ModalTheme;
  readonly resolveRepositoryName: (repositoryId: string) => string | null;
  readonly getCommandMenu: () => CommandMenuState | null;
  readonly resolveCommandMenuActions: () => readonly CommandMenuActionDescriptor[];
  readonly getNewThreadPrompt: () => NewThreadPromptState | null;
  readonly getAddDirectoryPrompt: () => AddDirectoryPromptState | null;
  readonly getApiKeyPrompt?: () => ApiKeyPromptState | null;
  readonly getTaskEditorPrompt: () => TaskEditorPromptState | null;
  readonly getRepositoryPrompt: () => RepositoryPromptState | null;
  readonly getConversationTitleEdit: () => ConversationTitleEditState | null;
}

export interface ModalDismissOnOutsideClickInput {
  readonly input: Buffer;
  readonly inputRemainder: string;
  readonly dismiss: () => void;
  readonly buildCurrentModalOverlay: () => ModalOverlay | null;
  readonly onInsidePointerPress?: (col: number, row: number) => boolean;
  readonly isOverlayHit: (overlay: ModalOverlay, col: number, row: number) => boolean;
}

export interface ModalDismissOnOutsideClickResult {
  readonly handled: boolean;
  readonly inputRemainder: string;
}

export interface ModalManagerStrategies {
  buildCommandMenuModalOverlay(
    layoutCols: number,
    viewportRows: number,
    menu: CommandMenuState | null,
    actions: readonly CommandMenuActionDescriptor[],
    theme: ModalTheme,
  ): ModalOverlay | null;
  buildNewThreadModalOverlay(
    layoutCols: number,
    viewportRows: number,
    prompt: NewThreadPromptState | null,
    theme: ModalTheme,
  ): ModalOverlay | null;
  buildAddDirectoryModalOverlay(
    layoutCols: number,
    viewportRows: number,
    prompt: AddDirectoryPromptState | null,
    theme: ModalTheme,
  ): ModalOverlay | null;
  buildTaskEditorModalOverlay(
    layoutCols: number,
    viewportRows: number,
    prompt: TaskEditorPromptState | null,
    resolveRepositoryName: (repositoryId: string) => string | null,
    theme: ModalTheme,
  ): ModalOverlay | null;
  buildApiKeyModalOverlay(
    layoutCols: number,
    viewportRows: number,
    prompt: ApiKeyPromptState | null,
    theme: ModalTheme,
  ): ModalOverlay | null;
  buildRepositoryModalOverlay(
    layoutCols: number,
    viewportRows: number,
    prompt: RepositoryPromptState | null,
    theme: ModalTheme,
  ): ModalOverlay | null;
  buildConversationTitleModalOverlay(
    layoutCols: number,
    viewportRows: number,
    edit: ConversationTitleEditState | null,
    theme: ModalTheme,
  ): ModalOverlay | null;
  dismissModalOnOutsideClick(
    input: ModalDismissOnOutsideClickInput,
  ): ModalDismissOnOutsideClickResult;
  isOverlayHit(overlay: ModalOverlay, col: number, row: number): boolean;
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
  constructor(
    private readonly options: ModalManagerOptions,
    private readonly strategies: ModalManagerStrategies,
  ) {}

  buildCommandMenuOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.strategies.buildCommandMenuModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getCommandMenu(),
      this.options.resolveCommandMenuActions(),
      this.options.theme,
    );
  }

  buildNewThreadOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.strategies.buildNewThreadModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getNewThreadPrompt(),
      this.options.theme,
    );
  }

  buildAddDirectoryOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.strategies.buildAddDirectoryModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getAddDirectoryPrompt(),
      this.options.theme,
    );
  }

  buildTaskEditorOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.strategies.buildTaskEditorModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getTaskEditorPrompt(),
      this.options.resolveRepositoryName,
      this.options.theme,
    );
  }

  buildApiKeyOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.strategies.buildApiKeyModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getApiKeyPrompt?.() ?? null,
      this.options.theme,
    );
  }

  buildRepositoryOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.strategies.buildRepositoryModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getRepositoryPrompt(),
      this.options.theme,
    );
  }

  buildConversationTitleOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    return this.strategies.buildConversationTitleModalOverlay(
      layoutCols,
      viewportRows,
      this.options.getConversationTitleEdit(),
      this.options.theme,
    );
  }

  buildCurrentOverlay(layoutCols: number, viewportRows: number): ModalOverlay | null {
    const commandMenuOverlay = this.buildCommandMenuOverlay(layoutCols, viewportRows);
    if (commandMenuOverlay !== null) {
      return commandMenuOverlay;
    }
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
    const apiKeyOverlay = this.buildApiKeyOverlay(layoutCols, viewportRows);
    if (apiKeyOverlay !== null) {
      return apiKeyOverlay;
    }
    const repositoryOverlay = this.buildRepositoryOverlay(layoutCols, viewportRows);
    if (repositoryOverlay !== null) {
      return repositoryOverlay;
    }
    return this.buildConversationTitleOverlay(layoutCols, viewportRows);
  }

  dismissOnOutsideClick(input: ModalDismissInput): ModalDismissResult {
    return this.strategies.dismissModalOnOutsideClick({
      input: input.input,
      inputRemainder: input.inputRemainder,
      dismiss: input.dismiss,
      buildCurrentModalOverlay: () =>
        this.buildCurrentOverlay(input.layoutCols, input.viewportRows),
      isOverlayHit: this.strategies.isOverlayHit,
      ...(input.onInsidePointerPress === undefined
        ? {}
        : {
            onInsidePointerPress: input.onInsidePointerPress,
          }),
    });
  }
}

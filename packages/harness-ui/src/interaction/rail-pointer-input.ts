export interface HandlePointerClickInput {
  readonly clickEligible: boolean;
  readonly paneRows: number;
  readonly leftCols: number;
  readonly pointerRow: number;
  readonly pointerCol: number;
}

export interface RailPointerHitResolver<THit> {
  resolveHit(rowIndex: number, colIndex: number, railCols: number): THit | null;
}

export interface RailPointerHitDispatcher<THit> {
  dispatchHit(hit: THit): boolean;
}

export interface RailPointerEditController<THit> {
  hasActiveEdit(): boolean;
  shouldKeepActiveEdit(hit: THit): boolean;
  stopActiveEdit(): void;
}

export interface RailPointerSelectionController {
  hasSelection(): boolean;
  clearSelection(): void;
}

export class RailPointerInput<THit> {
  constructor(
    private readonly hitResolver: RailPointerHitResolver<THit>,
    private readonly hitDispatcher: RailPointerHitDispatcher<THit>,
    private readonly editController: RailPointerEditController<THit> | null = null,
    private readonly selectionController: RailPointerSelectionController | null = null,
  ) {}

  handlePointerClick(input: HandlePointerClickInput): boolean {
    if (!input.clickEligible) {
      return false;
    }

    const rowIndex = Math.max(0, Math.min(input.paneRows - 1, input.pointerRow - 1));
    const colIndex = Math.max(0, Math.min(input.leftCols - 1, input.pointerCol - 1));
    const hit = this.hitResolver.resolveHit(rowIndex, colIndex, input.leftCols);
    if (hit === null) {
      return false;
    }

    if (
      this.editController !== null &&
      this.editController.hasActiveEdit() &&
      !this.editController.shouldKeepActiveEdit(hit)
    ) {
      this.editController.stopActiveEdit();
    }

    if (this.selectionController !== null && this.selectionController.hasSelection()) {
      this.selectionController.clearSelection();
    }

    return this.hitDispatcher.dispatchHit(hit);
  }
}

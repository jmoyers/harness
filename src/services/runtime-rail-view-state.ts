export class RuntimeRailViewState<TRailViewRows> {
  private latestRows: TRailViewRows;

  constructor(initialRows: TRailViewRows) {
    this.latestRows = initialRows;
  }

  readLatestRows(): TRailViewRows {
    return this.latestRows;
  }

  setLatestRows(rows: TRailViewRows): void {
    this.latestRows = rows;
  }
}

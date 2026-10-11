export class RenderState {
  private values: (number | string | undefined)[] = [];
  private cursor = 0;
  private changed = true;
  begin() { this.cursor = 0; }
  add(...values: (number | string | undefined)[]) {
    for (const value of values) {
      if (this.values[this.cursor] !== value) this.changed = true;
      this.values[this.cursor++] = value;
    }
  }
  floats(...values: (number | undefined)[]) {
    this.add(...values.map(value => value === undefined ? undefined : Math.fround(value)));
  }
  end() {
    const changed = this.changed || this.values.length !== this.cursor;
    this.values.length = this.cursor;
    this.changed = false;
    return changed;
  }
  invalidate() { this.changed = true; }
}

export class ToggleSet<T> extends Set<T> {
  public toggle(key: T) {
    if (this.has(key)) {
      this.delete(key);
    } else {
      this.add(key);
    }

    return this;
  }
}

type Listener<T> = (...args: T[]) => void;

export class Binding<T> {
  private readonly listeners: Set<Listener<T>> = new Set();

  public register(callback: (value: T) => void) {
    this.listeners.add(callback);
  }

  public unregister(callback: (value: T) => void) {
    this.listeners.delete(callback);
  }

  public update(value: T) {
    this.listeners.forEach(listener => listener(value));
  }

  public clear() {
    this.listeners.clear();
  }
}

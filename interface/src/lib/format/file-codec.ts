/**
 * Turns the text of a file into the value the rest of the interface works
 * with, and back. The editor keeps every file it edits with one; the formats
 * of topologies, annotations and plain text implement it.
 */
export interface FileCodec<T> {
  // Reads the text, null if it isn't valid
  parse(text: string): T | null;

  serialize(value: T): string;

  /**
   * The text as the server stores it, e.g. reformatted JSON. Two texts with the
   * same normalized form are the same saved version. Defaults to the text.
   */
  normalize?(text: string): string;
}

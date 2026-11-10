const STORAGE_PREFIX = 'sb:editor-draft:';

// Drafts are written this long after the last change, so typing doesn't write on every key
const SAVE_DELAY = 500;

/**
 * The unsaved texts of a document, by the ID of the file, and a hash of the
 * saved version they were made on.
 */
export interface Draft {
  baseHash: string;
  texts: Record<string, string>;
}

/**
 * Keeps the unsaved changes of documents in the local storage of the browser,
 * so they survive a reload. Drafts are kept per user, since a browser can be
 * shared.
 */
export class DraftStorage {
  private readonly prefix: string;
  private readonly pending = new Map<
    string,
    {timeout: ReturnType<typeof setTimeout>; draft: () => Draft}
  >();

  constructor(userId: string) {
    this.prefix = `${STORAGE_PREFIX}${userId}:`;
  }

  public load(documentId: string): Draft | null {
    try {
      const stored = localStorage.getItem(this.prefix + documentId);
      if (stored === null) return null;

      const draft = JSON.parse(stored) as Draft;
      if (typeof draft?.baseHash !== 'string' || !draft.texts) return null;

      return draft;
    } catch {
      return null;
    }
  }

  /**
   * Writes the draft of a document after a short delay. A later call for the
   * same document replaces the pending one.
   */
  public saveDebounced(documentId: string, draft: () => Draft) {
    clearTimeout(this.pending.get(documentId)?.timeout);

    this.pending.set(documentId, {
      timeout: setTimeout(() => {
        this.pending.delete(documentId);
        this.write(documentId, draft());
      }, SAVE_DELAY),
      draft,
    });
  }

  // Writes all drafts that are waiting, e.g. before the page is left
  public flush() {
    for (const [documentId, {timeout, draft}] of this.pending) {
      clearTimeout(timeout);
      this.write(documentId, draft());
    }

    this.pending.clear();
  }

  public delete(documentId: string) {
    clearTimeout(this.pending.get(documentId)?.timeout);
    this.pending.delete(documentId);

    try {
      localStorage.removeItem(this.prefix + documentId);
    } catch {
      // Storage blocked, there is nothing to delete
    }
  }

  // The IDs of all documents with a draft
  public documentIds(): string[] {
    const ids: string[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.prefix))
          ids.push(key.slice(this.prefix.length));
      }
    } catch {
      // Storage blocked, there are no drafts
    }

    return ids;
  }

  private write(documentId: string, draft: Draft) {
    try {
      localStorage.setItem(this.prefix + documentId, JSON.stringify(draft));
    } catch {
      // Storage full or blocked: the changes are still kept while the page is open
    }
  }
}

/**
 * A short hash of the saved texts of a document, so a draft can tell whether it
 * was made on the version that is saved now.
 */
export function hashTexts(texts: readonly string[]): string {
  // FNV-1a over all texts, with a separator so ["ab", ""] and ["a", "b"] differ
  let hash = 0x811c9dc5;

  for (const text of texts) {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }

  return (
    (hash >>> 0).toString(16) + ':' + texts.reduce((n, t) => n + t.length, 0)
  );
}

import {action, computed, observable} from 'mobx';

// Consecutive changes with the same merge key are merged into one entry within this interval
const MERGE_INTERVAL = 1000;

const MAX_ENTRIES = 100;

export interface HistorySelection {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

// The selected elements of the graph by their IDs
export interface GraphSelectionSnapshot {
  nodeIds: string[];
  groupIds: string[];
  shapeIds: string[];
  textIds: string[];
}

/**
 * The content of all files of a document after a change, by the ID of the file.
 */
export interface EditHistoryEntry {
  texts: Readonly<Record<string, string>>;

  // The ID of the file that was changed and its selections after the change
  file: string;
  selections: HistorySelection[] | null;

  // The selection of the graph before and after a change of the graph, restored by undo and redo
  graphSelectionBefore?: GraphSelectionSnapshot;
  graphSelectionAfter?: GraphSelectionSnapshot;
}

/**
 * The undo history of a document. It holds the raw text of all of its files, so
 * a change that touches several files is undone in one step, and states that
 * don't pass validation can be restored as well.
 */
export class EditHistory {
  @observable accessor position: number = 0;
  @observable accessor length: number = 0;

  private entries: EditHistoryEntry[] = [];

  // Merge key and time of the last entry that further changes can be merged into
  private lastMerge: {key: string; time: number} | null = null;

  @computed
  public get canUndo() {
    return this.position > 0;
  }

  @computed
  public get canRedo() {
    return this.position < this.length - 1;
  }

  @action
  public reset(entry: EditHistoryEntry) {
    this.entries = [entry];
    this.lastMerge = null;
    this.update(0);
  }

  /**
   * Adds an entry after the current one and drops all entries that could be
   * redone.
   *
   * @param entry The content of the files after the change.
   * @param mergeKey Merges the change with a change with the same key right
   * before, e.g. typing in the same file. Null if it is never merged.
   */
  @action
  public record(entry: EditHistoryEntry, mergeKey: string | null) {
    this.entries.splice(this.position + 1);

    const now = Date.now();
    const canMerge =
      mergeKey !== null &&
      this.lastMerge?.key === mergeKey &&
      now - this.lastMerge.time < MERGE_INTERVAL;

    if (canMerge) {
      this.entries[this.position] = {
        ...entry,
        graphSelectionBefore: this.entries[this.position].graphSelectionBefore,
      };
    } else {
      this.entries.push(entry);
    }

    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    this.lastMerge = mergeKey !== null ? {key: mergeKey, time: now} : null;
    this.update(this.entries.length - 1);
  }

  /**
   * Steps back one entry. Returns the entry to restore, the file of the change
   * that was undone and the selection of the graph before it, or null if there
   * is nothing to undo.
   *
   * @param graphSelection The current selection of the graph, restored by redo.
   */
  @action
  public undo(graphSelection?: GraphSelectionSnapshot): {
    entry: EditHistoryEntry;
    file: string;
    graphSelection?: GraphSelectionSnapshot;
  } | null {
    if (!this.canUndo) return null;

    const undone = this.entries[this.position];
    if (undone.graphSelectionBefore) {
      undone.graphSelectionAfter = graphSelection;
    }

    this.lastMerge = null;
    this.update(this.position - 1);

    return {
      entry: this.entries[this.position],
      file: undone.file,
      graphSelection: undone.graphSelectionBefore,
    };
  }

  /**
   * Steps forward one entry. Returns the entry to restore, the file of the
   * change that was redone and the selection of the graph after it, or null if
   * there is nothing to redo.
   */
  @action
  public redo(): {
    entry: EditHistoryEntry;
    file: string;
    graphSelection?: GraphSelectionSnapshot;
  } | null {
    if (!this.canRedo) return null;

    this.lastMerge = null;
    this.update(this.position + 1);

    const entry = this.entries[this.position];
    return {entry, file: entry.file, graphSelection: entry.graphSelectionAfter};
  }

  private update(position: number) {
    this.position = position;
    this.length = this.entries.length;
  }
}

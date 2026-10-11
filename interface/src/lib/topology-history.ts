import {action, computed, observable} from 'mobx';

import {TopologyFileType} from '@sb/types/domain/topology';

// Consecutive typing in the same file is merged into one entry within this interval
const MERGE_INTERVAL = 1000;

const MAX_ENTRIES = 100;

export interface HistorySelection {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}

/**
 * The content of both files of a topology after a change.
 */
export interface TopologyHistoryEntry {
  definition: string;
  annotations: string;

  // The file that was changed and its selections after the change
  file: TopologyFileType;
  selections: HistorySelection[] | null;
}

/**
 * The undo history of a topology. Contrary to the topology manager, it holds the
 * raw content of the files, so states that don't pass validation can be restored
 * as well.
 */
export class TopologyHistory {
  @observable accessor position: number = 0;
  @observable accessor length: number = 0;

  private entries: TopologyHistoryEntry[] = [];

  // File and time of the last entry that further typing can be merged into
  private lastTyping: {file: TopologyFileType; time: number} | null = null;

  @computed
  public get canUndo() {
    return this.position > 0;
  }

  @computed
  public get canRedo() {
    return this.position < this.length - 1;
  }

  @action
  public reset(entry: TopologyHistoryEntry) {
    this.entries = [entry];
    this.lastTyping = null;
    this.update(0);
  }

  /**
   * Adds an entry after the current one and drops all entries that could be
   * redone.
   *
   * @param entry The content of the files after the change.
   * @param isTyping Whether the change was typed, which merges it with typing
   * in the same file right before.
   */
  @action
  public record(entry: TopologyHistoryEntry, isTyping: boolean) {
    this.entries.splice(this.position + 1);

    const now = Date.now();
    const canMerge =
      isTyping &&
      this.lastTyping?.file === entry.file &&
      now - this.lastTyping.time < MERGE_INTERVAL;

    if (canMerge) {
      this.entries[this.position] = entry;
    } else {
      this.entries.push(entry);
    }

    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    this.lastTyping = isTyping ? {file: entry.file, time: now} : null;
    this.update(this.entries.length - 1);
  }

  /**
   * Steps back one entry. Returns the entry to restore and the file of the change
   * that was undone, or null if there is nothing to undo.
   */
  @action
  public undo(): {entry: TopologyHistoryEntry; file: TopologyFileType} | null {
    if (!this.canUndo) return null;

    const undoneFile = this.entries[this.position].file;

    this.lastTyping = null;
    this.update(this.position - 1);

    return {entry: this.entries[this.position], file: undoneFile};
  }

  /**
   * Steps forward one entry. Returns the entry to restore and the file of the
   * change that was redone, or null if there is nothing to redo.
   */
  @action
  public redo(): {entry: TopologyHistoryEntry; file: TopologyFileType} | null {
    if (!this.canRedo) return null;

    this.lastTyping = null;
    this.update(this.position + 1);

    const entry = this.entries[this.position];
    return {entry, file: entry.file};
  }

  private update(position: number) {
    this.position = position;
    this.length = this.entries.length;
  }
}

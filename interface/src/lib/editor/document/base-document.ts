import {action, IReactionDisposer, observable, reaction} from 'mobx';

import {
  DocumentCapabilities,
  DocumentFile,
  EditorDocument,
  GraphSelectionProvider,
  RestoredChange,
  TextSelectionProvider,
} from '@sb/lib/editor/document/editor-document';
import {DraftStorage, hashTexts} from '@sb/lib/editor/draft-storage';
import {
  EditHistory,
  EditHistoryEntry,
  GraphSelectionSnapshot,
} from '@sb/lib/editor/edit-history';
import {
  FileBuffer,
  FileChange,
  FileEditSource,
} from '@sb/lib/editor/file-buffer';
import {GraphModel} from '@sb/lib/editor/graph-model';
import {Result} from '@sb/types/result';

/**
 * What all documents share: the history of their editable files, drafts, and
 * following the saved version in the store.
 *
 * The getters aren't computed values: MobX can't combine computed values of a
 * base class and its subclass with the decorators of this project, and they are
 * cheap. They still read observables, so observers follow them.
 */
export abstract class BaseDocument implements EditorDocument {
  public abstract readonly id: string;
  public abstract readonly topologyId: string;
  public abstract readonly title: string;
  public abstract readonly subtitle: string;
  public abstract readonly icon: string;
  public abstract readonly capabilities: DocumentCapabilities;
  public abstract readonly files: readonly DocumentFile[];
  public abstract readonly graph: GraphModel | null;

  public readonly history = new EditHistory();

  @observable accessor activeFileId: string = '';
  @observable accessor hasConflict: boolean = false;

  protected readonly drafts: DraftStorage;

  // The editable files by their ID, set by the subclass with init()
  protected buffers = new Map<string, FileBuffer<unknown>>();

  private textSelections: TextSelectionProvider | null = null;
  private graphSelections: GraphSelectionProvider | null = null;

  // Set while a change of several files is applied, which is recorded once
  private transaction: {changed: string[]} | null = null;

  private readonly disposers: IReactionDisposer[] = [];
  private readonly listeners = new Map<
    FileBuffer<unknown>,
    (change: FileChange) => void
  >();

  // Set while the document is saved, the store changes with it
  private isSaving = false;

  protected constructor(drafts: DraftStorage) {
    this.drafts = drafts;
  }

  public get activeFile(): DocumentFile {
    return (
      this.files.find(file => file.id === this.activeFileId) ?? this.files[0]
    );
  }

  public get isEdited(): boolean {
    return this.hasEditedBuffer();
  }

  public get isValid(): boolean {
    return [...this.buffers.values()].every(buffer => buffer.isValid);
  }

  public get isParsing(): boolean {
    return [...this.buffers.values()].some(buffer => buffer.isParsing);
  }

  @action
  public selectFile(fileId: string) {
    if (this.files.some(file => file.id === fileId)) {
      this.activeFileId = fileId;
    }
  }

  public setSelectionProviders(
    text: TextSelectionProvider | null,
    graph: GraphSelectionProvider | null,
  ) {
    this.textSelections = text;
    this.graphSelections = graph;
  }

  @action
  public replaceText(fileId: string, text: string) {
    this.edit(() => {
      this.buffers.get(fileId)?.setText(text, FileEditSource.Structured);
    });
  }

  /**
   * Applies a change of one or more files as one entry in the history.
   *
   * @param change Changes the buffers of the files.
   * @param mergeKey Merges the change with the change right before with the same key.
   */
  @action
  public edit(change: () => void, mergeKey?: string) {
    if (this.transaction) {
      change();
      return;
    }

    const graphSelectionBefore = this.graphSelections?.();
    this.transaction = {changed: []};

    try {
      change();
    } finally {
      const {changed} = this.transaction;
      this.transaction = null;

      // The change is shown in the file that is open if it changed, so undo doesn't switch files
      if (changed.length > 0) {
        const file = changed.includes(this.activeFileId)
          ? this.activeFileId
          : changed[0];

        this.record(file, mergeKey ?? null, {
          graphSelectionBefore,
        });
      }
    }
  }

  @action
  public undo(graphSelection?: GraphSelectionSnapshot): RestoredChange | null {
    const undone = this.history.undo(graphSelection);
    if (!undone) return null;

    this.applyEntry(undone.entry);

    return {
      file: undone.file,
      selections:
        undone.entry.file === undone.file ? undone.entry.selections : null,
      graphSelection: undone.graphSelection,
    };
  }

  @action
  public redo(): RestoredChange | null {
    const redone = this.history.redo();
    if (!redone) return null;

    this.applyEntry(redone.entry);

    return {
      file: redone.file,
      selections: redone.entry.selections,
      graphSelection: redone.graphSelection,
    };
  }

  public async save(): Promise<Result<void>> {
    for (const buffer of this.buffers.values()) buffer.parse();
    if (!this.isValid) {
      return Result.createErr({code: -1, message: 'The file is not valid.'});
    }

    this.isSaving = true;
    let sent: Record<string, string>;
    try {
      const sending = this.send();

      // The texts as they are sent, what's typed while the request runs is still unsaved
      sent = this.texts();

      const result = await sending;
      if (result.isErr()) return result;
    } finally {
      this.isSaving = false;
    }

    this.afterSave(sent);
    return Result.createOk(undefined);
  }

  @action
  public revert() {
    const saved = this.storedTexts();
    if (!saved) return;

    for (const [fileId, buffer] of this.buffers) {
      buffer.reset(saved[fileId]);
    }

    this.hasConflict = false;
    this.drafts.delete(this.id);
    this.history.reset(this.entry(this.activeFile.id));
  }

  @action
  public keepChanges() {
    const saved = this.storedTexts();
    if (!saved) return;

    for (const [fileId, buffer] of this.buffers) {
      buffer.markSaved(saved[fileId]);
    }

    this.hasConflict = false;
    this.updateDraft();
  }

  public dispose() {
    this.disposers.forEach(dispose => dispose());

    for (const [buffer, listener] of this.listeners) {
      buffer.onChange.unregister(listener);
      buffer.dispose();
    }

    this.listeners.clear();
  }

  /**
   * The saved texts of the editable files as the store holds them, by the ID
   * of the file. Null if the document no longer exists.
   */
  protected abstract storedTexts(): Record<string, string> | null;

  // Sends the editable files to the server
  protected abstract send(): Promise<Result<unknown>>;

  /**
   * Sets up the editable files. Their texts start at the draft if it was made
   * on the saved version; a draft made on an older version is restored as a
   * conflict.
   */
  @action
  protected init(
    createBuffers: (
      saved: Record<string, string>,
      start: Record<string, string>,
    ) => Map<string, FileBuffer<unknown>>,
  ) {
    const saved = this.storedTexts() ?? {};
    const draft = this.drafts.load(this.id);
    const draftTexts =
      draft && this.matchesFiles(draft.texts, saved) ? draft : null;

    this.buffers = createBuffers(saved, draftTexts?.texts ?? saved);
    this.activeFileId = this.files[0].id;

    if (draftTexts && draftTexts.baseHash !== this.hash(saved)) {
      this.hasConflict = true;
    }
    // Computed values aren't set up yet while the document is constructed
    if (!this.hasEditedBuffer()) this.drafts.delete(this.id);

    for (const [fileId, buffer] of this.buffers) {
      const listener = (change: FileChange) =>
        this.onBufferChange(fileId, change);
      buffer.onChange.register(listener);
      this.listeners.set(buffer, listener);
    }

    this.history.reset(this.entry(this.activeFileId));

    // A newer version saved somewhere else replaces the files, or is a conflict if they have changes
    this.disposers.push(
      reaction(
        () => this.storedTexts(),
        stored => {
          if (stored && !this.isSaving) this.onStoredChange(stored);
        },
      ),
    );
  }

  private hasEditedBuffer() {
    return [...this.buffers.values()].some(buffer => buffer.isEdited);
  }

  private onBufferChange(fileId: string, change: FileChange) {
    if (
      change.source !== FileEditSource.History &&
      change.source !== FileEditSource.System
    ) {
      if (this.transaction) {
        this.transaction.changed.push(fileId);
      } else {
        const mergeKey =
          change.source === FileEditSource.TextEditor
            ? `typing-${fileId}`
            : null;
        this.record(fileId, mergeKey, {});
      }
    }

    this.updateDraft();
  }

  @action
  private onStoredChange(stored: Record<string, string>) {
    const isSame = [...this.buffers].every(
      ([fileId, buffer]) =>
        buffer.normalize(buffer.savedText) === buffer.normalize(stored[fileId]),
    );
    if (isSame) return;

    if (this.isEdited) {
      this.hasConflict = true;
      return;
    }

    for (const [fileId, buffer] of this.buffers) {
      buffer.reset(stored[fileId]);
    }
    this.history.reset(this.entry(this.activeFile.id));
  }

  @action
  private afterSave(sent: Record<string, string>) {
    const stored = this.storedTexts();

    for (const [fileId, buffer] of this.buffers) {
      buffer.markSaved(sent[fileId]);

      // The server may store the file reformatted, which isn't a change
      if (
        stored &&
        stored[fileId] !== sent[fileId] &&
        buffer.text === sent[fileId] &&
        buffer.normalize(stored[fileId]) === buffer.normalize(sent[fileId])
      ) {
        buffer.reset(stored[fileId]);
      }
    }

    this.hasConflict = false;
    if (this.hasEditedBuffer()) {
      this.updateDraft();
    } else {
      this.drafts.delete(this.id);
    }
  }

  private record(
    fileId: string,
    mergeKey: string | null,
    extra: Partial<EditHistoryEntry>,
  ) {
    this.history.record({...this.entry(fileId), ...extra}, mergeKey);
  }

  // The current texts of the editable files, by the ID of their file
  private texts(): Record<string, string> {
    const texts: Record<string, string> = {};
    for (const [id, buffer] of this.buffers) texts[id] = buffer.text;
    return texts;
  }

  private entry(fileId: string): EditHistoryEntry {
    return {
      texts: this.texts(),
      file: fileId,
      selections: (this.textSelections?.(fileId) ??
        null) as EditHistoryEntry['selections'],
    };
  }

  @action
  private applyEntry(entry: EditHistoryEntry) {
    for (const [fileId, buffer] of this.buffers) {
      const text = entry.texts[fileId];
      if (text !== undefined) buffer.setText(text, FileEditSource.History);
    }
  }

  private updateDraft() {
    if (!this.isEdited && !this.hasConflict) {
      this.drafts.delete(this.id);
      return;
    }

    this.drafts.saveDebounced(this.id, () => {
      const texts: Record<string, string> = {};
      const saved: string[] = [];

      for (const [fileId, buffer] of this.buffers) {
        texts[fileId] = buffer.text;
        saved.push(buffer.normalize(buffer.savedText));
      }

      return {baseHash: hashTexts(saved), texts};
    });
  }

  private hash(saved: Record<string, string>) {
    return hashTexts(
      [...this.buffers].map(([fileId, buffer]) =>
        buffer.normalize(saved[fileId]),
      ),
    );
  }

  private matchesFiles(
    texts: Record<string, string>,
    saved: Record<string, string>,
  ) {
    const ids = Object.keys(saved);
    return ids.length > 0 && ids.every(id => typeof texts[id] === 'string');
  }
}

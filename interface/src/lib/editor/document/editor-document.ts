import {EditHistory, GraphSelectionSnapshot} from '@sb/lib/editor/edit-history';
import {FileBuffer} from '@sb/lib/editor/file-buffer';
import {GraphModel} from '@sb/lib/editor/graph-model';
import {Result} from '@sb/types/result';

// How a document is shown: its files as text, as a graph or both, or an overview without files
export type EditorView = 'code' | 'split' | 'graph' | 'overview';

/**
 * What the editor offers for a document. Computed from the stores, so it
 * follows changes of the permissions while the document is open.
 */
export interface DocumentCapabilities {
  // The views the view switch offers, the first one is the default
  readonly views: readonly EditorView[];

  // Whether the toolbar offers the git sync options
  readonly sync: boolean;

  // Whether the toolbar offers to deploy the document
  readonly deploy: boolean;

  // Whether the user can't change the document, e.g. without edit permission
  readonly readOnly: boolean;
}

// The schemas the text editor validates and completes files with
export type FileSchema = 'containerlab' | 'annotations';

export type FileValidation =
  // Validated and completed against a schema in the text editor
  {kind: 'schema'; schema: FileSchema};

/**
 * A file of a document. A document with more than one file lets the user pick
 * the file in the editor; files that aren't in the explorer, like the
 * annotations, are only reachable there.
 */
export interface DocumentFile {
  // Unique within the document
  readonly id: string;

  // How the file picker names the file, e.g. "Topology"
  readonly label: string;

  readonly fileName: string;

  // The name a downloaded copy of the file gets
  readonly downloadName: string;

  readonly icon: string;

  // A section of the file picker, e.g. for generated files
  readonly group: string | null;

  // The language of the text editor, 'auto' to pick it from the file name
  readonly language: string;

  readonly validation: FileValidation | null;

  // Whether paths to bind files in the text can be clicked
  readonly fileLinks: boolean;

  // Whether the file can be changed at all, the document's readOnly applies on top
  readonly editable: boolean;

  readonly state: 'ready' | 'loading' | 'unavailable';
  readonly unavailableReason: string | null;

  // Null unless the file is ready
  readonly buffer: FileBuffer<unknown> | null;
}

// Supplies the selections of the text editor for history entries, null if the file isn't shown
export type TextSelectionProvider = (fileId: string) => unknown[] | null;

// Supplies the selection of the graph for history entries
export type GraphSelectionProvider = () => GraphSelectionSnapshot | undefined;

/**
 * What undo and redo restored, so the editor can show it.
 */
export interface RestoredChange {
  // The file of the change that was undone or redone
  file: string;

  // The selections of the text editor in that file, null if there are none
  selections: unknown[] | null;

  graphSelection?: GraphSelectionSnapshot;
}

/**
 * What a tab holds. The tabs, the editor, drafts and saving only use this
 * interface and never ask what kind of document it is.
 */
export interface EditorDocument {
  // The ID of the topology or bind file
  readonly id: string;

  // The topology itself, or the one a bind file belongs to; none for a collection
  readonly topologyId: string | null;

  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;

  readonly capabilities: DocumentCapabilities;

  // The file picker is shown if there is more than one
  readonly files: readonly DocumentFile[];
  readonly activeFile: DocumentFile | null;
  selectFile(fileId: string): void;

  // The graph of the document, null if it has none
  readonly graph: GraphModel | null;

  // One history for all editable files
  readonly history: EditHistory;

  // Whether any editable file differs from its saved version
  readonly isEdited: boolean;

  // Whether all editable files can be read
  readonly isValid: boolean;

  // Set while typed text waits to be read
  readonly isParsing: boolean;

  /**
   * Whether a newer version was saved somewhere else while the document has
   * unsaved changes.
   */
  readonly hasConflict: boolean;

  /**
   * Replaces the text of a file as one change, e.g. content pulled from git.
   * Typing goes to the buffer of the file directly.
   */
  replaceText(fileId: string, text: string): void;

  undo(graphSelection?: GraphSelectionSnapshot): RestoredChange | null;
  redo(): RestoredChange | null;

  setSelectionProviders(
    text: TextSelectionProvider | null,
    graph: GraphSelectionProvider | null,
  ): void;

  // Saves all editable files
  save(): Promise<Result<void>>;

  // Goes back to the saved version and deletes the draft
  revert(): void;

  // Keeps the unsaved changes on top of the newer saved version
  keepChanges(): void;

  dispose(): void;
}

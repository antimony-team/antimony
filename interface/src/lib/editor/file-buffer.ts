import {action, computed, observable} from 'mobx';

import {FileCodec} from '@sb/lib/format/file-codec';
import {Binding} from '@sb/lib/utils/binding';

// Delay after the last typed change before the text is parsed
const PARSE_DELAY = 100;

// Parsing large files takes a while, so they are only parsed once the user stops typing
const LARGE_FILE_LENGTH = 100_000;
const LARGE_FILE_PARSE_DELAY = 500;

function parseDelay(text: string) {
  return text.length > LARGE_FILE_LENGTH ? LARGE_FILE_PARSE_DELAY : PARSE_DELAY;
}

export enum FileEditSource {
  // Typed in the text editor
  TextEditor,

  // Changed in the graph or another structured editor
  Structured,

  // Restored by undo or redo
  History,

  // Replaced from outside, e.g. a newer saved version
  System,
}

export interface FileChange {
  text: string;
  source: FileEditSource;
}

/**
 * The working copy of exactly one file. It holds the text as it's written and
 * the text as it was last saved, and parses the text with its codec. It knows
 * nothing about topologies, other files or the server.
 */
export class FileBuffer<T> {
  @observable accessor text: string;
  @observable accessor savedText: string;

  // The last text that could be parsed, kept while the text is invalid
  @observable.ref accessor value: T | null = null;
  @observable accessor isValid: boolean = true;

  // Set while typed text waits to be parsed
  @observable accessor isParsing: boolean = false;

  public readonly onChange: Binding<FileChange> = new Binding();

  private readonly codec: FileCodec<T>;

  // The text the value was parsed from, so a serialized value isn't parsed again
  private parsedText: string | null = null;

  private parseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(savedText: string, text: string, codec: FileCodec<T>) {
    this.codec = codec;
    this.savedText = savedText;
    this.text = text;
    this.parse();
  }

  @computed
  public get isEdited(): boolean {
    return this.text !== this.savedText;
  }

  /**
   * Replaces the text. Text from the text editor is parsed shortly after the
   * last change, so typing isn't slowed down by parsing; all other text is
   * parsed right away.
   */
  @action
  public setText(text: string, source: FileEditSource) {
    if (text === this.text) return;

    this.text = text;

    if (source === FileEditSource.TextEditor) {
      this.scheduleParse();
    } else {
      this.parse();
    }

    this.onChange.update({text, source});
  }

  /**
   * Replaces the value, the text is its serialized form.
   */
  @action
  public setValue(value: T, source: FileEditSource) {
    const text = this.codec.serialize(value);

    this.value = value;
    this.isValid = true;
    this.parsedText = text;

    if (text === this.text) return;

    this.text = text;
    this.onChange.update({text, source});
  }

  /**
   * Parses the current text. Returns whether it's valid; an invalid text keeps
   * the last valid value.
   */
  @action
  public parse(): boolean {
    this.cancelParse();
    if (this.parsedText === this.text) return this.isValid;

    const value = this.codec.parse(this.text);

    this.parsedText = this.text;
    this.isValid = value !== null;
    if (value !== null) this.value = value;

    return this.isValid;
  }

  /**
   * Takes the current text as saved, or the given text if the saved version
   * differs from what was sent.
   */
  @action
  public markSaved(text: string = this.text) {
    this.savedText = text;
  }

  /**
   * Replaces the saved text and the text, e.g. when a newer version was saved
   * somewhere else.
   */
  @action
  public reset(savedText: string) {
    this.savedText = savedText;
    this.setText(savedText, FileEditSource.System);
  }

  public serialize(value: T): string {
    return this.codec.serialize(value);
  }

  public normalize(text: string): string {
    return this.codec.normalize?.(text) ?? text;
  }

  public dispose() {
    this.cancelParse();
    this.onChange.clear();
  }

  @action
  private scheduleParse() {
    this.cancelParse();
    this.isParsing = true;
    this.parseTimeout = setTimeout(() => this.parse(), parseDelay(this.text));
  }

  @action
  private cancelParse() {
    if (this.parseTimeout !== null) clearTimeout(this.parseTimeout);
    this.parseTimeout = null;
    this.isParsing = false;
  }
}

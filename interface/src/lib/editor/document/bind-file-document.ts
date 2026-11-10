import {computed} from 'mobx';

import {BaseDocument} from '@sb/lib/editor/document/base-document';
import {
  DocumentCapabilities,
  DocumentFile,
} from '@sb/lib/editor/document/editor-document';
import {DraftStorage} from '@sb/lib/editor/draft-storage';
import {FileBuffer} from '@sb/lib/editor/file-buffer';
import {PlainTextFormat} from '@sb/lib/format/plain-text-format';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {BindFile, Topology} from '@sb/types/domain/topology';
import {Result} from '@sb/types/result';

export const CONTENT_FILE = 'content';

/**
 * A bind file of a topology, edited as text.
 */
export class BindFileDocument extends BaseDocument {
  public readonly id: string;
  public readonly topologyId: string;
  public readonly icon = 'description';
  public readonly graph = null;
  public readonly files: readonly DocumentFile[];

  private readonly topologyStore: TopologyStore;

  constructor(
    bindFile: BindFile,
    topologyStore: TopologyStore,
    drafts: DraftStorage,
  ) {
    super(drafts);

    this.id = bindFile.id;
    this.topologyId = bindFile.topologyId;
    this.topologyStore = topologyStore;

    let buffer!: FileBuffer<string>;
    const title = () => this.title;

    this.files = [
      {
        id: CONTENT_FILE,
        label: 'Bind file',
        icon: 'description',
        group: null,
        validation: null,
        fileLinks: false,
        editable: true,
        state: 'ready',
        unavailableReason: null,
        get fileName() {
          return title();
        },
        get downloadName() {
          return title();
        },
        // Picked by the text editor from the file name
        language: 'auto',
        get buffer() {
          return buffer;
        },
      },
    ];

    this.init((saved, start) => {
      buffer = new FileBuffer(
        saved[CONTENT_FILE],
        start[CONTENT_FILE],
        new PlainTextFormat(),
      );
      return new Map<string, FileBuffer<unknown>>([[CONTENT_FILE, buffer]]);
    });
  }

  // The path of the file in its topology, it can change when the file is moved
  @computed
  public get filePath(): string {
    return this.bindFile?.filePath ?? '';
  }

  @computed
  public get title(): string {
    return this.filePath.split('/').pop() ?? '';
  }

  // The topology the file belongs to
  @computed
  public get subtitle(): string {
    return this.topology?.definition.name ?? '';
  }

  @computed
  public get capabilities(): DocumentCapabilities {
    const topology = this.topology;

    return {
      views: ['code'],
      sync: false,
      deploy: false,
      readOnly: !topology || !this.topologyStore.canEdit(topology),
    };
  }

  @computed
  private get bindFile(): BindFile | undefined {
    return this.topologyStore.bindFileLookup.get(this.id);
  }

  @computed
  private get topology(): Topology | undefined {
    return this.topologyStore.lookup.get(this.topologyId);
  }

  protected storedTexts(): Record<string, string> | null {
    const bindFile = this.bindFile;
    return bindFile ? {[CONTENT_FILE]: bindFile.content} : null;
  }

  protected send(): Promise<Result<unknown>> {
    return this.topologyStore.updateBindFile(this.topologyId, this.id, {
      content: this.files[0].buffer!.text as string,
    });
  }
}

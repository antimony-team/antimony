import {computed} from 'mobx';

import {BaseDocument} from '@sb/lib/editor/document/base-document';
import {
  DocumentCapabilities,
  DocumentFile,
} from '@sb/lib/editor/document/editor-document';
import {DraftStorage} from '@sb/lib/editor/draft-storage';
import {FileBuffer, FileEditSource} from '@sb/lib/editor/file-buffer';
import {GraphModel} from '@sb/lib/editor/graph-model';
import {
  AnnotationsFormat,
  serializeAnnotations,
} from '@sb/lib/format/annotations-format';
import {CollectionStore} from '@sb/lib/stores/collection-store';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {
  Topology,
  TopologyAnnotations,
  TopologyIn,
} from '@sb/types/domain/topology';
import {TopologyDefinition} from '@sb/types/domain/topology-definition';
import {Result} from '@sb/types/result';

export const DEFINITION_FILE = 'definition';
export const ANNOTATIONS_FILE = 'annotations';

/**
 * A topology: its definition and annotations, edited as text or in the graph.
 * Both files are one document, so an edit in the graph that changes both is
 * one change, and saving sends both.
 */
export class TopologyDocument extends BaseDocument {
  public readonly id: string;
  public readonly topologyId: string;
  public readonly icon = 'network_node';
  public readonly graph: GraphModel;
  public readonly files: readonly DocumentFile[];

  private readonly topologyStore: TopologyStore;
  private readonly collectionStore: CollectionStore;
  private readonly definition: FileBuffer<TopologyDefinition>;
  private readonly annotations: FileBuffer<TopologyAnnotations>;

  constructor(
    topology: Topology,
    topologyStore: TopologyStore,
    collectionStore: CollectionStore,
    deviceStore: DeviceStore,
    schemaStore: SchemaStore,
    drafts: DraftStorage,
  ) {
    super(drafts);

    this.id = topology.id;
    this.topologyId = topology.id;
    this.topologyStore = topologyStore;
    this.collectionStore = collectionStore;

    const format = topologyStore.format;
    let definition!: FileBuffer<TopologyDefinition>;
    let annotations!: FileBuffer<TopologyAnnotations>;

    this.files = [
      topologyFile({
        id: DEFINITION_FILE,
        label: 'Topology',
        fileName: () => `${this.title}.clab.yml`,
        downloadName: () => `${this.subtitle}_${this.title}.yaml`,
        icon: 'notes',
        language: 'yaml',
        validation: {kind: 'schema', schema: 'containerlab'},
        fileLinks: true,
        buffer: () => definition,
      }),
      topologyFile({
        id: ANNOTATIONS_FILE,
        label: 'Annotations',
        fileName: () => `${this.title}.clab.yml.annotations.json`,
        downloadName: () => `${this.subtitle}_${this.title}.annotations.json`,
        icon: 'data_object',
        language: 'json',
        validation: {kind: 'schema', schema: 'annotations'},
        fileLinks: false,
        buffer: () => annotations,
      }),
    ];

    this.init((saved, start) => {
      definition = new FileBuffer(
        saved[DEFINITION_FILE],
        start[DEFINITION_FILE],
        // The format of the topology reads and writes its definition
        format,
      );
      annotations = new FileBuffer(
        saved[ANNOTATIONS_FILE],
        start[ANNOTATIONS_FILE],
        new AnnotationsFormat(() => schemaStore.annotationsValidator),
      );

      return new Map<string, FileBuffer<unknown>>([
        [DEFINITION_FILE, definition],
        [ANNOTATIONS_FILE, annotations],
      ]);
    });

    this.definition = definition;
    this.annotations = annotations;

    this.graph = new GraphModel({
      definition,
      annotations,
      capabilities: format.capabilities,
      edit: (change, mergeKey) => this.edit(change, mergeKey),
      isReadOnly: () => this.capabilities.readOnly,
      savedTopology: () => this.savedTopology,
      devices: deviceStore,
    });
  }

  @computed
  public get title(): string {
    return (
      this.definition.value?.name ?? this.savedTopology?.definition.name ?? ''
    );
  }

  @computed
  public get subtitle(): string {
    const collectionId = this.savedTopology?.collectionId;
    if (!collectionId) return '';

    return this.collectionStore.lookup.get(collectionId)?.name ?? '';
  }

  @computed
  public get capabilities(): DocumentCapabilities {
    const topology = this.savedTopology;

    return {
      views: ['split', 'code', 'graph'],
      sync: true,
      deploy:
        !!topology && this.collectionStore.canDeployIn(topology.collectionId),
      readOnly: !topology || !this.topologyStore.canEdit(topology),
    };
  }

  /**
   * Follows a rename that was saved somewhere else, e.g. in the topology dialog.
   * Unsaved changes are kept and get the new name as well, unless the text
   * isn't valid right now, then it's kept as it's written.
   */
  public applyRename(name: string) {
    if (!this.hasConflict) return;

    // The value is the last valid text, which may be older than the text
    this.definition.parse();
    const definition = this.definition.isValid ? this.definition.value : null;
    if (definition) {
      this.definition.setValue(definition.setName(name), FileEditSource.System);
    }

    this.keepChanges();
  }

  // The topology as the store holds it, the saved version
  @computed
  public get savedTopology(): Topology | undefined {
    return this.topologyStore.lookup.get(this.topologyId);
  }

  protected storedTexts(): Record<string, string> | null {
    const topology = this.savedTopology;
    if (!topology) return null;

    return {
      [DEFINITION_FILE]: topology.definition.toString(),
      [ANNOTATIONS_FILE]: serializeAnnotations(topology.annotations),
    };
  }

  protected async send(): Promise<Result<unknown>> {
    this.graph.completeLayout();

    // The text is sent as it's written, the annotations only if they changed
    const body: Partial<TopologyIn> = {definition: this.definition.text};
    if (this.annotations.isEdited) body.annotations = this.annotations.text;

    return this.topologyStore.update(this.topologyId, body);
  }
}

function topologyFile(options: {
  id: string;
  label: string;
  fileName: () => string;
  downloadName: () => string;
  icon: string;
  language: string;
  validation: DocumentFile['validation'];
  fileLinks: boolean;
  buffer: () => FileBuffer<unknown>;
}): DocumentFile {
  return {
    id: options.id,
    label: options.label,
    icon: options.icon,
    group: null,
    language: options.language,
    validation: options.validation,
    fileLinks: options.fileLinks,
    editable: true,
    state: 'ready',
    unavailableReason: null,
    get fileName() {
      return options.fileName();
    },
    get downloadName() {
      return options.downloadName();
    },
    get buffer() {
      return options.buffer();
    },
  };
}

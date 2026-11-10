import {computed} from 'mobx';

import {
  DocumentCapabilities,
  EditorDocument,
  RestoredChange,
} from '@sb/lib/editor/document/editor-document';
import {EditHistory} from '@sb/lib/editor/edit-history';
import {CollectionStore} from '@sb/lib/stores/collection-store';
import {Collection} from '@sb/types/domain/collection';
import {Result} from '@sb/types/result';

const CAPABILITIES: DocumentCapabilities = {
  views: ['overview'],
  sync: false,
  deploy: false,
  readOnly: true,
};

/**
 * A collection, shown as an overview of its topologies and labs. It has no
 * files, so there is nothing to edit, save or undo.
 */
export class CollectionDocument implements EditorDocument {
  public readonly id: string;
  public readonly topologyId = null;
  public readonly subtitle = 'Collection';
  public readonly icon = 'inventory_2';
  public readonly capabilities = CAPABILITIES;

  public readonly files = [];
  public readonly activeFile = null;
  public readonly graph = null;
  public readonly history = new EditHistory();

  public readonly isEdited = false;
  public readonly isValid = true;
  public readonly isParsing = false;
  public readonly hasConflict = false;

  private readonly collectionStore: CollectionStore;

  constructor(collection: Collection, collectionStore: CollectionStore) {
    this.id = collection.id;
    this.collectionStore = collectionStore;
  }

  // The collection as the store holds it, undefined once it's deleted
  @computed
  public get collection(): Collection | undefined {
    return this.collectionStore.lookup.get(this.id);
  }

  @computed
  public get title(): string {
    return this.collection?.name ?? '';
  }

  public selectFile() {}

  public replaceText() {}

  public undo(): RestoredChange | null {
    return null;
  }

  public redo(): RestoredChange | null {
    return null;
  }

  public setSelectionProviders() {}

  public async save(): Promise<Result<void>> {
    return Result.createOk(undefined);
  }

  public revert() {}

  public keepChanges() {}

  public dispose() {}
}

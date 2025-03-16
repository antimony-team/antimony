import {DataStore} from '@sb/lib/stores/data-store';
import {Collection, CollectionIn} from '@sb/types/domain/collection';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {computed} from 'mobx';

export class CollectionStore extends DataStore<
  Collection,
  CollectionIn,
  Collection
> {
  protected get resourcePath(): string {
    return '/collections';
  }

  protected handleUpdate(response: DataResponse<Collection[]>): void {
    this.data = response.payload.toSorted((a, b) =>
      a.name.localeCompare(b.name)
    );
    this.lookup = new Map(
      this.data.map(collection => [collection.id, collection])
    );
  }

  @computed
  public get hasWritableCollections(): boolean {
    return this.data.filter(collection => collection.publicWrite).length > 0;
  }
}

import {action, computed} from 'mobx';

import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {DataStore} from '@sb/lib/stores/data-store';
import {Collection, CollectionIn} from '@sb/types/domain/collection';
import {Result} from '@sb/types/result';

export class CollectionStore extends DataStore<
  Collection,
  CollectionIn,
  Collection
> {
  @computed
  public get hasAccessibleCollections(): boolean {
    return this.data.length > 0;
  }

  /**
   * Whether the user may create labs from the topologies of a collection: admins
   * always, everyone else if anyone can deploy in it.
   */
  public canDeployIn(collectionId: string): boolean {
    if (this.rootStore._dataBinder.authUser.isAdmin) return true;

    return this.lookup.get(collectionId)?.publicDeploy ?? false;
  }

  /**
   * Whether the user may add topologies to a collection: admins always, everyone
   * else if anyone can edit it.
   */
  public canWriteIn(collectionId: string): boolean {
    if (this.rootStore._dataBinder.authUser.isAdmin) return true;

    return this.lookup.get(collectionId)?.publicWrite ?? false;
  }

  @computed
  public get hasDeployableCollections(): boolean {
    return this.data.some(collection => this.canDeployIn(collection.id));
  }

  protected get resourcePath(): string {
    return '/collections';
  }

  @action
  protected handleUpdate(response: DataResponse<Collection[]>): void {
    this.data = response.payload.toSorted((a, b) =>
      a.name.localeCompare(b.name),
    );
    this.lookup = new Map(
      this.data.map(collection => [collection.id, collection]),
    );
  }

  /**
   * Deleting a collection also deletes its labs and topologies in the backend,
   * so we have to refetch them as they could refer to a deleted collection.
   */
  public override async delete(
    id: string,
  ): Promise<Result<DataResponse<void>>> {
    const result = await this.rootStore._dataBinder.delete<void>(
      `${this.resourcePath}/${id}` + this.deleteParams,
    );

    if (result.isOk()) {
      await this.rootStore._labStore.fetch();
      await this.rootStore._topologyStore.fetch();
      await this.fetch();
    }

    return result;
  }
}

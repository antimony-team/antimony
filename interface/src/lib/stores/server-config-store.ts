import {DataStore} from '@sb/lib/stores/data-store';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {action, computed} from 'mobx';
import {ServerConfig} from '@sb/types/domain/server-config';

export class ServerConfigStore extends DataStore<
  ServerConfig,
  null,
  ServerConfig
> {
  protected get resourcePath(): string {
    return '/config';
  }

  @action
  protected handleUpdate(response: DataResponse<ServerConfig>): void {
    this.data = [response.payload];
  }

  @computed
  public get hasAccessibleCollections(): boolean {
    return this.data.length > 0;
  }

  @computed
  public get config(): ServerConfig {
    return this.data[0];
  }
}

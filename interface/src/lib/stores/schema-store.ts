import {action, observable, runInAction} from 'mobx';
import {Schema} from 'jsonschema';

import {DataStore} from '@sb/lib/stores/data-store';
import {DefaultFetchReport, FetchReport} from '@sb/types/types';
import {ClabSchema} from '@sb/types/domain/schema';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

export class SchemaStore extends DataStore<ClabSchema, void, ClabSchema> {
  @observable accessor fetchReport: FetchReport = DefaultFetchReport;
  @observable accessor clabSchema: ClabSchema | null = null;
  @observable accessor annotationsSchema: Schema | null = null;

  protected get resourcePath(): string {
    return '/clab-schema';
  }

  // The annotations schema is fetched first, so it is available once the fetch report is done
  public override async fetch() {
    const result = await this.rootStore._dataBinder.get<Schema>(
      this.resourcePath + '/annotations',
    );

    if (result.isOk()) {
      runInAction(() => (this.annotationsSchema = result.data.payload));
    }

    await super.fetch();
  }

  @action
  protected handleUpdate(response: DataResponse<ClabSchema>): void {
    this.clabSchema = response.payload;
  }
}

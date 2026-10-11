import {action, observable, runInAction} from 'mobx';
import Ajv, {SchemaObject, ValidateFunction} from 'ajv';

import {DataStore} from '@sb/lib/stores/data-store';
import {DefaultFetchReport, FetchReport} from '@sb/types/types';
import {ClabSchema} from '@sb/types/domain/schema';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

export class SchemaStore extends DataStore<ClabSchema, void, ClabSchema> {
  @observable accessor fetchReport: FetchReport = DefaultFetchReport;
  @observable accessor clabSchema: ClabSchema | null = null;
  @observable accessor annotationsSchema: SchemaObject | null = null;

  // Compiling a schema takes a while, so the validators are only compiled once per fetched schema
  public clabValidator: ValidateFunction | null = null;
  public annotationsValidator: ValidateFunction | null = null;

  protected get resourcePath(): string {
    return '/clab-schema';
  }

  // The annotations schema is fetched first, so it is available once the fetch report is done
  public override async fetch() {
    const result = await this.rootStore._dataBinder.get<SchemaObject>(
      this.resourcePath + '/annotations',
    );

    if (result.isOk()) {
      this.annotationsValidator = compileSchema(result.data.payload);
      runInAction(() => (this.annotationsSchema = result.data.payload));
    }

    await super.fetch();
  }

  @action
  protected handleUpdate(response: DataResponse<ClabSchema>): void {
    this.clabValidator = compileSchema(response.payload);
    this.clabSchema = response.payload;
  }
}

/*
 * Each schema gets its own instance, as an instance doesn't accept a schema with
 * the same ID again when it is fetched another time. The schemas contain fields
 * that are not part of the JSON schema specification, so the strict mode is off.
 */
function compileSchema(schema: object): ValidateFunction {
  return new Ajv({strict: false}).compile(schema);
}

import {action, computed, observable, observe} from 'mobx';

import {
  DefaultFetchReport,
  FetchReport,
  FetchState,
  uuid4,
} from '@sb/types/types';
import {RootStore} from '@sb/lib/stores/root-store';
import {Result} from '@sb/types/result';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

export abstract class DataStore<T, I, O> {
  protected rootStore: RootStore;

  @observable accessor data: T[] = [];
  @observable accessor lookup: Map<string, T> = new Map();
  @observable accessor fetchReport: FetchReport = DefaultFetchReport;

  protected abstract get resourcePath(): string;
  protected abstract handleUpdate(updatedData: DataResponse<O | O[]>): void;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;

    observe(rootStore._dataBinder, () => this.fetch());

    void this.fetch();
  }

  @action
  public async fetch() {
    if (!this.rootStore._dataBinder.isLoggedIn) {
      this.fetchReport = {state: FetchState.Pending};
      return;
    }

    this.handleData(
      await this.rootStore._dataBinder.get<O[]>(
        this.resourcePath + this.getParams
      )
    );
  }

  public async delete(id: string): Promise<Result<DataResponse<void>>> {
    const result = await this.rootStore._dataBinder.delete<void>(
      `${this.resourcePath}/${id}` + this.deleteParams
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  public async add<R = void>(body: I): Promise<Result<DataResponse<R>>> {
    const result = await this.rootStore._dataBinder.post<I, R>(
      this.resourcePath + this.postParams,
      body
    );

    if (result.isOk()) {
      await this.fetch();
    }

    return result;
  }

  public async update(
    id: uuid4,
    body: Partial<I>
  ): Promise<Result<DataResponse<void>>> {
    const result = await this.rootStore._dataBinder.patch<I, void>(
      `${this.resourcePath}/${id}` + this.patchParams,
      body
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  @action
  private handleData(result: Result<DataResponse<O | O[]>>) {
    if (result.isOk()) {
      this.handleUpdate(result.data);
      this.fetchReport = {state: FetchState.Done};
    }

    if (result.isErr()) {
      this.fetchReport = {
        state: FetchState.Error,
        errorCode: String(result.error.code),
        errorMessage: result.error.message,
      };
    }
  }

  @computed
  protected get getParams() {
    return '';
  }

  @computed
  protected get postParams() {
    return '';
  }

  @computed
  protected get patchParams() {
    return '';
  }

  @computed
  protected get deleteParams() {
    return '';
  }
}

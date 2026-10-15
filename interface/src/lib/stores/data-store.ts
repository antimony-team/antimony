import {action, computed, observable, ObservableMap, reaction} from 'mobx';

import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {RootStore} from '@sb/lib/stores/root-store';
import {Result} from '@sb/types/result';
import {
  DefaultFetchReport,
  FetchReport,
  FetchState,
  uuid4,
} from '@sb/types/types';

export abstract class DataStore<T, I, O> {
  @observable accessor data: T[] = [];
  @observable accessor lookup: Map<string, T> = new ObservableMap();
  @observable accessor fetchReport: FetchReport = DefaultFetchReport;
  protected rootStore: RootStore;
  protected disposers: (() => void)[] = [];

  constructor(rootStore: RootStore, dependencies: DataStoreDependency[] = []) {
    this.rootStore = rootStore;

    this.disposers.push(
      // Fetch once the user is logged in and all dependencies have loaded
      reaction(
        () =>
          rootStore._dataBinder.isLoggedIn &&
          dependencies.every(d => d.fetchReport.state === FetchState.Done),
        ready => {
          if (ready) void this.fetch();
        },
        {fireImmediately: true},
      ),
      // Drop all data on logout
      reaction(
        () => rootStore._dataBinder.isLoggedIn,
        isLoggedIn => {
          if (!isLoggedIn) this.reset();
        },
      ),
    );
  }

  protected abstract get resourcePath(): string;

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

  public dispose() {
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
  }

  @action
  public async fetch() {
    if (!this.rootStore._dataBinder.isLoggedIn) {
      this.fetchReport = {state: FetchState.Pending};
      return;
    }

    this.handleData(
      await this.rootStore._dataBinder.get<O[]>(
        this.resourcePath + this.getParams,
      ),
    );
  }

  public async delete(id: string): Promise<Result<DataResponse<void>>> {
    const result = await this.rootStore._dataBinder.delete<void>(
      `${this.resourcePath}/${id}` + this.deleteParams,
    );

    if (result.isOk()) await this.fetch();

    return result;
  }

  public async add<R = void>(body: I): Promise<Result<DataResponse<R>>> {
    const result = await this.rootStore._dataBinder.post<I, R>(
      this.resourcePath + this.postParams,
      body,
    );

    if (result.isOk()) {
      await this.fetch();
    }

    return result;
  }

  public async update(
    id: uuid4,
    body: Partial<I>,
    fetch: boolean = true,
  ): Promise<Result<DataResponse<void>>> {
    const result = await this.rootStore._dataBinder.patch<I, void>(
      `${this.resourcePath}/${id}` + this.patchParams,
      body,
    );

    if (result.isOk() && fetch) await this.fetch();

    return result;
  }

  protected abstract handleUpdate(updatedData: DataResponse<O | O[]>): void;

  @action
  protected reset() {
    this.data = [];
    this.lookup = new ObservableMap();
    this.fetchReport = DefaultFetchReport;
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
}

export interface DataStoreDependency {
  readonly fetchReport: FetchReport;
}

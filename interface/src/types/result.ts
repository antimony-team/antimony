export type Ok<T> = Result<T>;
export type Err = Result<never>;

export type ErrorResult = {
  code: number;
  message: string;
};

/**
 * Error handling object based on the result pattern.
 *
 * Inspired by https://www.dennisokeeffe.com/blog/2024-07-14-creating-a-result-type-in-typescript.
 */
export class Result<T> {
  protected constructor(
    readonly _tag: 'ok' | 'err',
    protected readonly value: T | ErrorResult
  ) {}

  static createOk<T>(data: T): Ok<T> {
    return new Result('ok', data) as Ok<T>;
  }

  static createErr<E>(error: E): Err {
    return new Result('err', error) as Err;
  }

  isOk(): this is Ok<T> {
    return this._tag === 'ok';
  }

  isErr(): this is Err {
    return this._tag === 'err';
  }

  get data(): T {
    if (this.isOk()) return this.value as T;
    throw new Error('Cannot get data from an err result');
  }

  get error(): ErrorResult {
    if (this.isErr()) return this.value as ErrorResult;
    throw new Error('Cannot get error from an ok result');
  }
}

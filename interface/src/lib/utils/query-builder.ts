export class QueryBuilder {
  private query: string = '?';

  public add(
    name: string,
    value: string | number | undefined | null,
    omitIfNull: boolean = true,
  ): QueryBuilder {
    if (omitIfNull && (value === undefined || value === null)) return this;

    this.query = `${this.query}${name}=${value}&`;

    return this;
  }
  public addList(name: string, values: string[] | number[]): QueryBuilder {
    for (const value of values) {
      this.add(`${name}[]`, value);
    }

    return this;
  }

  public toString() {
    return this.query;
  }
}

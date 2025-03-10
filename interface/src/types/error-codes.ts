export enum ErrorCodes {
  /*
   * Generic API error that is used for multiple internal things.
   *
   * - Network / Connection errors: Handled internally
   * - Authetication / Authorization errors: Handled internally
   * - Server / Database errors: API error message is shown to user directly
   */
  ErrorGeneric = -1,

  /*
   * The following errors can occur through invalid user input and have to be
   * handled separately to properly highlight invalid input fields.
   */

  ErrorInvalidCredentials = 1001,

  ErrorCollectionExists = 2001,
}

export enum ErrorCodes {
  /*
   * Generic API error that is used for multiple internal things.
   *
   * - Network / Connection errors: Handled internally
   * - Authetication / Authorization errors: Handled internally
   * - Server / Database errors: An API error message is shown to the user directly
   */
  ErrorGeneric = -1,

  /*
   * The following errors can occur through invalid user input and have to be
   * handled separately to properly highlight invalid input fields.
   */
  ErrorInvalidCredentials = 1001,

  ErrorCollectionExists = 2001,

  ErrorTopologyExists = 3001,

  ErrorBindFileExists = 4001,

  /*
   * Errors that the server returns from socket requests.
   */
  ErrorSocketClabError = 5001,
  ErrorSocketInvalidRequest = 5422,
  ErrorSocketForbidden = 5403,
  ErrorSocketNotFound = 5404,
}

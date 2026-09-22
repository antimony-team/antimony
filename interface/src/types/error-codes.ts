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
  // Generic request errors
  ErrorAntimony = 5000,
  ErrorProvider = 5001,
  ErrorInvalidRuntimeCommand = 5400,
  ErrorSocketForbidden = 5403,
  ErrorUuidNotFound = 5404,
  ErrorSocketInvalidRequest = 5422,

  // Lab errors
  ErrorLabNotFound = 5011,
  ErrorLabNotRunning = 5012,
  ErrorLabOperationInProgress = 5013,

  // Node errors
  ErrorNodeNotFound = 5021,
  ErrorNodeNotRunning = 5022,
  ErrorInvalidNodeOperation = 5023,

  // Shell errors
  ErrorShellNotFound = 5031,
  ErrorShellLimitReached = 5032,
}

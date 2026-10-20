export enum ErrorCodes {
  /*
   * Generic API error that is used for multiple internal things.
   *
   * - Network / Connection errors: Handled internally
   * - Authetication / Authorization errors: Handled internally
   * - Server / Database errors: An API error message is shown to the user directly
   */
  ErrorGeneric = -1,

  // The request body is malformed or misses fields
  ErrorValidation = 422,
  ErrorDatabase = 500,

  /*
   * The following errors can occur through invalid user input and have to be
   * handled separately to properly highlight invalid input fields.
   */
  ErrorInvalidCredentials = 1001,

  ErrorCollectionExists = 2001,
  ErrorInvalidCollectionName = 2002,

  ErrorTopologyExists = 3001,

  ErrorInvalidTopology = 3003,

  ErrorInvalidTopologyName = 3004,

  ErrorUnsafeTopology = 3005,

  ErrorBindFileExists = 4001,
  ErrorInvalidBindFilePath = 4002,
  ErrorLabRunning = 4003,

  /*
   * Errors that the server returns from socket requests.
   */
  // Generic request errors
  ErrorAntimony = 5000,
  ErrorProvider = 5500,
  ErrorInvalidRuntimeCommand = 5400,
  ErrorSocketForbidden = 5403,
  ErrorUuidNotFound = 5404,
  ErrorSocketInvalidRequest = 5422,

  // Lab errors
  ErrorLabNameExists = 5001,
  ErrorInvalidLabName = 5002,
  ErrorInvalidLabTime = 5003,
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

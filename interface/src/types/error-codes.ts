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
  ErrorContainerlab = 5001,
  ErrorLabIsDeploying = 5002,
  ErrorLabNotRunning = 5003,
  ErrorNodeNotRunning = 5004,
  ErrorUuidNotFound = 5005,
  ErrorNodeNotFound = 5006,
  ErrorShellNotFound = 5007,
  ErrorShellLimitReached = 5008,
  ErrorSocketInvalidRequest = 5422,
  ErrorSocketForbidden = 5403,
}

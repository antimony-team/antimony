# Socket.IO API

Antimony uses Socket.IO sockets to communicate real-time data such as logs, terminal data or server event data such as status messages. Every type of message has its own communication channel, or namespace.

Read more about Socket.IO namespaces in the [Socket.IO documentation](https://socket.io/docs/v4/namespaces/).

!!! note "Socket Acknowledgements"
    Socket acknowledgements are return values that are returned by a message receiver to indicate the status of a requested action. Antimony exclusively uses acks in events that are received **by the server**. The server replies with an acknowledgement to communicate a return value, or possible [errors](#error-codes) in the processing of a request. 

## Authentication

As with Antimony's RESTful API, the user needs to authenticate themselves with the Antimony `access token` to get access to it.

!!! example "Authentication with Socket.IO in JavaScript"
    ```js
    import {io} from 'socket.io-client';

    const socket = io('/<ns>', {
        auth: {
            token: '<access-token>
        }
    });
    ```

Read more about authentication [here](../implementation/authentication.md).

## Namespaces

### Status Messages

The status messages namespace is a global namespace that is used by the server to communicate status messages to the client. Status messages are notifications emitted by the server that indicate the progress or status of server actions such as the deployment of labs or deployment problems.

Unlike return values or errors resulting from requests, status messages are unstructured and provided in a human-readable form.

**Namespace:** `/status-messages`

**Flow:** `server -> client`

<table>
<thead>
<tr><td>Event</td><td>Payload</td><td>Description</td></tr>
</thead>
<tbody>
<tr><td><code>data</code></td><td>
```ts
{
    payload: {
        id: string
        timestamp: string  // ISO 8601
        source: string     // The source component
        content: string
        logContent: string // More detailed message, for logging
        severity: int
    }
}
```
</pre></td><td>The server is sending a new status message to the client</td></tr>
</tbody>
</table>

#### Severities

| Severity Code | Description |
| ------ | ------ |
| `0` | Success |
| `1` | Info |
| `2` | Warning |
| `3` | Error |
| `4` | Fatal |

### Lab Updates

The lab updates namespace is a global namespace that is used by the server to communicate changes in a lab's state to the client. For example, the server sends a lab update for when a lab has finished deploying and goes into the `running` [state](../implementation/labs.md#instance-state).

**Namespace:** `/lab-updates`

**Flow:** `server -> client`

<table>
<thead>
<tr><td>Event</td><td>Payload</td><td>Description</td></tr>
</thead>
<tbody>
<tr><td><code>data</code></td><td>
```ts
{
    payload: {
        labId: string
    }
}
```
</pre></td><td>Server notifying the client of an update in a lab. Client is supposed to re-fetch the specified lab. If no lab has been specified, all labs should be re-fetched.</td></tr>
</tbody>
</table>

### Lab Log Streaming

A lab log streaming namespace is a namespace that is used by the server to send deployment logs to a client.

!!! note "Availability"
    A lab log namespace for a certain lab is only available once that lab has an instance. This means that the lab must have attempted deployment at least once before.

**Namespace:** `/logs/<labId>`

**Flow:** `server -> client`

| Event | Payload | Description |
| -- | -- | -- |
| `data` | `string` | The server streams a new log line. |
| `backlog` | `string[]` | The server sends a backlog of all previously emited logs to the client. This event is fired when a client subscribes to the namespace. |

### Node Log Streaming

A node log streaming namespaces is a namespace is used by the server to send node logs to a client.

!!! note "Availability"
    A node log namespace for a certain node is only available when the node's parent lab is currently deployed.

**Namespace:** `/logs/<labId>/<node>`

**Flow:** `server -> client`

| Event | Payload | Description |
| -- | -- | -- |
| `data` | `string` | The server streams a new log line. |
| `backlog` | `string[]` | The server sends a backlog of all previously emited logs to the client. This event is fired when a client subscribes to the namespace. |

### Lab Commands
 
 The lab commands namespace is a global namespace that is used by the client to signal the server to initiate a lab action (e.g. deploying a lab).

**Namespace:** `/lab-commands`

**Flow:** `client -> server`

<table>
<thead>
<tr><td>Event</td><td>Payload</td><td>Description</td></tr>
</thead>
<tbody>
<tr><td><code>data</code></td><td>
```ts
{
    labId: string,
    command: int,    
    node?: string,
    shellId?: string
}
```
</pre></td><td>The client is issuing a lab command to the server. Some commands require the optional `node` field or `shellId` field in order to work.</td></tr>
</tbody>
</table>

#### Available Commands

<table>
  <thead>
    <tr>
      <td align="center">Command ID</td>
      <td>Description</td>
      <td>Return Value</td>
      <td>Requires Node</td>
      <td>Requires Shell ID</td>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center">0</td>
      <td>Deploys the specified lab.<br><br><i>If that lab is already running, it redeploys the lab instead.</i></td>
      <td>
      ```ts
      { payload: null }
      ```
      </td>
      <td>No</td>
      <td>No</td>
    </tr>
    <tr>
      <td align="center">1</td>
      <td>Destroys the specified lab.</td>
      <td>
      ```ts
      { payload: null }
      ```
      </td>
      <td>No</td>
      <td>No</td>
    </tr>
    <tr>
      <td align="center">2</td>
      <td>Stops a node within the specified lab.</td>
      <td>
      ```ts
      { payload: null }
      ```
      </td>
      <td>Yes</td>
      <td>No</td>
    </tr>
    <tr>
      <td align="center">3</td>
      <td>Starts a node within the specified lab.</td>
      <td>
      ```ts
      { payload: null }
      ```
      </td>
      <td>Yes</td>
      <td>No</td>
    </tr>
    <tr>
      <td align="center">4</td>
      <td>Restarts a node within the specified lab.</td>
      <td>
      ```ts
      { payload: null }
      ```
      </td>
      <td>Yes</td>
      <td>No</td>
    </tr>
    <tr>
      <td align="center">5</td>
      <td>Returns all currently open shells from the current user for the specified lab.</td>
      <td>
      ```ts
      {
        payload: {
            id: string,
            node: string
        }[]
      }
      ```
      </td>
      <td>No</td>
      <td>No</td>
    </tr>
    <tr>
      <td align="center">6</td>
      <td>Opens a new interactive shell with the specified node in the specified lab.</td>
      <td>
      ```ts
      {
        payload: string
      }
      ```
      </td>
      <td>Yes</td>
      <td>No</td>
    </tr>
    <tr>
      <td align="center">7</td>
      <td>Closes a currently open shell.</td>
      <td>
      ```ts
      { payload: null }
      ```
      </td>
      <td>No</td>
      <td>Yes</td>
    </tr>
  </tbody>
</table>


### Shell Commands

The shell commands namespace is a global namespace that is used by the server to indicate that something has happened with a currently open shell to the client.

**Namespace:** `/shell-commands`

**Flow:** `server -> client`

<table>
<thead>
<tr><td>Event</td><td>Description</td><td>Payload</td></tr>
</thead>
<tbody>
<tr>
<td><code>data</code></td>
<td>The client is issuing a new shell command to the server.</td>
<td>
```ts
{
    labId: string
    node: string
    shellId: string 
    command: ShellCommand
    message: string
}
```
</td>
</tr>
</tbody>
</table>

#### Available Commands

| Command ID | Name | Description |
| -- | -- | -- |
| 0 | Shell Error | There has been an I/O error with the shell. |
| 1 | Shell Close | The shell has been closed. |

### Shell I/O

Shell I/O namespaces namespaces that are are used by the client and the server to transmit data to and from an interactive shell.

!!! note "Availability"
    A shell I/O namespace becomes available as soon as the client requests to open a shell and receives a shell ID. This only works if the node is currently running.

**Namespace:** `/shells/<shellId>`

**Flow:** `server -> client` / `client -> server`

| Event | Payload | Description |
| -- | -- | -- |
| `data` | `string` | The client or the server send shell data. |
| `backlog` | `string[]` | The server sends a backlog of all previously transmitted shell data. |

## Error Codes

Any namespace that sends a package to the server can receive an error as acknowledgement value. This error is formatted like this.

```ts
{
    code: number
    message: string
}
```

The following table provides an overview of all possible error codes.

| Error Code | Description |
| ------ | ------ |
| `5000` | Generic Antimony error. Refer to the message for more information. |
| `5001` | Containerlab returned an error during processing. |
| `5002` | The specified lab is already being deployed. |
| `5003` | The specified lab is not running. |
| `5004` | The specified lab is already being deployed. |
| `5005` | The specified ID could not be found. |
| `5006` | The specified node could not be found. |
| `5007` | The specified shell could not be found. |
| `5008` | The user has reached the max open shell limit. |
| `5422` | Generic error that is returned when the socket request was invalid. |
| `5403` | Generic error that is returned when the user does not have access to the requested resource. | 

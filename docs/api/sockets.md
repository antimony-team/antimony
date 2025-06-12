# Socket.IO API

Antimony uses Socket.IO sockets to communicate real-time data such as logs or terminal data and server event data such as status messages. Every type of message has its own Socket.IO namespace. Read more about Socket.IO namespaces [here](https://socket.io/docs/v4/namespaces/).

!!! note "Socket Acknowledgements"
    Socket acknowledgements are return values that are returned by a message receiver to indicate the status of a requested action. Antimony exclusively uses acks in events that are sent **by the client**. The server sends an acknowledgement to communicate possible errors in the processing of a requested action. 

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

The status messages namespace is used by the server to communicate status messages to the client. Status messages are short updates that indicate the progress of certian server actions such as the deployment of labs or deployment problems.

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
        timestamp: string // ISO 8601
        source: string
        content: string
        logContent: string // More detailed, for logging
        severity: int
    }
}
```
</pre></td><td>Server sending a status message to the client</td></tr>
</tbody>
</table>

### Lab Updates

The lab updates namespace is used to communicate changes in a lab's state to the client.

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

Lab log streaming namespaces are a set of spaces that contain the communication of lab logs from the server to the clients.

!!! note "Availability"
    Lab log namespaces are only available once the specified lab has an instance. This means that the lab must have attempted deployment at least once before.

**Namespace:** `/logs/<labId>`

**Flow:** `server -> client`

| Event | Payload | Description |
| -- | -- | -- |
| `data` | `string` | The server streams a new log output line. |
| `backlog` | `string[]` | The server sends a backlog of all previously emited logs to the client. |

### Node Log Streaming

Node log streaming namespaces are a set of namespaces that handle the transmission of node logs from the server to the clients.

!!! note "Availability"
    Node log namespaces are only available once the node lab's instance state is set to `Running` and the respective node is running as well.

**Namespace:** `/logs/<labId>/<node>`

**Flow:** `server -> client`

| Event | Payload | Description |
| -- | -- | -- |
| `data` | `string` | The server streams a new log output line. |
| `backlog` | `string[]` | The server sends a backlog of all previously emited logs to the client. |

### Lab Commands
 
 The lab commands namespace is used by the client to initiate lab actions (e.g. deploying, destroying, etc.). Some commands require the optional `node` field or `shellId` field to be set in order to work.

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
</pre></td><td>Client issuing a lab command to the server</td></tr>
</tbody>
</table>

#### Available Commands

<!-- | Command ID | Name | Description | Successful Return Value |
| -- | -- | -- | -- |
| 0 | Deploy | (Re)deploys the specified lab. |  `{}` |
| 1 | Destroy | Destroys the specified lab. | `{}` |
| 2 | Stop Node | Stops a node within the specified lab. | `{}` |
| 3 | Start Node | Starts a node within the specified lab. | `{}` | 
| 4 | Restart Node | Restarts a node within the specified lab. | `{}` | 
| 5 | Fetch Shells | Returns all currently open shells from the user for the specified lab. | `{ payload: string[] }` | 
| 6 | Open Shell | Opens a new interactive shell with the specified node in the specified lab. | `{ payload: string }` | 
| 7 | Close Shell | Closes a currently open shell. | `{}` |  -->

<table>
  <thead>
    <tr>
      <td>Command ID</td>
      <td>Name</td>
      <td>Description</td>
      <td>Return Value</td>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>0</td>
      <td>Deploy</td>
      <td>(Re)deploys the specified lab.</td>
      <td><code>{}</code></td>
    </tr>
    <tr>
      <td>1</td>
      <td>Destroy</td>
      <td>Destroys the specified lab.</td>
      <td><code>{}</code></td>
    </tr>
    <tr>
      <td>2</td>
      <td>Stop Node</td>
      <td>Stops a node within the specified lab.</td>
      <td><code>{}</code></td>
    </tr>
    <tr>
      <td>3</td>
      <td>Start Node</td>
      <td>Starts a node within the specified lab.</td>
      <td><code>{}</code></td>
    </tr>
    <tr>
      <td>4</td>
      <td>Restart Node</td>
      <td>Restarts a node within the specified lab.</td>
      <td><code>{}</code></td>
    </tr>
    <tr>
      <td>5</td>
      <td>Fetch Shells</td>
      <td>Returns all currently open shells from the user for the specified lab.</td>
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
    </tr>
    <tr>
      <td>6</td>
      <td>Open Shell</td>
      <td>Opens a new interactive shell with the specified node in the specified lab.</td>
      <td>
      ```ts
      {
        payload: string
      }
      ```
      </td>
    </tr>
    <tr>
      <td>7</td>
      <td>Close Shell</td>
      <td>Closes a currently open shell.</td>
      <td><code>{}</code></td>
    </tr>
  </tbody>
</table>


### Shell Commands

The shell commands namespace is used by the server to indicate to the client that something has happened with a currently open shell.

**Namespace:** `/shell-commands`

**Flow:** `server -> client`

<table>
<thead>
<tr><td>Event</td><td>Payload</td><td>Description</td></tr>
</thead>
<tbody>
<tr><td><code>data</code></td><td>
```json
{
    labId: string,
    node: string,
    shellId: string,    
    command: ShellCommand
    message: string
}
```
</pre></td><td>Client issuing a lab command to the server</td></tr>
</tbody>
</table>

#### Available Commands

| Command ID | Name | Description |
| -- | -- | -- |
| 0 | Shell Error | There has been an I/O error with the shell. |
| 1 | Shell Close | The shell has been closed. |

### Shell I/O

Shell I/O namespaces are used by the client and the server to transmit data to and from an interactive shell.

!!! note "Availability"
    A shell I/O namespace becomes available as soon as the client requests to open a shell and receives a shell ID.

**Namespace:** `/shells/<shellId>`

**Flow:** `server -> client` / `client -> server`

| Event | Payload | Description |
| -- | -- | -- |
| `data` | `string` | The client or the server send shell data. |
| `backlog` | `string[]` | The server sends a backlog of all previously generated shell data. |

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
| `5005` | The specified UUID could not be found. |
| `5006` | The specified node could not be found. |
| `5007` | The specified shell could not be found. |
| `5008` | The user has reached the max open shell limit. |
| `5422` | Generic error that is returned when the socket request was invalid. |
| `5403` | Generic error that is returned when the user does not have access to the requested namespace. | 

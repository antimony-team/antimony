# Streaming API

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
<tr><td>data</td><td>
```json
{
    id: string
    timestamp: string // ISO 8601
    source: string
    content: string
    logContent: string // More detailed, for logging
    severity: int
}
```
</pre></td><td>Server sending a status message to the client</td></tr>
</tbody>
</table>

### Lab Updates

The lab updates namespace is used to communicate changes in a lab's state to the client.

**Namespace:** `/lab-updates`

**Flow:** `server -> client`

| Event | Payload | Description |
| ---- | ---- | ---- |
| data | `labId` | Called whenever a specific lab received an update to its state. The client is supposed to re-fetch that lab. |
| data | `""` | Called when multiple labs have been updated. The client is supposed to re-fetch all labs. |

### Lab Log Streaming

Lab log streaming namespaces are a set of spaces that contain the communication of lab logs from the server to the clients.

!!! note "Availability"
    Lab log namespaces are only available when the specified lab is in an active state, meaning the lab's state is neither `Inactive (-1)` nor `Scheduled (-2)`.

**Namespace:** `/logs/<labId>`

**Flow:** `server -> client`

| Event | Payload | Description |
| -- | -- | -- |
| data | `log: string` | The server streams a new log output line. |
| backlog | `logs: string[]` | The server sends a backlog of all previously emited logs to the client. |

### Node Log Streaming

Node log streaming namespaces are a set of spaces that contain the communication of container logs from the server to the clients.

!!! note "Availability"
    Node log namespaces are only available once the node lab's instance state is set to `Running`.

**Namespace:** `/logs/<labId>/<containerId>`

**Flow:** `server -> client`

| Event | Payload | Description |
| -- | -- | -- |
| data | `log: string` | The server streams a new log output line. |
| backlog | `logs: string[]` | The server sends a backlog of all previously emited logs to the client. |

### Lab Commands
 
 The lab commands namespace is used by the client to initiate lab actions (e.g. deploying, destroying, etc.).

**Namespace:** `/lab-commands`

**Flow:** `client -> server`

| Event | Payload | Description |
| -- | -- | -- |
| data | `{ labId: string, command: int, node?: string }` | Emits a lab command to the server. |

#### Available Commands

This namespace can be used to send various commands to the server. Some commands require the optional `node` field to be set in order to work. Here is a list of available commands.

| Command ID | Name | Description | Requires Node |
| -- | -- | -- | -- |
| 0 | Deploy | (Re)deploys the specified lab. |  No |
| 1 | Destroy | Destroys the specified lab. | No |
| 2 | Stop Node | Stops a node within the specified lab. | Yes |
| 3 | Start Node | Starts a node within the specified lab. | Yes | 

## Common Errors

Common errors are errors that can be returned by the server in any namespace.

| Error Code | Description |
| ------ | ------ |
| 5001 | Containerlab returned an error during processing. |
| 5002 | The specified lab is already being deployed. |
| 5422 | Generic error that is returned when the socket request was invalid. |
| 5404 | Generic error that is returned when the user provides any invalid UUID. |
| 5403 | Generic error that is returned when the user does not have access to the requested namespace. | 

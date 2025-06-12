# Configuration

Antimony comes with a lot of different configuration options. All of which can be changed through the config file, environment variables and the provided CLI arguments.


## Authentication

Antimony allows for two different authentication schemes; native authentication via credentials and authentication via OpenID provider. Either of these schemes can be enabled and configurated in the config file.

```yaml title="config.yml"
auth:
  enableNative: true
  enableOpenId: true
```

At least one authentication method needs to be enabled for Antimony to work properly.

!!! tip "Login Screen"
    The Antimony interface will dynamically adjust the login screen to the enabled authentication schemes.

### Native Authentication

Native authentication allows users to authenticate as a static user with credentials that are defined at stat-up. The native user has admin priviledges, meaning it is able to access any of Antimony's resources. Native authentication should mainly be used in testing environments.

When native authentication is enabled, Antimony attempts to read the native user's credentials from environment variables.

The credential environment variables can be defined in the `docker-compose.yml` like so.

```yaml title="docker-compose.yml"
services:
  server:
    environment:
      SB_NATIVE_USERNAME="admin"
      SB_NATIVE_PASSWORD="admin"
```

#### Auto Login
In some cases you might want the Antimony interface to skip the login screen entirely. This can be done by not specifying any credential environment variables or setting them to an empty value.

### Authentication via OpenID

Authentication via OpenID is the proper way to authenticate users in a large-scale Antimony setup. Authentication via OpenID allows for fine-grained user access control to Antimony's resources as well as tracking of lab deployment and management.

If authentication via OpenID is enabled, the OpenID provider, the client ID and the redirect URL can be specified in the config file.

```yaml title="config.yml"
auth:
  openIdIssuer: <your-openid-provider>
  openIdClientId: <your-client-id>
  openIdRedirectHost: <your-redirect-host>  # The server's host (e.g. https://antimony.dev/api)
```

The client secret can be passed to Antimony via an environment variable in the `docker-compose.yml` file.

```yaml title="docker-compose.yml"
services:
  server:
    environment:
      SB_OIDC_SECRET=<your-secret>
```

#### Collection Access

Access to Antimony topology collections is derived from OpenID group memberships. After the OAuth token exchange, the Antimony server fetches user information from the provider's [user info endpoint](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo) and determines what collections the user has access to by *mapping the user's group names to collection names*.

#### Admin Groups

In addition to providing collection access, user groups can also be used to grant admin privileges. You can provide a list of groups that should be treated as admin groups in the Antimony config. If a user is a member in any of the provided admin groups, they are granted admin privileges and have access to all Antimony resources.


```yaml title="config.yml"
auth:
  openIdAdminGroups:
    - <some-admin-group>
```

## Database

Antimony can operate with either a file-based SQLite database or a PostgreSQL database.

### PostgresSQL Database

PostgreSQL is Antimony's default database and will be used if nothing else is specified. You can change the connection details to the database in the config file.

```yaml title="config.yml"
database:
  host: 127.0.0.1
  port: 5432
  database: antimony
  user: antimony
```

If the database is secured with a password, you can provide it to Antimony via an environment variable in the `docker-compose.yml` file.

```yaml title="docker-compose.yml"
services:
  server:
    SB_DATABASE_PASSWORD=<your-password>
```

### SQLite Database

To use the file-based SQLite database instead, simply pass the `sqlite` CLI argument to the Antimony server. In the `docker-compose.yml` file this can be done like so.

```yaml title="docker-compose.yml"
services:
  server:
    command: -config=./config.yml -sqlite=true
```

You can change the database file that Antimony will be using in the config.

```yaml title="config.yml"
database:
  localFile: ./db/antimony.db
```

## Storage Directories

The Antimony server uses file-based storage to save topologies and the runtime topologies that are used by Containerlab.

* **Storage Directory:** Contains all topologies that have been created with Antimony.
* **Run Directory:** Contains runtime the copies of topologies of currently deployed labs. 

!!! warning "Modifying Files"
    Even though Antimony is treating any topologies with missing files as invalid, it is strongly discouraged to modify any files in the storage directories.


The paths to the storage directories can be changed in the config file.

```yaml title="config.yml"
fileSystem:
  storage: ./path/to/storage
  run: ./path/to/run
```

## HTTPS Certificate

By default, Traefik generates a self-signed certificate for all Antimony services. You can switch to a [Let's Encrypt](https://letsencrypt.org/) certificate if Antimony is hosted on an external server.

To do so, uncomment the following lines in the `docker-compose.yml` and replace the example domain with your server's hostname.

```yaml title="docker-compose.yml"

services:
  interface:
    labels:
      - traefik.http.routers.interface.tls.domains[0].main=<your-domain.com>
  server:
    labels:
      - traefik.http.routers.server-socket.tls.domains[0].main=<your-domain.com>
      - traefik.http.routers.server-api.tls.domains[0].main=<your-domain.com>

```
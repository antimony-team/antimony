# Configuration

Antimony comes with a lot of different configuration options. All of which can be found in the config file, in environment variables and in CLI arguments.

## Authentication

By default, Antimony allows native login with a username and password defined via environment variables. Native authentication as well as authentication via OpenID connect can be configured in the config file.

```yaml title="config.yml"
auth:
  enableNative: true
  enableOpenId: true

  openIdIssuer: "<openid-provider>"
  openIdClientId: "<client-id>"
  openIdAdminGroups:
    - "<some-admin-group>
```

### Admin Groups

When authentication via OpenID is enabled, its possible to define a list of groups that are considered admins. If a user is in any of these groups they will be granted Antimony admin privileges.

### Native Credentials

When native login is enabled, you can pass the natives user's credentials to Antimony via environment variables. The native user has Antimony admin privileges.

```bash
export SB_NATIVE_USERNAME="admin"
export SB_NATIVE_PASSWORD="admin"
```

!!! note "Empty Credentials"
    If you enable native login, but don't set the environment variables, you will be able to login with empty credentials. Antimony will log a warning during startup.

## Database

Antimony can be used with either a file-based SQLite database or a PostgreSQL database. The default docker compose setup uses a SQLite database that is mounted as a volume into the docker container.

### PostgresSQL Database

To use the PostgreSQL database, simply don't supply any additional CLI arguments to the Antimony server and specify the *connection parameters* in the config file.

```yaml title="config.yml"
database:
  host: 127.0.0.1
  user: antimony
  database: antimony
  port: 5432
```

If the database is secured with a password, you can provide it to Antimony via the `SB_DATABASE_PASSWORD` environment variable.

```bash
export SB_DATABASE_PASSWORD="password123"
```

### SQLite Database

To use the file-based SQLite database instead, pass the `sqlite` CLI argument to the Antimony server.

```bash
./antimony-server -sqlite=true
```

You can change the database file that Antimony will be using in the config.

```yaml title="config.yml"
database:
  localFile: ./db/antimony.db
```

## Storage Directories

The Antimony server uses file-based storage to save topologies and runtime topologies.

!!! warning "Modifying Files"
    It is strongly discouraged to modify any files in the storage directories in order to not mess with Antimony.

* **Storage Directory:** Contains all topologies that have been created with Antimony.
* **Run Directory:** Contains runtime the copies of topologies of currently deployed labs. 

The paths to the storage directories can be changed in the config file.

```yaml title="config.yml"
fileSystem:
  storage: ./storage/
  run: ./run/
```
---
hide:
  - navigation
---

# Quick Start

## Local Deployment

To deploy Antimony locally, simply use the pre-configured docker compose script in the [main repository](https://github.com/antimony-team/antimony).

```bash
git clone https://github.com/antimony-team/antimony

docker compose up
```

!!! info "Docker Desktop"
    If you are using Docker Desktop on Linux, you might have to explicitly specify the docker host to be set to the `dockerd` socket.

    ```bash
    DOCKER_HOST=unix:///var/run/docker.sock docker compose up
    ```

## Login

The default login is `admin:admin`. To change this, change the environment variables `SB_NATIVE_USERNAME` and `SB_NATIVE_PASSWORD` in the docker compose file.

```yaml
environment:
  - SB_NATIVE_USERNAME=admin
  - SB_NATIVE_PASSWORD=admin
```

## Database

By default, Antimony uses a SQLite database. This can be changed by removing the `-sqlite=true` command line argument in the docker compose file.

If a postgres database is used, you have to set the connection details in the configuration file and use an environment variable to set the database password. 

```yaml title="docker-compose.yml"
environment:
  - SB_DATABASE_PASSWORD=password123
```

```yaml title="config.yml"
database:
  host: 127.0.0.1
  user: antimony
  database: antimony
  port: 5432
```


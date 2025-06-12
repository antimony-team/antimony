# Developer Guide

Antimony was started as a bachelor's thesis by [Kian Gribi](https://www.linkedin.com/in/kiangribi) and [Tom Stromer](https://www.linkedin.com/in/tom-stromer/) and is now an open-source project, maintained by the [Institute for Networking](https://www.ost.ch/de/forschung-und-dienstleistungen/informatik/ins-institut-fuer-netzwerke-und-sicherheit) at [OST](ost.ch).

Contributions to Antimony are welcome and highly appreciated! This guide goes into setting up the development environment and deploying the Antimony services locally.

## Repository Setup

Antimony's code base is separated into three main repositories.

* **[antimony-team/antimony](https://github.com/antimony-team/antimony)**  
    Contains the documentation as well as all the deployment and configuration files.
* **[antimony-team/antimony-server](https://github.com/antimony-team/antimony-server)**  
    Contains the code base for the Antimony server.
* **[antimony-team/antimony-interface](https://github.com/antimony-team/antimony-interface)**  
    Contains the code base for Antimony's interface.

## Antimony Interface

The Antimony Interface is the frontend part of Antimony, written in React and TypeScript. Deploying the interface locally is pretty straight-forward.

### Prerequisites

Before you begin with the development, you will need to install the following tools.

* [Yarn](https://yarnpkg.com/)
* [Docker](https://www.docker.com/) (Optional, for building the Docker image)

### Environment Setup

```bash
# Step 1: Clone the repository
git clone https://github.com/antimony-team/antimony-interface
cd antimony-interface

# Step 2: Install all the dependencies
yarn install

# Step 3: Run the devserver
yarn run strt

# Step 4: Run the gts linters to check the files
yarn run lint

# Step 5: Build a production release
yarn run build:prod

# Step 5: Build a docker image with the production release
yarn run build:docker
```

!!! note "Webpack Dev Server"
    When running live dev server, webpack automatically sets up a reverse proxy that redirects all requests to `/api` and `/socket.io` to an Antimony server hosted at `localhost:3000`.

## Antimony Server

The Antimony Server is the backend part of Antimony, written in GoLang.

### Prerequisites

Before you begin with the development, you will need to install the following tools.

* [Go](https://go.dev/)
* [Taskfile](https://taskfile.dev/)
* [Docker](https://www.docker.com/) (Optional, for building the Docker image)

### Environment Setup

Due to the way the OAuth authentication flow works, the OpenID provider URL is required to be identical for the server and the client. Because of this, it is not possible to run both the Antimony server and an OpenID provider on the same host when accessing the OpenID provider through `localhost`.

Therefore, we provide two different ways to running the Antimony server loally.

* **On the Host** (With an OpenID provider running in a container)
* **Inside a Container** (Without OpenID authentication)

!!! note "Go Task Binary"
    Depending on your environment, the `go-task` binary might be called `task` instead.

#### Running on the Host

Running the server on the host will use the configuration located in `./test/config.test.yml`.

This config enables authentication via OpenID and contains the Keycloak test provider URL (hosted at `http://localhost:4022`). The Keycloak test server is pre-configured with a realm file that is imported when the container is started. The realm includes the following users.

| Username | Password | Group Memberships | Is Admin |
| - | - | - | - |
| zoey101 | 123 | `fs25-cldinf`, `fs25-nisec`, `hs52-cn1`, `hs25-cn2` | false |
| mynamejeff | 123 | `antimony-admin` | true |

!!! tip "Keycloak Console"
    The keycloak admin console can be accessed at `http://localhost:4022` with the default credentials `admin:admin` after the server is started.


```bash
# Step 1: Clone the repository
git clone https://github.com/antimony-team/antimony-server
cd antimony-server

# Step 2: Deploying the Keycloak test server and the PostgreSQL server
docker compose up

# Step 3: Starting the server
go-task run
```

When running the server on the host, the task will create a `./build` folder in which it copies all the necessary runtime files that looks as follows.

```bash
build/
  ├── data/             # Copy of ../data/ 
  ├── storage/          # The storage directory
  ├── run/              # The run storage directory
  ├── antimony-server   # The compiled executable
  └── config.yml        # The config file
```

#### Running Inside a Container

Running the server inside a container will use the configuration located in `./test/config.docker.yml`. Running the server like this will disable authentication via OpenID and use a file-based SQLite database by default.

```bash
# Step 1: Clone the repository
git clone https://github.com/antimony-team/antimony-server
cd antimony-server

# Step 2: Building and running the Docker container
go-task run-docker
```

When running the server inside a Docker container, the task will create a `./docker` folder in which it copies all the necessary runtime files that looks as follows.

```bash
docker/
  ├── data/             # Copy of ../data/ 
  ├── storage/          # The storage directory
  ├── run/              # The run storage directory
  ├── antimony-server   # The compiled executable
  └── config.yml        # The config file
```

### Cleanup

The following commands can be used to completely reset the development environment.

```bash
# Step 1: Stop the containers (If any have been started)
docker compose down

# Step 2: Remove the database files (If PostgreSQL has been used)
rm -rf ./db

# Step 3: Run the clean-up task
go-task clean
```

### Running Tests

The following command will run all API and unit tests and generate a coverage report.

```bash
# Step 1: Run the tests 
go-task test

# Step 2: Generate a coverage analysis
go-task test-coverage
```

### Running Linters

The following commands can be used to run all `golangci-lint` linters and format the source files.


```bash
# Step 1: Run all linters and return results
go-task lint

# Step 2: Automatically format all the source files
go-task lint-fmt
```

### Swagger Documentation

The swagger documentation is automatically generated and hosted at `https://localhost:3000/swagger/index.html`. 

!!! tip "Authentication"
    Authentication via bearer token does not work as Antimony uses auth cookies for authentication. Instead, send your credentials to the `/users/login/native` end point to acquire the cookie before executing any other requests.
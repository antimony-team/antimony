# Antimony
A visual approach to designing Containerlab networks.

<img src="./assets/zoey.png" alt="zoey" style="zoom: 33%" />

## About

Antimony is a 2025 student project of the [University of Applied Science Rapperswil](https://www.ost.ch) (OST). It is meant to provide the first comprehensive graphical user interface for the [Containerlab](https://containerlab.dev/) / [Clabernetes](https://containerlab.dev/manual/clabernetes/) tool chain.

Antimony is still in its prototype phase and currently only exist as a frontend. The complementary backend is planned to be implemented in the upcoming semesters. As of right now, its only practical use is as a Containerlab topology file editor.

## Dependencies

- Node v22.9.0+

## How to Start

There exist two different builds of Antimony right now; the online build and the offline build.

### The Offline Build

The offline build can be deployed standalone. It only provides topology editor functionality and does not support the deployment or management of Containerlab instances.

It is served on `localhost:8100` by default. This can be changed in `./start.js`.

```bash
yarn install

yarn run build-offline:prod		# For the production version
yarn run build-offline:dev		# For the development version

node ./start.js
```

### The Online Build

The online build requires a backend which does not exist yet. For testing purposes, we implemented a simple mock backend that handles all API calls and creates fake deployments.

It is served on `localhost:8100` by default. This can be changed in `./start.js`.

The frontend requires the Antimony API and the web socket to be accessible at `/api` so we need to also create a proxy , which redirects all the HTTP traffic from `localhost:8100/api` to `localhost:3000`. This can be done with the `--with-proxy` argument.

The proxy URL defaults to `localhost:3000` as this is where the mock backend is being served by default. This can be overridden with the `PROXY_URL` environment variable.

```bash
yarn install

yarn run build:prod		# For the production version
yarn run build:dev		# For the development version

yarn run server			# Starts the mockserver with predefined testing data

node ./start.js --with-proxy
```

#### Default Credentials

The test data includes a default user with the credentials `admin` /`admin`. This and other testing data can be found in `server/data/`.

#### Note on the Mock Server

The mock server loads the test data at startup and stores it in-memory until the application exits. This means, that all changes made to the data are transient and will be wiped once the server restarts.

The server is able to simulate the deployment of topologies. There is a 50/50 chance for the deployment to either fail or succeed.

### Run the Devserver

The webpack devserver will be served on `localhost:8080`. This can be changed in `webpack.dev.cjs`.

```bash
yarn install

yarn run start			# Starts the online version
yarn run start-offline	# Starts the offline version
```

# Credits

Authors: Kian Gribi, Tom Stromer

Project Lead: Jan Untersander

Project Lecturer: Prof. Dr. Markus Stolze



All of Antimony's icons are either taken from PrimeReact's Icon library, Material Symbols, or were designed by ourselves. Antimony's mascot Zoey was generated with the help of DALL-E 3 and SDXL.

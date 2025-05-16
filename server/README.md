# Antimony Backend
Middleware that connects the Antimony Interface to the containerlab toolchain.

## Dev doc
### Running the dev slim backend
To run a dev build of the slim backend using Containerlab you can use the following commands:
```bash
docker compose -f docker-compose-clab-simple.yaml up --build
```
It uses the sqlite database backend, per default no OIDC, and can be configured with changing the [config.default.yml](config.default.yml)

## Considerations
### Only admins can add collections
This is due to collection access being managed by the OpenID provider. If a non-admin was to create a new collection, they wouldn't have access to it until the OpenID provider allows it.
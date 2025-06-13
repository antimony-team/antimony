# RESTful API

Antimony's RESTful API is the primary way to communicate with the Antimony server and create, edit and delete its resources. The API is divided into resources which resemble Antimony's primary domain objects.

Read more about the domain [here](../implementation/architecture.md#the-domain).

## Authentication

Most calls to the RESTful API need to be authenticated. Learn more about authentication [here](../implementation/authentication.md).

To authenticate yourself with native credentials, the `/users/login/native` endpoint can be used. To refresh your access token, use the `/users/login/refresh` endpoint.

<swagger-ui src="https://raw.githubusercontent.com/antimony-team/antimony-backend/refs/heads/development/src/docs/swagger.json"/>
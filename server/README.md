# Antimony Backend
Middleware that connects the Antimony Interface to the containerlab toolchain.

## Considerations
### Only admins can add collections
This is due to collection access being managed by the OpenID provider. If a non-admin was to create a new collection, they wouldn't have access to it until the OpenID provider allows it.
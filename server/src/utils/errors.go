package utils

import "errors"

var ErrorRunningLab = errors.New("unable to modify running lab")
var ErrorOpenIDError = errors.New("failed to authenticate via openid connect")
var ErrorUuidNotFound = errors.New("the specified uuid was not found")
var ErrorTokenInvalid = errors.New("the auth token provided was invalid")
var ErrorCollectionExists = errors.New("a collection with that name already exists")
var ErrorInvalidCredentials = errors.New("the credentials provided were invalid")

var ErrorUnauthorized = errors.New("the request was unauthorized")
var ErrorForbidden = errors.New("access to the requested action is forbidden")
var ErrorNoWriteAccessToLab = errors.New("write access to the provided lab is not granted")
var ErrorNoWriteAccessToTopology = errors.New("write access to the provided topology is not granted")
var ErrorNoWriteAccessToCollection = errors.New("write access to the provided collection is not granted")
var ErrorNoDeployAccessToCollection = errors.New("deploy access to the provided collection is not granted")
var ErrorNoPermissionToCreateCollections = errors.New("permission to create collections is not granted")

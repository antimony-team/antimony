package utils

import "errors"

/*
 * Generic errors.
 */
var ErrorAntimony = errors.New("the antimony server encountered an error. please check the logs")
var ErrorContainerlab = errors.New("the containerlab subprocess encountered an error")
var ErrorDatabaseError = errors.New("the antimony database encountered an error. please check the logs")
var ErrorFileStorage = errors.New("the antimony storage service encountered an error. please check the logs")
var ErrorOpenIDError = errors.New("failed to authenticate via openid connect")

/*
 * Not found errors.
 */
var ErrorUuidNotFound = errors.New("the specified uuid was not found")
var ErrorNodeNotFound = errors.New("the specified node was not found")
var ErrorShellNotFound = errors.New("the provided shell id does not exist")

/*
 * Input processing errors.
 */
var ErrorLabRunning = errors.New("modifications to a running lab are not allowed")
var ErrorTopologyExists = errors.New("a topology with that name already exists in that collection")
var ErrorBindFileExists = errors.New("a file with that path already exists for that topology")
var ErrorCollectionExists = errors.New("a collection with that name already exists")
var ErrorInvalidTopology = errors.New("the topology provided were invalid")

/*
 * Permission / Access errors.
 */
var ErrorOpenIDAuthDisabledError = errors.New("authentication via openid is disabled")
var ErrorNativeAuthDisabledError = errors.New("native authentication is disabled")
var ErrorInvalidCredentials = errors.New("the provided native credentials were invalid")
var ErrorTokenInvalid = errors.New("the auth token provided was invalid")
var ErrorUnauthorized = errors.New("the request was unauthorized")
var ErrorForbidden = errors.New("access to the requested resource is forbidden")
var ErrorNoAccessToLab = errors.New("access to the provided lab is not granted")
var ErrorNoWriteAccessToLab = errors.New("write access to the provided lab is not granted")
var ErrorNoWriteAccessToTopology = errors.New("write access to the provided topology is not granted")
var ErrorNoWriteAccessToBindFile = errors.New("write access to the provided file is not granted")
var ErrorNoWriteAccessToCollection = errors.New("write access to the provided collection is not granted")
var ErrorNoDeployAccessToLab = errors.New("deploy access to the provided lab is not granted")
var ErrorNoDestroyAccessToLab = errors.New("destroy access to the provided lab is not granted")
var ErrorNoDeployAccessToCollection = errors.New("deploy access to the provided collection is not granted")
var ErrorNoPermissionToCreateCollections = errors.New("permission to create collections is not granted")

/*
 * Socket-exclusive errors.
 */
var ErrorLabNotRunning = errors.New("the specified lab is not running")
var ErrorShellLimitReached = errors.New("user shell limit reached")
var ErrorNodeNotRunning = errors.New("the specified node is not running")
var ErrorLabIsDeploying = errors.New("the specified lab is already being deployed")
var ErrorInvalidLabCommand = errors.New("the provided lab command was invalid")
var ErrorNoAccessToShell = errors.New("access to the provided shell is not granted")
var ErrorInvalidSocketRequest = errors.New("the socket request was invalid")

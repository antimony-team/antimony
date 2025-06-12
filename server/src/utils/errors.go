package utils

import "errors"

/*
 * Generic errors.
 */

var ErrAntimony = errors.New("the antimony server encountered an error. please check the logs")
var ErrContainerlab = errors.New("the containerlab subprocess encountered an error")
var ErrDatabaseError = errors.New("the antimony database encountered an error. please check the logs")
var ErrFileStorage = errors.New("the antimony storage service encountered an error. please check the logs")
var ErrOpenIDError = errors.New("failed to authenticate via openid connect")

/*
 * Not found errors.
 */

var ErrUuidNotFound = errors.New("the specified uuid was not found")
var ErrNodeNotFound = errors.New("the specified node was not found")
var ErrShellNotFound = errors.New("the provided shell id does not exist")

/*
 * Input processing errors.
 */

var ErrLabRunning = errors.New("modifications to a running lab are not allowed")
var ErrTopologyExists = errors.New("a topology with that name already exists in that collection")
var ErrBindFileExists = errors.New("a file with that path already exists for that topology")
var ErrCollectionExists = errors.New("a collection with that name already exists")
var ErrInvalidTopology = errors.New("the topology provided were invalid")
var ErrInvalidBindFilePath = errors.New("the provided bind file path was invalid")

/*
 * Permission / Access errors.
 */

var ErrOpenIDAuthDisabledError = errors.New("authentication via openid is disabled")
var ErrNativeAuthDisabledError = errors.New("native authentication is disabled")
var ErrInvalidCredentials = errors.New("the provided native credentials were invalid")
var ErrTokenInvalid = errors.New("the auth token provided was invalid")
var ErrUnauthorized = errors.New("the request was unauthorized")
var ErrForbidden = errors.New("access to the requested resource is forbidden")
var ErrNoAccessToLab = errors.New("access to the provided lab is not granted")
var ErrNoWriteAccessToLab = errors.New("write access to the provided lab is not granted")
var ErrNoWriteAccessToTopology = errors.New("write access to the provided topology is not granted")
var ErrNoWriteAccessToBindFile = errors.New("write access to the provided file is not granted")
var ErrNoWriteAccessToCollection = errors.New("write access to the provided collection is not granted")
var ErrNoDeployAccessToLab = errors.New("deploy access to the provided lab is not granted")
var ErrNoDestroyAccessToLab = errors.New("destroy access to the provided lab is not granted")
var ErrNoDeployAccessToCollection = errors.New("deploy access to the provided collection is not granted")
var ErrNoPermissionToCreateCollections = errors.New("permission to create collections is not granted")

/*
 * Socket-exclusive errors.
 */

var ErrLabNotRunning = errors.New("the specified lab is not running")
var ErrShellLimitReached = errors.New("user shell limit reached")
var ErrNodeNotRunning = errors.New("the specified node is not running")
var ErrLabIsDeploying = errors.New("the specified lab is already being deployed")
var ErrInvalidLabCommand = errors.New("the provided lab command was invalid")
var ErrNoAccessToShell = errors.New("access to the provided shell is not granted")
var ErrInvalidSocketRequest = errors.New("the socket request was invalid")

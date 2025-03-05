package utils

import "errors"

var ErrorServer = errors.New("there was a problem processing the request")
var ErrorRunningLab = errors.New("unable to modify running lab")
var ErrorUuidNotFound = errors.New("the specified uuid was not found")
var ErrorValidationError = errors.New("the data provided was invalid")
var ErrorInvalidCredentials = errors.New("the credentials provided were invalid")

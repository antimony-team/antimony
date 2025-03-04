package utils

import "errors"

var ErrorUuidNotFound = errors.New("the specified uuid was not found")
var ErrorInvalidCredentials = errors.New("the credentials provided were invalid")

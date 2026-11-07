package utils

import "context"

type Worker struct {
	Context context.Context
	Cancel  context.CancelFunc
}

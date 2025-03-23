package events

import (
	"antimonyBackend/types"
	"time"
)

type NotificationEventData struct {
	Content   string
	Timestamp time.Time
	Type      types.Severity
	Receivers []string
}

type NotificationReceiverType int

const (
	// All Everyone receives the message
	All NotificationReceiverType = iota

	// ReceiverList Everyone in the receiver list receives the message
	ReceiverList

	// Admins All admins receive the message
	Admins
)

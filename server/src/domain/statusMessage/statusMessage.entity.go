package statusMessage

import (
	"antimonyBackend/domain/user"
	"gorm.io/gorm"
	"time"
)

type StatusMessage struct {
	gorm.Model
	Content   string
	Timestamp time.Time
	Type      StatusMessageType
	Receivers []user.User `gorm:"many2many:user_status_messages;"`
}

type StatusMessageOut struct {
	Content   string            `json:"content"`
	Timestamp time.Time         `json:"timestamp"`
	Type      StatusMessageType `json:"type"`
}

type StatusMessageType int

const (
	Success StatusMessageType = iota
	Info
	Warning
	Error
	Fatal
)

package statusMessage

import (
	"antimonyBackend/domain/user"
	"antimonyBackend/events"
	"antimonyBackend/types"
)

type (
	Service interface {
	}

	statusMessageService struct {
		userRepo          user.Repository
		notificationEvent events.Event[events.NotificationEventData]
	}
)

func CreateService(userRepo user.Repository, notificationEvent events.Event[events.NotificationEventData]) Service {
	statusMessageService := &statusMessageService{
		userRepo:          userRepo,
		notificationEvent: notificationEvent,
	}

	notificationHandler := statusMessageService.OnNotification
	notificationEvent.Subscribe(&notificationHandler)

	return statusMessageService
}

func (s *statusMessageService) OnNotification(notification events.NotificationEventData) {

}

type StatusMessageFilter struct {
	Limit          int              `query:"limit"`
	Offset         int              `query:"offset"`
	SeverityFilter []types.Severity `query:"severityFilter"`
}

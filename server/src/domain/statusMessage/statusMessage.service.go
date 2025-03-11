package statusMessage

import (
	"antimonyBackend/utils"
	"github.com/gin-gonic/gin"
	socketio "github.com/googollee/go-socket.io"
)

type (
	Service interface {
		Get(ctx *gin.Context, userId string, filter StatusMessageFilter) ([]StatusMessageOut, error)
	}

	statusMessageService struct {
		statusMessageRepo Repository
		socketServer      *socketio.Server
	}
)

func CreateService(userRepo Repository, socketServer *socketio.Server) Service {
	return &statusMessageService{
		statusMessageRepo: userRepo,
		socketServer:      socketServer,
	}
}

func (s *statusMessageService) Get(ctx *gin.Context, userId string, filter StatusMessageFilter) ([]StatusMessageOut, error) {
	allMessages, err := s.statusMessageRepo.Get(ctx, userId)
	if err != nil {
		return nil, err
	}

	result := make([]StatusMessageOut, 0)
	for _, statusMessage := range utils.GetItemsFromList(allMessages, filter.Limit, filter.Offset) {
		result = append(result, StatusMessageOut{
			Type:      statusMessage.Type,
			Content:   statusMessage.Content,
			Timestamp: statusMessage.Timestamp,
		})
	}

	return result, nil
}

type StatusMessageFilter struct {
	Limit  int `query:"limit"`
	Offset int `query:"offset"`
}

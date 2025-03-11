package instance

import (
	"antimonyBackend/config"
	socketio "github.com/googollee/go-socket.io"
)

type (
	Service interface {
		Init()
		GetInstanceForLab(labId string) *Instance
	}

	instanceService struct {
		instances    map[string]Instance
		socketServer *socketio.Server
	}
)

func CreateService(config *config.AntimonyConfig, socketServer *socketio.Server) Service {
	instanceService := &instanceService{
		instances:    make(map[string]Instance),
		socketServer: socketServer,
	}

	instanceService.Init()

	return instanceService
}

func (s *instanceService) Init() {
	s.socketServer.OnEvent("/instances", string(Deploy), s.onDeploy)
	s.socketServer.OnEvent("/instances", string(Destroy), s.onDestroy)
	s.socketServer.OnEvent("/instances", string(Redeploy), s.onRedeploy)
	s.socketServer.OnEvent("/instances", string(StartNode), s.onStartNode)
	s.socketServer.OnEvent("/instances", string(StopNode), s.onStopNode)
	s.socketServer.OnEvent("/instances", string(SaveNode), s.onSaveNode)
}

func (s *instanceService) onDeploy(c socketio.Conn, msg string)    {}
func (s *instanceService) onDestroy(c socketio.Conn, msg string)   {}
func (s *instanceService) onRedeploy(c socketio.Conn, msg string)  {}
func (s *instanceService) onStopNode(c socketio.Conn, msg string)  {}
func (s *instanceService) onStartNode(c socketio.Conn, msg string) {}
func (s *instanceService) onSaveNode(c socketio.Conn, msg string)  {}

func (s *instanceService) handleCommand(command InstanceCommand) error {
	switch command {
	case Destroy:
		panic("implement me")
	case Redeploy:
		panic("implement me")
	case SaveNode:
		panic("implement me")
	case StopNode:
		panic("implement me")
	case StartNode:
		panic("implement me")
	}

	return nil
}

func (s *instanceService) GetInstanceForLab(labId string) *Instance {
	instance, exists := s.instances[labId]
	if exists {
		return &instance
	}
	return nil
}

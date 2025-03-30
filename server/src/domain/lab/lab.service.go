package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"slices"
	"sort"
	"sync"
	"time"
)

type (
	Service interface {
		Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]LabOut, error)
		Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req LabIn, labId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error
	}

	labService struct {
		labRepo                Repository
		userRepo               user.Repository
		topologyRepo           topology.Repository
		labScheduleMutex       *sync.Mutex
		labSchedule            []Lab
		runningInstances       map[string]*Instance
		deploymentProvider     deployment.DeploymentProvider
		socketManager          socket.SocketManager
		labUpdatesNamespace    socket.NamespaceManager[string]
		statusMessageNamespace socket.NamespaceManager[statusMessage.StatusMessage]
	}
)

func CreateService(
	labRepo Repository,
	userRepo user.Repository,
	topologyRepo topology.Repository,
	socketManager socket.SocketManager,
	statusMessageNamespace socket.NamespaceManager[statusMessage.StatusMessage],
) Service {
	labSchedule, err := labRepo.GetAll()
	if err != nil {
		log.Fatal("Failed to load scheduled labs from database. Exiting.")
	}

	labService := &labService{
		labRepo:                labRepo,
		userRepo:               userRepo,
		topologyRepo:           topologyRepo,
		labScheduleMutex:       &sync.Mutex{},
		labSchedule:            labSchedule,
		runningInstances:       make(map[string]*Instance),
		deploymentProvider:     &deployment.ContainerlabProvider{},
		socketManager:          socketManager,
		labUpdatesNamespace:    socket.CreateNamespace[string](socketManager, false, false, "lab-updates"),
		statusMessageNamespace: statusMessageNamespace,
	}

	go labService.RunScheduler()

	return labService
}

func (s *labService) RunScheduler() {
	for {
		if len(s.labSchedule) > 0 && s.labSchedule[0].StartTime.Unix() <= time.Now().Unix() {
			s.deployLab(s.labSchedule[0])

			// Remove lab from schedule list
			s.labScheduleMutex.Lock()
			s.labSchedule = s.labSchedule[1:]
			s.labScheduleMutex.Unlock()
		}
		time.Sleep(5 * time.Second)
	}
}

func (s *labService) deployLab(lab Lab) {
	topologyFile := fmt.Sprintf("storage/%s/topology.clab.yaml", lab.Topology.UUID)

	log.Infof("[SCHEDULER] Deploying topology %s (%s)", lab.Name, lab.Topology.Name)
	s.statusMessageNamespace.Send(statusMessage.Info(
		"Lab Scheduler", fmt.Sprintf("Deploying topology %s (%s)", lab.Name, lab.Topology.Name),
	))

	s.runningInstances[lab.UUID] = s.createInstance()

	logNamespace := socket.CreateNamespace[string](s.socketManager, false, true, "logs", lab.UUID)
	s.UpdateInstanceState(lab, InstanceStates.Deploying)

	ctx := context.Background()
	go s.deploymentProvider.Deploy(ctx, topologyFile, logNamespace.Send, func(_ *string, err error) {
		if err != nil {
			log.Infof("[SCHEDULER] Failed to deploy lab %s: %s", lab.Name, err.Error())
			s.statusMessageNamespace.Send(statusMessage.Error(
				"Lab Scheduler", fmt.Sprintf("Failed to deploy lab %s: %s", lab.Name, err.Error()),
			))

			s.UpdateInstanceState(lab, InstanceStates.Failed)
		} else {
			// Fetch and attach lab runtime info and change state to running if successful
			s.deploymentProvider.Inspect(ctx, topologyFile, logNamespace.Send, func(output *deployment.InspectOutput, err error) {
				if err != nil {
					log.Infof("[SCHEDULER] Failed to inspect lab %s: %s", lab.Name, err.Error())
					s.UpdateInstanceState(lab, InstanceStates.Failed)
				} else {
					log.Infof("[SCHEDULER] Successfully deployed lab %s!", lab.Name)
					s.runningInstances[lab.UUID].Nodes = s.parseInspectOutput(*output)
					s.UpdateInstanceState(lab, InstanceStates.Running)

					s.statusMessageNamespace.Send(statusMessage.Success(
						"Lab Scheduler", fmt.Sprintf("Successfully deployed lab %s!", lab.Name),
					))
				}
			})
		}
	})
}

func (s *labService) createInstance() *Instance {
	return &Instance{
		Deployed:          time.Now(),
		LatestStateChange: time.Now(),
		State:             InstanceStates.Deploying,
	}
}

func (s *labService) parseInspectOutput(info deployment.InspectOutput) []InstanceNode {
	return lo.Map(info.Containers, func(container deployment.InspectContainer, index int) InstanceNode {
		return InstanceNode{
			Name:  container.Name,
			User:  "ins",
			Port:  50005,
			IPv4:  container.IPv4Address,
			IPv6:  container.IPv6Address,
			State: container.State,
		}
	})
}

func (s *labService) UpdateInstanceState(lab Lab, state InstanceState) {
	s.runningInstances[lab.UUID].State = state
	s.runningInstances[lab.UUID].LatestStateChange = time.Now()

	// Send lab update to namespace so clients can refresh
	s.labUpdatesNamespace.Send(lab.UUID)
}

func (s *labService) Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]LabOut, error) {
	var (
		labs []Lab
		err  error
	)

	if authUser.IsAdmin {
		labs, err = s.labRepo.GetAll()
	} else {
		labs, err = s.labRepo.GetFromCollections(ctx, authUser.Collections)
	}
	if err != nil {
		return nil, err
	}

	result := make([]LabOut, len(labs))
	for i, lab := range labs {
		result[i] = LabOut{
			ID:           lab.UUID,
			Name:         lab.Name,
			StartTime:    lab.StartTime,
			EndTime:      lab.EndTime,
			TopologyId:   lab.Topology.UUID,
			CollectionId: lab.Topology.Collection.UUID,
			Creator:      s.userRepo.UserToOut(lab.Creator),
			Instance:     s.runningInstances[lab.UUID],
		}
	}

	return result, err
}

func (s *labService) Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error) {
	labTopology, err := s.topologyRepo.GetByUuid(ctx, req.TopologyId)
	if err != nil {
		return "", err
	}
	// Deny request if user does not have access to the lab topology's collection
	if !authUser.IsAdmin && (!labTopology.Collection.PublicDeploy || !slices.Contains(authUser.Collections, labTopology.Collection.Name)) {
		return "", utils.ErrorNoDeployAccessToCollection
	}

	log.Errorf("Start date: %s", req.StartTime)

	creatorUser, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		log.Errorf("lab create uuid: %+v", authUser)

		return "", utils.ErrorUnauthorized
	}

	newUuid := utils.GenerateUuid()
	lab := &Lab{
		UUID:      newUuid,
		Name:      req.Name,
		StartTime: req.StartTime,
		EndTime:   req.EndTime,
		Creator:   *creatorUser,
		Topology:  *labTopology,
	}

	// Add created lab to schedule if it was successfully added to the database
	if err := s.labRepo.Create(ctx, lab); err == nil {
		s.scheduleLab(*lab)
	}

	log.Errorf("created: %v", lab)

	return newUuid, err
}

func (s *labService) Update(ctx *gin.Context, req LabIn, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrorNoWriteAccessToLab
	}

	// Don't allow modifications to running labs
	if _, hasInstance := s.runningInstances[lab.UUID]; hasInstance {
		return utils.ErrorRunningLab
	}

	labTopology, err := s.topologyRepo.GetByUuid(ctx, req.TopologyId)
	if err != nil {
		return err
	}

	lab.Name = req.Name
	lab.StartTime = req.StartTime
	lab.EndTime = req.EndTime
	lab.Topology = *labTopology

	return s.labRepo.Update(ctx, lab)
}

func (s *labService) Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrorNoWriteAccessToLab
	}

	// Don't allow the deletion of running labs
	if _, hasInstance := s.runningInstances[lab.UUID]; hasInstance {
		return utils.ErrorRunningLab
	}

	return s.labRepo.Delete(ctx, lab)
}

func (s *labService) scheduleLab(lab Lab) {
	insertIndex := sort.Search(len(s.labSchedule), func(i int) bool {
		return s.labSchedule[i].StartTime.Unix() >= lab.StartTime.Unix()
	})

	if insertIndex == len(s.labSchedule) {
		s.labScheduleMutex.Lock()
		s.labSchedule = append(s.labSchedule, lab)
		s.labScheduleMutex.Unlock()
		return
	}

	s.labScheduleMutex.Lock()
	s.labSchedule = append(s.labSchedule[:insertIndex+1], s.labSchedule[insertIndex:]...)
	s.labSchedule[insertIndex] = lab
	s.labScheduleMutex.Unlock()
}

package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"context"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"gopkg.in/yaml.v3"
	"slices"
	"sort"
	"sync"
	"time"
)

type (
	Service interface {
		// RunScheduler Starts looping through all scheduled labs and waits to deploy them
		RunScheduler()
		Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]LabOut, error)
		Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req LabIn, labId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error
	}

	labService struct {
		// Ordered list of currently scheduled labs. Ordered by start time.
		labSchedule []Lab

		// Set of currently scheduled labs indexed by lab ID
		scheduledLabs map[string]struct{}

		// Mutex for labSchedule and scheduledLabs operations
		labScheduleMutex *sync.Mutex

		// Map of currently running instances indexed by lab ID
		runningInstances map[string]*Instance

		labRepo                Repository
		userRepo               user.Repository
		topologyRepo           topology.Repository
		storageManager         storage.StorageManager
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
	storageManager storage.StorageManager,
	socketManager socket.SocketManager,
	statusMessageNamespace socket.NamespaceManager[statusMessage.StatusMessage],
) Service {
	labService := &labService{
		labRepo:                labRepo,
		userRepo:               userRepo,
		topologyRepo:           topologyRepo,
		labScheduleMutex:       &sync.Mutex{},
		labSchedule:            make([]Lab, 0),
		scheduledLabs:          make(map[string]struct{}),
		runningInstances:       make(map[string]*Instance),
		storageManager:         storageManager,
		deploymentProvider:     &deployment.ContainerlabProvider{},
		socketManager:          socketManager,
		labUpdatesNamespace:    socket.CreateNamespace[string](socketManager, false, false, "lab-updates"),
		statusMessageNamespace: statusMessageNamespace,
	}

	labService.initSchedule()

	return labService
}

func (s *labService) RunScheduler() {
	for {
		if len(s.labSchedule) > 0 && s.labSchedule[0].StartTime.Unix() <= time.Now().Unix() {
			lab := s.labSchedule[0]
			s.deployLab(lab)

			// Remove lab from schedule list
			s.labScheduleMutex.Lock()
			s.labSchedule = s.labSchedule[1:]
			delete(s.scheduledLabs, lab.UUID)
			s.labScheduleMutex.Unlock()
		}
		time.Sleep(5 * time.Second)
	}
}

func (s *labService) initSchedule() {
	labs, err := s.labRepo.GetAll(nil)
	if err != nil {
		log.Fatal("Failed to load labs from database. Exiting.")
		return
	}

	result, err := s.deploymentProvider.InspectAll(context.Background())
	if err != nil {
		log.Fatal("Failed to retrieve containers from clab inspect. Exiting.", "err", err.Error())
		return
	}

	containersByInstanceName := lo.GroupBy(result.Containers, func(item deployment.InspectContainer) string {
		return item.LabName
	})

	for _, lab := range labs {
		if lab.InstanceName != nil {
			// Lab has been deployed before
			if containers, ok := containersByInstanceName[*lab.InstanceName]; ok {
				// Lab is currently running
				s.runningInstances[*lab.InstanceName] = &Instance{
					State:             InstanceStates.Running,
					Nodes:             lo.Map(containers, s.containerToNode),
					Deployed:          time.Now(),
					LatestStateChange: time.Now(),
				}
			}
		} else {
			// Lab has not been run before
			if lab.StartTime.Unix() >= time.Now().Unix() {
				s.scheduleLab(lab)
			}
		}
	}
}

func (s *labService) Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]LabOut, error) {
	var (
		labs []Lab
		err  error
	)

	if authUser.IsAdmin {
		labs, err = s.labRepo.GetAll(&labFilter)
	} else {
		labs, err = s.labRepo.GetFromCollections(ctx, labFilter, authUser.Collections)
	}
	if err != nil {
		return nil, err
	}

	hasStateFilter := len(labFilter.StateFilter) > 0

	result := make([]LabOut, 0)
	for _, lab := range labs {
		instance, hasInstance := s.runningInstances[lab.UUID]

		if hasStateFilter {
			instanceState := InstanceStates.Inactive

			if hasInstance {
				instanceState = instance.State
			} else if _, isScheduled := s.scheduledLabs[lab.UUID]; isScheduled {
				instanceState = InstanceStates.Scheduled
			}

			if !slices.Contains(labFilter.StateFilter, instanceState) {
				continue
			}
		}

		result = append(result, LabOut{
			ID:           lab.UUID,
			Name:         lab.Name,
			StartTime:    lab.StartTime,
			EndTime:      lab.EndTime,
			TopologyId:   lab.Topology.UUID,
			CollectionId: lab.Topology.Collection.UUID,
			Creator:      s.userRepo.UserToOut(lab.Creator),
			Instance:     instance,
		})
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

	creatorUser, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
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
		s.scheduledLabs[lab.UUID] = struct{}{}
		s.labScheduleMutex.Unlock()
		return
	}

	s.labScheduleMutex.Lock()
	s.labSchedule = append(s.labSchedule[:insertIndex+1], s.labSchedule[insertIndex:]...)
	s.labSchedule[insertIndex] = lab
	s.scheduledLabs[lab.UUID] = struct{}{}
	s.labScheduleMutex.Unlock()
}

// renameTopology Read a topology, changes its name and returns the re-marshalled output
func (s *labService) renameTopology(topologyId string, topologyName string, runTopologyDefinition *string) error {
	var (
		topologyRaw        string
		topologyDefinition map[interface{}]interface{}
	)
	if err := s.storageManager.ReadTopology(topologyId, &topologyRaw); err != nil {
		return err
	}

	if err := yaml.Unmarshal([]byte(topologyRaw), &topologyDefinition); err != nil {
		return err
	}

	topologyDefinition["name"] = topologyName
	if runTopologyRaw, err := yaml.Marshal(topologyDefinition); err != nil {
		return err
	} else {
		*runTopologyDefinition = string(runTopologyRaw)
		return nil
	}
}

func (s *labService) deployFail(lab Lab, err error) {
	log.Infof("[SCHEDULER] Failed to deploy lab %s: %s", lab.Name, err.Error())
	s.statusMessageNamespace.Send(statusMessage.Error(
		"Lab Scheduler", fmt.Sprintf("Failed to deploy lab %s: %s", lab.Name, err.Error()),
	))

	s.updateInstanceState(lab, InstanceStates.Failed)
}

func (s *labService) createLabEnvironment(ctx context.Context, lab Lab) (string, error) {
	var (
		runTopologyName       string
		runTopologyDefinition string
		runTopologyFile       string
	)

	runTopologyName = fmt.Sprintf("%s_%d", lab.Topology.Name, time.Now().UnixMilli())
	if err := s.renameTopology(lab.Topology.UUID, runTopologyName, &runTopologyDefinition); err != nil {
		return "", err
	}

	if err := s.storageManager.CreateRunEnvironment(lab.Topology.UUID, lab.UUID, runTopologyDefinition, &runTopologyFile); err != nil {
		return "", err
	}

	lab.InstanceName = &runTopologyName
	if err := s.labRepo.Update(ctx, &lab); err != nil {
		return "", err
	}

	return runTopologyFile, nil
}

func (s *labService) deployLab(lab Lab) {
	ctx := context.Background()
	log.Infof("[SCHEDULER] Deploying topology %s (%s)", lab.Name, lab.Topology.Name)

	s.runningInstances[lab.UUID] = s.createInstance()
	logNamespace := socket.CreateNamespace[string](s.socketManager, false, true, "logs", lab.UUID)

	s.updateInstanceState(lab, InstanceStates.Deploying)
	s.statusMessageNamespace.Send(statusMessage.Info(
		"Lab Scheduler", fmt.Sprintf("Deploying topology %s (%s)", lab.Name, lab.Topology.Name),
	))

	runTopologyFile, err := s.createLabEnvironment(ctx, lab)
	if err != nil {
		s.deployFail(lab, err)
		return
	}

	go s.deploymentProvider.Deploy(ctx, runTopologyFile, logNamespace.Send, func(_ *string, err error) {
		if err != nil {
			s.deployFail(lab, err)
			return
		}

		// Fetch and attach lab runtime info and change state to running if successful
		s.deploymentProvider.Inspect(ctx, runTopologyFile, logNamespace.Send, func(output *deployment.InspectOutput, err error) {
			if err != nil {
				log.Infof("[SCHEDULER] Failed to inspect lab %s: %s", lab.Name, err.Error())
				s.updateInstanceState(lab, InstanceStates.Failed)
			} else {
				log.Infof("[SCHEDULER] Successfully deployed lab %s!", lab.Name)
				s.runningInstances[lab.UUID].Nodes = lo.Map(output.Containers, s.containerToNode)
				for _, container := range output.Containers {
					containerLogNamespace := socket.CreateNamespace[string](
						s.socketManager, false, true, "logs", lab.UUID, container.ContainerId,
					)
					err := s.deploymentProvider.StreamContainerLogs(ctx, "", container.ContainerId, containerLogNamespace.Send)
					if err != nil {
						log.Errorf("Failed to setup container logs for container %s: %s", container.ContainerId, err.Error())
					}
				}

				s.updateInstanceState(lab, InstanceStates.Running)

				s.statusMessageNamespace.Send(statusMessage.Success(
					"Lab Scheduler", fmt.Sprintf("Successfully deployed lab %s!", lab.Name),
				))
			}
		})
	})
}

func (s *labService) createInstance() *Instance {
	return &Instance{
		Deployed:          time.Now(),
		LatestStateChange: time.Now(),
		State:             InstanceStates.Deploying,
	}
}

func (s *labService) containerToNode(container deployment.InspectContainer, _ int) InstanceNode {
	return InstanceNode{
		Name:        container.Name,
		User:        "ins",
		Port:        50005,
		IPv4:        container.IPv4Address,
		IPv6:        container.IPv6Address,
		State:       container.State,
		ContainerId: container.ContainerId,
	}
}

func (s *labService) updateInstanceState(lab Lab, state InstanceState) {
	s.runningInstances[lab.UUID].State = state
	s.runningInstances[lab.UUID].LatestStateChange = time.Now()

	// Send lab update to namespace so clients can refresh
	s.labUpdatesNamespace.Send(lab.UUID)
}

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
	"regexp"
	"slices"
	"sort"
	"strings"
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
		// An ordered list of labs scheduled for deployment. Ordered by start time.
		labDeploySchedule []Lab

		// An ordered list of labs scheduled for destroying. Ordered by end time.
		labDestroySchedule []Lab

		// Set of currently scheduled labs indexed by lab ID
		scheduledLabs map[string]struct{}

		// Mutex for the labDeploySchedule and scheduledLabs operations
		labDeployScheduleMutex sync.Mutex

		// Mutex for the labDestroySchedule
		labDestroyScheduleMutex sync.Mutex

		// Map of currently active instances indexed by lab ID.
		// The instances can be in any of the real states.
		instances       map[string]*Instance
		deploymentMutex sync.Mutex

		labRepo                Repository
		userRepo               user.Repository
		topologyRepo           topology.Repository
		storageManager         storage.StorageManager
		deploymentProvider     deployment.DeploymentProvider
		socketManager          socket.SocketManager
		labUpdatesNamespace    socket.NamespaceManager[string]
		labCommandsNamespace   socket.NamespaceManager[LabCommandData]
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
		labRepo:                 labRepo,
		userRepo:                userRepo,
		topologyRepo:            topologyRepo,
		labDeployScheduleMutex:  sync.Mutex{},
		labDestroyScheduleMutex: sync.Mutex{},
		labDeploySchedule:       make([]Lab, 0),
		labDestroySchedule:      make([]Lab, 0),
		scheduledLabs:           make(map[string]struct{}),
		instances:               make(map[string]*Instance),
		deploymentMutex:         sync.Mutex{},
		storageManager:          storageManager,
		deploymentProvider:      deployment.GetProvider(),
		socketManager:           socketManager,
		statusMessageNamespace:  statusMessageNamespace,
	}
	labService.labUpdatesNamespace = socket.CreateNamespace[string](
		socketManager, false, false, nil,
		"lab-updates",
	)
	labService.labCommandsNamespace = socket.CreateNamespace[LabCommandData](
		socketManager, false, false, labService.handleLabCommand,
		"lab-commands",
	)

	labService.reviveLabs()
	labService.labUpdatesNamespace.Send("")

	return labService
}

func (s *labService) RunScheduler() {
	for {
		if len(s.labDeploySchedule) > 0 && s.labDeploySchedule[0].StartTime.Unix() <= time.Now().Unix() {
			lab := s.labDeploySchedule[0]

			// Remove the lab from the schedule list
			s.labDeployScheduleMutex.Lock()
			s.labDeploySchedule = s.labDeploySchedule[1:]
			delete(s.scheduledLabs, lab.UUID)
			s.labDeployScheduleMutex.Unlock()

			go s.deployLab(lab)

			// Schedule the destroying of the lab
			s.scheduleDestroy(lab)
		}

		if len(s.labDestroySchedule) > 0 && s.labDestroySchedule[0].EndTime.Unix() <= time.Now().Unix() {
			lab := s.labDeploySchedule[0]

			// Remove the lab from the schedule list
			s.labDestroyScheduleMutex.Lock()
			s.labDestroySchedule = s.labDestroySchedule[1:]
			s.labDestroyScheduleMutex.Unlock()

			go s.destroyLab(lab, s.instances[lab.UUID])
		}

		time.Sleep(5 * time.Second)
	}
}

func (s *labService) reviveLabs() {
	ctx := context.Background()

	labs, err := s.labRepo.GetAll(nil)
	if err != nil {
		log.Fatal("Failed to load labs from database. Exiting.")
		return
	}

	result, err := s.deploymentProvider.InspectAll(ctx)
	if err != nil {
		log.Fatal("Failed to retrieve containers from clab inspect. Exiting.", "err", err.Error())
		return
	}

	containersByInstanceName := lo.GroupBy(result.Containers, func(item deployment.InspectContainer) string {
		return item.LabName
	})

	for _, lab := range labs {
		if lab.InstanceName != nil {
			// The lab has been deployed before
			if containers, ok := containersByInstanceName[*lab.InstanceName]; ok {
				// Lab is currently running
				logNamespace := socket.CreateNamespace[string](
					s.socketManager, false, true, nil,
					"logs", lab.UUID,
				)

				// Create log namespaces for each container in the lab
				for _, container := range containers {
					containerLogNamespace := socket.CreateNamespace[string](
						s.socketManager, false, true, nil, "logs", lab.UUID, container.ContainerId,
					)
					err := s.deploymentProvider.StreamContainerLogs(ctx, "", container.ContainerId, containerLogNamespace.Send)
					if err != nil {
						log.Errorf("Failed to setup container logs for container %s: %s", container.ContainerId, err.Error())
					}
				}

				s.deploymentMutex.Lock()
				s.instances[lab.UUID] = &Instance{
					State:             InstanceStates.Running,
					Nodes:             lo.Map(containers, s.containerToInstanceNode),
					Deployed:          time.Now(),
					LatestStateChange: time.Now(),
					Recovered:         true,
					TopologyFile:      s.storageManager.GetRunTopologyFile(lab.UUID),
					LogNamespace:      logNamespace,
				}
				s.deploymentMutex.Unlock()

				// Schedule the destroying of the lab in the future
				s.scheduleDestroy(lab)
			}
		} else {
			// The lab has not been run before
			if lab.StartTime.Unix() >= time.Now().Unix() {
				// Schedule the deployment of the lab in the future
				s.scheduleDeployment(lab)
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
		instance, hasInstance := s.instances[lab.UUID]

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
			Instance:     s.instanceToOut(instance),
			InstanceName: lab.InstanceName,
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
		s.scheduleDeployment(*lab)
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
	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
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
	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
		return utils.ErrorRunningLab
	}

	return s.labRepo.Delete(ctx, lab)
}

func (s *labService) scheduleDeployment(lab Lab) {
	s.labDeployScheduleMutex.Lock()
	defer s.labDeployScheduleMutex.Unlock()

	insertIndex := sort.Search(len(s.labDeploySchedule), func(i int) bool {
		return s.labDeploySchedule[i].StartTime.Unix() >= lab.StartTime.Unix()
	})

	if insertIndex == len(s.labDeploySchedule) {
		s.labDeploySchedule = append(s.labDeploySchedule, lab)
		s.scheduledLabs[lab.UUID] = struct{}{}
		return
	}

	s.labDeploySchedule = append(s.labDeploySchedule[:insertIndex+1], s.labDeploySchedule[insertIndex:]...)
	s.labDeploySchedule[insertIndex] = lab
	s.scheduledLabs[lab.UUID] = struct{}{}
}

func (s *labService) scheduleDestroy(lab Lab) {
	s.labDestroyScheduleMutex.Lock()
	defer s.labDestroyScheduleMutex.Unlock()

	insertIndex := sort.Search(len(s.labDestroySchedule), func(i int) bool {
		return s.labDestroySchedule[i].StartTime.Unix() >= lab.StartTime.Unix()
	})

	if insertIndex == len(s.labDestroySchedule) {
		s.labDestroySchedule = append(s.labDestroySchedule, lab)
		return
	}

	s.labDestroySchedule = append(s.labDestroySchedule[:insertIndex+1], s.labDestroySchedule[insertIndex:]...)
	s.labDestroySchedule[insertIndex] = lab
}

// renameTopology Read a topology, changes its name and returns the re-marshalled output
func (s *labService) renameTopology(topologyId string, topologyName string, runTopologyDefinition *string) error {
	var (
		topologyRaw        string
		topologyDefinition = make(map[interface{}]interface{})
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

func (s *labService) createLabEnvironment(ctx context.Context, lab *Lab) (string, error) {
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
	if err := s.labRepo.Update(ctx, lab); err != nil {
		return "", err
	}

	return runTopologyFile, nil
}

func (s *labService) destroyLab(lab Lab, instance *Instance) {
	s.notifyUpdate(lab, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Destruction of lab %s has been scheduled", lab.Name),
		"Destruction has been scheduled", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	))

	// We need to wait for previous operations to complete before destroying the lab
	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx := context.Background()

	s.updateStateAndNotify(lab, InstanceStates.Stopping, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Destroying lab %s (%s)", lab.Name, lab.Topology.Name),
		"Destroying lab", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)

	output, err := s.deploymentProvider.Destroy(ctx, instance.TopologyFile, instance.LogNamespace.Send)
	streamClabOutput(instance.LogNamespace, output)

	if err != nil {
		s.statusMessageNamespace.Send(*statusMessage.Error(
			"Lab Manager", fmt.Sprintf("Failed to destroy lab %s: %s", lab.Name, err.Error()),
			"Failed to destroy lab", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		))
		return
	}

	if err := s.storageManager.DeleteRunEnvironment(lab.UUID); err != nil {
		s.statusMessageNamespace.Send(*statusMessage.Warning(
			"Lab Manager", fmt.Sprintf("Failed to remove run environment for %s: %s", lab.Name, err.Error()),
			"Failed to remove run environment", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		))
	}

	instance.LogNamespace.ClearBacklog()
	instance.LogNamespace = nil

	// Remove instance from lab and send update to clients
	s.deploymentMutex.Lock()
	delete(s.instances, lab.UUID)
	s.deploymentMutex.Unlock()
	s.labUpdatesNamespace.Send(lab.UUID)

	s.statusMessageNamespace.Send(*statusMessage.Success(
		"Lab Manager", fmt.Sprintf("Successfully destroyed lab %s", lab.Name),
		"Lab has been destroyed successfully", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	))
}

func (s *labService) redeployLab(lab Lab, instance *Instance) bool {
	// We have to ensure that the instance isn't already being deployed
	if instance.State == InstanceStates.Deploying {
		return false
	}

	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx := context.Background()
	s.updateStateAndNotify(lab, InstanceStates.Deploying, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Redeploying lab %s (%s)", lab.Name, lab.Topology.Name),
		"Starting redeployment of lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)
	output, err := s.deploymentProvider.Redeploy(ctx, instance.TopologyFile, instance.LogNamespace.Send)
	streamClabOutput(instance.LogNamespace, output)

	if err != nil {
		s.updateStateAndNotify(lab, InstanceStates.Failed, statusMessage.Error(
			"Lab Manager",
			fmt.Sprintf("Failed to redeploy lab %s (%s)", lab.Name, lab.Topology.Name),
			"Failed to redeploy lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
	} else {
		s.updateStateAndNotify(lab, InstanceStates.Running, statusMessage.Success(
			"Lab Manager",
			fmt.Sprintf("Successfully redeployed lab %s (%s)", lab.Name, lab.Topology.Name),
			"Successfully redeployed lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
	}
	return true
}

// setTopologyDeployStatus Sets the LastDeployFailed flag in the lab's topology
func (s *labService) setTopologyDeployStatus(lab Lab, wasSuccessful bool) {
	lab.Topology.LastDeployFailed = !wasSuccessful
	if err := s.topologyRepo.Update(context.Background(), &lab.Topology); err != nil {
		log.Error("Failed to set last deployment failed on topology", "topo", lab.Topology.UUID)
	}
}

func (s *labService) deployLab(lab Lab) bool {
	// We have to ensure that the instance is only created once
	s.deploymentMutex.Lock()
	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
		return false
	}
	s.instances[lab.UUID] = s.createInstance()
	s.deploymentMutex.Unlock()
	instance := s.instances[lab.UUID]

	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx := context.Background()
	runTopologyFile, err := s.createLabEnvironment(ctx, &lab)
	if err != nil {
		// for testing
		if instance.LogNamespace == nil {
			instance.LogNamespace = socket.CreateNamespace[string](s.socketManager, true, false, nil, "logs", lab.UUID)
		}
		s.updateStateAndNotify(lab, InstanceStates.Failed, statusMessage.Error(
			"Lab Manager",
			fmt.Sprintf("Failed to create environment for %s (%s)", lab.Name, lab.Topology.Name),
			"Failed to create environment for lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(lab, false)
		return true
	}
	instance.TopologyFile = runTopologyFile
	instance.LogNamespace = socket.CreateNamespace[string](s.socketManager, false, true, nil, "logs", lab.UUID)

	s.updateStateAndNotify(lab, InstanceStates.Deploying, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Deploying lab %s (%s)", lab.Name, lab.Topology.Name),
		"Starting deployment of lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)

	output, err := s.deploymentProvider.Deploy(ctx, runTopologyFile, instance.LogNamespace.Send)

	streamClabOutput(instance.LogNamespace, output)

	if err != nil {
		s.updateStateAndNotify(lab, InstanceStates.Failed, statusMessage.Error(
			"Lab Manager",
			fmt.Sprintf("Failed to deploy lab %s (%s)", lab.Name, lab.Topology.Name),
			"Deployment of lab failed", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(lab, false)
		return true
	}

	// Fetch and attach lab runtime info and change state to running if successful
	inspectOutput, err := s.deploymentProvider.Inspect(ctx, runTopologyFile, instance.LogNamespace.Send)
	if err != nil {
		log.Infof("[SCHEDULER] Failed to inspect lab %s: %s", lab.Name, err.Error())
		s.updateStateAndNotify(lab, InstanceStates.Failed, statusMessage.Warning(
			"Lab Manager",
			fmt.Sprintf("Failed to get info of lab %s (%s)", lab.Name, lab.Topology.Name),
			"Inspection of lab failed", "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(lab, false)
	} else {
		log.Infof("[SCHEDULER] Successfully deployed lab %s!", lab.Name)
		s.instances[lab.UUID].Nodes = lo.Map(inspectOutput.Containers, s.containerToInstanceNode)
		for _, container := range inspectOutput.Containers {
			containerLogNamespace := socket.CreateNamespace[string](
				s.socketManager, false, true, nil, "logs", lab.UUID, container.ContainerId,
			)
			err := s.deploymentProvider.StreamContainerLogs(ctx, "", container.ContainerId, containerLogNamespace.Send)
			if err != nil {
				log.Errorf("Failed to setup container logs for container %s: %s", container.ContainerId, err.Error())
			}
		}

		s.updateStateAndNotify(lab, InstanceStates.Running, statusMessage.Success(
			"Lab Manager",
			fmt.Sprintf("Successfully deployed %s (%s)", lab.Name, lab.Topology.Name),
			"Deployment of lab was successful", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(lab, true)
	}

	return true
}

func (s *labService) createInstance() *Instance {
	return &Instance{
		Deployed:          time.Now(),
		LatestStateChange: time.Now(),
		State:             InstanceStates.Deploying,
		Recovered:         false,
		Mutex:             sync.Mutex{},
	}
}

func (s *labService) instanceToOut(instance *Instance) *InstanceOut {
	if instance == nil {
		return nil
	}

	return &InstanceOut{
		Deployed:          instance.Deployed,
		EdgesharkLink:     instance.EdgesharkLink,
		State:             instance.State,
		LatestStateChange: instance.LatestStateChange,
		Nodes:             instance.Nodes,
		Recovered:         instance.Recovered,
	}
}

func (s *labService) containerToInstanceNode(container deployment.InspectContainer, _ int) InstanceNode {
	nodeNameParts := strings.Split(container.Name, "-")

	return InstanceNode{
		Name:          nodeNameParts[len(nodeNameParts)-1],
		User:          "ins",
		Port:          50005,
		IPv4:          container.IPv4Address,
		IPv6:          container.IPv6Address,
		State:         container.State,
		ContainerName: container.Name,
		ContainerId:   container.ContainerId,
	}
}

func (s *labService) notifyUpdate(lab Lab, message *statusMessage.StatusMessage) {
	s.labUpdatesNamespace.Send(lab.UUID)

	if message != nil {
		s.statusMessageNamespace.Send(*message)
	}
}

// updateStateAndNotify Updates the state of a lab and sends various notification updates.
// If the status message is set, all users will receive the status message.
// If the log namespace is set, the log content of the status message is also sent to the provided namespace.
func (s *labService) updateStateAndNotify(lab Lab, state InstanceState, statusMessage *statusMessage.StatusMessage, logNamespace *socket.NamespaceManager[string]) {
	s.instances[lab.UUID].State = state
	s.instances[lab.UUID].LatestStateChange = time.Now()
	s.labUpdatesNamespace.Send(lab.UUID)

	if statusMessage != nil {
		s.statusMessageNamespace.Send(*statusMessage)
		if logNamespace != nil {
			(*logNamespace).Send(statusMessage.LogContent)
		}
	}
}

func (s *labService) handleLabCommand(
	ctx context.Context,
	data *LabCommandData,
	authUser *auth.AuthenticatedUser,
	onResponse func(response utils.OkResponse[any]),
	onError func(response utils.ErrorResponse),
) {
	switch data.Command {
	case deployCommand:
		if err := s.deployLabCommand(ctx, data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	case destroyCommand:
		if err := s.destroyLabCommand(ctx, data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	case stopNodeCommand:
		if err := s.stopNodeCommand(ctx, data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	case startNodeCommand:
		if err := s.startNodeCommand(ctx, data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrorInvalidLabCommand))
		break
	}
}

func (s *labService) destroyLabCommand(ctx context.Context, labId string, authUser *auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrorNoDestroyAccessToLab
	}

	// Don't allow destroying non-running labs
	instance, hasInstance := s.instances[lab.UUID]
	if !hasInstance {
		return utils.ErrorLabNotRunning
	}
	s.destroyLab(*lab, instance)
	return nil
}

func (s *labService) deployLabCommand(ctx context.Context, labId string, authUser *auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrorNoDeployAccessToLab
	}
	instance, hasInstance := s.instances[lab.UUID]
	if hasInstance {
		if !s.redeployLab(*lab, instance) {
			return utils.ErrorLabActionInProgress
		}
	} else {
		// Manually remove the lab from the lab schedule
		if _, isScheduled := s.scheduledLabs[lab.UUID]; isScheduled {
			s.labDeployScheduleMutex.Lock()
			delete(s.scheduledLabs, lab.UUID)
			labIndex := slices.Index(s.labDeploySchedule, *lab)
			s.labDeploySchedule = append(s.labDeploySchedule[:labIndex], s.labDeploySchedule[labIndex+1:]...)
			s.labDeployScheduleMutex.Unlock()
		}
		result := s.deployLab(*lab)
		log.Infof("result: %v", result)
	}

	return nil
}

func (s *labService) stopNodeCommand(ctx context.Context, labId string, node *string, authUser *auth.AuthenticatedUser) error {
	if node == nil {
		return utils.ErrorNodeNotFound
	}
	return nil
}

func (s *labService) startNodeCommand(ctx context.Context, labId string, node *string, authUser *auth.AuthenticatedUser) error {
	if node == nil {
		return utils.ErrorNodeNotFound
	}
	return nil
}

// streamClabOutput Streams the output of a containerlab command to a given socket namespace.
func streamClabOutput(logNamespace socket.NamespaceManager[string], output *string) {
	re := regexp.MustCompile(`\[\dm`)
	if output == nil {
		return
	}

	for _, line := range strings.Split(*output, "\n") {
		if line == "" {
			continue
		}
		logNamespace.Send(string(re.ReplaceAll([]byte(line), []byte(""))))
	}
}

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
	"io"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

type (
	Service interface {
		Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]LabOut, error)
		Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req LabInPartial, labId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error

		// RunScheduler Starts looping through all scheduled labs and waits to deploy them
		RunScheduler()
	}

	labService struct {
		labDeploymentSchedule  utils.Schedule[Lab]
		labDestructionSchedule utils.Schedule[Lab]

		// Map of currently active instances indexed by lab ID.
		// The instances can be in any of the real states.
		instances      map[string]*Instance
		instancesMutex sync.Mutex

		openShells      map[string]ShellConfig
		openShellsMutex sync.Mutex

		labRepo                Repository
		userRepo               user.Repository
		topologyRepo           topology.Repository
		storageManager         storage.StorageManager
		deploymentProvider     deployment.DeploymentProvider
		socketManager          socket.SocketManager
		labUpdatesNamespace    socket.OutputNamespace[string]
		labCommandsNamespace   socket.InputNamespace[LabCommandData]
		statusMessageNamespace socket.OutputNamespace[statusMessage.StatusMessage]
	}

	ShellConfig struct {
		Owner         *auth.AuthenticatedUser
		NodeId        string
		Connection    io.ReadWriteCloser
		DataNamespace socket.IONamespace[string, string]
	}
)

func CreateService(
	labRepo Repository,
	userRepo user.Repository,
	topologyRepo topology.Repository,
	storageManager storage.StorageManager,
	socketManager socket.SocketManager,
	statusMessageNamespace socket.OutputNamespace[statusMessage.StatusMessage],
) Service {
	deploymentSchedule := utils.CreateSchedule[Lab](
		func(lab Lab) string {
			return lab.UUID
		},
		func(lab Lab) *time.Time {
			return &lab.StartTime
		},
	)

	destructionSchedule := utils.CreateSchedule[Lab](
		func(lab Lab) string {
			return lab.UUID
		},
		func(lab Lab) *time.Time {
			return lab.EndTime
		},
	)

	labService := &labService{
		labRepo:                labRepo,
		userRepo:               userRepo,
		topologyRepo:           topologyRepo,
		labDeploymentSchedule:  deploymentSchedule,
		labDestructionSchedule: destructionSchedule,
		openShells:             make(map[string]ShellConfig),
		openShellsMutex:        sync.Mutex{},
		instances:              make(map[string]*Instance),
		instancesMutex:         sync.Mutex{},
		storageManager:         storageManager,
		deploymentProvider:     deployment.GetProvider(),
		socketManager:          socketManager,
		statusMessageNamespace: statusMessageNamespace,
	}
	labService.labUpdatesNamespace = socket.CreateOutputNamespace[string](
		socketManager, false, false, nil, "lab-updates",
	)
	labService.labCommandsNamespace = socket.CreateInputNamespace[LabCommandData](
		socketManager, false, false, labService.handleLabCommand, nil, "lab-commands",
	)

	labService.reviveLabs()
	labService.labUpdatesNamespace.Send("")

	return labService
}

func (s *labService) RunScheduler() {
	for {
		if lab := s.labDeploymentSchedule.TryPop(); lab != nil {
			go func() {
				_ = s.deployLab(lab)
			}()

			// Schedule the destruction of the lab
			s.labDestructionSchedule.Schedule(lab)
		}

		if lab := s.labDestructionSchedule.TryPop(); lab != nil {
			go func() {
				_ = s.destroyLab(lab, s.instances[lab.UUID])
			}()
		}

		time.Sleep(5 * time.Second)
	}
}

func (s *labService) reviveLabs() {
	ctx := context.Background()

	labs, err := s.labRepo.GetAll(ctx, nil)
	if err != nil {
		log.Fatal("Failed to load labs from database. Exiting.")
		return
	}

	result, err := s.deploymentProvider.InspectAll(ctx)
	if err != nil {
		log.Fatal("Failed to retrieve containers from clab inspect. Exiting.", "err", err.Error())
		return
	}

	for _, lab := range labs {
		if lab.InstanceName == nil {
			if lab.StartTime.Unix() >= time.Now().Unix() {
				// The lab has not been run before
				s.labDeploymentSchedule.Schedule(&lab)
			}

			continue
		}

		// The lab has been deployed before
		if containers, ok := result[*lab.InstanceName]; ok {
			// Lab is currently running
			logNamespace := socket.CreateOutputNamespace[string](
				s.socketManager, false, true, nil, "logs", lab.UUID,
			)

			// Create log namespaces for each container in the lab
			for _, container := range containers {
				containerLogNamespace := socket.CreateOutputNamespace[string](
					s.socketManager, false, true, nil, "logs", lab.UUID, container.ContainerId,
				)
				err := s.deploymentProvider.StreamContainerLogs(
					ctx, "", container.ContainerId, containerLogNamespace.Send,
				)
				if err != nil {
					log.Errorf(
						"Failed to setup container logs for container %s: %s", container.ContainerId, err.Error(),
					)
				}
			}

			var runTopologyDefinition string
			if err := s.storageManager.ReadRunTopologyDefinition(lab.UUID, &runTopologyDefinition); err != nil {
				log.Errorf("Failed to read run topology definition for %s: %s", lab.UUID, err.Error())
				continue
			}

			s.instancesMutex.Lock()
			s.instances[lab.UUID] = &Instance{
				State:              InstanceStates.Running,
				Nodes:              lo.Map(containers, s.containerToInstanceNode),
				Deployed:           time.Now(),
				LatestStateChange:  time.Now(),
				Recovered:          true,
				TopologyFile:       s.storageManager.GetRunTopologyFile(lab.UUID),
				TopologyDefinition: runTopologyDefinition,
				LogNamespace:       logNamespace,
			}
			s.instancesMutex.Unlock()

			s.labDestructionSchedule.Schedule(&lab)
		}
	}
}

func (s *labService) Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]LabOut, error) {
	var (
		labs []Lab
		err  error
	)

	// If the user isn't admin, restrict collection filter to accessible collections
	if !authUser.IsAdmin {
		labFilter.CollectionFilter = lo.Intersect(labFilter.CollectionFilter, authUser.Collections)
	}

	if labs, err = s.labRepo.GetAll(ctx, &labFilter); err != nil {
		return nil, err
	}

	hasStateFilter := len(labFilter.StateFilter) > 0

	result := make([]LabOut, 0)
	for _, lab := range labs {
		s.instancesMutex.Lock()
		instance, hasInstance := s.instances[lab.UUID]
		s.instancesMutex.Unlock()

		if hasStateFilter {
			instanceState := InstanceStates.Inactive

			if hasInstance {
				instanceState = instance.State
			} else if s.labDeploymentSchedule.IsScheduled(lab.UUID) {
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
	labTopology, err := s.topologyRepo.GetByUuid(ctx, *req.TopologyId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the lab topology's collection
	if !authUser.IsAdmin && (!labTopology.Collection.PublicDeploy || !slices.Contains(authUser.Collections, labTopology.Collection.Name)) {
		return "", utils.ErrorNoDeployAccessToCollection
	}

	creator, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrorUnauthorized
	}

	labUuid := utils.GenerateUuid()
	lab := &Lab{
		UUID:      labUuid,
		Name:      *req.Name,
		StartTime: *req.StartTime,
		EndTime:   req.EndTime,
		Creator:   *creator,
		Topology:  *labTopology,
	}

	if err := s.labRepo.Create(ctx, lab); err != nil {
		return "", err
	}

	// Add newly created lab to the deployment schedule
	s.labDeploymentSchedule.Schedule(lab)

	return labUuid, nil
}

func (s *labService) Update(ctx *gin.Context, req LabInPartial, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrorNoWriteAccessToLab
	}

	// Don't allow modifications to running labs
	s.instancesMutex.Lock()
	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
		return utils.ErrorLabRunning
	}
	s.instancesMutex.Unlock()

	updateDeploymentSchedule := false
	updateDestructionSchedule := false

	if req.Indefinite != nil && *req.Indefinite == true {
		lab.EndTime = nil
		updateDestructionSchedule = true
	} else if req.EndTime != nil {
		lab.EndTime = req.EndTime
		updateDestructionSchedule = true
	}

	if req.StartTime != nil {
		lab.StartTime = *req.StartTime
		updateDeploymentSchedule = true
	}

	if req.Name != nil {
		lab.Name = *req.Name
	}

	if err := s.labRepo.Update(ctx, lab); err != nil {
		if updateDeploymentSchedule {
			s.labDeploymentSchedule.Reschedule(lab.UUID)
		}

		if updateDestructionSchedule {
			s.labDestructionSchedule.Reschedule(lab.UUID)
		}

		return nil
	} else {
		return err
	}
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
	s.instancesMutex.Lock()
	if instance, hasInstance := s.instances[lab.UUID]; hasInstance && instance.State != InstanceStates.Failed {
		return utils.ErrorLabRunning
	}
	s.instancesMutex.Unlock()

	if err := s.storageManager.DeleteRunEnvironment(lab.UUID); err != nil {
		s.statusMessageNamespace.Send(*statusMessage.Warning(
			"Lab Manager", fmt.Sprintf("Failed to remove run environment for %s: %s", lab.Name, err.Error()),
			"Failed to remove run environment", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		))
	}

	return s.labRepo.Delete(ctx, lab)
}

// Read a topology, changes its name and returns the re-marshalled output.
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

func (s *labService) createLabEnvironment(lab *Lab) (string, string, error) {
	var (
		runTopologyName       string
		runTopologyDefinition string
		runTopologyFile       string
	)

	runTopologyName = fmt.Sprintf("%s_%d", lab.Topology.Name, time.Now().UnixMilli())
	if err := s.renameTopology(lab.Topology.UUID, runTopologyName, &runTopologyDefinition); err != nil {
		return "", "", err
	}

	if err := s.storageManager.CreateRunEnvironment(lab.Topology.UUID, lab.UUID, runTopologyDefinition, &runTopologyFile); err != nil {
		return "", "", err
	}

	lab.InstanceName = &runTopologyName
	if err := s.labRepo.Update(context.Background(), lab); err != nil {
		return "", "", err
	}

	return runTopologyFile, runTopologyDefinition, nil
}

func (s *labService) destroyLab(lab *Lab, instance *Instance) error {
	// We have to ensure that we cancel any pending deployment operations before destroying
	if instance.DeploymentWorker != nil && instance.DeploymentWorker.Context.Err() == nil {
		log.Infof("Deployment still running, cancelling")
		instance.DeploymentWorker.Cancel()

		s.notifyUpdate(*lab,
			statusMessage.Info(
				"Lab Manager",
				fmt.Sprintf("Cancelling deployment of lab '%s' (%s)", lab.Name, lab.Topology.Name),
				"Cancelling deployment of lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
			),
		)
	}

	// We need to wait for previous operations to complete before destroying the lab
	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx := context.Background()

	s.updateStateAndNotify(*lab, InstanceStates.Stopping, statusMessage.Info(
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
		return utils.ErrorContainerlab
	}

	instance.LogNamespace.ClearBacklog()
	instance.LogNamespace = nil

	// Remove instance from lab and send update to clients
	s.instancesMutex.Lock()
	delete(s.instances, lab.UUID)
	s.instancesMutex.Unlock()
	s.labUpdatesNamespace.Send(lab.UUID)

	s.statusMessageNamespace.Send(*statusMessage.Success(
		"Lab Manager", fmt.Sprintf("Successfully destroyed lab %s", lab.Name),
		"Lab has been destroyed successfully", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	))

	return nil
}

func (s *labService) redeployLab(lab *Lab, instance *Instance) bool {
	// We have to ensure that the instance isn't already being deployed
	if instance.State == InstanceStates.Deploying {
		s.notifyUpdate(*lab,
			statusMessage.Error(
				"Lab Manager",
				fmt.Sprintf("Unable to redeploy lab '%s' (%s). The lab is already being deployed", lab.Name, lab.Topology.Name),
				"Failed to deploy lab: The lab is already being deployed", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
			),
		)
		return false
	}

	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	instance.DeploymentWorker = &utils.Worker{
		Context: ctx,
		Cancel:  cancel,
	}
	defer instance.DeploymentWorker.Cancel()

	s.updateStateAndNotify(*lab, InstanceStates.Deploying, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Redeploying lab '%s' (%s)", lab.Name, lab.Topology.Name),
		"Starting redeployment of lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)
	output, err := s.deploymentProvider.Redeploy(ctx, instance.TopologyFile, instance.LogNamespace.Send)
	streamClabOutput(instance.LogNamespace, output)

	// Only report errors if the worker has not been cancelled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Error(
			"Lab Manager",
			fmt.Sprintf("Failed to redeploy lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Failed to redeploy lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
	} else {
		s.updateStateAndNotify(*lab, InstanceStates.Running, statusMessage.Success(
			"Lab Manager",
			fmt.Sprintf("Successfully redeployed lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Successfully redeployed lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
	}

	instance.DeploymentWorker.Context.Done()

	return true
}

// setTopologyDeployStatus Sets the LastDeployFailed flag in the lab's topology
func (s *labService) setTopologyDeployStatus(lab Lab, wasSuccessful bool) {
	lab.Topology.LastDeployFailed = !wasSuccessful
	if err := s.topologyRepo.Update(context.Background(), &lab.Topology); err != nil {
		log.Error("Failed to set last deployment failed on topology", "topo", lab.Topology.UUID)
	}
}

func (s *labService) deployLab(lab *Lab) error {
	// We have to ensure that the instance is only created once
	s.instancesMutex.Lock()

	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
		s.notifyUpdate(*lab,
			statusMessage.Error(
				"Lab Manager",
				fmt.Sprintf("Unable to deploy lab '%s' (%s). The lab is already being deployed", lab.Name, lab.Topology.Name),
				"Failed to deploy lab: The lab is already being deployed", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
			),
		)
		return utils.ErrorLabIsDeploying
	}

	logNamespace := socket.CreateOutputNamespace[string](s.socketManager, false, true, nil, "logs", lab.UUID)

	runTopologyFile, runTopologyDefinition, err := s.createLabEnvironment(lab)
	instance := s.createInstance(logNamespace, runTopologyFile, runTopologyDefinition)

	if err != nil {
		log.Errorf("Failed to create lab environment for lab '%s': %s", lab.Name, err)

		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Error(
			"Lab Manager",
			fmt.Sprintf("Failed to create environment for lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Failed to create environment for lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &logNamespace)
		s.setTopologyDeployStatus(*lab, false)
		return utils.ErrorAntimony
	}

	s.instances[lab.UUID] = instance
	s.instancesMutex.Unlock()

	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	instance.DeploymentWorker = &utils.Worker{
		Context: ctx,
		Cancel:  cancel,
	}
	defer instance.DeploymentWorker.Cancel()

	s.updateStateAndNotify(*lab, InstanceStates.Deploying, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Deploying lab '%s' (%s)", lab.Name, lab.Topology.Name),
		"Starting deployment of lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)

	output, err := s.deploymentProvider.Deploy(ctx, runTopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})

	streamClabOutput(instance.LogNamespace, output)

	// Only report errors if the deployment worker has not been cancelled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Error(
			"Lab Manager",
			fmt.Sprintf("Failed to deploy lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Deployment of lab failed", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(*lab, false)
		return utils.ErrorContainerlab
	}

	// Fetch and attach lab runtime info and change state to running if successful
	inspectOutput, err := s.deploymentProvider.Inspect(ctx, runTopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})

	// Only report errors if the deployment worker has not been cancelled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Warning(
			"Lab Manager",
			fmt.Sprintf("Failed to get info of lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Inspection of lab failed", "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(*lab, false)
	} else {
		containers := inspectOutput[*lab.InstanceName]

		log.Infof("[SCHEDULER] Successfully deployed lab '%s'!", lab.Name)
		s.instances[lab.UUID].Nodes = lo.Map(containers, s.containerToInstanceNode)
		for _, container := range containers {
			containerLogNamespace := socket.CreateOutputNamespace[string](
				s.socketManager, false, true, nil, "logs", lab.UUID, container.ContainerId,
			)
			err := s.deploymentProvider.StreamContainerLogs(ctx, "", container.ContainerId, func(data string) {
				containerLogNamespace.Send(data)
			})
			if err != nil {
				log.Errorf("Failed to setup container logs for container %s: %s", container.ContainerId, err.Error())
			}
		}

		s.updateStateAndNotify(*lab, InstanceStates.Running, statusMessage.Success(
			"Lab Manager",
			fmt.Sprintf("Successfully deployed '%s' (%s)", lab.Name, lab.Topology.Name),
			"Deployment of lab was successful", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(*lab, true)
	}

	instance.DeploymentWorker.Context.Done()

	return nil
}

func (s *labService) createInstance(
	logNamespace socket.OutputNamespace[string],
	runTopologyFile string,
	topologyDefinition string,
) *Instance {
	return &Instance{
		Deployed:           time.Now(),
		LatestStateChange:  time.Now(),
		State:              InstanceStates.Deploying,
		Recovered:          false,
		Mutex:              sync.Mutex{},
		DeploymentWorker:   nil,
		LogNamespace:       logNamespace,
		TopologyFile:       runTopologyFile,
		TopologyDefinition: topologyDefinition,
	}
}

func (s *labService) instanceToOut(instance *Instance) *InstanceOut {
	if instance == nil {
		return nil
	}

	return &InstanceOut{
		Deployed:           instance.Deployed,
		EdgesharkLink:      instance.EdgesharkLink,
		State:              instance.State,
		LatestStateChange:  instance.LatestStateChange,
		Nodes:              instance.Nodes,
		Recovered:          instance.Recovered,
		TopologyDefinition: instance.TopologyDefinition,
	}
}

func (s *labService) containerToInstanceNode(container deployment.InspectContainer, _ int) InstanceNode {
	nodeNameParts := strings.Split(container.Name, "-")

	return InstanceNode{
		Name:          nodeNameParts[len(nodeNameParts)-1],
		IPv4:          container.IPv4Address,
		IPv6:          container.IPv6Address,
		Port:          50005,
		User:          "ins",
		WebSSH:        "",
		State:         container.State,
		ContainerId:   container.ContainerId,
		ContainerName: container.Name,
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
func (s *labService) updateStateAndNotify(lab Lab, state InstanceState, statusMessage *statusMessage.StatusMessage, logNamespace *socket.OutputNamespace[string]) {
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
	if data.LabId == nil || data.Command == nil {
		onError(utils.CreateSocketErrorResponse(utils.ErrorInvalidSocketRequest))
		return
	}

	switch *data.Command {
	case LabCommands.Deploy:
		if err := s.deployLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	case LabCommands.Destroy:
		if err := s.destroyLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	case LabCommands.StopNode:
		if err := s.stopNodeCommand(ctx, *data.LabId, data.NodeId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	case LabCommands.StartNode:
		if err := s.startNodeCommand(ctx, *data.LabId, data.NodeId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
		break
	case LabCommands.OpenShell:
		if shellId, err := s.openShellCommand(ctx, *data.LabId, data.NodeId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shellId))
		}
		break
	case LabCommands.CloseShell:
		if err := s.closeShellCommand(data.ShellId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
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

	s.labDestructionSchedule.Remove(lab.UUID)

	if err := s.destroyLab(lab, instance); err != nil {
		return err
	}

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
		result := s.redeployLab(lab, instance)

		if !result {
			return utils.ErrorLabIsDeploying
		}
	} else {
		// Manually remove the lab from the lab schedule and add it to the destruction schedule
		s.labDeploymentSchedule.Remove(lab.UUID)

		// When redeploying a lab that has already ended, set its end time to indefinite
		if lab.EndTime != nil && lab.EndTime.Unix() <= time.Now().Unix() {
			lab.EndTime = nil
			if err := s.labRepo.Update(context.Background(), lab); err != nil {
				log.Errorf("Failed to update lab end time: %s", err.Error())
			}
		}

		s.labDestructionSchedule.Schedule(lab)

		if err := s.deployLab(lab); err != nil {
			return err
		}
	}

	return nil
}

func (s *labService) stopNodeCommand(ctx context.Context, labId string, nodeId *string, authUser *auth.AuthenticatedUser) error {
	if nodeId == nil {
		return utils.ErrorNodeNotFound
	}
	return nil
}

func (s *labService) startNodeCommand(ctx context.Context, labId string, nodeId *string, authUser *auth.AuthenticatedUser) error {
	if nodeId == nil {
		return utils.ErrorNodeNotFound
	}
	return nil
}

func (s *labService) openShellCommand(
	ctx context.Context,
	labId string,
	nodeId *string,
	authUser *auth.AuthenticatedUser,
) (string, error) {
	if nodeId == nil {
		return "", utils.ErrorInvalidSocketRequest
	}

	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return "", err
	}

	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, lab.Topology.Collection.UUID) {
		return "", utils.ErrorNoAccessToShell
	}

	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[lab.UUID]
	if !hasInstance {
		return "", utils.ErrorLabNotRunning
	}
	s.instancesMutex.Unlock()

	_, hasContainer := lo.Find(instance.Nodes, func(node InstanceNode) bool {
		return node.ContainerId == *nodeId
	})
	if !hasContainer {
		return "", utils.ErrorNodeNotFound
	}

	connection, err := s.deploymentProvider.OpenShell(ctx, *nodeId)
	if err != nil {
		log.Errorf("Failed to open shell: %s", err.Error())
		return "", err
	}

	shellId := utils.GenerateUuid()

	accessGroup := []*auth.AuthenticatedUser{authUser}

	dataNamespace := socket.CreateIONamespace[string, any](
		s.socketManager,
		false,
		true,
		s.handleShellData(shellId),
		&accessGroup,
		"shells", shellId,
	)

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := connection.Read(buf)
			if err != nil {
				dataNamespace.Send(utils.CreateSocketErrorResponse(err))
				break
			}

			dataNamespace.Send(string(buf[:n]))
		}
	}()

	shellConfig := ShellConfig{
		Owner:      authUser,
		NodeId:     *nodeId,
		Connection: connection,
	}

	s.openShellsMutex.Lock()
	s.openShells[shellId] = shellConfig
	s.openShellsMutex.Unlock()

	return shellId, nil
}

func (s *labService) closeShellCommand(shellId *string, authUser *auth.AuthenticatedUser) error {
	if shellId == nil {
		return utils.ErrorInvalidSocketRequest
	}

	s.openShellsMutex.Lock()
	shell, hasShell := s.openShells[*shellId]
	s.openShellsMutex.Unlock()

	if !hasShell {
		return utils.ErrorShellNotFound
	}

	if !authUser.IsAdmin && shell.Owner != authUser {
		return utils.ErrorNoAccessToShell
	}

	err := shell.Connection.Close()
	if err != nil {
		log.Errorf("Failed to close shell: %s", err.Error())
	}

	s.openShellsMutex.Lock()
	delete(s.openShells, *shellId)
	s.openShellsMutex.Unlock()

	return nil
}

func (s *labService) handleShellData(
	shellId string,
) func(
	ctx context.Context,
	data *string,
	authUser *auth.AuthenticatedUser,
	onResponse func(response utils.OkResponse[any]),
	onError func(response utils.ErrorResponse),
) {
	return func(
		ctx context.Context,
		data *string,
		authUser *auth.AuthenticatedUser,
		onResponse func(response utils.OkResponse[any]),
		onError func(response utils.ErrorResponse),
	) {
		if data == nil {
			onError(utils.CreateSocketErrorResponse(utils.ErrorInvalidSocketRequest))
			return
		}

		s.openShellsMutex.Lock()
		shell, hasShell := s.openShells[shellId]
		s.openShellsMutex.Unlock()

		if !hasShell {
			onError(utils.CreateSocketErrorResponse(utils.ErrorShellNotFound))
			return
		}

		if shell.Owner.UserId != authUser.UserId {
			onError(utils.CreateSocketErrorResponse(utils.ErrorNoAccessToShell))
			return
		}

		_, err := shell.Connection.Write(([]byte)(*data))
		if err != nil {
			log.Errorf("Failed to write shell data: %s", err.Error())
			onError(utils.CreateSocketErrorResponse(err))
		}
	}
}

// streamClabOutput Streams the output of a containerlab command to a given socket namespace.
func streamClabOutput(logNamespace socket.OutputNamespace[string], output *string) {
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

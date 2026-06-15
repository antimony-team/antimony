package instance

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/statusmessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/socket"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"context"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	"gopkg.in/yaml.v3"
)

type Service struct {
	config *config.AntimonyConfig

	// Map of currently active instances indexed by lab ID.
	// The instances can be in any of the real states.
	instances      map[string]*Instance
	instancesMutex sync.Mutex

	nodeKindConfigs map[string]NodeKindConfig

	monitor *Monitor

	labRepo         *lab.Repository
	schemaService   *schema.Service
	topologyService *topology.Service

	storageManager *storage.Manager
	socketManager  *socket.Manager

	deploymentProvider deployment.DeploymentProvider

	labEventBus *utils.EventBus[*lab.Lab]

	updatesNamespace       *socket.OutputNamespace[instanceUpdate]
	statusMessageNamespace *socket.OutputNamespace[statusmessage.Message]
}

func CreateService(
	config *config.AntimonyConfig,
	schemaService *schema.Service,
	labRepo *lab.Repository,
	topologyService *topology.Service,
	storageManager *storage.Manager,
	socketManager *socket.Manager,
	labEventBus *utils.EventBus[*lab.Lab],
	statusMessageNamespace *socket.OutputNamespace[statusmessage.Message],
	deploymentProvider deployment.DeploymentProvider,
) *Service {
	monitor := CreateMonitor(socketManager, deploymentProvider)

	service := &Service{
		config:                 config,
		labRepo:                labRepo,
		schemaService:          schemaService,
		topologyService:        topologyService,
		monitor:                monitor,
		nodeKindConfigs:        getNodeKindConfigs("./kinds.conf.yml"),
		instances:              make(map[string]*Instance),
		instancesMutex:         sync.Mutex{},
		storageManager:         storageManager,
		labEventBus:            labEventBus,
		deploymentProvider:     deploymentProvider,
		socketManager:          socketManager,
		statusMessageNamespace: statusMessageNamespace,
	}

	service.updatesNamespace = socket.CreateOutputNamespace[instanceUpdate](
		socketManager, false, nil, false, nil, "lab-updates",
	)

	service.reviveInstances()
	service.updatesNamespace.Send(instanceUpdate{
		LabId: nil,
	})

	go service.registerProviderEventListener()

	go service.monitor.Run()

	return service
}

/*
 * Lab Created -> Put in deployment schedule
 * Lab Deleted -> Remove from deployment schedule (Only non-running)
 *
 * Lab manually deployed -> Remove from deployment schedule, put in destruction
 * Lab manually destroyed -> Remove from destruction schedule
 *
 * Lab automatically deployed -> Removed from deployment schedule, put in destruction
 * Lab automatically destroyed -> Removed from destruction schedule
 *
 * Lab (manually) redeployed -> Leave everything as-is
 */

func (s *Service) DeployLabCommand(ctx context.Context, labId string, authUser *auth.AuthenticatedUser) error {
	instanceLab, err := s.validateLabCommand(ctx, labId, authUser)
	if err != nil {
		return err
	}

	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[instanceLab.UUID]
	s.instancesMutex.Unlock()

	if hasInstance {
		return s.redeployLab(instanceLab, instance)
	}

	// When deploying a lab that has already ended, set its end time to indefinite
	if instanceLab.EndTime != nil && instanceLab.EndTime.Unix() <= time.Now().Unix() {
		instanceLab.EndTime = nil
		if err := s.labRepo.Update(context.Background(), instanceLab); err != nil {
			log.Errorf("Failed to update lab end time: %s", err.Error())
		}
	}

	// Make sure everyone knows the lab is being deployed manually by the user
	s.labEventBus.Publish("lab.manually-deployed", instanceLab)

	if err := s.DeployLab(instanceLab); err != nil {
		return err
	}

	return nil
}

func (s *Service) DestroyLabCommand(ctx context.Context, labId string, authUser *auth.AuthenticatedUser) error {
	instanceLab, err := s.validateLabCommand(ctx, labId, authUser)
	if err != nil {
		return err
	}

	s.labEventBus.Publish("lab.deleted", instanceLab)

	if err := s.DestroyLab(instanceLab); err != nil {
		return err
	}

	return nil
}

func (s *Service) StartNodeCommand(
	ctx context.Context,
	labId string,
	nodeId *string,
	authUser *auth.AuthenticatedUser,
) error {
	instanceLab, instance, node, err := s.validateNodeCommand(ctx, labId, nodeId, authUser)
	if err != nil {
		return err
	}

	if !node.CanRestart {
		return fmt.Errorf("unable to manually start nodes of kind '%s'", node.Kind)
	}

	switch node.State {
	case deployment.NodeStates.Starting:
		return fmt.Errorf("node is already starting")
	case deployment.NodeStates.Running:
		return fmt.Errorf("node is already running")
	}

	if err := s.deploymentProvider.StartNode(ctx, node.ContainerId); err != nil {
		return err
	}

	if err := s.updateInstanceNode(ctx, instance, instanceLab.InstanceName, node, true); err != nil {
		return err
	}

	go s.startNodeStartupListener(node, instance, instanceLab)

	s.notifyUpdate(*instanceLab, statusmessage.Success(
		"Runtime",
		fmt.Sprintf("Node %s is starting", node.Name),
		"Node has been started", "nodeId", node.ContainerId, "labId", instanceLab.UUID,
	))

	return nil
}

func (s *Service) StopNodeCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) error {
	instanceLab, instance, node, err := s.validateNodeCommand(ctx, labId, nodeName, authUser)
	if err != nil {
		return err
	}

	if !node.CanRestart {
		return fmt.Errorf("unable to manually stop nodes of kind '%s'", node.Kind)
	}

	if node.State == deployment.NodeStates.Exited {
		return fmt.Errorf("node is already stopped")
	}

	//s.closeNodeShells(node.Name)

	if err := s.deploymentProvider.StopNode(ctx, node.ContainerId); err != nil {
		return err
	}

	if err := s.updateInstanceNode(ctx, instance, instanceLab.InstanceName, node, true); err != nil {
		return err
	}

	s.notifyUpdate(*instanceLab, statusmessage.Success(
		"Runtime",
		fmt.Sprintf("Node %s is stopping", node.Name),
		"Node has been stopped", "nodeId", node.ContainerId, "labId", instanceLab.UUID,
	))

	return nil
}

func (s *Service) RestartNodeCommand(
	ctx context.Context,
	labId string,
	nodeId *string,
	authUser *auth.AuthenticatedUser,
) error {
	instanceLab, instance, node, err := s.validateNodeCommand(ctx, labId, nodeId, authUser)
	if err != nil {
		return err
	}

	if !node.CanRestart {
		return fmt.Errorf("unable to manually restart nodes of kind '%s'", node.Kind)
	}

	//s.closeNodeShells(node.Name)

	if err := s.deploymentProvider.RestartNode(ctx, node.ContainerId); err != nil {
		return err
	}

	if err := s.updateInstanceNode(ctx, instance, instanceLab.InstanceName, node, true); err != nil {
		return err
	}

	go s.startNodeStartupListener(node, instance, instanceLab)

	s.notifyUpdate(*instanceLab, statusmessage.Success(
		"Runtime",
		fmt.Sprintf("Node %s is restarting", node.Name),
		"Node has been restarted", "nodeId", node.ContainerId, "labId", instanceLab.UUID,
	))

	return nil
}

func (s *Service) validateLabCommand(
	ctx context.Context,
	labId string,
	authUser *auth.AuthenticatedUser,
) (*lab.Lab, error) {
	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != instanceLab.Creator.UUID {
		return nil, utils.ErrNoDeployAccessToLab
	}

	return instanceLab, nil
}

func (s *Service) validateNodeCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) (*lab.Lab, *Instance, *InstanceNode, error) {
	if nodeName == nil {
		return nil, nil, nil, utils.ErrNodeNotFound
	}

	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, nil, nil, err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != instanceLab.Creator.UUID {
		return nil, nil, nil, utils.ErrNoDestroyAccessToLab
	}

	// Don't allow destroying non-running labs
	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[instanceLab.UUID]
	s.instancesMutex.Unlock()

	if !hasInstance {
		return nil, nil, nil, utils.ErrLabNotRunning
	}

	var node *InstanceNode

	for i := range instance.Nodes {
		if instance.Nodes[i].Name == *nodeName {
			node = &instance.Nodes[i]
			break
		}
	}

	if node == nil {
		return nil, nil, nil, utils.ErrNodeNotFound
	}

	return instanceLab, instance, node, nil
}

func (s *Service) registerProviderEventListener() {
	ctx := context.Background()

	_ = s.deploymentProvider.RegisterListener(ctx, func(containerId string) {
		var targetLabId *string

		s.instancesMutex.Lock()
		for labId, instance := range s.instances {
			_, hasMatched := lo.Find(instance.Nodes, func(item InstanceNode) bool {
				return item.ContainerId == containerId
			})

			if hasMatched {
				targetLabId = &labId
				break
			}
		}
		s.instancesMutex.Unlock()

		if targetLabId != nil {
			s.updatesNamespace.Send(instanceUpdate{
				LabId:    targetLabId,
				NewState: nil,
			})
		}
	})
}

func (s *Service) GetInstance(labId string) *Instance {
	s.instancesMutex.Lock()
	defer s.instancesMutex.Unlock()

	return s.instances[labId]
}

func (s *Service) DestroyLab(lab *lab.Lab) error {
	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[lab.UUID]
	s.instancesMutex.Unlock()

	if !hasInstance {
		return utils.ErrLabNotRunning
	}

	// We have to ensure that we cancel any pending deployment operations before destroying
	if instance.DeploymentWorker != nil && instance.DeploymentWorker.Context.Err() == nil {
		instance.DeploymentWorker.Cancel()
	}

	// We need to wait for previous operations to complete before destroying the lab
	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	// Close all open shells for all nodes in the lab
	//for _, node := range instance.Nodes {
	//	s.closeNodeShells(node.Name)
	//}

	ctx := context.Background()

	s.updateStateAndNotify(
		lab, instance, InstanceStates.Stopping,
		statusmessage.Info(
			"Runtime", fmt.Sprintf("Destroying lab '%s'", lab.Name),
			"Destruction of lab has begun", "name", lab.Name, "id", lab.UUID,
		),
		instance.LogNamespace,
	)

	output, err := s.deploymentProvider.Destroy(ctx, instance.TopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})
	streamClabOutput(instance.LogNamespace, output)

	if err != nil {
		s.statusMessageNamespace.Send(*statusmessage.Error(
			"Runtime", fmt.Sprintf("Failed to destroy lab '%s': %s", lab.Name, err.Error()),
			"Destruction of lab has failed", "name", lab.Name, "id", lab.UUID,
		))
		return utils.ErrContainerlab
	}

	instance.LogNamespace.ClearBacklog()

	// Remove instance from a lab and send update to clients
	s.instancesMutex.Lock()
	delete(s.instances, lab.UUID)
	s.instancesMutex.Unlock()

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &lab.UUID,
	})

	s.statusMessageNamespace.Send(*statusmessage.Success(
		"Runtime", fmt.Sprintf("Successfully destroyed lab '%s'", lab.Name),
		"Destruction of lab has succeeded", "name", lab.Name, "id", lab.UUID,
	))

	return nil
}

func (s *Service) redeployLab(lab *lab.Lab, instance *Instance) error {
	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	// We have to ensure that the instance isn't already being deployed
	if instance.State == InstanceStates.Deploying {
		s.notifyUpdate(*lab,
			statusmessage.Error(
				"Runtime", fmt.Sprintf("Lab '%s' is currently being deployed", lab.Name),
				"Failed to redeploy lab. The lab is currently being deployed", "name", lab.Name, "id", lab.UUID,
			),
		)
		return utils.ErrLabIsDeploying
	}

	ctx, cancel := context.WithCancel(context.Background())
	instance.DeploymentWorker = &utils.Worker{
		Context: ctx,
		Cancel:  cancel,
	}
	defer instance.DeploymentWorker.Cancel()

	// Close all open shells for all nodes in the lab
	//for _, node := range instance.Nodes {
	//	s.closeNodeShells(node.Name)
	//}

	instance.Nodes = make([]InstanceNode, 0)
	instance.Recovered = false
	instance.Deployed = time.Now()

	s.updateStateAndNotify(lab, instance, InstanceStates.Deploying,
		statusmessage.Info(
			"Runtime", fmt.Sprintf("Redeploying lab '%s'", lab.Name),
			"Redeployment of lab has begun", "name", lab.Name, "id", lab.UUID,
		),
		instance.LogNamespace,
	)

	output, err := s.deploymentProvider.Redeploy(ctx, instance.TopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})

	streamClabOutput(instance.LogNamespace, output)

	// Only report errors if the worker has not been canceled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(lab, instance, InstanceStates.Failed,
			statusmessage.Error(
				"Runtime", fmt.Sprintf("Failed to redeploy lab '%s'", lab.Name),
				"Redeployment of lab has failed", "name", lab.Name, "id", lab.UUID,
			),
			instance.LogNamespace,
		)
		s.topologyService.SetLastDeployFailed(ctx, &lab.Topology, true)
		return utils.ErrContainerlab
	}

	// Fetch and attach lab inspect info and change state to running if successful
	instanceNodes, err := s.getNodesFromInspect(ctx, instance, lab.InstanceName, func(data string) {
		instance.LogNamespace.Send(data)
	})

	for i := range instanceNodes {
		go s.startNodeStartupListener(&instanceNodes[i], instance, lab)
	}

	// Only report errors if the deployment worker has not been canceled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(lab, instance, InstanceStates.Failed,
			statusmessage.Warning(
				"Runtime", fmt.Sprintf("Failed to inspect lab '%s'", lab.Name),
				"Inspection of lab has failed", "name", lab.Name, "id", lab.UUID,
			),
			instance.LogNamespace,
		)
		s.topologyService.SetLastDeployFailed(ctx, &lab.Topology, true)
		return utils.ErrContainerlab
	}

	log.Infof("[SCHEDULER] Successfully redeployed lab '%s'!", lab.Name)
	instance.Nodes = instanceNodes
	for _, node := range instanceNodes {
		containerLogNamespace := socket.CreateOutputNamespace[string](
			s.socketManager,
			false,
			&socket.BacklogConfig{
				Capacity: s.config.Streaming.ContainerLogBacklog,
				Kind:     utils.RingKindValue,
			},
			true, nil,
			"logs",
			lab.UUID,
			node.ContainerId,
		)
		err := s.deploymentProvider.StreamContainerLogs(ctx, "", node.ContainerId, func(data string) {
			containerLogNamespace.Send(data)
		})
		if err != nil {
			log.Errorf("Failed to setup container logs for container %s: %s", node.ContainerId, err.Error())
		}
	}

	s.updateStateAndNotify(lab, instance, InstanceStates.Running,
		statusmessage.Success(
			"Runtime", fmt.Sprintf("Successfully redeployed '%s'", lab.Name),
			"Redeployment of lab was successful", "name", lab.Name, "id", lab.UUID,
		),
		instance.LogNamespace,
	)
	s.topologyService.SetLastDeployFailed(ctx, &lab.Topology, false)

	instance.DeploymentWorker.Context.Done()

	return nil
}

func (s *Service) DeployLab(lab *lab.Lab) error {
	// We have to ensure that the instance is only created once
	s.instancesMutex.Lock()

	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
		s.notifyUpdate(*lab,
			statusmessage.Error(
				"Runtime", fmt.Sprintf("Lab '%s' has already been deployed", lab.Name),
				"Failed to deploy lab. The lab has already been deployed", "name", lab.Name, "id", lab.UUID,
			),
		)
		s.instancesMutex.Unlock()
		return utils.ErrLabIsDeploying
	}

	logNamespace := socket.CreateOutputNamespace[string](
		s.socketManager,
		false,
		&socket.BacklogConfig{
			Capacity: s.config.Streaming.ClabLogBacklog,
			Kind:     utils.RingKindValue,
		},
		true,
		nil,
		"logs",
		lab.UUID,
	)

	var runTopologyDefinition string
	runTopologyFile, err := s.storageManager.GetRunEnvironment(lab.UUID, &runTopologyDefinition)

	if err != nil {
		log.Errorf("Failed to get lab environment for lab '%s': %s", lab.Name, err)
		s.updateStateAndNotify(lab, nil, InstanceStates.Failed,
			statusmessage.Error("Runtime",
				fmt.Sprintf("Failed to get environment for lab '%s' (%s)", lab.Name, lab.Topology.Name),
				"Failed to get environment for lab",
				"id", lab.UUID, "instance", lab.InstanceName, "topo", lab.Topology.Name,
			),
			logNamespace,
		)
		s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, true)
		s.instancesMutex.Unlock()
		return utils.ErrAntimony
	}

	instance := s.createInstance(logNamespace, *runTopologyFile, runTopologyDefinition)
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

	s.updateStateAndNotify(lab, instance, InstanceStates.Deploying,
		statusmessage.Info("Runtime",
			fmt.Sprintf("Deploying lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Starting deployment of lab", "id", lab.UUID, "instance", lab.InstanceName, "topo", lab.Topology.Name,
		),
		instance.LogNamespace,
	)

	output, err := s.deploymentProvider.Deploy(ctx, *runTopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})

	streamClabOutput(instance.LogNamespace, output)

	// Only report errors if the deployment worker has not been canceled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(lab, instance, InstanceStates.Failed,
			statusmessage.Error("Runtime",
				fmt.Sprintf("Failed to deploy lab '%s': %s", lab.Name, err.Error()),
				"Deployment of lab failed", "id", lab.UUID, "instance", lab.InstanceName, "topo", lab.Topology.Name,
			),
			instance.LogNamespace,
		)
		s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, true)
		return utils.ErrContainerlab
	}

	// Fetch and attach lab inspect info and change state to running if successful
	instanceNodes, err := s.getNodesFromInspect(ctx, instance, lab.InstanceName, func(data string) {
		instance.LogNamespace.Send(data)
	})

	for i := range instanceNodes {
		go s.startNodeStartupListener(&instanceNodes[i], instance, lab)
	}

	// Only report errors if the deployment worker has not been canceled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(lab, instance, InstanceStates.Failed,
			statusmessage.Warning("Runtime",
				fmt.Sprintf("Failed to get info of lab '%s' (%s)", lab.Name, lab.Topology.Name),
				"Inspection of lab failed", "instance", lab.InstanceName, "topo", lab.Topology.Name,
			),
			instance.LogNamespace,
		)
		s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, true)
		return utils.ErrContainerlab
	}

	log.Infof("[SCHEDULER] Successfully deployed lab '%s'!", lab.Name)
	instance.Nodes = instanceNodes
	for _, node := range instanceNodes {
		containerLogNamespace := socket.CreateOutputNamespace[string](
			s.socketManager,
			false,
			&socket.BacklogConfig{
				Capacity: s.config.Streaming.ContainerLogBacklog,
				Kind:     utils.RingKindValue,
			},
			true,
			nil,
			"logs",
			lab.UUID,
			node.ContainerId,
		)
		err := s.deploymentProvider.StreamContainerLogs(ctx, "", node.ContainerId, func(data string) {
			containerLogNamespace.Send(data)
		})
		if err != nil {
			log.Errorf("Failed to setup container logs for container %s: %s", node.ContainerId, err.Error())
		}
	}

	s.updateStateAndNotify(lab, instance, InstanceStates.Running,
		statusmessage.Success(
			"Runtime", fmt.Sprintf("Successfully deployed '%s'", lab.Name),
			"Deployment of lab was successful", "name", lab.Name, "id", lab.UUID,
		),
		instance.LogNamespace,
	)
	s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, false)

	instance.DeploymentWorker.Context.Done()

	return nil
}

// startNodeStartupListener Starts a blocking listener that waits until the localhost SSH Service responds or the container is stopped
func (s *Service) startNodeStartupListener(node *InstanceNode, instance *Instance, lab *lab.Lab) {
	ctx := context.Background()

	// We can't use Go's built-in SSH service here as it responds differently to when the sevrer is not reachable.
	cmd := []string{
		"bash", "-c", `
		until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 admin@localhost; do
			sleep 2
		done
	`}

	connection, err := s.deploymentProvider.ExecInteractive(ctx, node.ContainerId, cmd)
	if err != nil {
		// Error code 127 means that the command was not found.
		// If bash or ssh can't be found, just treat the node as started as there is no service running inside
		// the node that we have to wait for anyway.
		if strings.Contains(err.Error(), "exit code 127") {
			s.onNodeStarted(ctx, instance, node, lab)
			return
		}

		log.Error(
			"Failed to listen for node startup.",
			"err", err.Error(),
			"lab", lab.ID,
			"node", node.Name,
		)

		return
	}

	// We wait until the SSH process responds or the pipe is broken
	buf := make([]byte, 1024)
	_, err = connection.Read(buf)

	if err == nil {
		s.onNodeStarted(ctx, instance, node, lab)
	}
}

func (s *Service) onNodeStarted(
	ctx context.Context,
	instance *Instance,
	node *InstanceNode,
	lab *lab.Lab,
) {
	interfaces, _ := s.deploymentProvider.GetInterfaces(ctx, node.ContainerName)

	s.monitor.AddNode(node.ContainerId)

	instance.Mutex.Lock()
	node.State = deployment.NodeStates.Running
	node.Interfaces = interfaces
	instance.Mutex.Unlock()

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &lab.UUID,
	})
}

func (s *Service) createInstance(
	logNamespace *socket.OutputNamespace[string],
	runTopologyFile string,
	runTopologyDefinition string,
) *Instance {
	runTopologyDefintionParsed, _ := s.schemaService.Parse(runTopologyDefinition)

	return &Instance{
		Deployed:          time.Now(),
		LatestStateChange: time.Now(),
		State:             InstanceStates.Deploying,
		Recovered:         false,
		Mutex:             sync.Mutex{},
		DeploymentWorker:  nil,
		LogNamespace:      logNamespace,
		TopologyFile:      runTopologyFile,
		NodeKinds:         s.extractNodeKinds(*runTopologyDefintionParsed),
		NodeLabels:        s.extractNodeLabels(*runTopologyDefintionParsed),
	}
}

func (s *Service) extractNodeLabels(topologyDefinition any) map[string]map[string]string {
	result := make(map[string]map[string]string)

	topologyMap, ok := topologyDefinition.(map[string]any)
	if !ok {
		return result
	}

	top, ok := topologyMap["topology"].(map[string]any)
	if !ok {
		return result
	}

	nodes, ok := top["nodes"].(map[string]any)
	if !ok {
		return result
	}

	for nodeName, nodeVal := range nodes {
		node, ok := nodeVal.(map[string]any)
		if !ok {
			continue
		}

		labels, ok := node["labels"].(map[string]any)
		if !ok {
			continue
		}

		result[nodeName] = make(map[string]string)
		for k, v := range labels {
			result[nodeName][k] = fmt.Sprintf("%v", v)
		}
	}

	return result
}

func (s *Service) extractNodeKinds(topologyDefinition any) map[string]string {
	result := make(map[string]string)

	topologyMap, ok := topologyDefinition.(map[string]any)
	if !ok {
		return result
	}

	top, ok := topologyMap["topology"].(map[string]any)
	if !ok {
		return result
	}

	nodes, ok := top["nodes"].(map[string]any)
	if !ok {
		return result
	}

	for nodeName, nodeVal := range nodes {
		node, ok := nodeVal.(map[string]any)
		if !ok {
			continue
		}

		kind, ok := node["kind"].(string)
		if !ok {
			continue
		}

		result[nodeName] = kind
	}

	return result
}

func (s *Service) updateInstanceNode(
	ctx context.Context,
	instance *Instance,
	instanceName string,
	node *InstanceNode,
	sendLogs bool,
) error {
	var onLog func(string)

	if sendLogs && instance.LogNamespace != nil {
		onLog = func(data string) {
			instance.LogNamespace.Send(data)
		}
	}

	updatedNodes, err := s.getNodesFromInspect(ctx, instance, instanceName, onLog)
	if err != nil {
		return err
	}

	updatedNode, found := lo.Find(updatedNodes, func(cmpNode InstanceNode) bool {
		return cmpNode.Name == node.Name
	})

	if !found {
		return nil
	}

	instance.Mutex.Lock()
	node.State = updatedNode.State
	node.IPv4 = updatedNode.IPv4
	node.IPv6 = updatedNode.IPv6
	node.Interfaces = updatedNode.Interfaces
	instance.Mutex.Unlock()

	return nil
}

func (s *Service) getNodesFromInspect(
	ctx context.Context,
	instance *Instance,
	instanceName string,
	onLog func(data string),
) ([]InstanceNode, error) {
	inspectOutput, err := s.deploymentProvider.Inspect(ctx, instance.TopologyFile, onLog)

	if err != nil {
		return nil, err
	}

	containers := inspectOutput[instanceName]

	return lo.Map(containers, func(container deployment.InspectContainer, _ int) InstanceNode {
		return s.containerToInstanceNode(container, instanceName, instance.NodeKinds)
	}), nil
}

func (s *Service) containerToInstanceNode(
	container deployment.InspectContainer,
	instanceName string,
	nodeKinds map[string]string,
) InstanceNode {
	var ok bool

	prefix := fmt.Sprintf("clab-%s-", instanceName)
	nodeName := strings.TrimPrefix(container.Name, prefix)

	var nodeKind string
	canRestart := false

	if nodeKind, ok = nodeKinds[nodeName]; ok {
		if kindConfig, ok := s.nodeKindConfigs[nodeKind]; ok {
			if kindConfig.CanRestart != nil && *kindConfig.CanRestart {
				canRestart = true
			}
		}
	} else {
		log.Warnf("Failed to get kind for running node '%s'", nodeName)
	}

	nodeState := container.State

	// Always set running nodes to starting as we want the startup listener to decide when they are actually running
	if container.State == deployment.NodeStates.Running {
		nodeState = deployment.NodeStates.Starting
	}

	return InstanceNode{
		Name:          nodeName,
		Kind:          nodeKind,
		IPv4:          container.IPv4Address,
		IPv6:          container.IPv6Address,
		State:         nodeState,
		ContainerId:   container.ContainerId,
		ContainerName: container.Name,
		Interfaces:    make([]deployment.NodeInterface, 0),
		CanRestart:    canRestart,
	}
}

func (s *Service) notifyUpdate(lab lab.Lab, message *statusmessage.Message) {
	s.updatesNamespace.Send(instanceUpdate{
		LabId: &lab.UUID,
	})

	if message != nil {
		s.statusMessageNamespace.Send(*message)
	}
}

// updateStateAndNotify Updates the state of a lab and sends various notification updates.
// If the status message is set, all users will receive the status message.
// If the log namespace is set, the log content of the status message is also sent to the provided namespace.
func (s *Service) updateStateAndNotify(
	lab *lab.Lab,
	instance *Instance,
	state InstanceState,
	statusMessage *statusmessage.Message,
	logNamespace *socket.OutputNamespace[string],
) {
	if instance != nil {
		instance.State = state
		instance.LatestStateChange = time.Now()
	}

	s.updatesNamespace.Send(instanceUpdate{
		LabId:    &lab.UUID,
		NewState: &state,
	})

	if statusMessage != nil {
		s.statusMessageNamespace.Send(*statusMessage)
		if logNamespace != nil {
			logNamespace.Send(statusMessage.LogContent)
		}
	}
}

// reviveInstances runs whenever the application is started and attempts to restore instances from running containers
// and database entries. Labs that have not yet been started and have a start time in the future will be scheduled by the scheduler.
func (s *Service) reviveInstances() {
	ctx := context.Background()

	savedLabs, err := s.labRepo.GetAll(ctx, nil)
	if err != nil {
		log.Fatal("Failed to load labs from database. Exiting.")
		return
	}

	result, err := s.deploymentProvider.InspectAll(ctx)
	if err != nil {
		log.Fatal("Failed to retrieve containers from clab inspect. Exiting.", "err", err.Error())
		return
	}

	for _, savedLab := range savedLabs {
		containers, isCurrentlyDeployed := result[savedLab.InstanceName]

		if !isCurrentlyDeployed {
			// If the lab's start time is in the future, notify the scheduler to schedule the lab
			if savedLab.StartTime.Unix() >= time.Now().Unix() {
				s.labEventBus.Publish("lab.created", &savedLab)
			}
			continue
		}

		logNamespace := socket.CreateOutputNamespace[string](
			s.socketManager,
			false,
			&socket.BacklogConfig{
				Capacity: s.config.Streaming.ClabLogBacklog,
				Kind:     utils.RingKindValue,
			},
			true,
			nil,
			"logs",
			savedLab.UUID,
		)

		for _, container := range containers {
			containerLogNamespace := socket.CreateOutputNamespace[string](
				s.socketManager,
				false,
				&socket.BacklogConfig{
					Capacity: s.config.Streaming.ContainerLogBacklog,
					Kind:     utils.RingKindValue,
				},
				true,
				nil,
				"logs",
				savedLab.UUID,
				container.ContainerId,
			)
			err := s.deploymentProvider.StreamContainerLogs(
				ctx, "", container.ContainerId, func(data string) {
					containerLogNamespace.Send(data)
				},
			)
			if err != nil {
				log.Errorf(
					"Failed to setup container logs for container %s: %s", container.ContainerId, err.Error(),
				)
			}
		}

		var nodeKinds map[string]string
		var nodeLabels map[string]map[string]string
		topologyDefinition := new(string)

		if err := s.storageManager.ReadTopology(savedLab.Topology.UUID, topologyDefinition); err == nil {
			topologyDefinitionParsed, _ := s.schemaService.Parse(*topologyDefinition)
			nodeLabels = s.extractNodeLabels(*topologyDefinitionParsed)
			nodeKinds = s.extractNodeKinds(*topologyDefinitionParsed)
		}

		instanceNodes := lo.Map(containers, func(container deployment.InspectContainer, _ int) InstanceNode {
			return s.containerToInstanceNode(container, savedLab.InstanceName, nodeKinds)
		})

		instance := &Instance{
			State:             InstanceStates.Running,
			Nodes:             instanceNodes,
			Deployed:          time.Now(),
			LatestStateChange: time.Now(),
			Recovered:         true,
			TopologyFile:      s.storageManager.GetRunTopologyFile(savedLab.UUID),
			LogNamespace:      logNamespace,
			NodeLabels:        nodeLabels,
			NodeKinds:         nodeKinds,
		}

		for i := range instanceNodes {
			if instanceNodes[i].State != deployment.NodeStates.Exited {
				go s.startNodeStartupListener(&instanceNodes[i], instance, &savedLab)
			}
		}

		s.instancesMutex.Lock()
		s.instances[savedLab.UUID] = instance
		s.instancesMutex.Unlock()

		s.labEventBus.Publish("lab.restored", &savedLab)

		// TODO(kian): Implement adding this to only destruction schedule somehow
		//s.labDestructionSchedule.Schedule(&savedLab)
	}
}

// streamClabOutput Streams the output of a containerlab command to a given socket namespace.
func streamClabOutput(logNamespace *socket.OutputNamespace[string], output *string) {
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

func getNodeKindConfigs(path string) map[string]NodeKindConfig {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Infof("No kind config file was specified: %s", err)
		return make(map[string]NodeKindConfig)
	}

	log.Info("Loaded container kinds config file.", "file", path)

	var configs map[string]NodeKindConfig
	if err := yaml.Unmarshal(data, &configs); err != nil {
		log.Warnf("Failed to parse node kind config: %s", err)
		return make(map[string]NodeKindConfig)
	}

	for kind, nodeConfig := range configs {
		configs[kind] = nodeConfig
	}

	return configs
}

func (s *Service) GetNodeKindsConfig() map[string]NodeKindConfig {
	return s.nodeKindConfigs
}

func (s *Service) GetInstanceNode(
	ctx context.Context,
	labId string,
	nodeName string,
	authUser *auth.AuthenticatedUser,
) (*InstanceNode, error) {
	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, err
	}

	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, instanceLab.Topology.Collection.Name) {
		return nil, utils.ErrNoAccessToLab
	}

	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[instanceLab.UUID]
	s.instancesMutex.Unlock()

	if !hasInstance {
		return nil, utils.ErrLabNotRunning
	}

	node, hasNode := lo.Find(instance.Nodes, func(node InstanceNode) bool {
		return node.Name == nodeName
	})
	if !hasNode {
		return nil, utils.ErrNodeNotFound
	}

	return &node, nil
}

func (s *Service) IsRunning(labId string) bool {
	s.instancesMutex.Lock()
	defer s.instancesMutex.Unlock()

	_, hasInstance := s.instances[labId]

	return hasInstance
}

func (s *Service) CanDelete(labId string) bool {
	s.instancesMutex.Lock()
	defer s.instancesMutex.Unlock()

	if instance, hasInstance := s.instances[labId]; hasInstance {
		// If instance is failed, user can delete it
		return instance.State == InstanceStates.Failed
	}

	return true
}

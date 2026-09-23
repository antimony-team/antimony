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
	"errors"
	"fmt"
	"maps"
	"os"
	"path"
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

	//s.instancesMutex.Lock()
	//instance, hasInstance := s.instances[instanceLab.UUID]
	//s.instancesMutex.Unlock()

	//if hasInstance {
	//	return s.redeployLab(instanceLab, instance)
	//}

	// When deploying a lab that has already ended, set its end time to indefinite
	if instanceLab.EndTime != nil && instanceLab.EndTime.Unix() <= time.Now().Unix() {
		instanceLab.EndTime = nil
		if err := s.labRepo.Update(context.Background(), instanceLab); err != nil {
			log.Errorf("Failed to update lab end time: %s", err.Error())
		}
	}

	// Make sure everyone knows the lab is being deployed manually by the user
	s.labEventBus.Publish("lab.manually-deployed", instanceLab)

	return s.DeployLab(instanceLab)
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
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) error {
	instanceLab, instance, err := s.validateNodeCommand(ctx, labId, nodeName, authUser)
	if err != nil {
		return err
	}

	// Don't wait to acquire mutex, just abort immediately if lab is busy
	if !instance.OperationMutex.TryLock() {
		return utils.ErrLabOperationInProgress
	}
	defer instance.OperationMutex.Unlock()

	node := getInstanceNode(instance, *nodeName)

	if node == nil {
		return utils.ErrNodeNotFound
	} else if !node.CanRestart {
		return fmt.Errorf("%w: unable to manually start nodes of kind '%s'", utils.ErrInvalidNodeOperation, node.Kind)
	}

	instance.DataMutex.Lock()
	nodeState := node.State
	instance.DataMutex.Unlock()

	switch nodeState {
	case deployment.NodeStates.Starting:
		return fmt.Errorf("%w: node is already starting", utils.ErrInvalidNodeOperation)
	case deployment.NodeStates.Running:
		return fmt.Errorf("%w: node is already running", utils.ErrInvalidNodeOperation)
	case deployment.NodeStates.Stopping:
		return fmt.Errorf("%w: node is currently stopping", utils.ErrInvalidNodeOperation)
	}

	deploymentContext := instance.deploymentContext()

	err = s.deploymentProvider.StartNode(
		deploymentContext,
		instanceLab.InstanceName,
		node.Name,
	)
	if err != nil {
		return err
	}

	if _, err := s.fetchNode(instance, instanceLab.InstanceName, node, true); err != nil {
		return err
	}

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})

	go s.startNodeStartupListener(node, instance, instanceLab)

	return nil
}

func (s *Service) StopNodeCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) error {
	instanceLab, instance, err := s.validateNodeCommand(ctx, labId, nodeName, authUser)
	if err != nil {
		return err
	}

	// Don't wait to acquire mutex, just abort immediately if lab is busy
	if !instance.OperationMutex.TryLock() {
		return utils.ErrLabOperationInProgress
	}
	defer instance.OperationMutex.Unlock()

	node := getInstanceNode(instance, *nodeName)

	if node == nil {
		return utils.ErrNodeNotFound
	} else if !node.CanRestart {
		return fmt.Errorf("%w: unable to manually start nodes of kind '%s'", utils.ErrInvalidNodeOperation, node.Kind)
	}

	instance.DataMutex.Lock()
	nodeState := node.State
	instance.DataMutex.Unlock()

	switch nodeState {
	case deployment.NodeStates.Stopping:
		return fmt.Errorf("%w: node is already stopping", utils.ErrInvalidNodeOperation)
	case deployment.NodeStates.Stopped:
		return fmt.Errorf("%w: node is already stopped", utils.ErrInvalidNodeOperation)
	}

	instance.DataMutex.Lock()
	deploymentContext := instance.DeploymentCtx
	node.Reset()
	instance.DataMutex.Unlock()

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})

	err = s.deploymentProvider.StopNode(
		deploymentContext,
		instanceLab.InstanceName,
		node.Name,
	)
	if err != nil {
		return err
	}

	if _, err := s.fetchNode(instance, instanceLab.InstanceName, node, true); err != nil {
		return err
	}

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})

	return nil
}

func (s *Service) RestartNodeCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) error {
	instanceLab, instance, err := s.validateNodeCommand(ctx, labId, nodeName, authUser)
	if err != nil {
		return err
	}

	// Don't wait to acquire mutex, just abort immediately if lab is busy
	if !instance.OperationMutex.TryLock() {
		return utils.ErrLabOperationInProgress
	}
	defer instance.OperationMutex.Unlock()

	node := getInstanceNode(instance, *nodeName)

	if node == nil {
		return utils.ErrNodeNotFound
	} else if !node.CanRestart {
		return fmt.Errorf("%w: unable to manually start nodes of kind '%s'", utils.ErrInvalidNodeOperation, node.Kind)
	}

	instance.DataMutex.Lock()
	nodeState := node.State
	instance.DataMutex.Unlock()

	switch nodeState {
	case deployment.NodeStates.Stopping:
		return fmt.Errorf("%w: node is currently stopping", utils.ErrInvalidNodeOperation)
	case deployment.NodeStates.Starting:
		return fmt.Errorf("%w: node is currently starting", utils.ErrInvalidNodeOperation)
	}

	instance.DataMutex.Lock()
	deploymentContext := instance.DeploymentCtx
	node.Reset()
	instance.DataMutex.Unlock()

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})

	err = s.deploymentProvider.RestartNode(
		deploymentContext,
		instanceLab.InstanceName,
		node.Name,
	)
	if err != nil {
		return err
	}

	if _, err := s.fetchNode(instance, instanceLab.InstanceName, node, true); err != nil {
		return err
	}

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})

	go s.startNodeStartupListener(node, instance, instanceLab)

	return nil
}

func (s *Service) validateLabCommand(
	ctx context.Context,
	labId string,
	authUser *auth.AuthenticatedUser,
) (*lab.Lab, error) {
	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		if errors.Is(err, utils.ErrUuidNotFound) {
			return nil, utils.ErrLabNotFound
		}

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
) (*lab.Lab, *Instance, error) {
	if nodeName == nil {
		return nil, nil, utils.ErrNodeNotFound
	}

	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		if errors.Is(err, utils.ErrUuidNotFound) {
			return nil, nil, utils.ErrLabNotFound
		}

		return nil, nil, err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != instanceLab.Creator.UUID {
		return nil, nil, utils.ErrNoDestroyAccessToLab
	}

	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[instanceLab.UUID]
	s.instancesMutex.Unlock()

	// Don't allow destroying non-running labs
	if !hasInstance {
		return nil, nil, utils.ErrLabNotRunning
	}

	return instanceLab, instance, nil
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

	// We have to ensure that we cancel any pending deployment operations before destroying the instance
	instance.DeploymentMutex.Lock()
	if instance.DeploymentCancel != nil {
		instance.DeploymentCancel()
	}
	instance.DeploymentMutex.Unlock()

	instance.OperationMutex.Lock()
	defer instance.OperationMutex.Unlock()

	ctx := context.Background()

	log.Info(
		"[Runtime] Starting destruction of lab",
		"name",
		lab.Name, "id", lab.UUID,
		"instance", lab.InstanceName,
	)

	// Manually set node states to exited to mark the nodes no longer running
	instance.DataMutex.Lock()
	for _, node := range instance.Nodes {
		node.State = deployment.NodeStates.Stopped
		node.Interfaces = make([]deployment.NodeInterface, 0)
	}
	instance.DataMutex.Unlock()

	s.updateLabAndSendUpdate(
		lab, instance, InstanceStates.Stopping,
		statusmessage.Info(
			"Runtime", fmt.Sprintf("Destroying lab '%s'", lab.Name),
			"Destruction of lab has begun", "name", lab.Name, "id", lab.UUID,
		),
		instance.LogNamespace,
	)

	err := s.deploymentProvider.Destroy(ctx, instance.TopologyFile, lab.InstanceName, func(data string) {
		instance.LogNamespace.Send(data)
	})

	if err != nil {
		log.Warn(
			"[Runtime] Destruction of lab failed",
			"name", lab.Name,
			"id", lab.UUID,
			"instance", lab.InstanceName,
			"err", err.Error(),
		)

		s.updateLabAndSendUpdate(
			lab, instance, InstanceStates.Failed,
			statusmessage.Error(
				"Runtime", fmt.Sprintf("Failed to destroy lab '%s': %s", lab.Name, err.Error()),
				"Destruction of lab failed", "name", lab.Name, "id", lab.UUID, "err", err.Error(),
			),
			instance.LogNamespace,
		)

		return utils.ErrProvider
	}

	instance.DataMutex.Lock()
	instance.IsDestroyed = true
	instance.DataMutex.Unlock()

	instance.LogNamespace.Release()

	s.instancesMutex.Lock()
	delete(s.instances, lab.UUID)
	s.instancesMutex.Unlock()

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &lab.UUID,
	})

	log.Info(
		"[Runtime] Destruction of lab was successful",
		"name", lab.Name,
		"id", lab.UUID,
		"instance", lab.InstanceName,
	)

	s.statusMessageNamespace.Send(*statusmessage.Success(
		"Runtime", fmt.Sprintf("Successfully destroyed lab '%s'", lab.Name),
		"Destruction of lab was successful", "name", lab.Name, "id", lab.UUID,
	))

	return nil
}

func (s *Service) DeployLab(lab *lab.Lab) error {
	s.instancesMutex.Lock()
	instance, instanceRunning := s.instances[lab.UUID]

	if !instanceRunning {
		var runTopologyDefinition string
		runTopologyFile, err := s.storageManager.GetRunEnvironment(lab.UUID, &runTopologyDefinition)

		if err != nil {
			log.Error(
				"Failed to get run environment for lab",
				"name", lab.Name,
				"id", lab.UUID,
				"instance", lab.InstanceName,
				"err", err.Error(),
			)

			s.sendLabUpdate(
				lab, statusmessage.Error(
					"Runtime", fmt.Sprintf("Failed to get environment for lab '%s'", lab.Name),
					"Failed to get environment for lab. Please check Antimony logs for more details.",
					"name", lab.Name, "id", lab.UUID,
				),
				nil,
			)

			s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, true)

			s.instancesMutex.Unlock()
			return utils.ErrAntimony
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

		instance, err = s.createInstance(lab.InstanceName, logNamespace, *runTopologyFile, runTopologyDefinition)
		if err != nil {
			s.instancesMutex.Unlock()
			return err
		}

		s.instances[lab.UUID] = instance
	}

	s.instancesMutex.Unlock()

	ctx, cancel := context.WithCancel(context.Background())

	instance.DeploymentMutex.Lock()
	if instance.DeploymentCancel != nil {
		instance.DeploymentCancel()
	}
	instance.DeploymentCtx = ctx
	instance.DeploymentCancel = cancel
	instance.DeploymentMutex.Unlock()

	instance.OperationMutex.Lock()
	defer instance.OperationMutex.Unlock()

	// If the instance has been destroyed in the meantime, ignore deploy command
	if ctx.Err() != nil || instance.IsDestroyed {
		return nil
	}

	log.Info(
		"[Runtime] Starting deployment of lab",
		"name", lab.Name,
		"id", lab.UUID,
		"instance", lab.InstanceName,
	)

	var err error

	if instanceRunning {
		instance.DataMutex.Lock()
		for _, node := range instance.Nodes {
			node.Reset()
		}
		instance.DataMutex.Unlock()

		s.updateLabAndSendUpdate(
			lab, instance, InstanceStates.Deploying,
			statusmessage.Info("Runtime",
				fmt.Sprintf("Redeploying lab '%s'", lab.Name),
				"Starting redeployment of lab", "name", lab.Name, "id", lab.UUID,
			),
			instance.LogNamespace,
		)

		// Redeploy instead of deploy if instance already existed
		err = s.deploymentProvider.Redeploy(ctx, instance.TopologyFile, lab.InstanceName, func(data string) {
			instance.LogNamespace.Send(data)
		})
	} else {
		s.updateLabAndSendUpdate(
			lab, instance, InstanceStates.Deploying,
			statusmessage.Info("Runtime",
				fmt.Sprintf("Deploying lab '%s'", lab.Name),
				"Starting deployment of lab", "name", lab.Name, "id", lab.UUID,
			),
			instance.LogNamespace,
		)

		err = s.deploymentProvider.Deploy(ctx, instance.TopologyFile, lab.InstanceName, func(data string) {
			instance.LogNamespace.Send(data)
		})
	}

	if err != nil {
		// Ignore the error if the context was canceled and the deployment was aborted
		if ctx.Err() != nil {
			return nil
		}

		log.Warn(
			"[Runtime] Deployment of lab failed",
			"name", lab.Name,
			"id", lab.UUID,
			"instance", lab.InstanceName,
			"err", err.Error(),
		)

		s.updateLabAndSendUpdate(
			lab, instance, InstanceStates.Failed,
			statusmessage.Error("Runtime",
				fmt.Sprintf("Failed to deploy lab '%s': %s", lab.Name, err.Error()),
				"Deployment of lab failed", "name", lab.Name, "id", lab.UUID, "err", err.Error(),
			),
			instance.LogNamespace,
		)

		s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, true)
		return utils.ErrProvider
	}

	// Fetch and attach lab inspect info and change state to running if successful
	instanceNodes, err := s.inspectLab(instance, lab.InstanceName, func(data string) {
		instance.LogNamespace.Send(data)
	})

	if err != nil {
		// Ignore the error if the context was canceled and the deployment was aborted
		if ctx.Err() != nil {
			return nil
		}

		instance.DataMutex.Lock()
		instance.Nodes = make([]*InstanceNode, 0)
		instance.DataMutex.Unlock()

		log.Warn(
			"[Runtime] Inspection of lab failed",
			"name", lab.Name,
			"id", lab.UUID,
			"instance", lab.InstanceName,
			"err", err.Error(),
		)

		s.updateLabAndSendUpdate(lab, instance, InstanceStates.Failed,
			statusmessage.Warning("Runtime",
				fmt.Sprintf("Failed to inspect lab '%s': %s", lab.Name, err.Error()),
				"Inspection of lab failed", "name", lab.Name, "id", lab.UUID, "err", err.Error(),
			),
			instance.LogNamespace,
		)

		s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, true)
		return utils.ErrProvider
	}

	instance.DataMutex.Lock()
	instance.Nodes = instanceNodes
	instance.Recovered = false
	instance.Deployed = time.Now()
	instance.DataMutex.Unlock()

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

		err = s.deploymentProvider.StreamContainerLogs(
			ctx,
			lab.InstanceName,
			node.Name,
			func(data string) {
				containerLogNamespace.Send(data)
			},
		)

		if err != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				return nil
			}

			log.Warn(
				"[Runtime] Fetching of container logs failed",
				"name", lab.Name,
				"id", lab.UUID,
				"instance", lab.InstanceName,
				"container", node.ContainerId,
				"err", err.Error(),
			)
		}

		go s.startNodeStartupListener(node, instance, lab)
	}

	log.Info(
		"[Runtime] Deployment of lab was successful",
		"name", lab.Name,
		"id", lab.UUID,
		"instance", lab.InstanceName,
	)

	s.updateLabAndSendUpdate(lab, instance, InstanceStates.Running,
		statusmessage.Success(
			"Runtime", fmt.Sprintf("Successfully deployed lab '%s'", lab.Name),
			"Deployment of lab was successful", "name", lab.Name, "id", lab.UUID,
		),
		instance.LogNamespace,
	)

	s.topologyService.SetLastDeployFailed(context.Background(), &lab.Topology, false)

	return nil
}

func (s *Service) registerProviderEventListener() {
	ctx := context.Background()

	_ = s.deploymentProvider.RegisterListener(ctx, func(nodeName string) {
		var targetLabId string
		var targetInstance *Instance
		var targetNode *InstanceNode

		s.instancesMutex.Lock()
		instances := maps.Clone(s.instances)
		s.instancesMutex.Unlock()

		for labId, instance := range instances {
			instance.DataMutex.Lock()

			node, hasMatched := lo.Find(instance.Nodes, func(item *InstanceNode) bool {
				return item.Name == nodeName
			})

			if hasMatched {
				targetLabId = labId
				targetInstance = instance
				targetNode = node

				instance.DataMutex.Unlock()
				break
			}

			instance.DataMutex.Unlock()
		}

		if targetLabId != "" {
			hasChanged, err := s.fetchNode(
				targetInstance,
				targetInstance.Name,
				targetNode,
				true,
			)

			if err != nil {
				log.Warn(
					"Failed to update instance node",
					"lab", targetLabId,
					"node", targetNode.Name,
					"err", err.Error(),
				)
			} else if hasChanged {
				s.updatesNamespace.Send(instanceUpdate{
					LabId: &targetLabId,
				})
			}
		}
	})
}

func (s *Service) startNodeStartupListener(
	node *InstanceNode,
	instance *Instance,
	lab *lab.Lab,
) {
	deploymentContext := instance.deploymentContext()
	ctxTimeout, cancel := context.WithTimeout(deploymentContext, 10*time.Minute)
	defer cancel()

	log.Debug(
		"[Startup] Starting startup launcher for node",
		"lab", lab.UUID,
		"node", node.Name,
	)

	err := s.waitForNodeStarted(ctxTimeout, lab.InstanceName, node.Name)
	if err != nil {
		// Ignore the error if the context was canceled and the deployment was aborted
		if errors.Is(deploymentContext.Err(), context.Canceled) {
			return
		}

		instance.DataMutex.Lock()
		node.State = deployment.NodeStates.Stopped
		instance.DataMutex.Unlock()

		log.Error(
			"Node did not start.",
			"err", err.Error(),
			"lab", lab.UUID,
			"node", node.Name,
		)

		s.updatesNamespace.Send(instanceUpdate{
			LabId: &lab.UUID,
		})

		return
	}

	log.Debug("[Startup] Node has started", "lab", lab.UUID, "node", node.Name)

	s.onNodeStarted(instance, node, lab)
}

// sshProbe asks the node's own SSH server for a connection. BatchMode makes a
// reachable-but-unauthenticated server fail fast with "Permission denied"
// instead of prompting, so we can tell "server up" from "nothing listening".
var sshProbe = []string{
	"ssh",
	"-o", "BatchMode=yes",
	"-o", "StrictHostKeyChecking=no",
	"-o", "ConnectTimeout=5",
	"admin@localhost", "true",
}

// waitForNodeStarted blocks until the node's SSH server accepts connections,
// or until it's clear the node has no SSH server to wait for. It returns
// ctx.Err() if the context expires first.
func (s *Service) waitForNodeStarted(
	ctx context.Context,
	instanceName string,
	nodeName string,
) error {
	for {
		out, code, err := s.deploymentProvider.Exec(ctx, instanceName, nodeName, sshProbe)

		switch {
		case errors.Is(err, utils.ErrNodeNotRunning):
			// Container not running yet: retry.
		case err != nil:
			return err
		case code == 0:
			// SSH accepted the connection.
			return nil
		case code == 126 || code == 127:
			// No ssh client in the node, so there is no server to wait for.
			return nil
		case code == 255 && sshServerResponded(out):
			// A server answered and rejected our credentials: it's up.
			return nil
		case code == 255:
			// Nothing listening yet: retry.
		default:
			return fmt.Errorf("unexpected exit %d from ssh probe: %s", code, strings.TrimSpace(out))
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// sshServerResponded reports whether ssh's output came from a live server (auth or host-key stage) rather than from
// failing to connect at all.
func sshServerResponded(out string) bool {
	for _, marker := range []string{
		"Permission denied",
		"Host key verification",
		"Too many authentication failures",
	} {
		if strings.Contains(out, marker) {
			return true
		}
	}
	return false
}

func (s *Service) onNodeStarted(
	instance *Instance,
	node *InstanceNode,
	lab *lab.Lab,
) {
	deploymentContext := instance.deploymentContext()

	interfaces, err := s.deploymentProvider.GetNetworkInterfaces(deploymentContext, lab.InstanceName, node.Name)

	interfaces = lo.Filter(interfaces, func(i deployment.NodeInterface, _ int) bool {
		for _, p := range s.config.Capture.ExcludedInterfaces {
			if ok, _ := path.Match(p, i.Name); ok {
				return false
			}
		}
		return true
	})

	instance.DataMutex.Lock()

	// Ignore the error if the context was canceled and the deployment was aborted
	if deploymentContext.Err() != nil {
		instance.DataMutex.Unlock()
		return
	}

	if err != nil {
		log.Warn(
			"Failed to get interfaces for node",
			"lab", lab.UUID,
			"container", node.ContainerId,
			"err", err.Error(),
		)

		interfaces = make([]deployment.NodeInterface, 0)
	}

	node.SetReady(interfaces)

	instance.DataMutex.Unlock()

	s.monitor.AddNode(deploymentContext, lab.InstanceName, node.Name, node.ContainerId)

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &lab.UUID,
	})
}

func (s *Service) createInstance(
	name string,
	logNamespace *socket.OutputNamespace[string],
	runTopologyFile string,
	runTopologyDefinition string,
) (*Instance, error) {
	runTopologyDefintionParsed, err := s.schemaService.Parse(runTopologyDefinition)
	if err != nil {
		log.Error(
			"[NECRO] Failed to parse topology definition for newly created instance",
			"instance", name,
			"err", err.Error(),
		)
		return nil, utils.ErrAntimony
	}

	return &Instance{
		Name:              name,
		Deployed:          time.Now(),
		LatestStateChange: time.Now(),
		State:             InstanceStates.Deploying,
		Recovered:         false,
		OperationMutex:    sync.Mutex{},
		DataMutex:         sync.Mutex{},
		DeploymentCancel:  nil,
		DeploymentMutex:   sync.Mutex{},
		LogNamespace:      logNamespace,
		TopologyFile:      runTopologyFile,
		NodeLabels:        s.extractNodeLabels(*runTopologyDefintionParsed),
		NodeKinds:         s.extractNodeKinds(*runTopologyDefintionParsed),
		IsDestroyed:       false,
	}, nil
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

func (s *Service) fetchNode(
	instance *Instance,
	instanceName string,
	node *InstanceNode,
	sendLogs bool,
) (bool, error) {
	var onLog func(string)

	if sendLogs && instance.LogNamespace != nil {
		onLog = func(data string) {
			instance.LogNamespace.Send(data)
		}
	}

	nodeContainer, err := s.deploymentProvider.InspectNode(
		instance.deploymentContext(),
		instance.TopologyFile,
		instanceName,
		node.Name,
		onLog,
	)
	if err != nil {
		log.Warn(
			"Tried to update a node that was not found in inspect output",
			"instance", instanceName,
			"node", node.Name,
		)
		return false, nil
	}

	updatedNode := s.containerToInstanceNode(nodeContainer, instance.NodeKinds)

	instance.DataMutex.Lock()

	// If the state hasn't changed, there is no need to update anything
	if node.State == updatedNode.State {
		instance.DataMutex.Unlock()
		return false, nil
	}

	//if node.State != deployment.NodeStates.Running {
	//	node.IsReady = false
	//	node.Interfaces = make([]deployment.NodeInterface, 0)
	//}

	node.Set(updatedNode.State, updatedNode.IPv4, updatedNode.IPv6, updatedNode.ContainerId, updatedNode.ContainerName)

	instance.DataMutex.Unlock()

	return true, nil
}

func (s *Service) inspectLab(
	instance *Instance,
	instanceName string,
	onLog func(data string),
) ([]*InstanceNode, error) {
	deploymentContext := instance.deploymentContext()

	labContainers, err := s.deploymentProvider.InspectLab(deploymentContext, instance.TopologyFile, instanceName, onLog)
	if err != nil {
		return nil, err
	}

	return lo.Map(labContainers, func(container deployment.InspectContainer, _ int) *InstanceNode {
		return s.containerToInstanceNode(container, instance.NodeKinds)
	}), nil
}

func (s *Service) containerToInstanceNode(
	container deployment.InspectContainer,
	nodeKinds map[string]string,
) *InstanceNode {
	canRestart := false

	nodeKind, kindFound := nodeKinds[container.Name]

	if kindFound {
		if kindConfig, ok := s.nodeKindConfigs[nodeKind]; ok {
			if kindConfig.CanRestart != nil && *kindConfig.CanRestart {
				canRestart = true
			}
		}
	} else {
		log.Warn("Failed to get kind of running node", "containerId", container.ContainerId)
	}

	// For consistency, we clear the IP, container ID and container name fields when the container is stopped,
	// even though the deployment provider might supply them.
	if container.State == deployment.NodeStates.Stopped {
		container.ContainerId = ""
		container.ContainerName = ""
		container.IPv4Address = ""
		container.IPv6Address = ""
	}

	return &InstanceNode{
		Name:          container.Name,
		Kind:          nodeKind,
		IPv4:          container.IPv4Address,
		IPv6:          container.IPv6Address,
		State:         container.State,
		IsReady:       false,
		ContainerId:   container.ContainerId,
		ContainerName: container.ContainerName,
		Interfaces:    make([]deployment.NodeInterface, 0),
		CanRestart:    canRestart,
	}
}

// updateLabAndSendUpdate Updates the state of a lab and sends various notification updates.
// If the status message is set, all users will receive the status message.
// If the serverlog namespace is set, the serverlog content of the status message is also sent to the provided namespace.
func (s *Service) updateLabAndSendUpdate(
	lab *lab.Lab,
	instance *Instance,
	state InstanceState,
	statusMessage *statusmessage.Message,
	logNamespace *socket.OutputNamespace[string],
) {
	instance.DataMutex.Lock()
	instance.State = state
	instance.LatestStateChange = time.Now()
	instance.DataMutex.Unlock()

	s.sendLabUpdate(lab, statusMessage, logNamespace)
}

func (s *Service) sendLabUpdate(
	lab *lab.Lab,
	statusMessage *statusmessage.Message,
	logNamespace *socket.OutputNamespace[string],
) {
	s.updatesNamespace.Send(instanceUpdate{
		LabId: &lab.UUID,
	})

	if statusMessage != nil {
		s.statusMessageNamespace.Send(*statusMessage)
		if logNamespace != nil {
			logNamespace.Send(statusMessage.LogContent)
		}
	}
}

// reviveInstances runs whenever the application is started and attempts to restore instances from running containers
// and database entries.
func (s *Service) reviveInstances() {
	ctx := context.Background()

	savedLabs, err := s.labRepo.GetAll(ctx, nil)
	if err != nil {
		log.Fatal("[RUntime] Failed to load labs from database. Exiting.", "err", err.Error())
		return
	}

	result, err := s.deploymentProvider.InspectLabs(ctx, nil)
	if err != nil {
		log.Fatal("[Runtime] Failed to retrieve containers from clab inspect. Exiting.", "err", err.Error())
		return
	}

	restoredLabs := 0

	for _, savedLab := range savedLabs {
		containers, isCurrentlyDeployed := result[savedLab.InstanceName]

		if !isCurrentlyDeployed {
			// If the lab's start time is in the future, notify the scheduler to schedule the lab
			if savedLab.StartTime.Unix() >= time.Now().Unix() {
				s.labEventBus.Publish("lab.created", &savedLab)
				restoredLabs++
			}
			continue
		}

		var topologyDefinition string
		var topologyDefinitionParsed *any

		if err = s.storageManager.ReadTopology(savedLab.Topology.UUID, &topologyDefinition); err != nil {
			log.Error(
				"[NECRO] Failed to read topology for revived lab. Skipping",
				"lab", savedLab.UUID,
				"err", err.Error(),
			)
			continue
		}

		topologyDefinitionParsed, err = s.schemaService.Parse(topologyDefinition)
		if err != nil {
			log.Error(
				"[NECRO] Failed to parse topology definition for revived lab. Skipping",
				"lab", savedLab.UUID,
				"err", err.Error(),
			)
			continue
		}

		nodeLabels := s.extractNodeLabels(*topologyDefinitionParsed)
		nodeKinds := s.extractNodeKinds(*topologyDefinitionParsed)

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
			if container.State == deployment.NodeStates.Stopped {
				continue
			}

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
				ctx,
				savedLab.InstanceName,
				container.Name,
				func(data string) {
					containerLogNamespace.Send(data)
				},
			)

			if err != nil {
				log.Error(
					"[NECRO] Failed to setup container log stream for container",
					"container", container.ContainerId,
					"err", err.Error(),
				)
			}
		}

		instanceNodes := lo.Map(containers, func(container deployment.InspectContainer, _ int) *InstanceNode {
			return s.containerToInstanceNode(container, nodeKinds)
		})

		ctx, cancel := context.WithCancel(context.Background())

		instance := &Instance{
			Name:              savedLab.InstanceName,
			State:             InstanceStates.Running,
			Nodes:             instanceNodes,
			Deployed:          time.Now(),
			LatestStateChange: time.Now(),
			Recovered:         true,
			TopologyFile:      s.storageManager.GetRunTopologyFile(savedLab.UUID),
			LogNamespace:      logNamespace,
			NodeLabels:        nodeLabels,
			NodeKinds:         nodeKinds,
			DeploymentCtx:     ctx,
			DeploymentCancel:  cancel,
			DeploymentMutex:   sync.Mutex{},
			IsDestroyed:       false,
		}

		for i := range instanceNodes {
			// Attach a starup listener to the node if it's currently running or starting
			if instanceNodes[i].State == deployment.NodeStates.Running ||
				instanceNodes[i].State == deployment.NodeStates.Starting {
				go s.startNodeStartupListener(instanceNodes[i], instance, &savedLab)
			}
		}

		s.instancesMutex.Lock()
		s.instances[savedLab.UUID] = instance
		s.instancesMutex.Unlock()

		s.labEventBus.Publish("lab.restored", &savedLab)
		restoredLabs++
	}

	log.Infof("[Runtime] Successfully restored %d labs", restoredLabs)
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

// GetInstanceNode returns a copy of the instance node with the given name and lab ID.
func (s *Service) GetInstanceNode(
	ctx context.Context,
	labId string,
	nodeName string,
	authUser *auth.AuthenticatedUser,
) (InstanceNode, error) {
	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return InstanceNode{}, err
	}

	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, instanceLab.Topology.Collection.Name) {
		return InstanceNode{}, utils.ErrNoAccessToLab
	}

	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[instanceLab.UUID]
	s.instancesMutex.Unlock()

	if !hasInstance {
		return InstanceNode{}, utils.ErrLabNotRunning
	}

	instance.DataMutex.Lock()
	defer instance.DataMutex.Unlock()

	node, hasNode := lo.Find(instance.Nodes, func(node *InstanceNode) bool {
		return node.Name == nodeName
	})
	if !hasNode {
		return InstanceNode{}, utils.ErrNodeNotFound
	}

	nodeCopy := *node
	nodeCopy.Interfaces = slices.Clone(node.Interfaces)

	return nodeCopy, nil
}

func (s *Service) IsRunning(labId string) bool {
	s.instancesMutex.Lock()
	defer s.instancesMutex.Unlock()

	_, hasInstance := s.instances[labId]

	return hasInstance
}

func (s *Service) CanDelete(labId string) bool {
	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[labId]
	s.instancesMutex.Unlock()

	if !hasInstance {
		return true
	}

	instance.DataMutex.Lock()
	defer instance.DataMutex.Unlock()

	return instance.State == InstanceStates.Failed
}

func getInstanceNode(instance *Instance, nodeName string) *InstanceNode {
	for _, node := range instance.Nodes {
		if node.Name == nodeName {
			return node
		}
	}

	return nil
}

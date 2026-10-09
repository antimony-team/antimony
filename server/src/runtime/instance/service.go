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

	// ctx governs the lifetime of the service's background workers. It is canceled by Close.
	ctx       context.Context
	cancel    context.CancelFunc
	closeOnce sync.Once
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

	ctx, cancel := context.WithCancel(context.Background())

	service := &Service{
		config:                 config,
		labRepo:                labRepo,
		schemaService:          schemaService,
		topologyService:        topologyService,
		monitor:                monitor,
		nodeKindConfigs:        getNodeKindConfigs(config.Containerlab.KindsConfig),
		instances:              make(map[string]*Instance),
		instancesMutex:         sync.Mutex{},
		storageManager:         storageManager,
		labEventBus:            labEventBus,
		deploymentProvider:     deploymentProvider,
		socketManager:          socketManager,
		statusMessageNamespace: statusMessageNamespace,
		ctx:                    ctx,
		cancel:                 cancel,
		closeOnce:              sync.Once{},
	}

	service.updatesNamespace = socket.CreateOutputNamespace[instanceUpdate](
		socketManager, false, nil, false, nil, "lab-updates",
	)

	go service.registerProviderEventListener(ctx)

	go service.monitor.Run(ctx)

	return service
}

// Revive restores instances from the labs in the database and the containers the deployment provider reports and must
// be called once during startup.
func (s *Service) Revive() {
	s.reviveInstances()

	s.updatesNamespace.Send(instanceUpdate{
		LabId: nil,
	})
}

// Close stops the service's background workers, cancels any in-flight deployments, and releases the socket namespaces
// owned by the service and its instances. It is safe to call more than once.
func (s *Service) Close() {
	s.closeOnce.Do(func() {
		s.cancel()
		s.monitor.Close()

		s.instancesMutex.Lock()
		for labId, instance := range s.instances {
			instance.DeploymentMutex.Lock()
			if instance.DeploymentCancel != nil {
				instance.DeploymentCancel()
			}
			instance.DeploymentMutex.Unlock()

			if instance.LogNamespace != nil {
				instance.LogNamespace.Release()
			}

			delete(s.instances, labId)
		}
		s.instancesMutex.Unlock()

		s.updatesNamespace.Release()
	})
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

func (s *Service) DeployLabCommand(ctx context.Context, labId *string, authUser *auth.AuthenticatedUser) error {
	instanceLab, err := s.validateLabCommand(ctx, labId, authUser)
	if err != nil {
		return err
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

	return s.DeployLab(instanceLab)
}

func (s *Service) DestroyLabCommand(ctx context.Context, labId *string, authUser *auth.AuthenticatedUser) error {
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

	s.fetchNode(instance, instanceLab.InstanceName, node, true)

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})

	go s.startNodeStartupListener(labId, instance, node, true)

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

	s.fetchNode(instance, instanceLab.InstanceName, node, true)

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

	s.fetchNode(instance, instanceLab.InstanceName, node, true)

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})

	go s.startNodeStartupListener(labId, instance, node, true)

	return nil
}

func (s *Service) validateLabCommand(
	ctx context.Context,
	labId *string,
	authUser *auth.AuthenticatedUser,
) (*lab.Lab, error) {
	if labId == nil {
		return nil, fmt.Errorf("%w: no lab specified", utils.ErrLabNotFound)
	}

	instanceLab, err := s.labRepo.GetByUuid(ctx, *labId)
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

	log.Info(
		"[Runtime] Starting destruction of lab",
		"name",
		lab.Name, "id", lab.UUID,
		"instance", lab.InstanceName,
	)

	// Manually set node states to exited to mark the nodes no longer running
	instance.DataMutex.Lock()
	for k := range instance.Nodes {
		instance.Nodes[k].State = deployment.NodeStates.Stopped
		instance.Nodes[k].Interfaces = make([]deployment.NodeInterface, 0)
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

	err := s.deploymentProvider.Destroy(s.ctx, instance.TopologyFile, lab.InstanceName, func(data string) {
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
	for k := range instance.Nodes {
		instance.Nodes[k].LogNamespace.Release()
	}

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
		topologyFile, err := s.storageManager.GetRunEnvironment(lab.UUID, &runTopologyDefinition)

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

		instance, err = s.createInstance(
			lab.InstanceName,
			logNamespace,
			*topologyFile,
			runTopologyDefinition,
			lab.UUID,
		)

		if err != nil {
			s.instancesMutex.Unlock()
			return err
		}

		// Set all node state to starting immediately
		for i := range instance.Nodes {
			instance.Nodes[i].State = deployment.NodeStates.Starting
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
		for k := range instance.Nodes {
			instance.Nodes[k].Reset()
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

	// Fetch and attach lab inspect info to nodes
	err = s.inspectLabAndUpdateNodes(instance, lab.InstanceName, func(data string) {
		instance.LogNamespace.Send(data)
	})

	if err != nil {
		// Ignore the error if the context was canceled and the deployment was aborted
		if ctx.Err() != nil {
			return nil
		}

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
	instance.Recovered = false
	instance.Deployed = time.Now()
	instance.DataMutex.Unlock()

	for k := range instance.Nodes {
		if instance.Nodes[k].State == deployment.NodeStates.Stopped {
			continue
		}

		err = s.deploymentProvider.StreamContainerLogs(
			ctx,
			instance.Name,
			instance.Nodes[k].Name,
			instance.Nodes[k].LogNamespace.Send,
		)

		if err != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				return nil
			}

			log.Warn(
				"[Runtime] Starting of node log streaming has failed",
				"name", instance.Name,
				"id", lab.UUID,
				"instance", instance.Name,
				"nodeName", instance.Nodes[k].Name,
				"err", err.Error(),
			)
		}

		go s.startNodeStartupListener(lab.UUID, instance, instance.Nodes[k], false)
	}

	log.Info(
		"[Runtime] Deployment of lab was successful",
		"name", lab.Name,
		"id", lab.UUID,
		"instance", instance.Name,
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

func (s *Service) registerProviderEventListener(ctx context.Context) {
	_ = s.deploymentProvider.RegisterListener(ctx, func(nodeName string) {
		var targetLabId string
		var targetInstance *Instance
		var targetNode *InstanceNode

		s.instancesMutex.Lock()
		instances := maps.Clone(s.instances)
		s.instancesMutex.Unlock()

		for labId, instance := range instances {
			instance.DataMutex.Lock()

			if node, ok := instance.Nodes[nodeName]; ok {
				targetLabId = labId
				targetInstance = instance
				targetNode = node

				instance.DataMutex.Unlock()
				break
			}

			instance.DataMutex.Unlock()
		}

		if targetLabId != "" {
			if s.fetchNode(targetInstance, targetInstance.Name, targetNode, false) {
				s.updatesNamespace.Send(instanceUpdate{
					LabId: &targetLabId,
				})
			}
		}
	})
}

func (s *Service) startNodeStartupListener(
	labId string,
	instance *Instance,
	node *InstanceNode,
	startStreamingLogs bool,
) {
	deploymentContext := instance.deploymentContext()
	ctxTimeout, cancel := context.WithTimeout(deploymentContext, 10*time.Minute)
	defer cancel()

	log.Debug(
		"[Startup] Starting startup launcher for node",
		"lab", labId,
		"node", node.Name,
	)

	err := s.waitForNodeStarted(ctxTimeout, instance.Name, node.Name)

	if startStreamingLogs {
		err := s.deploymentProvider.StreamContainerLogs(
			deploymentContext,
			instance.Name,
			node.Name,
			node.LogNamespace.Send,
		)

		if err != nil {
			if errors.Is(deploymentContext.Err(), context.Canceled) {
				return
			}

			log.Warn(
				"[Runtime] Starting of node log streaming has failed",
				"name", instance.Name,
				"id", labId,
				"instance", instance.Name,
				"nodeName", node.Name,
				"err", err.Error(),
			)
		}
	}

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
			"lab", labId,
			"node", node.Name,
		)

		s.updatesNamespace.Send(instanceUpdate{
			LabId: &labId,
		})

		return
	}

	log.Debug("[Startup] Node has started", "lab", labId, "node", node.Name)

	s.onNodeStarted(labId, instance, node)
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
	labId string,
	instance *Instance,
	node *InstanceNode,
) {
	deploymentContext := instance.deploymentContext()

	interfaces, err := s.deploymentProvider.GetNetworkInterfaces(deploymentContext, instance.Name, node.Name)

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
			"lab", labId,
			"container", node.ContainerId,
			"err", err.Error(),
		)

		interfaces = make([]deployment.NodeInterface, 0)
	}

	node.SetReady(interfaces)

	containerId := node.ContainerId

	instance.DataMutex.Unlock()

	s.monitor.AddNode(deploymentContext, instance.Name, node.Name, containerId)

	s.updatesNamespace.Send(instanceUpdate{
		LabId: &labId,
	})
}

func (s *Service) createInstance(
	name string,
	logNamespace *socket.OutputNamespace[string],
	runTopologyFile string,
	runTopologyDefinition string,
	labId string,
) (*Instance, error) {
	runTopologyDefintionParsed, err := s.schemaService.Parse(runTopologyDefinition)
	if err != nil {
		log.Error(
			"Failed to parse topology definition for newly created instance",
			"instance", name,
			"err", err.Error(),
		)
		return nil, utils.ErrAntimony
	}

	nodes, err := s.createNodesFromTopology(*runTopologyDefintionParsed, labId)
	if err != nil {
		log.Error(
			"Failed to get nodes from topology definition for newly created instance",
			"lab", labId,
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
		Nodes:             nodes,
		IsDestroyed:       false,
	}, nil
}

func (s *Service) createNodesFromTopology(topologyDefinition any, labId string) (map[string]*InstanceNode, error) {
	topologyMap, ok := topologyDefinition.(map[string]any)
	if !ok {
		return nil, errors.New("topology definition is not a map")
	}

	top, ok := topologyMap["topology"].(map[string]any)
	if !ok {
		return nil, errors.New("topology definition has no topology section")
	}

	nodes, ok := top["nodes"].(map[string]any)
	if !ok {
		return nil, errors.New("topology definition has no nodes")
	}

	defaultKind := ""
	if defaults, ok := top["defaults"].(map[string]any); ok {
		defaultKind, _ = defaults["kind"].(string)
	}

	result := make(map[string]*InstanceNode)
	for nodeName, nodeVal := range nodes {
		kind := defaultKind
		if node, ok := nodeVal.(map[string]any); ok {
			if nodeKind, ok := node["kind"].(string); ok {
				kind = nodeKind
			}
		}

		nodeLogNamespace := socket.CreateOutputNamespace[string](
			s.socketManager,
			false,
			&socket.BacklogConfig{
				Capacity: s.config.Streaming.ContainerLogBacklog,
				Kind:     utils.RingKindValue,
			},
			true,
			nil,
			"logs",
			labId,
			nodeName,
		)

		canRestart := false
		if kindConfig, ok := s.nodeKindConfigs[kind]; ok {
			canRestart = kindConfig.CanRestart != nil && *kindConfig.CanRestart
		}

		result[nodeName] = &InstanceNode{
			Name:         nodeName,
			Kind:         kind,
			CanRestart:   canRestart,
			State:        deployment.NodeStates.Stopped,
			Interfaces:   make([]deployment.NodeInterface, 0),
			LogNamespace: nodeLogNamespace,
		}
	}

	return result, nil
}

// fetchNode re-inspects a single node and applies any state change to it.
//
// It reports whether the node's state actually changed. A node that is missing from the inspect
// output is not an error: the provider may simply not have created its container yet, so it is
// logged and treated as unchanged.
func (s *Service) fetchNode(
	instance *Instance,
	instanceName string,
	node *InstanceNode,
	sendLogs bool,
) bool {
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

		return false
	}

	instance.DataMutex.Lock()

	// If the state hasn't changed, there is no need to update anything
	if node.State == nodeContainer.State {
		instance.DataMutex.Unlock()

		return false
	}

	s.updateNodeWithContainer(node, nodeContainer)

	instance.DataMutex.Unlock()

	return true
}

func (s *Service) inspectLabAndUpdateNodes(
	instance *Instance,
	instanceName string,
	onLog func(data string),
) error {
	inspectContainers, err := s.deploymentProvider.InspectLab(
		instance.deploymentContext(),
		instance.TopologyFile,
		instanceName,
		onLog,
	)

	instance.DataMutex.Lock()
	defer instance.DataMutex.Unlock()

	for k := range instance.Nodes {
		// If the inspect failed, just set all nodes to the stopped state
		if err != nil {
			instance.Nodes[k].State = deployment.NodeStates.Stopped
			continue
		}

		targetContainer, ok := lo.Find(inspectContainers, func(container deployment.InspectContainer) bool {
			return container.Name == instance.Nodes[k].Name
		})
		if !ok {
			instance.Nodes[k].State = deployment.NodeStates.Stopped
			log.Warn("Failed to find node in inspect output", "node", instance.Nodes[k].Name, "lab", instanceName)
			continue
		}

		instance.Nodes[k].Reset()
		s.updateNodeWithContainer(instance.Nodes[k], targetContainer)
	}

	return err
}

// updateNodeWithContainer updates a node with the information from a container inspect.
// It is expected that the [instance.DataMutex] of the node is locked during the call of this function.
func (s *Service) updateNodeWithContainer(
	node *InstanceNode,
	container deployment.InspectContainer,
) {
	node.State = container.State

	// For consistency, we clear the IP, container ID and container name fields when the node is stopped, even though
	// the deployment provider might supply them.
	if container.State == deployment.NodeStates.Stopped {
		node.ContainerId = ""
		node.ContainerName = ""
		node.IPv4 = ""
		node.IPv6 = ""
	} else {
		node.ContainerId = container.ContainerId
		node.ContainerName = container.ContainerName
		node.IPv4 = container.IPv4Address
		node.IPv6 = container.IPv6Address
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
		log.Fatal("[Runtime] Failed to load labs from database. Exiting.", "err", err.Error())
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

		if err = s.storageManager.ReadRunTopologyDefinition(savedLab.UUID, &topologyDefinition); err != nil {
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

		nodes, err := s.createNodesFromTopology(*topologyDefinitionParsed, savedLab.UUID)
		if err != nil {
			log.Error(
				"Failed to get nodes from topology definition for newly created instance",
				"lab", savedLab.UUID,
				"instance", savedLab.InstanceName,
				"err", err.Error(),
			)
			continue
		}

		deploymentCtx, deploymentCancel := context.WithCancel(context.Background())

		for i := range nodes {
			nodeContainer, ok := lo.Find(containers, func(container deployment.InspectContainer) bool {
				return container.Name == nodes[i].Name
			})
			if !ok {
				log.Warn("Failed to find node in inspect output", "node", nodes[i].Name, "lab", savedLab.InstanceName)
				continue
			}

			// Attach runtime information to nodes
			nodes[i].Reset()
			s.updateNodeWithContainer(nodes[i], nodeContainer)

			if nodes[i].State != deployment.NodeStates.Stopped {
				err := s.deploymentProvider.StreamContainerLogs(
					deploymentCtx,
					savedLab.InstanceName,
					nodes[i].Name,
					nodes[i].LogNamespace.Send,
				)

				if err != nil {
					log.Error(
						"[NECRO] Failed to setup container log stream for container",
						"lab", savedLab.UUID,
						"node", nodes[i].Name,
						"containerId", nodes[i].ContainerId,
						"err", err.Error(),
					)
				}
			}
		}

		instance := &Instance{
			Name:              savedLab.InstanceName,
			State:             InstanceStates.Running,
			Nodes:             nodes,
			Deployed:          time.Now(),
			LatestStateChange: time.Now(),
			Recovered:         true,
			TopologyFile:      s.storageManager.GetRunTopologyDefinitionFile(savedLab.UUID),
			LogNamespace:      logNamespace,
			DeploymentCtx:     deploymentCtx,
			DeploymentCancel:  deploymentCancel,
			DeploymentMutex:   sync.Mutex{},
			IsDestroyed:       false,
		}

		// Attach startup listeners to nodes that are currently running or starting
		for i := range nodes {
			if nodes[i].State == deployment.NodeStates.Running ||
				nodes[i].State == deployment.NodeStates.Starting {
				go s.startNodeStartupListener(savedLab.UUID, instance, nodes[i], false)
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

// GetInstanceNode returns a copy of the instance node with a given combination of identifiers.
//
// Possible identifiers:
//   - containerId
//   - labId + nodeName
//   - instanceName + nodeName
//   - collectionName + labName + nodeName
//
// Optinally, an [auth.AuthenticatedUser] can be provided to only allow access if the user has access to the lab.
func (s *Service) GetInstanceNode(
	ctx context.Context,
	labId *string,
	instanceName *string,
	collectionName *string,
	labName *string,
	nodeName *string,
	containerId *string,
	authUser *auth.AuthenticatedUser,
) (InstanceNode, string, error) {
	var targetLab *lab.Lab
	var labError error

	var targetInstance *Instance
	var targetNodeName string

	switch {
	case containerId != nil:
		s.instancesMutex.Lock()
		instancesCopy := maps.Clone(s.instances)
		s.instancesMutex.Unlock()

		for k := range instancesCopy {
			instancesCopy[k].DataMutex.Lock()
			nodeName, ok := lo.FindKeyBy(instancesCopy[k].Nodes, func(k string, n *InstanceNode) bool {
				return n.ContainerId == *containerId
			})
			instancesCopy[k].DataMutex.Unlock()

			if ok {
				if targetLab, labError = s.labRepo.GetByUuid(ctx, k); labError == nil {
					targetInstance, targetNodeName = instancesCopy[k], nodeName
				}
				break
			}
		}

		// If the target instance was not found but the lab was, the node is missing
		if targetInstance == nil && labError == nil {
			return InstanceNode{}, "", utils.ErrNodeNotFound
		}
	case labId != nil && nodeName != nil:
		if targetLab, labError = s.labRepo.GetByUuid(ctx, *labId); labError == nil {
			s.instancesMutex.Lock()
			targetInstance, targetNodeName = s.instances[targetLab.UUID], *nodeName
			s.instancesMutex.Unlock()
		}
	case instanceName != nil && nodeName != nil:
		s.instancesMutex.Lock()
		instancesCopy := maps.Clone(s.instances)
		s.instancesMutex.Unlock()

		labId, ok := lo.FindKeyBy(instancesCopy, func(k string, i *Instance) bool {
			return i.Name == *instanceName
		})

		if ok {
			if targetLab, labError = s.labRepo.GetByUuid(ctx, labId); labError == nil {
				instancesCopy[labId].DataMutex.Lock()
				targetInstance, targetNodeName = instancesCopy[labId], *nodeName
				instancesCopy[labId].DataMutex.Unlock()
			}
		}
	case collectionName != nil && labName != nil && nodeName != nil:
		if targetLab, labError = s.labRepo.GetByCollectionAndName(ctx, *collectionName, *labName); labError == nil {
			s.instancesMutex.Lock()
			targetInstance, targetNodeName = s.instances[targetLab.UUID], *nodeName
			s.instancesMutex.Unlock()
		}
	default:
		return InstanceNode{}, "", utils.ErrInvalidSocketRequest
	}

	if labError != nil {
		return InstanceNode{}, "", fmt.Errorf("%w: %s", utils.ErrNodeNotFound, labError.Error())
	}

	// Deny action if the user doesn't have access to the node's lab
	if targetLab != nil && authUser != nil && !authUser.IsAdmin &&
		!slices.Contains(authUser.Collections, targetLab.Collection.Name) {
		return InstanceNode{}, "", utils.ErrNoAccessToLab
	}

	if targetInstance == nil {
		return InstanceNode{}, "", utils.ErrLabNotRunning
	}

	targetInstance.DataMutex.Lock()
	defer targetInstance.DataMutex.Unlock()

	node, ok := targetInstance.Nodes[targetNodeName]
	if !ok {
		return InstanceNode{}, "", utils.ErrNodeNotFound
	}

	nodeCopy := *node
	nodeCopy.Interfaces = slices.Clone(node.Interfaces)

	return nodeCopy, targetInstance.Name, nil
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

// getInstanceNode looks a node up by name under the instance's data lock.
func getInstanceNode(instance *Instance, nodeName string) *InstanceNode {
	instance.DataMutex.Lock()
	defer instance.DataMutex.Unlock()

	for _, node := range instance.Nodes {
		if node.Name == nodeName {
			return node
		}
	}

	return nil
}

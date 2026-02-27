package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"bytes"
	"context"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net/netip"
	"os"
	filepath "path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"golang.org/x/crypto/ssh"
	"gopkg.in/yaml.v3"
)

const ShellTimeout = 60

type (
	Service interface {
		Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]LabOut, error)
		GetByUuid(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) (*LabOut, error)
		Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req LabInPartial, labId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error

		// RunScheduler Starts looping through all scheduled labs and waits to deploy them
		RunScheduler()

		RunShellManager()

		ListenToProviderEvents()
	}

	labService struct {
		config                 *config.AntimonyConfig
		labDeploymentSchedule  utils.Schedule[Lab]
		labDestructionSchedule utils.Schedule[Lab]

		// Map of currently active instances indexed by lab ID.
		// The instances can be in any of the real states.
		instances      map[string]*Instance
		instancesMutex sync.Mutex

		openShells      map[string]*ShellConfig
		openShellsMutex sync.Mutex

		defaultSshAuth  []ssh.AuthMethod
		nodeKindConfigs map[string]NodeKindConfig

		labRepo                Repository
		userRepo               user.Repository
		topologyRepo           topology.Repository
		schemaService          schema.Service
		topologyService        topology.Service
		storageManager         storage.StorageManager
		deploymentProvider     deployment.DeploymentProvider
		socketManager          socket.SocketManager
		labUpdatesNamespace    socket.OutputNamespace[LabUpdateOut]
		labCommandsNamespace   socket.InputNamespace[LabCommandData]
		shellCommandsNamespace socket.OutputNamespace[ShellCommandData]
		statusMessageNamespace socket.OutputNamespace[statusMessage.StatusMessage]
	}

	ShellConfig struct {
		Owner            *auth.AuthenticatedUser
		LabId            string
		Node             string
		Connection       io.ReadWriteCloser
		ConnectionCancel context.CancelFunc
		LastInteraction  int64
		DataNamespace    socket.IONamespace[string, string]
	}
)

func CreateService(
	config *config.AntimonyConfig,
	labRepo Repository,
	userRepo user.Repository,
	topologyRepo topology.Repository,
	schemaService schema.Service,
	topologyService topology.Service,
	storageManager storage.StorageManager,
	socketManager socket.SocketManager,
	statusMessageNamespace socket.OutputNamespace[statusMessage.StatusMessage],
	deploymentProvider deployment.DeploymentProvider,
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
		config:                 config,
		labRepo:                labRepo,
		userRepo:               userRepo,
		topologyRepo:           topologyRepo,
		schemaService:          schemaService,
		topologyService:        topologyService,
		labDeploymentSchedule:  deploymentSchedule,
		labDestructionSchedule: destructionSchedule,
		nodeKindConfigs:        getNodeKindConfigs("./kinds.conf.yml"),
		openShells:             make(map[string]*ShellConfig),
		openShellsMutex:        sync.Mutex{},
		instances:              make(map[string]*Instance),
		instancesMutex:         sync.Mutex{},
		defaultSshAuth:         getSshKeyAuth(),
		storageManager:         storageManager,
		deploymentProvider:     deploymentProvider,
		socketManager:          socketManager,
		statusMessageNamespace: statusMessageNamespace,
	}
	labService.labCommandsNamespace = socket.CreateInputNamespace[LabCommandData](
		socketManager, false, false, labService.handleLabCommand, nil, "lab-commands",
	)
	labService.labUpdatesNamespace = socket.CreateOutputNamespace[LabUpdateOut](
		socketManager, false, false, false, nil, "lab-updates",
	)
	labService.shellCommandsNamespace = socket.CreateOutputNamespace[ShellCommandData](
		socketManager, false, false, false, nil, "shell-commands",
	)

	labService.reviveLabs()
	labService.labUpdatesNamespace.Send(LabUpdateOut{
		LabId: nil,
	})

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

		time.Sleep(50 * time.Millisecond)
	}
}

func (s *labService) RunShellManager() {
	for {
		s.openShellsMutex.Lock()
		for shellId, shell := range s.openShells {
			if time.Now().Unix()-shell.LastInteraction > s.config.Shell.Timeout {
				if err := s.closeShell(shellId, shell, "shell was inactive for too long"); err != nil {
					log.Errorf("Failed to close shell: %s", err.Error())
				}

				delete(s.openShells, shellId)
			}
		}
		s.openShellsMutex.Unlock()

		time.Sleep(5 * time.Second)
	}
}

func (s *labService) ListenToProviderEvents() {
	ctx := context.Background()

	err := s.deploymentProvider.RegisterListener(ctx, func(containerId string) {
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
			s.labUpdatesNamespace.Send(LabUpdateOut{
				targetLabId,
			})
		}
	})

	if err != nil {
		return
	}
}

func (s *labService) Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]LabOut, error) {
	var (
		labs []Lab
		err  error
	)

	if labs, err = s.labRepo.GetAll(ctx, &labFilter); err != nil {
		return nil, err
	}

	hasStateFilter := len(labFilter.StateFilter) > 0

	result := make([]LabOut, 0)
	for _, lab := range labs {
		// If the user isn't an admin, skip labs that they don't have access to
		if !authUser.IsAdmin && !slices.Contains(authUser.Collections, lab.Topology.Collection.Name) {
			continue
		}

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
			ID:                 lab.UUID,
			Name:               lab.Name,
			StartTime:          lab.StartTime,
			EndTime:            lab.EndTime,
			TopologyId:         lab.Topology.UUID,
			CollectionId:       lab.Topology.Collection.UUID,
			Creator:            s.userRepo.UserToOut(lab.Creator),
			TopologyDefinition: *lab.TopologyDefinition,
			Instance:           s.instanceToOut(instance),
			InstanceName:       lab.InstanceName,
		})
	}

	return result, err
}

func (s *labService) GetByUuid(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) (*LabOut, error) {
	var (
		lab *Lab
		err error
	)
	if lab, err = s.labRepo.GetByUuid(ctx, labId); err != nil {
		return nil, err
	}

	// Deny request if user doesn't have access to the lab
	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, lab.Topology.Collection.Name) {
		return nil, utils.ErrNoAccessToLab
	}

	s.instancesMutex.Lock()
	instance := s.instances[lab.UUID]
	s.instancesMutex.Unlock()

	result := &LabOut{
		ID:                 lab.UUID,
		Name:               lab.Name,
		StartTime:          lab.StartTime,
		EndTime:            lab.EndTime,
		TopologyId:         lab.Topology.UUID,
		CollectionId:       lab.Topology.Collection.UUID,
		Creator:            s.userRepo.UserToOut(lab.Creator),
		TopologyDefinition: *lab.TopologyDefinition,
		Instance:           s.instanceToOut(instance),
		InstanceName:       lab.InstanceName,
	}

	return result, err
}

func (s *labService) Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error) {
	labTopology, err := s.topologyRepo.GetByUuid(ctx, *req.TopologyId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the lab topology's collection
	if !authUser.IsAdmin &&
		(!labTopology.Collection.PublicDeploy || !slices.Contains(authUser.Collections, labTopology.Collection.Name)) {
		return "", utils.ErrNoDeployAccessToCollection
	}

	creator, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrUnauthorized
	}

	topologyDefinition, _, err := s.topologyService.LoadTopology(labTopology.UUID, []topology.BindFile{})
	if err != nil {
		log.Errorf("Failed to read definition of topology '%s': %s", labTopology.UUID, err.Error())
		return "", utils.ErrAntimony
	}

	labUuid := utils.GenerateUuid()
	lab := &Lab{
		UUID:               labUuid,
		Name:               *req.Name,
		StartTime:          *req.StartTime,
		EndTime:            req.EndTime,
		Creator:            *creator,
		Topology:           *labTopology,
		TopologyDefinition: &topologyDefinition,
	}

	if err := s.labRepo.Create(ctx, lab); err != nil {
		return "", err
	}

	// Add newly created lab to the deployment schedule
	s.labDeploymentSchedule.Schedule(lab)

	// Send update to clients
	s.notifyUpdate(*lab, nil)

	return labUuid, nil
}

func (s *labService) Update(ctx *gin.Context, req LabInPartial, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrNoWriteAccessToLab
	}

	// Don't allow modifications to running labs
	s.instancesMutex.Lock()
	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
		return utils.ErrLabRunning
	}
	s.instancesMutex.Unlock()

	updateDeploymentSchedule := false
	updateDestructionSchedule := false

	if req.Indefinite != nil && *req.Indefinite {
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
		return err
	}

	if updateDeploymentSchedule {
		s.labDeploymentSchedule.Reschedule(lab)
	}

	if updateDestructionSchedule {
		s.labDestructionSchedule.Reschedule(lab)
	}

	return nil
}

func (s *labService) Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrNoWriteAccessToLab
	}

	// Don't allow the deletion of running labs
	s.instancesMutex.Lock()
	if instance, hasInstance := s.instances[lab.UUID]; hasInstance && instance.State != InstanceStates.Failed {
		return utils.ErrLabRunning
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

	runTopologyName = strings.ReplaceAll(lab.Topology.Name, " ", "-")
	runTopologyName = strings.ReplaceAll(runTopologyName, "_", "-")
	runTopologyName = fmt.Sprintf("%s-%d", runTopologyName, time.Now().UnixMilli())

	if err := s.renameTopology(lab.Topology.UUID, runTopologyName, &runTopologyDefinition); err != nil {
		return "", "", err
	}

	if err := s.storageManager.CreateRunEnvironment(
		lab.Topology.UUID,
		lab.UUID,
		runTopologyDefinition,
		&runTopologyFile,
	); err != nil {
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
		log.Infof("[SCHEDULER] Deployment still running, cancelling")
		instance.DeploymentWorker.Cancel()

		s.notifyUpdate(*lab,
			statusMessage.Info(
				"Lab Manager",
				fmt.Sprintf("Cancelling deployment of lab '%s' (%s)", lab.Name, lab.Topology.Name),
				"Cancelling deployment of lab",
				"id",
				lab.UUID,
				"instance",
				*lab.InstanceName,
				"topo",
				lab.Topology.Name,
			),
		)
	}

	// We need to wait for previous operations to complete before destroying the lab
	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	// Close all open shells for all nodes in the lab
	for _, node := range instance.Nodes {
		s.closeNodeShells(node.Name)
	}

	ctx := context.Background()

	s.updateStateAndNotify(*lab, InstanceStates.Stopping, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Destroying lab %s (%s)", lab.Name, lab.Topology.Name),
		"Destroying lab", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)

	output, err := s.deploymentProvider.Destroy(ctx, instance.TopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})
	streamClabOutput(instance.LogNamespace, output)

	if err != nil {
		s.statusMessageNamespace.Send(*statusMessage.Error(
			"Lab Manager", fmt.Sprintf("Failed to destroy lab %s: %s", lab.Name, err.Error()),
			"Failed to destroy lab", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		))
		return utils.ErrContainerlab
	}

	instance.LogNamespace.ClearBacklog()
	instance.LogNamespace = nil

	// Remove instance from a lab and send update to clients
	s.instancesMutex.Lock()
	delete(s.instances, lab.UUID)
	s.instancesMutex.Unlock()
	s.labUpdatesNamespace.Send(LabUpdateOut{
		LabId: &lab.UUID,
	})

	s.statusMessageNamespace.Send(*statusMessage.Success(
		"Lab Manager", fmt.Sprintf("Successfully destroyed lab %s", lab.Name),
		"Lab has been destroyed successfully", "lab", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	))

	return nil
}

func (s *labService) redeployLab(lab *Lab, instance *Instance) error {
	// We have to ensure that the instance isn't already being deployed
	if instance.State == InstanceStates.Deploying {
		s.notifyUpdate(*lab,
			statusMessage.Error(
				"Lab Manager",
				fmt.Sprintf(
					"Unable to redeploy lab '%s' (%s). The lab is already being deployed",
					lab.Name,
					lab.Topology.Name,
				),
				"Failed to deploy lab: The lab is already being deployed",
				"id",
				lab.UUID,
				"instance",
				*lab.InstanceName,
				"topo",
				lab.Topology.Name,
			),
		)
		return utils.ErrLabIsDeploying
	}

	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	instance.DeploymentWorker = &utils.Worker{
		Context: ctx,
		Cancel:  cancel,
	}
	defer instance.DeploymentWorker.Cancel()

	// Close all open shells for all nodes in the lab
	for _, node := range instance.Nodes {
		s.closeNodeShells(node.Name)
	}

	// Remove old nodes from instance
	instance.Nodes = make([]InstanceNode, 0)

	s.updateStateAndNotify(*lab, InstanceStates.Deploying, statusMessage.Info(
		"Lab Manager",
		fmt.Sprintf("Redeploying lab '%s' (%s)", lab.Name, lab.Topology.Name),
		"Starting redeployment of lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)

	output, err := s.deploymentProvider.Redeploy(ctx, instance.TopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})

	streamClabOutput(instance.LogNamespace, output)

	// Only report errors if the worker has not been cancelled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Error(
			"Lab Manager",
			fmt.Sprintf("Failed to redeploy lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Failed to redeploy lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(*lab, false)
		return utils.ErrContainerlab
	}

	// Fetch and attach lab inspect info and change state to running if successful
	instanceNodes, err := s.getNodesFromInspect(ctx, instance, *lab.InstanceName, func(data string) {
		instance.LogNamespace.Send(data)
	})

	for i := range instanceNodes {
		go s.startNodeStartupListener(&instanceNodes[i], instance, lab)
	}

	// Only report errors if the deployment worker has not been cancelled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Warning(
			"Lab Manager",
			fmt.Sprintf("Failed to get info of lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Inspection of lab failed", "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(*lab, false)
		return utils.ErrContainerlab
	}

	log.Infof("[SCHEDULER] Successfully redeployed lab '%s'!", lab.Name)
	instance.Nodes = instanceNodes
	for _, node := range instanceNodes {
		containerLogNamespace := socket.CreateOutputNamespace[string](
			s.socketManager, false, true, true, nil, "logs", lab.UUID, node.ContainerId,
		)
		err := s.deploymentProvider.StreamContainerLogs(ctx, "", node.ContainerId, func(data string) {
			containerLogNamespace.Send(data)
		})
		if err != nil {
			log.Errorf("Failed to setup container logs for container %s: %s", node.ContainerId, err.Error())
		}
	}

	s.updateStateAndNotify(*lab, InstanceStates.Running, statusMessage.Success(
		"Lab Manager",
		fmt.Sprintf("Successfully redeployed '%s' (%s)", lab.Name, lab.Topology.Name),
		"Redeployment of lab was successful", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)
	s.setTopologyDeployStatus(*lab, true)

	instance.DeploymentWorker.Context.Done()

	return nil
}

func (s *labService) openSshSession(host string, nodeKind string) (io.ReadWriteCloser, error) {
	authMethods := s.defaultSshAuth

	sshUsername := "admin"
	kindConfig, hasConfig := s.nodeKindConfigs[nodeKind]

	if hasConfig && kindConfig.SSHUsername != nil {
		sshUsername = *kindConfig.SSHUsername
	}

	if hasConfig && kindConfig.SSHPassword != nil {
		authMethods = append(authMethods, ssh.Password(*kindConfig.SSHPassword))
	}

	sshConfig := &ssh.ClientConfig{
		User:            sshUsername,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	client, err := ssh.Dial("tcp", host+":22", sshConfig)
	if err != nil {
		return nil, err
	}

	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	err = session.RequestPty("xterm", 25, 130, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	})

	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}

	if err = session.Shell(); err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}

	return &sshReadWriteCloser{
		reader:  stdout,
		writer:  stdin,
		session: session,
		client:  client,
	}, nil
}

type sshReadWriteCloser struct {
	reader  io.Reader
	writer  io.WriteCloser
	session *ssh.Session
	client  *ssh.Client
}

func (s *sshReadWriteCloser) Read(p []byte) (int, error)  { return s.reader.Read(p) }
func (s *sshReadWriteCloser) Write(p []byte) (int, error) { return s.writer.Write(p) }
func (s *sshReadWriteCloser) Close() error {
	_ = s.writer.Close()
	_ = s.session.Close()
	return s.client.Close()
}

func (s *labService) deployLab(lab *Lab) error {
	// We have to ensure that the instance is only created once
	s.instancesMutex.Lock()

	if _, hasInstance := s.instances[lab.UUID]; hasInstance {
		s.notifyUpdate(*lab,
			statusMessage.Error("Lab Manager",
				fmt.Sprintf(
					"Unable to deploy lab '%s' (%s). The lab is already being deployed", lab.Name, lab.Topology.Name,
				),
				"Failed to deploy lab: The lab is already being deployed",
				"id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
			),
		)
		return utils.ErrLabIsDeploying
	}

	logNamespace := socket.CreateOutputNamespace[string](s.socketManager, false, true, true, nil, "logs", lab.UUID)
	runTopologyFile, runTopologyDefinition, err := s.createLabEnvironment(lab)

	instance := s.createInstance(logNamespace, runTopologyFile, runTopologyDefinition)
	s.instances[lab.UUID] = instance
	s.instancesMutex.Unlock()

	if err != nil {
		log.Errorf("Failed to create lab environment for lab '%s': %s", lab.Name, err)
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Error("Lab Manager",
			fmt.Sprintf("Failed to create environment for lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Failed to create environment for lab",
			"id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &logNamespace)
		s.setTopologyDeployStatus(*lab, false)
		return utils.ErrAntimony
	}

	instance.Mutex.Lock()
	defer instance.Mutex.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	instance.DeploymentWorker = &utils.Worker{
		Context: ctx,
		Cancel:  cancel,
	}
	defer instance.DeploymentWorker.Cancel()

	s.updateStateAndNotify(*lab, InstanceStates.Deploying, statusMessage.Info("Lab Manager",
		fmt.Sprintf("Deploying lab '%s' (%s)", lab.Name, lab.Topology.Name),
		"Starting deployment of lab", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)

	output, err := s.deploymentProvider.Deploy(ctx, runTopologyFile, func(data string) {
		instance.LogNamespace.Send(data)
	})

	streamClabOutput(instance.LogNamespace, output)

	// Only report errors if the deployment worker has not been cancelled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Error("Lab Manager",
			fmt.Sprintf("Failed to deploy lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Deployment of lab failed", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(*lab, false)
		return utils.ErrContainerlab
	}

	// Fetch and attach lab inspect info and change state to running if successful
	instanceNodes, err := s.getNodesFromInspect(ctx, instance, *lab.InstanceName, func(data string) {
		instance.LogNamespace.Send(data)
	})

	for i := range instanceNodes {
		go s.startNodeStartupListener(&instanceNodes[i], instance, lab)
	}

	// Only report errors if the deployment worker has not been cancelled
	if err != nil && instance.DeploymentWorker.Context.Err() == nil {
		s.updateStateAndNotify(*lab, InstanceStates.Failed, statusMessage.Warning("Lab Manager",
			fmt.Sprintf("Failed to get info of lab '%s' (%s)", lab.Name, lab.Topology.Name),
			"Inspection of lab failed", "instance", *lab.InstanceName, "topo", lab.Topology.Name,
		), &instance.LogNamespace)
		s.setTopologyDeployStatus(*lab, false)
		return utils.ErrContainerlab
	}

	log.Infof("[SCHEDULER] Successfully deployed lab '%s'!", lab.Name)
	instance.Nodes = instanceNodes
	for _, node := range instanceNodes {
		containerLogNamespace := socket.CreateOutputNamespace[string](
			s.socketManager, false, true, true, nil, "logs", lab.UUID, node.ContainerId,
		)
		err := s.deploymentProvider.StreamContainerLogs(ctx, "", node.ContainerId, func(data string) {
			containerLogNamespace.Send(data)
		})
		if err != nil {
			log.Errorf("Failed to setup container logs for container %s: %s", node.ContainerId, err.Error())
		}
	}

	s.updateStateAndNotify(*lab, InstanceStates.Running, statusMessage.Success("Lab Manager",
		fmt.Sprintf("Successfully deployed '%s' (%s)", lab.Name, lab.Topology.Name),
		"Deployment of lab was successful", "id", lab.UUID, "instance", *lab.InstanceName, "topo", lab.Topology.Name,
	), &instance.LogNamespace)
	s.setTopologyDeployStatus(*lab, true)

	instance.DeploymentWorker.Context.Done()

	return nil
}

// startNodeStartupListener Starts a blocking listener that waits until the localhost SSH service responds or the container is stopped
func (s *labService) startNodeStartupListener(node *InstanceNode, instance *Instance, lab *Lab) {
	ctx := context.Background()
	cmd := []string{
		"bash", "-c", `
		until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 admin@localhost 2> /dev/null; do
			sleep 5
		done
	`}

	connection, err := s.deploymentProvider.ExecInteractive(ctx, node.ContainerId, cmd)
	if err != nil {
		return
	}

	// We wait until the SSH process responds or the pipe is broken
	buf := make([]byte, 1024)
	_, err = connection.Read(buf)

	// Set the instance state to running if the SSH process responded
	if err == nil {
		instance.Mutex.Lock()
		node.State = deployment.NodeStates.Running
		instance.Mutex.Unlock()

		s.labUpdatesNamespace.Send(LabUpdateOut{
			LabId: &lab.UUID,
		})
	}
}

// setTopologyDeployStatus Sets the LastDeployFailed flag in the lab's topology
func (s *labService) setTopologyDeployStatus(lab Lab, wasSuccessful bool) {
	lab.Topology.LastDeployFailed = !wasSuccessful
	if err := s.topologyRepo.Update(context.Background(), &lab.Topology); err != nil {
		log.Error("Failed to set last deployment failed on topology", "topo", lab.Topology.UUID)
	}
}

func (s *labService) createInstance(
	logNamespace socket.OutputNamespace[string],
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

func (s *labService) extractNodeLabels(topologyDefinition any) map[string]map[string]string {
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

func (s *labService) extractNodeKinds(topologyDefinition any) map[string]string {
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

func (s *labService) instanceToOut(instance *Instance) *InstanceOut {
	if instance == nil {
		return nil
	}

	return &InstanceOut{
		Deployed:          instance.Deployed,
		State:             instance.State,
		LatestStateChange: instance.LatestStateChange,
		Nodes:             s.nodesToOut(instance.Nodes),
		Recovered:         instance.Recovered,
	}
}

func (s *labService) nodesToOut(nodes []InstanceNode) []InstanceNode {
	cmdTemplate := template.Must(template.New("msg").Parse(s.config.Capture.Cmd))

	var nodesOut []InstanceNode
	ctx := context.Background()

	for _, node := range nodes {
		var interfaceCaptures map[string]string

		if s.config.Capture.Enabled {
			interfaces, _ := s.deploymentProvider.GetInterfaces(ctx, node.ContainerName)
			interfaces = utils.FilterList(interfaces, s.config.Capture.Excluded)

			interfaceCaptures = make(map[string]string)

			for _, interfaceName := range interfaces {
				var buf bytes.Buffer
				_ = cmdTemplate.Execute(&buf, struct {
					ContainerName string
					InterfaceName string
				}{
					ContainerName: node.ContainerName,
					InterfaceName: interfaceName,
				})

				interfaceCaptures[interfaceName] = buf.String()
			}
		}

		nodesOut = append(nodesOut, InstanceNode{
			Name:              node.Name,
			IPv4:              node.IPv4,
			IPv6:              node.IPv6,
			State:             node.State,
			ContainerId:       node.ContainerId,
			ContainerName:     node.ContainerName,
			InterfaceCaptures: interfaceCaptures,
		})
	}

	return nodesOut
}

func (s *labService) updateInstanceNodes(
	ctx context.Context,
	instance *Instance,
	instanceName string,
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

	instance.Mutex.Lock()
	instance.Nodes = updatedNodes
	instance.Mutex.Unlock()

	return nil
}

func (s *labService) getNodesFromInspect(
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
		return s.containerToInstanceNode(container, instance.NodeKinds)
	}), nil
}

func (s *labService) containerToInstanceNode(
	container deployment.InspectContainer,
	nodeKinds map[string]string,
) InstanceNode {
	var ok bool

	nodeNameParts := strings.Split(container.Name, "-")
	nodeName := nodeNameParts[len(nodeNameParts)-1]

	var nodeKind string

	if nodeKind, ok = nodeKinds[nodeName]; !ok {
		log.Warnf("Failed to get kind for running node '%s'", nodeName)
	}

	return InstanceNode{
		Name:          nodeName,
		Kind:          nodeKind,
		IPv4:          container.IPv4Address,
		IPv6:          container.IPv6Address,
		State:         deployment.NodeStates.Starting,
		ContainerId:   container.ContainerId,
		ContainerName: container.Name,
	}
}

func (s *labService) notifyUpdate(lab Lab, message *statusMessage.StatusMessage) {
	s.labUpdatesNamespace.Send(LabUpdateOut{
		LabId: &lab.UUID,
	})

	if message != nil {
		s.statusMessageNamespace.Send(*message)
	}
}

// updateStateAndNotify Updates the state of a lab and sends various notification updates.
// If the status message is set, all users will receive the status message.
// If the log namespace is set, the log content of the status message is also sent to the provided namespace.
func (s *labService) updateStateAndNotify(
	lab Lab,
	state InstanceState,
	statusMessage *statusMessage.StatusMessage,
	logNamespace *socket.OutputNamespace[string],
) {
	s.instances[lab.UUID].State = state
	s.instances[lab.UUID].LatestStateChange = time.Now()
	s.labUpdatesNamespace.Send(LabUpdateOut{
		LabId: &lab.UUID,
	})

	if statusMessage != nil {
		s.statusMessageNamespace.Send(*statusMessage)
		if logNamespace != nil {
			(*logNamespace).Send(statusMessage.LogContent)
		}
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
				s.socketManager, false, true, true, nil, "logs", lab.UUID,
			)

			// Create log namespaces for each container in the lab
			for _, container := range containers {
				containerLogNamespace := socket.CreateOutputNamespace[string](
					s.socketManager, false, true, true, nil, "logs", lab.UUID, container.ContainerId,
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

			if err := s.storageManager.ReadTopology(lab.Topology.UUID, topologyDefinition); err == nil {
				topologyDefinitionParsed, _ := s.schemaService.Parse(*topologyDefinition)
				nodeLabels = s.extractNodeLabels(*topologyDefinitionParsed)
				nodeKinds = s.extractNodeKinds(*topologyDefinitionParsed)
			}

			instanceNodes := lo.Map(containers, func(container deployment.InspectContainer, _ int) InstanceNode {
				return s.containerToInstanceNode(container, nodeKinds)
			})

			instance := &Instance{
				State:             InstanceStates.Running,
				Nodes:             instanceNodes,
				Deployed:          time.Now(),
				LatestStateChange: time.Now(),
				Recovered:         true,
				TopologyFile:      s.storageManager.GetRunTopologyFile(lab.UUID),
				LogNamespace:      logNamespace,
				NodeLabels:        nodeLabels,
				NodeKinds:         nodeKinds,
			}

			for i := range instanceNodes {
				go s.startNodeStartupListener(&instanceNodes[i], instance, &lab)
			}

			s.instancesMutex.Lock()
			s.instances[lab.UUID] = instance
			s.instancesMutex.Unlock()

			s.labDestructionSchedule.Schedule(&lab)
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
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidSocketRequest))
		return
	}

	switch *data.Command {
	case LabCommands.Deploy:
		if err := s.deployLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case LabCommands.Destroy:
		if err := s.destroyLabCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case LabCommands.StartNode:
		if err := s.startNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case LabCommands.StopNode:
		if err := s.stopNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case LabCommands.RestartNode:
		if err := s.restartNodeCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	case LabCommands.FetchShells:
		if shells, err := s.fetchShellsCommand(ctx, *data.LabId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shells))
		}
	case LabCommands.OpenShell:
		if shellId, err := s.openShellCommand(ctx, *data.LabId, data.Node, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
		} else {
			onResponse(utils.CreateSocketOkResponse[any](shellId))
		}
	case LabCommands.CloseShell:
		if err := s.closeShellCommand(data.ShellId, authUser); err != nil {
			onError(utils.CreateSocketErrorResponse(err))
			return
		}
		onResponse(utils.CreateSocketOkResponse[any](nil))
	default:
		onError(utils.CreateSocketErrorResponse(utils.ErrInvalidLabCommand))
	}
}

func (s *labService) destroyLabCommand(ctx context.Context, labId string, authUser *auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrNoDestroyAccessToLab
	}

	// Don't allow destroying non-running labs
	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[lab.UUID]
	s.instancesMutex.Unlock()

	if !hasInstance {
		return utils.ErrLabNotRunning
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
		return utils.ErrNoDeployAccessToLab
	}

	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[lab.UUID]
	s.instancesMutex.Unlock()

	if hasInstance {
		if err := s.redeployLab(lab, instance); err != nil {
			return err
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

func (s *labService) startNodeCommand(
	ctx context.Context,
	labId string,
	nodeId *string,
	authUser *auth.AuthenticatedUser,
) error {
	lab, instance, node, err := s.validateNodeCommand(ctx, labId, nodeId, authUser)
	if err != nil {
		return err
	}

	if err := s.deploymentProvider.StartNode(ctx, node.ContainerId); err != nil {
		return err
	}

	if err := s.updateInstanceNodes(ctx, instance, *lab.InstanceName, true); err != nil {
		return err
	}

	s.notifyUpdate(*lab, statusMessage.Success(
		"Lab Manager",
		fmt.Sprintf("Node %s is starting", node.Name),
		"Starting of node has been issued", "nodeId", node.ContainerId, "labId", lab.UUID,
	))

	return nil
}

func (s *labService) stopNodeCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) error {
	lab, instance, node, err := s.validateNodeCommand(ctx, labId, nodeName, authUser)
	if err != nil {
		return err
	}

	s.closeNodeShells(node.Name)

	if err := s.deploymentProvider.StopNode(ctx, node.ContainerId); err != nil {
		return err
	}

	if err := s.updateInstanceNodes(ctx, instance, *lab.InstanceName, true); err != nil {
		return err
	}

	s.notifyUpdate(*lab, statusMessage.Success(
		"Lab Manager",
		fmt.Sprintf("Node %s is stopping", node.Name),
		"Stopping of node has been issued", "nodeId", node.ContainerId, "labId", lab.UUID,
	))

	return nil
}

func (s *labService) restartNodeCommand(
	ctx context.Context,
	labId string,
	nodeId *string,
	authUser *auth.AuthenticatedUser,
) error {
	lab, instance, node, err := s.validateNodeCommand(ctx, labId, nodeId, authUser)
	if err != nil {
		return err
	}

	s.closeNodeShells(node.Name)

	if err := s.deploymentProvider.RestartNode(ctx, node.ContainerId); err != nil {
		return err
	}

	if err := s.updateInstanceNodes(ctx, instance, *lab.InstanceName, true); err != nil {
		return err
	}

	s.notifyUpdate(*lab, statusMessage.Success(
		"Lab Manager",
		fmt.Sprintf("Node %s is restarting", node.Name),
		"Restart of node has been issued", "nodeId", node.ContainerId, "labId", lab.UUID,
	))

	return nil
}

func (s *labService) validateNodeCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) (*Lab, *Instance, *InstanceNode, error) {
	if nodeName == nil {
		return nil, nil, nil, utils.ErrNodeNotFound
	}

	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, nil, nil, err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return nil, nil, nil, utils.ErrNoDestroyAccessToLab
	}

	// Don't allow destroying non-running labs
	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[lab.UUID]
	s.instancesMutex.Unlock()

	if !hasInstance {
		return nil, nil, nil, utils.ErrLabNotRunning
	}

	node, hasNode := lo.Find(instance.Nodes, func(node InstanceNode) bool {
		return node.Name == *nodeName
	})

	if !hasNode {
		return nil, nil, nil, utils.ErrNodeNotFound
	}

	return lab, instance, &node, nil
}

func (s *labService) fetchShellsCommand(
	ctx context.Context,
	labId string,
	authUser *auth.AuthenticatedUser,
) ([]ShellData, error) {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, err
	}

	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, lab.Topology.Collection.Name) {
		return nil, utils.ErrNoAccessToLab
	}

	var userShells []ShellData

	s.openShellsMutex.Lock()
	for shellId, shell := range s.openShells {
		if shell.LabId == labId && shell.Owner.UserId == authUser.UserId {
			userShells = append(userShells, ShellData{
				Id:   shellId,
				Node: shell.Node,
			})
		}
	}
	s.openShellsMutex.Unlock()

	return userShells, nil
}

func (s *labService) openShellCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) (string, error) {
	if nodeName == nil {
		return "", utils.ErrInvalidSocketRequest
	}

	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return "", err
	}

	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, lab.Topology.Collection.Name) {
		return "", utils.ErrNoAccessToLab
	}

	s.instancesMutex.Lock()
	instance, hasInstance := s.instances[lab.UUID]
	if !hasInstance {
		return "", utils.ErrLabNotRunning
	}
	s.instancesMutex.Unlock()

	node, hasNode := lo.Find(instance.Nodes, func(node InstanceNode) bool {
		return node.Name == *nodeName
	})
	if !hasNode {
		return "", utils.ErrNodeNotFound
	}

	s.openShellsMutex.Lock()
	userShellCount := lo.CountBy(lo.Values(s.openShells), func(shell *ShellConfig) bool {
		return shell.Owner.UserId == authUser.UserId
	})
	s.openShellsMutex.Unlock()

	if userShellCount >= s.config.Shell.UserLimit {
		return "", utils.ErrShellLimitReached
	}

	var host string
	if ip, err := netip.ParsePrefix(node.IPv4); err != nil {
		log.Warn(
			"Failed to parse node IP",
			"ip", node.IPv4, "container", node.ContainerName,
			"err", err,
		)
		host = ip.Addr().String()
	} else {
		host = node.ContainerName
	}

	connection, err := s.openSshSession(host, node.Kind)

	if err != nil {
		log.Errorf("Failed to open shell: %s", err.Error())
		return "", err
	}

	shellId := utils.GenerateUuid()
	accessGroup := []*auth.AuthenticatedUser{authUser}

	dataNamespace := socket.CreateIONamespace[string, string](
		s.socketManager,
		false,
		true,
		true,
		s.handleShellData(shellId),
		&accessGroup,
		"shells", shellId,
	)

	ctx, cancel := context.WithCancel(context.Background())

	shellConfig := &ShellConfig{
		Owner:            authUser,
		Node:             *nodeName,
		LabId:            labId,
		Connection:       connection,
		ConnectionCancel: cancel,
		LastInteraction:  time.Now().Unix(),
		DataNamespace:    dataNamespace,
	}

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := connection.Read(buf)
			if err != nil {
				if errors.Is(err, io.EOF) {
					_ = s.closeShell(shellId, shellConfig, "User closed the shell")
					break
				}

				// Only send an error if the connection hasn't been closed explicitly
				if ctx.Err() == nil {
					s.shellCommandsNamespace.Send(ShellCommandData{
						LabId:   labId,
						Node:    *nodeName,
						ShellId: shellId,
						Command: ShellCommands.Error,
						Message: err.Error(),
					})
				}

				break
			}

			dataNamespace.Send(string(buf[:n]))
		}
	}()

	s.openShellsMutex.Lock()
	s.openShells[shellId] = shellConfig
	s.openShellsMutex.Unlock()

	return shellId, nil
}

func (s *labService) closeShellCommand(shellId *string, authUser *auth.AuthenticatedUser) error {
	if shellId == nil {
		return utils.ErrInvalidSocketRequest
	}

	s.openShellsMutex.Lock()
	shell, hasShell := s.openShells[*shellId]
	s.openShellsMutex.Unlock()

	if !hasShell {
		return utils.ErrShellNotFound
	}

	if !authUser.IsAdmin && shell.Owner != authUser {
		return utils.ErrNoAccessToShell
	}

	err := s.closeShell(*shellId, shell, "shell was closed by the user")
	if err != nil {
		log.Errorf("Failed to close shell: %s", err.Error())
	}

	s.openShellsMutex.Lock()
	delete(s.openShells, *shellId)
	s.openShellsMutex.Unlock()

	return nil
}

func (s *labService) closeNodeShells(nodeName string) {
	var removeShellIds []string

	s.openShellsMutex.Lock()
	for shellId, shell := range s.openShells {
		if shell.Node == nodeName {
			err := s.closeShell(shellId, shell, "the shell's node has been stopped")
			if err != nil {
				log.Errorf("Failed to close shell: %s", err.Error())
			}

			removeShellIds = append(removeShellIds, shellId)
		}
	}
	for _, id := range removeShellIds {
		delete(s.openShells, id)
	}
	s.openShellsMutex.Unlock()
}

func (s *labService) closeShell(shellId string, shell *ShellConfig, reason string) error {
	s.openShellsMutex.Lock()
	delete(s.openShells, shellId)
	s.openShellsMutex.Unlock()

	s.shellCommandsNamespace.Send(ShellCommandData{
		LabId:   shell.LabId,
		Node:    shell.Node,
		ShellId: shellId,
		Command: ShellCommands.Close,
		Message: reason,
	})

	shell.ConnectionCancel()

	return shell.Connection.Close()
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
			onError(utils.CreateSocketErrorResponse(utils.ErrInvalidSocketRequest))
			return
		}

		s.openShellsMutex.Lock()
		shell, hasShell := s.openShells[shellId]
		s.openShellsMutex.Unlock()

		if !hasShell {
			if onError != nil {
				onError(utils.CreateSocketErrorResponse(utils.ErrShellNotFound))
			}
			return
		}

		if shell.Owner.UserId != authUser.UserId {
			onError(utils.CreateSocketErrorResponse(utils.ErrNoAccessToShell))
			return
		}

		shell.LastInteraction = time.Now().Unix()

		_, err := shell.Connection.Write(([]byte)(*data))
		if err != nil {
			log.Errorf("Failed to write shell data: %s", err.Error())
			if onError != nil {
				onError(utils.CreateSocketErrorResponse(err))
			}
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

func getNodeKindConfigs(path string) map[string]NodeKindConfig {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Infof("No kind config file was specified: %s", err)
		return make(map[string]NodeKindConfig)
	}

	log.Infof("Loaded kind config file: %s", err)

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

func getSshKeyAuth() []ssh.AuthMethod {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Errorf("Failed to get home directory for SSH keys.")
		return []ssh.AuthMethod{}
	}

	keyFiles := []string{
		"id_rsa",
		"id_ed25519",
		"id_ecdsa",
		"id_dsa",
		"id_ecdsa_sk",
		"id_ed25519_sk",
	}

	var signers []ssh.AuthMethod
	for _, name := range keyFiles {
		path := filepath.Join(home, ".ssh", name)
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		signer, err := ssh.ParsePrivateKey(data)
		if err != nil {
			continue
		}

		signers = append(signers, ssh.PublicKeys(signer))
	}

	if len(signers) == 0 {
		log.Warnf("Failed to find any SSH keys on the system.")
	}

	return signers
}

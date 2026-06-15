package shell

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/topology"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
	"errors"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	"golang.org/x/crypto/ssh"
)

type Service struct {
	config *config.AntimonyConfig

	openShells      map[string]*shellConfig
	openShellsMutex sync.Mutex

	defaultSshAuth []ssh.AuthMethod

	labRepo         *lab.Repository
	instanceService *instance.Service
	topologyService *topology.Service

	socketManager *socket.Manager

	deploymentProvider deployment.DeploymentProvider

	controlNamespace *socket.OutputNamespace[shellControlData]
}

type shellConfig struct {
	owner            *auth.AuthenticatedUser
	labId            string
	node             string
	connection       io.ReadWriteCloser
	connectionCancel context.CancelFunc
	lastInteraction  int64
	dataNamespace    *socket.IONamespace[string, byte]
}

type sshReadWriteCloser struct {
	reader  io.Reader
	writer  io.WriteCloser
	session *ssh.Session
	client  *ssh.Client
}

func CreateService(
	config *config.AntimonyConfig,
	labRepo *lab.Repository,
	instanceService *instance.Service,
	socketManager *socket.Manager,
	deploymentProvider deployment.DeploymentProvider,
) *Service {
	service := &Service{
		config:          config,
		labRepo:         labRepo,
		instanceService: instanceService,

		openShells:         make(map[string]*shellConfig),
		openShellsMutex:    sync.Mutex{},
		defaultSshAuth:     getSshKeyAuth(),
		deploymentProvider: deploymentProvider,
		socketManager:      socketManager,
	}

	service.controlNamespace = socket.CreateOutputNamespace[shellControlData](
		socketManager, false, nil, false, nil, "shell-control",
	)

	ctx := context.Background()
	go service.runManager(ctx)

	return service
}

func (s *Service) FetchShellsCommand(
	ctx context.Context,
	labId string,
	authUser *auth.AuthenticatedUser,
) ([]shellData, error) {
	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, err
	}

	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, instanceLab.Topology.Collection.Name) {
		return nil, utils.ErrNoAccessToLab
	}

	var userShells []shellData

	s.openShellsMutex.Lock()
	for shellId, shell := range s.openShells {
		if shell.labId == labId && shell.owner.UserId == authUser.UserId {
			userShells = append(userShells, shellData{
				Id:   shellId,
				Node: shell.node,
			})
		}
	}
	s.openShellsMutex.Unlock()

	return userShells, nil
}

func (s *Service) OpenShellCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) (string, error) {
	node, err := s.validateShellCommand(ctx, labId, nodeName, authUser)
	if err != nil {
		return "", err
	}

	s.openShellsMutex.Lock()
	userShellCount := lo.CountBy(lo.Values(s.openShells), func(shell *shellConfig) bool {
		return shell.owner.UserId == authUser.UserId
	})
	s.openShellsMutex.Unlock()

	if userShellCount >= s.config.Shell.UserLimit {
		return "", utils.ErrShellLimitReached
	}

	connection, err := s.openNodeShell(ctx, *node)
	if err != nil {
		log.Error("Failed to open shell on node.", "node", node.ContainerName)
		return "", err
	}

	shellId := utils.GenerateUuid()
	accessGroup := []*auth.AuthenticatedUser{authUser}

	dataNamespace := socket.CreateIONamespace[string, byte](
		s.socketManager,
		false,
		&socket.BacklogConfig{
			Capacity: s.config.Streaming.ClabLogBacklog,
			Kind:     utils.RingKindByte,
		},
		true,
		s.handleUserData(shellId),
		&accessGroup,
		"shell", shellId,
	)

	ctx, cancel := context.WithCancel(context.Background())

	shellConfig := &shellConfig{
		owner:            authUser,
		node:             *nodeName,
		labId:            labId,
		connection:       connection,
		connectionCancel: cancel,
		lastInteraction:  time.Now().Unix(),
		dataNamespace:    dataNamespace,
	}

	go s.runShell(ctx, labId, *nodeName, connection, shellId, shellConfig, dataNamespace)

	s.openShellsMutex.Lock()
	s.openShells[shellId] = shellConfig
	s.openShellsMutex.Unlock()

	return shellId, nil
}

func (s *Service) CloseShellCommand(shellId *string, authUser *auth.AuthenticatedUser) error {
	if shellId == nil {
		return utils.ErrInvalidSocketRequest
	}

	s.openShellsMutex.Lock()
	shell, hasShell := s.openShells[*shellId]
	s.openShellsMutex.Unlock()

	if !hasShell {
		return utils.ErrShellNotFound
	}

	if !authUser.IsAdmin && shell.owner != authUser {
		return utils.ErrNoAccessToShell
	}

	s.openShellsMutex.Lock()
	delete(s.openShells, *shellId)
	s.openShellsMutex.Unlock()

	err := s.closeShell(*shellId, shell, "shell was closed by the user")
	if err != nil {
		log.Errorf("Failed to close shell: %s", err.Error())
	}

	s.openShellsMutex.Lock()
	delete(s.openShells, *shellId)
	s.openShellsMutex.Unlock()

	return nil
}

func (s *Service) runManager(ctx context.Context) {
	for {
		s.openShellsMutex.Lock()
		for shellId, shell := range s.openShells {
			if time.Now().Unix()-shell.lastInteraction > s.config.Shell.Timeout {
				if err := s.closeShell(shellId, shell, "shell was inactive for too long"); err != nil {
					log.Errorf("Failed to close shell: %s", err.Error())
				}

				delete(s.openShells, shellId)
			}
		}
		s.openShellsMutex.Unlock()

		select {
		case <-time.After(5 * time.Second):
			continue
		case <-ctx.Done():
			break
		}
	}
}

func (s *Service) openNodeShell(ctx context.Context, node instance.InstanceNode) (io.ReadWriteCloser, error) {
	var host string
	var connection io.ReadWriteCloser
	var err error

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

	connection, err = s.openSshSession(host, node.Kind)
	if err == nil {
		return connection, nil
	}

	log.Debug(
		"Failed to open SSH session for node. Falling back to native bash.",
		"kind",
		node.Kind,
		"node",
		node.ContainerId,
	)

	connection, err = s.deploymentProvider.ExecInteractive(ctx, node.ContainerId, []string{"/bin/bash"})
	if err == nil {
		return connection, nil
	}

	log.Debug(
		"Failed to open native bash session for node. Falling back to native sh.",
		"kind",
		node.Kind,
		"node",
		node.ContainerId,
	)

	return s.deploymentProvider.ExecInteractive(ctx, node.ContainerId, []string{"/bin/sh"})
}

func (s *Service) openSshSession(host string, nodeKind string) (io.ReadWriteCloser, error) {
	authMethods := s.defaultSshAuth

	sshUsername := "admin"
	kindConfig, hasConfig := s.instanceService.GetNodeKindsConfig()[nodeKind]

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

func (s *Service) closeShell(shellId string, shell *shellConfig, reason string) error {
	s.controlNamespace.Send(shellControlData{
		LabId:   shell.labId,
		Node:    shell.node,
		ShellId: shellId,
		Command: ShellCommands.Close,
		Message: reason,
	})

	return shell.Close()
}

func (s *Service) handleUserData(
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

		if shell.owner.UserId != authUser.UserId {
			onError(utils.CreateSocketErrorResponse(utils.ErrNoAccessToShell))
			return
		}

		shell.lastInteraction = time.Now().Unix()

		_, err := shell.connection.Write(([]byte)(*data))
		if err != nil {
			log.Errorf("Failed to write shell data: %s", err.Error())
			if onError != nil {
				onError(utils.CreateSocketErrorResponse(err))
			}
		}
	}
}

func (s *Service) runShell(
	ctx context.Context,
	labId string,
	nodeName string,
	connection io.ReadWriteCloser,
	shellId string,
	shellConfig *shellConfig,
	dataNamespace *socket.IONamespace[string, byte],
) {
	var err error
	var n int

	buf := make([]byte, 1024)

	for {
		if n, err = connection.Read(buf); err == nil {
			dataNamespace.SendBulk(buf[:n])
			continue
		}

		if errors.Is(err, io.EOF) {
			s.openShellsMutex.Lock()
			delete(s.openShells, shellId)
			s.openShellsMutex.Unlock()

			_ = s.closeShell(shellId, shellConfig, "The connection has been terminated")
			break
		}

		// Only send an error if the connection hasn't been closed already
		if ctx.Err() == nil {
			s.controlNamespace.Send(shellControlData{
				LabId:   labId,
				Node:    nodeName,
				ShellId: shellId,
				Command: ShellCommands.Error,
				Message: err.Error(),
			})
		}

		break
	}
}

func (s *Service) validateShellCommand(
	ctx context.Context,
	labId string,
	nodeName *string,
	authUser *auth.AuthenticatedUser,
) (*instance.InstanceNode, error) {
	if nodeName == nil {
		return nil, utils.ErrInvalidSocketRequest
	}

	instanceLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != instanceLab.Creator.UUID {
		return nil, utils.ErrNoDeployAccessToLab
	}

	return s.instanceService.GetInstanceNode(ctx, labId, *nodeName, authUser)
}

func (s *sshReadWriteCloser) Read(p []byte) (int, error)  { return s.reader.Read(p) }
func (s *sshReadWriteCloser) Write(p []byte) (int, error) { return s.writer.Write(p) }
func (s *sshReadWriteCloser) Close() error {
	_ = s.writer.Close()
	_ = s.session.Close()
	return s.client.Close()
}

func (c *shellConfig) Close() error {
	c.connectionCancel()
	c.dataNamespace.Release()

	return c.connection.Close()
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

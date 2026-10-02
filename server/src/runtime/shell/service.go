package shell

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/lab"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
	"errors"
	"io"
	"maps"
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

	socketManager *socket.Manager

	deploymentProvider deployment.DeploymentProvider

	controlNamespace *socket.OutputNamespace[shellControlData]

	// cancel stops the shell manager worker. It is called by Close.
	cancel    context.CancelFunc
	closeOnce sync.Once
}

type shellConfig struct {
	owner            *auth.AuthenticatedUser
	labId            string
	node             string
	connection       deployment.ShellExecSession
	connectionCancel context.CancelFunc
	lastInteraction  int64
	dataNamespace    *socket.IONamespace[string, byte]
}

type sshSession struct {
	io.Reader
	io.Writer
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
	ctx, cancel := context.WithCancel(context.Background())

	service := &Service{
		config:          config,
		labRepo:         labRepo,
		instanceService: instanceService,

		openShells:         make(map[string]*shellConfig),
		openShellsMutex:    sync.Mutex{},
		defaultSshAuth:     getSshKeyAuth(),
		deploymentProvider: deploymentProvider,
		socketManager:      socketManager,

		cancel:    cancel,
		closeOnce: sync.Once{},
	}

	service.controlNamespace = socket.CreateOutputNamespace[shellControlData](
		socketManager, false, nil, false, nil, "shell-control",
	)

	go service.runManager(ctx)

	return service
}

func (s *Service) OpenShell(
	ctx context.Context,
	instanceName string,
	node *instance.InstanceNode,
) (deployment.ShellExecSession, error) {
	if connection, err := s.openSshSession(instanceName, node); err == nil {
		return connection, nil
	}

	log.Debug(
		"[Shell] Unable to open SSH session to node. Falling back to interactive shell.",
		"kind",
		node.Kind,
		"node",
		node.ContainerId,
	)

	return s.deploymentProvider.ExecInteractive(
		ctx,
		instanceName,
		node.Name,
		// We want to try and use /bin/bash and fall back to /bin/sh if it's not available
		[]string{"sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"},
	)
}

// Close stops the shell manager worker, terminates all open shells, and releases the control namespace.
// It is safe to call more than once.
func (s *Service) Close() {
	s.closeOnce.Do(func() {
		s.cancel()

		s.openShellsMutex.Lock()
		openShells := maps.Clone(s.openShells)
		s.openShells = make(map[string]*shellConfig)
		s.openShellsMutex.Unlock()

		for shellId, shell := range openShells {
			if err := s.closeShell(shellId, shell, "the server is shutting down"); err != nil {
				log.Errorf("Failed to close shell: %s", err.Error())
			}
		}

		s.controlNamespace.Release()
	})
}

func (s *Service) FetchShellsCommand(
	ctx context.Context,
	labId string,
	authUser *auth.AuthenticatedUser,
) ([]shellData, error) {
	targetLab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return nil, err
	}

	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, targetLab.Collection.Name) {
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
	if nodeName == nil {
		return "", utils.ErrInvalidSocketRequest
	}

	node, targetInstanceName, err := s.instanceService.GetInstanceNode(
		ctx,
		&labId,
		nil,
		nil,
		nil,
		nodeName,
		nil,
		authUser,
	)
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

	connection, err := s.OpenShell(ctx, targetInstanceName, &node)
	if err != nil {
		log.Error("Failed to open shell on node.", "node", node.ContainerId)
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

	// Compare by user ID rather than by pointer: the socket manager hands out a fresh
	// *AuthenticatedUser per connection, so the owner of a shell opened on an earlier
	// connection never matches by identity.
	if !authUser.IsAdmin && shell.owner.UserId != authUser.UserId {
		return utils.ErrNoAccessToShell
	}

	s.openShellsMutex.Lock()
	delete(s.openShells, *shellId)
	s.openShellsMutex.Unlock()

	err := s.closeShell(*shellId, shell, "shell was closed by the user")
	if err != nil {
		log.Errorf("Failed to close shell: %s", err.Error())
	}

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
		case <-ctx.Done():
			return
		}
	}
}

func (s *Service) openSshSession(
	instanceName string,
	node *instance.InstanceNode,
) (deployment.ShellExecSession, error) {
	authMethods := s.defaultSshAuth

	sshUsername := "admin"
	kindConfig, hasConfig := s.instanceService.GetNodeKindsConfig()[node.Kind]

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

	ctx := context.Background()
	conn, err := s.deploymentProvider.DialNode(ctx, instanceName, node.Name, 22)
	if err != nil {
		return nil, err
	}

	// The host here doesn't matter, we already have the connection
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, node.Name+":22", sshConfig)
	if err != nil {
		return nil, err
	}
	client := ssh.NewClient(sshConn, chans, reqs)

	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	err = session.RequestPty("xterm", 25, 110, ssh.TerminalModes{
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

	return &sshSession{
		Writer:  stdin,
		Reader:  stdout,
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
	connection deployment.ShellExecSession,
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

// Read and Write must delegate to the embedded reader and writer explicitly. Naming them after the
// embedded interface methods shadows those methods, so a bare s.Read / s.Write would recurse.
func (s *sshSession) Read(p []byte) (int, error)  { return s.Reader.Read(p) }
func (s *sshSession) Write(p []byte) (int, error) { return s.Writer.Write(p) }

func (s *sshSession) Close() error {
	// The writer is the session's stdin pipe. Closing it signals EOF to the remote shell.
	if stdin, ok := s.Writer.(io.Closer); ok {
		_ = stdin.Close()
	}

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

func (s *sshSession) Resize(cols uint, rows uint) error {
	return s.session.WindowChange(int(rows), int(cols))
}

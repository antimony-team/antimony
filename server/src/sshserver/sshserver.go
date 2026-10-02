package sshserver

import (
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/runtime/shell"
	"antimonyBackend/utils"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/gliderlabs/ssh"
)

// Server is a service that allows clients to connect via SSH and capture network traffic from a node's interface.
//
// SSH connection string: ssh <instance-name>/<node-name>@<host> -p <port> <interface-name>
//
// Instead of the bare interface name, the command can also be the tcpdump command Wireshark's sshdump sends, in
// which case the interface is taken from its -i option.
type Server struct {
	captureConfig *config.CaptureConfig

	openStreams      map[string]*stream
	openStreamsMutex sync.Mutex

	shellService    *shell.Service
	instanceService *instance.Service

	deploymentProvider deployment.DeploymentProvider
}

const (
	// exitUsage is the exit code for sessions with an invalid user or command.
	exitUsage = 2
	// exitFailure is the exit code for sessions whose node or capture could not be opened.
	exitFailure = 1
)

func CreateServer(
	config *config.AntimonyConfig,
	shellService *shell.Service,
	instanceService *instance.Service,
	deploymentProvider deployment.DeploymentProvider,
) *Server {
	return &Server{
		captureConfig: &config.Capture,

		openStreams:      make(map[string]*stream),
		openStreamsMutex: sync.Mutex{},

		shellService:    shellService,
		instanceService: instanceService,

		deploymentProvider: deploymentProvider,
	}
}

func (s *Server) Start() error {
	srv, err := s.createSSHServer()
	if err != nil {
		return err
	}

	return srv.ListenAndServe()
}

// createSSHServer sets up the SSH server, generating the host key at the configured path if it doesn't exist yet.
func (s *Server) createSSHServer() (*ssh.Server, error) {
	if err := ensureHostKey(s.captureConfig.SSHKeyPath); err != nil {
		return nil, fmt.Errorf("preparing host key: %w", err)
	}

	srv := &ssh.Server{
		Addr:    fmt.Sprintf("%s:%d", s.captureConfig.SSHHost, s.captureConfig.SSHPort),
		Handler: s.handleSession,
	}

	if err := srv.SetOption(ssh.HostKeyFile(s.captureConfig.SSHKeyPath)); err != nil {
		return nil, fmt.Errorf("loading host key: %w", err)
	}

	return srv, nil
}

func (s *Server) handleSession(sess ssh.Session) {
	var targetNode instance.InstanceNode
	var targetInstanceName string
	var err error

	switch userParts := strings.Split(sess.User(), "/"); len(userParts) {
	case 1:
		// Only one argument means that the argument is the container id
		targetNode, targetInstanceName, err = s.instanceService.GetInstanceNode(
			sess.Context(),
			nil, nil, nil, nil, nil, &userParts[0], nil,
		)
	case 2:
		// Two arguments mean the first argument is either the lab id or the instance name, and the second argument is the node name.
		if utils.IsUuid(userParts[0]) {
			targetNode, targetInstanceName, err = s.instanceService.GetInstanceNode(
				sess.Context(),
				&userParts[0], nil, nil, nil, nil, &userParts[1], nil,
			)
		} else {
			targetNode, targetInstanceName, err = s.instanceService.GetInstanceNode(
				sess.Context(),
				nil, &userParts[0], nil, nil, &userParts[1], nil, nil,
			)
		}
	case 3:
		// Three arguments mean the arguments are collection name, lab name, node name.
		targetNode, targetInstanceName, err = s.instanceService.GetInstanceNode(
			sess.Context(),
			nil, nil, &userParts[0], &userParts[1], &userParts[2], nil, nil,
		)
	}

	if err != nil {
		endSession(sess, exitFailure, "unable to connect to node: %s", err.Error())
		return
	}

	if len(sess.Command()) == 0 {
		shellSession, err := s.shellService.OpenShell(sess.Context(), targetInstanceName, &targetNode)
		if err != nil {
			endSession(sess, exitFailure, "unable to open shell: %s", err.Error())
		}
		return
	}

	interfaceName, err := parseCaptureCommand(sess.Command())
	if err != nil {
		endSession(sess, exitUsage, "%s", err)
		return
	}

	if targetNode.State == deployment.NodeStates.Stopped {
		endSession(sess, exitFailure, "node %s/%s is not running", targetInstanceName, targetNode.Name)
		return
	}

	c, r, err := s.subscribe(sess.Context(), targetInstanceName, targetNode.Name, interfaceName)
	if err != nil {
		endSession(
			sess,
			exitFailure,
			"failed to capture %s on %s/%s: %s",
			interfaceName,
			targetInstanceName,
			targetNode.Name,
			err,
		)
		return
	}
	defer s.unsubscribe(targetInstanceName, targetNode.Name, interfaceName, r)

	_ = s.stream(sess, c, r)
}

// endSession reports an error to the client on stderr and ends the session with the given exit code.
func endSession(sess ssh.Session, exitCode int, format string, args ...any) {
	_, _ = fmt.Fprintf(sess.Stderr(), format+"\n", args...)
	_ = sess.Exit(exitCode)
}

func ensureHostKey(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}

	keyBytes, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		return err
	}
	block := &pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes}
	return os.WriteFile(path, pem.EncodeToMemory(block), 0o600)
}

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
	"io"
	"os"
	"strings"
	"sync"

	"github.com/charmbracelet/log"
	"github.com/gliderlabs/ssh"
)

// Server is an SSH server that gives clients a shell on a node, or streams the traffic of one of its interfaces.
//
// The SSH user addresses the node, either as "<container-id>", "<lab-id>/<node>", "<instance-name>/<node>" or
// "<collection>/<lab>/<node>". Without a command, the session is an interactive shell on the node. With a command,
// the command is the interface to capture, either just its name or the tcpdump command Wireshark's sshdump sends, in
// which case the interface is taken from its -i option.
type Server struct {
	captureConfig *config.CaptureConfig

	shellService    *shell.Service
	instanceService *instance.Service
	captureService  *CaptureService

	// sshServer is the running server, kept to close all connections on shutdown.
	sshServer      *ssh.Server
	sshServerMutex sync.Mutex
	closed         bool
}

const (
	// exitUsage is the exit code for sessions with an invalid user or command.
	exitUsage = 2
	// exitFailure is the exit code for sessions whose node, shell, or capture could not be opened.
	exitFailure = 1
)

// errServerClosed is returned by Start when the server was closed before it started listening.
var errServerClosed = errors.New("the SSH server has been closed")

func CreateServer(
	config *config.AntimonyConfig,
	shellService *shell.Service,
	instanceService *instance.Service,
	deploymentProvider deployment.DeploymentProvider,
) *Server {
	return &Server{
		captureConfig: &config.Capture,

		shellService:    shellService,
		instanceService: instanceService,
		captureService:  CreateCaptureService(deploymentProvider),
	}
}

// Start runs the SSH server until it is closed.
func (s *Server) Start() error {
	sshServer, err := s.createSSHServer()
	if err != nil {
		return err
	}

	s.sshServerMutex.Lock()
	if s.closed {
		s.sshServerMutex.Unlock()
		return errServerClosed
	}
	s.sshServer = sshServer
	s.sshServerMutex.Unlock()

	if err := sshServer.ListenAndServe(); err != nil && !errors.Is(err, ssh.ErrServerClosed) {
		return err
	}

	return nil
}

// Close stops the server: it closes all SSH connections, which ends their sessions and with them the shells opened
// for them, and stops all running captures. It is safe to call more than once.
func (s *Server) Close() {
	s.sshServerMutex.Lock()
	s.closed = true
	sshServer := s.sshServer
	s.sshServerMutex.Unlock()

	if sshServer != nil {
		if err := sshServer.Close(); err != nil {
			log.Warn("Failed to close the SSH server", "err", err.Error())
		}
	}

	s.captureService.Close()
}

// createSSHServer sets up the SSH server, generating the host key at the configured path if it doesn't exist yet.
func (s *Server) createSSHServer() (*ssh.Server, error) {
	if err := ensureHostKey(s.captureConfig.SSHKeyPath); err != nil {
		return nil, fmt.Errorf("preparing host key: %w", err)
	}

	sshServer := &ssh.Server{
		Addr:    fmt.Sprintf("%s:%d", s.captureConfig.SSHHost, s.captureConfig.SSHPort),
		Handler: s.handleSession,
	}

	if err := sshServer.SetOption(ssh.HostKeyFile(s.captureConfig.SSHKeyPath)); err != nil {
		return nil, fmt.Errorf("loading host key: %w", err)
	}

	return sshServer, nil
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
		// Two arguments mean the first argument is either the lab id or the instance name, and the second argument
		// is the node name.
		if utils.IsUuid(userParts[0]) {
			targetNode, targetInstanceName, err = s.instanceService.GetInstanceNode(
				sess.Context(),
				&userParts[0], nil, nil, nil, &userParts[1], nil, nil,
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
	default:
		endSessionf(
			sess,
			exitUsage,
			`invalid node %q, expected "<container-id>", "<lab>/<node>" or "<collection>/<lab>/<node>"`,
			sess.User(),
		)
		return
	}

	if err != nil {
		endSessionf(sess, exitFailure, "unable to connect to node: %s", err.Error())
		return
	}

	if len(sess.Command()) > 0 {
		s.startCapture(sess, targetInstanceName, &targetNode, sess.Command())
	} else {
		s.runShell(sess, targetInstanceName, &targetNode)
	}
}

// runShell opens a shell on the node and relays it to the session until either side ends.
func (s *Server) runShell(sess ssh.Session, instanceName string, node *instance.InstanceNode) {
	// The shells on the nodes always run in a terminal, so the client has to request one (ssh -t is the default for
	// interactive sessions).
	pty, windowChanges, isPty := sess.Pty()
	if !isPty {
		endSessionf(sess, exitUsage, "a terminal is required for a shell, connect with ssh -t")
		return
	}

	shellSession, err := s.shellService.OpenShell(sess.Context(), instanceName, node)
	if err != nil {
		endSessionf(sess, exitFailure, "unable to open shell: %s", err.Error())
		return
	}

	_ = shellSession.Resize(uint(pty.Window.Width), uint(pty.Window.Height))

	// Closing the shell also ends the output copy below
	defer func() {
		_ = shellSession.Close()
	}()

	// Client input to the node ends when the session is closed
	go func() {
		_, _ = io.Copy(shellSession, sess)
	}()

	// Node output to the client ends when the shell exits or is closed
	outputDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(sess, shellSession)
		close(outputDone)
	}()

	for {
		select {
		case window, ok := <-windowChanges:
			if !ok {
				// A nil channel never receives, so this case is disabled from now on
				windowChanges = nil
				continue
			}
			_ = shellSession.Resize(uint(window.Width), uint(window.Height))
		case <-outputDone:
			// The shell exited on its own
			_ = sess.Exit(0)
			return
		case <-sess.Context().Done():
			// The client disconnected or the server closed the connection
			return
		}
	}
}

// startCapture streams the traffic of the interface the session's command asks for, until either side ends.
func (s *Server) startCapture(sess ssh.Session, instanceName string, node *instance.InstanceNode, args []string) {
	if node.State == deployment.NodeStates.Stopped {
		endSessionf(sess, exitFailure, "node %s/%s is not running", instanceName, node.Name)
		return
	}

	interfaceName, err := parseCaptureCommand(args)
	if err != nil {
		endSessionf(sess, exitUsage, "%s", err)
		return
	}

	if err := s.captureService.Capture(sess, instanceName, node.Name, interfaceName); err != nil {
		endSessionf(sess, exitFailure, "failed to capture %s on %s/%s: %s", interfaceName, instanceName, node.Name, err)
		return
	}

	_ = sess.Exit(0)
}

// endSessionf reports an error to the client on stderr and ends the session with the given exit code.
func endSessionf(sess ssh.Session, exitCode int, format string, args ...any) {
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

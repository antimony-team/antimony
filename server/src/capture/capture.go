package capture

import (
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/charmbracelet/log"
	"github.com/gliderlabs/ssh"
	"github.com/google/gopacket"
	"github.com/google/gopacket/afpacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
)

type (
	// Server is a service that allows clients to connect via SSH and capture network traffic from a provided
	// container's interface.
	//
	// SSH connection string: ssh://<container-id>@<host> -p <port> <interface-name>
	Server interface {
		Start() error
	}

	captureStream struct {
		key    string
		source *afpacket.TPacket

		mutex     sync.RWMutex
		receivers map[*captureReceiver]struct{}

		done      chan struct{}
		closeOnce sync.Once
	}

	capturePacket struct {
		ci   gopacket.CaptureInfo
		data []byte
	}

	captureReceiver struct {
		ch chan capturePacket
	}

	captureServer struct {
		captureConfig *config.CaptureConfig

		openStreams      map[string]*captureStream
		openStreamsMutex sync.Mutex

		deploymentProvider deployment.DeploymentProvider
	}
)

func CreateServer(
	config *config.AntimonyConfig,
	deploymentProvider deployment.DeploymentProvider,
) Server {
	return &captureServer{
		captureConfig: &config.Capture,

		deploymentProvider: deploymentProvider,

		openStreams:      make(map[string]*captureStream),
		openStreamsMutex: sync.Mutex{},
	}
}

func (s *captureServer) Start() error {
	if err := ensureHostKey("./key"); err != nil {
		log.Fatalf("preparing host key: %v", err)
	}

	srv := &ssh.Server{
		Addr:    fmt.Sprintf("%s:%d", s.captureConfig.SSHHost, s.captureConfig.SSHPort),
		Handler: s.makeSessionHandler(),
	}

	if err := srv.SetOption(ssh.HostKeyFile(s.captureConfig.SSHKeyPath)); err != nil {
		log.Fatalf("loading host key: %v", err)
	}

	return srv.ListenAndServe()
}

func (s *captureServer) subscribe(
	ctx context.Context,
	containerId string,
	interfaceName string,
) (*captureStream, *captureReceiver, error) {
	captureKey := containerId + "/" + interfaceName

	s.openStreamsMutex.Lock()

	stream, ok := s.openStreams[captureKey]
	if !ok {
		src, err := s.deploymentProvider.OpenCapture(ctx, containerId, interfaceName)
		if err != nil {
			return nil, nil, err
		}

		stream = &captureStream{
			key:       captureKey,
			source:    src,
			receivers: make(map[*captureReceiver]struct{}),
			done:      make(chan struct{}),
		}
		s.openStreams[captureKey] = stream

		go s.processStream(stream)
	}

	s.openStreamsMutex.Unlock()

	receiver := &captureReceiver{ch: make(chan capturePacket, 1024)}

	stream.mutex.Lock()
	stream.receivers[receiver] = struct{}{}
	stream.mutex.Unlock()

	return stream, receiver, nil
}

func (s *captureServer) unsubscribe(containerId string, interfaceName string, receiver *captureReceiver) {
	captureKey := containerId + "/" + interfaceName

	s.openStreamsMutex.Lock()
	stream, ok := s.openStreams[captureKey]
	if !ok {
		s.openStreamsMutex.Unlock()
		return
	}

	stream.mutex.Lock()
	delete(stream.receivers, receiver)
	empty := len(stream.receivers) == 0
	stream.mutex.Unlock()

	if empty {
		delete(s.openStreams, captureKey)
	}
	s.openStreamsMutex.Unlock()

	if empty {
		stream.shutdown()
	}
}

// stream is reading packets from a client's receiver channel and sending them into the client's SSH session
func (s *captureServer) stream(sess ssh.Session, stream *captureStream, receiver *captureReceiver) error {
	w := pcapgo.NewWriter(sess)

	// When the client first connects, we write the pcap header to the SSH session once
	if err := w.WriteFileHeader(65536, layers.LinkTypeEthernet); err != nil {
		return err
	}

	ctx := sess.Context()
	for {
		select {
		case p := <-receiver.ch:
			if err := w.WritePacket(p.ci, p.data); err != nil {
				return err
			}
		case <-ctx.Done():
			// The SSH session is closed by the client or the connection is interrupted
			return ctx.Err()
		case <-stream.done:
			// The stream ends because the container stopped or the connection is interrupted
			return nil
		}
	}
}

// processStream is reading packets from the capture source and forwarding them into the client receiver channels
func (s *captureServer) processStream(stream *captureStream) {
	defer s.captureEnded(stream)

	for {
		data, ci, err := stream.source.ReadPacketData()
		if err != nil {
			// The stream ends because the container stopped or the connection is interrupted
			return
		}

		p := capturePacket{ci: ci, data: data}
		stream.mutex.RLock()
		for r := range stream.receivers {
			select {
			case r.ch <- p:
			default:
			}
		}
		stream.mutex.RUnlock()
	}
}

// captureEnded is called when a stream ends because the container stopped or the connection is interrupted
func (s *captureServer) captureEnded(stream *captureStream) {
	// Remove the entry from the map only if it hasn't been removed yet.
	s.openStreamsMutex.Lock()
	if s.openStreams[stream.key] == stream {
		delete(s.openStreams, stream.key)
	}
	s.openStreamsMutex.Unlock()

	stream.shutdown()
}

func (s *captureServer) makeSessionHandler() ssh.Handler {
	return func(sess ssh.Session) {
		container := sess.User()

		args := sess.Command()
		if len(args) == 0 {
			_, _ = fmt.Fprint(sess.Stderr(), "missing interface argument(s)")
			_ = sess.Exit(2)
			return
		}

		c, r, err := s.subscribe(sess.Context(), container, args[0])
		if err != nil {
			return
		}
		defer s.unsubscribe(container, args[0], r)

		_ = s.stream(sess, c, r)
	}
}

func (s *captureStream) shutdown() {
	s.closeOnce.Do(func() {
		close(s.done)
		if s.source != nil {
			s.source.Close()
		}
	})
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

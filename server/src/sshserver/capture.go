package sshserver

import (
	"antimonyBackend/deployment"
	"context"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/gliderlabs/ssh"
	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
)

// errCaptureServiceClosed is returned for captures requested after the service was closed.
var errCaptureServiceClosed = errors.New("the capture service is shutting down")

const (
	// sessionProbeInterval is how often a capture checks that its session is still open.
	sessionProbeInterval = 10 * time.Second
	// keepaliveRequest is the request OpenSSH servers send to check that a client is still there.
	keepaliveRequest = "keepalive@openssh.com"
)

type (
	// CaptureService streams the traffic of node interfaces into SSH sessions as pcap. Every interface is only captured
	// once, no matter how many sessions are watching it, and the capture is stopped when the last of them leaves.
	CaptureService struct {
		deploymentProvider deployment.DeploymentProvider

		openStreams      map[string]*stream
		openStreamsMutex sync.Mutex
		closed           bool
	}

	stream struct {
		key    string
		source deployment.CaptureSource

		// opened is closed once opening the capture has finished, openErr tells whether it failed.
		opened  chan struct{}
		openErr error

		// ctx belongs to the capture, not to any one session, so the capture outlives the session that started it.
		ctx    context.Context
		cancel context.CancelFunc

		mutex     sync.RWMutex
		receivers map[*receiver]struct{}

		done      chan struct{}
		closeOnce sync.Once
	}

	receiver struct {
		ch chan packet
	}

	packet struct {
		ci   gopacket.CaptureInfo
		data []byte
	}
)

func CreateCaptureService(deploymentProvider deployment.DeploymentProvider) *CaptureService {
	return &CaptureService{
		deploymentProvider: deploymentProvider,
		openStreams:        make(map[string]*stream),
	}
}

// Capture streams the traffic of an interface into the session until the session ends, the capture ends (e.g., because
// the node stopped) or the service is closed.
func (c *CaptureService) Capture(sess ssh.Session, instanceName string, nodeName string, interfaceName string) error {
	captureStream, receiver, err := c.subscribe(sess.Context(), instanceName, nodeName, interfaceName)
	if err != nil {
		return err
	}
	defer c.unsubscribe(captureStream, receiver)

	return writeStream(sess, captureStream, receiver)
}

// Close stops all running captures, which ends the sessions watching them and refuses new ones. It is safe to call
// more than once.
func (c *CaptureService) Close() {
	c.openStreamsMutex.Lock()
	c.closed = true
	openStreams := c.openStreams
	c.openStreams = make(map[string]*stream)
	c.openStreamsMutex.Unlock()

	for _, openStream := range openStreams {
		openStream.shutdown()
	}
}

func (c *CaptureService) subscribe(
	ctx context.Context,
	instanceName string,
	nodeName string,
	interfaceName string,
) (*stream, *receiver, error) {
	captureKey := getCaptureKey(instanceName, nodeName, interfaceName)
	newReceiver := &receiver{ch: make(chan packet, 1024)}

	c.openStreamsMutex.Lock()
	if c.closed {
		c.openStreamsMutex.Unlock()
		return nil, nil, errCaptureServiceClosed
	}

	captureStream, ok := c.openStreams[captureKey]
	if !ok {
		streamCtx, cancel := context.WithCancel(context.Background())
		captureStream = &stream{
			key:       captureKey,
			opened:    make(chan struct{}),
			ctx:       streamCtx,
			cancel:    cancel,
			receivers: make(map[*receiver]struct{}),
			done:      make(chan struct{}),
		}
		c.openStreams[captureKey] = captureStream

		// Opening can take a while (an exec request on clabernetes), so it runs without the registry lock
		go c.openStream(captureStream, instanceName, nodeName, interfaceName)
	}

	// Registered right away, so the stream isn't left without receivers if this session gives up while waiting
	captureStream.mutex.Lock()
	captureStream.receivers[newReceiver] = struct{}{}
	captureStream.mutex.Unlock()

	c.openStreamsMutex.Unlock()

	select {
	case <-captureStream.opened:
	case <-ctx.Done():
		c.unsubscribe(captureStream, newReceiver)
		return nil, nil, ctx.Err()
	}

	if captureStream.openErr != nil {
		c.unsubscribe(captureStream, newReceiver)
		return nil, nil, captureStream.openErr
	}

	return captureStream, newReceiver, nil
}

// openStream opens the capture of a registered stream and starts forwarding its packets.
func (c *CaptureService) openStream(captureStream *stream, instanceName string, nodeName string, interfaceName string) {
	defer close(captureStream.opened)

	source, err := c.deploymentProvider.OpenCapture(captureStream.ctx, instanceName, nodeName, interfaceName)
	if err != nil {
		captureStream.openErr = err
		c.captureEnded(captureStream)
		return
	}

	captureStream.mutex.Lock()
	select {
	case <-captureStream.done:
		// The stream was shut down while opening, e.g., its last session left, or the service closed
		captureStream.mutex.Unlock()
		source.Close()
		captureStream.openErr = errCaptureServiceClosed
		return
	default:
	}
	captureStream.source = source
	captureStream.mutex.Unlock()

	go c.processStream(captureStream)
}

// unsubscribe removes a receiver from its stream and stops the capture once nobody is watching it anymore. It takes
// the registry lock before the stream's, like subscribe, so a session can't join a stream that is being shut down.
func (c *CaptureService) unsubscribe(captureStream *stream, receiver *receiver) {
	c.openStreamsMutex.Lock()
	captureStream.mutex.Lock()
	delete(captureStream.receivers, receiver)
	empty := len(captureStream.receivers) == 0
	captureStream.mutex.Unlock()

	// Only remove the entry if it is still this stream, a new capture of the same interface may have replaced it.
	if empty && c.openStreams[captureStream.key] == captureStream {
		delete(c.openStreams, captureStream.key)
	}
	c.openStreamsMutex.Unlock()

	if empty {
		captureStream.shutdown()
	}
}

// processStream reads packets from the capture source and forwards them to all receivers. Receivers that can't keep
// up miss packets rather than slowing down the capture for everyone else.
func (c *CaptureService) processStream(captureStream *stream) {
	defer c.captureEnded(captureStream)

	for {
		data, ci, err := captureStream.source.ReadPacketData()
		if err != nil {
			// The capture ends because the node stopped or the source was closed
			return
		}

		p := packet{ci: ci, data: data}
		captureStream.mutex.RLock()
		for r := range captureStream.receivers {
			select {
			case r.ch <- p:
			default:
			}
		}
		captureStream.mutex.RUnlock()
	}
}

// captureEnded is called when a capture ends on its own, e.g. because the node stopped.
func (c *CaptureService) captureEnded(captureStream *stream) {
	c.openStreamsMutex.Lock()
	if c.openStreams[captureStream.key] == captureStream {
		delete(c.openStreams, captureStream.key)
	}
	c.openStreamsMutex.Unlock()

	captureStream.shutdown()
}

func (s *stream) shutdown() {
	s.closeOnce.Do(func() {
		// Cancels an opening that is still running
		s.cancel()
		close(s.done)

		// The source is set while opening, which may run at the same time
		s.mutex.Lock()
		source := s.source
		s.mutex.Unlock()

		if source != nil {
			source.Close()
		}
	})
}

// writeStream writes the packets of a receiver into the session as pcap, until the session or the stream ends.
func writeStream(sess ssh.Session, captureStream *stream, receiver *receiver) error {
	w := pcapgo.NewWriter(sess)

	// When the client first connects, we write the pcap header to the SSH session once
	if err := w.WriteFileHeader(65536, layers.LinkTypeEthernet); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(sess.Context())
	defer cancel()

	sessionClosed := watchSessionClose(ctx, sess)
	for {
		select {
		case p := <-receiver.ch:
			if err := w.WritePacket(p.ci, p.data); err != nil {
				return err
			}
		case <-sessionClosed:
			// The client closed the session, but may keep the connection open for others
			return nil
		case <-ctx.Done():
			// The client disconnected or the server closed the connection
			return ctx.Err()
		case <-captureStream.done:
			// The capture ended because the node stopped or the service is shutting down
			return nil
		}
	}
}

// watchSessionClose returns a channel that is closed once the client has closed the session, or ctx ends. The session's
// context only ends with the whole connection, which a client sharing it for several sessions keeps open. The input
// doesn't tell either, a client without input (ssh -n) ends it right away and keeps watching. So the session is probed
// with a keepalive request, like OpenSSH's ClientAliveInterval does, which fails once the session is closed. Clients
// answer it with a failure, which is fine.
func watchSessionClose(ctx context.Context, sess ssh.Session) <-chan struct{} {
	closed := make(chan struct{})

	inputDone := make(chan struct{})
	go func() {
		// The input ends when the client closes the session, so the session is probed right away then
		_, _ = io.Copy(io.Discard, sess)
		close(inputDone)
	}()

	go func() {
		ticker := time.NewTicker(sessionProbeInterval)
		defer ticker.Stop()

		for {
			select {
			case <-inputDone:
				// A nil channel never receives, the input only triggers one probe
				inputDone = nil
			case <-ticker.C:
			case <-ctx.Done():
				return
			}

			if _, err := sess.SendRequest(keepaliveRequest, true, nil); err != nil {
				close(closed)
				return
			}
		}
	}()

	return closed
}

func getCaptureKey(instanceName string, nodeName string, interfaceName string) string {
	return instanceName + "/" + nodeName + "/" + interfaceName
}

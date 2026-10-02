package sshserver

import (
	"antimonyBackend/deployment"
	"context"
	"errors"
	"sync"

	"github.com/gliderlabs/ssh"
	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
)

// errCaptureServiceClosed is returned for captures requested after the service was closed.
var errCaptureServiceClosed = errors.New("the capture service is shutting down")

// CaptureService streams the traffic of node interfaces into SSH sessions as pcap. Every interface is only captured
// once, no matter how many sessions are watching it, and the capture is stopped when the last of them leaves.
type CaptureService struct {
	deploymentProvider deployment.DeploymentProvider

	openStreams      map[string]*stream
	openStreamsMutex sync.Mutex
	closed           bool
}

type stream struct {
	key    string
	source deployment.CaptureSource

	mutex     sync.RWMutex
	receivers map[*receiver]struct{}

	done      chan struct{}
	closeOnce sync.Once
}

type receiver struct {
	ch chan packet
}

type packet struct {
	ci   gopacket.CaptureInfo
	data []byte
}

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

// Close stops all running captures, which ends the sessions watching them, and refuses new ones. It is safe to call
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

	c.openStreamsMutex.Lock()
	defer c.openStreamsMutex.Unlock()

	if c.closed {
		return nil, nil, errCaptureServiceClosed
	}

	captureStream, ok := c.openStreams[captureKey]
	if !ok {
		source, err := c.deploymentProvider.OpenCapture(ctx, instanceName, nodeName, interfaceName)
		if err != nil {
			return nil, nil, err
		}

		captureStream = &stream{
			key:       captureKey,
			source:    source,
			receivers: make(map[*receiver]struct{}),
			done:      make(chan struct{}),
		}
		c.openStreams[captureKey] = captureStream

		go c.processStream(captureStream)
	}

	receiver := &receiver{ch: make(chan packet, 1024)}

	captureStream.mutex.Lock()
	captureStream.receivers[receiver] = struct{}{}
	captureStream.mutex.Unlock()

	return captureStream, receiver, nil
}

// unsubscribe removes a receiver from its stream and stops the capture once nobody is watching it anymore.
func (c *CaptureService) unsubscribe(captureStream *stream, receiver *receiver) {
	captureStream.mutex.Lock()
	delete(captureStream.receivers, receiver)
	empty := len(captureStream.receivers) == 0
	captureStream.mutex.Unlock()

	if !empty {
		return
	}

	c.openStreamsMutex.Lock()
	// Only remove the entry if it is still this stream, a new capture of the same interface may have replaced it.
	if c.openStreams[captureStream.key] == captureStream {
		delete(c.openStreams, captureStream.key)
	}
	c.openStreamsMutex.Unlock()

	captureStream.shutdown()
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

// writeStream writes the packets of a receiver into the session as pcap, until the session or the stream ends.
func writeStream(sess ssh.Session, captureStream *stream, receiver *receiver) error {
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
		case <-captureStream.done:
			// The capture ended because the node stopped or the service is shutting down
			return nil
		}
	}
}

func (s *stream) shutdown() {
	s.closeOnce.Do(func() {
		close(s.done)
		if s.source != nil {
			s.source.Close()
		}
	})
}

func getCaptureKey(instanceName string, nodeName string, interfaceName string) string {
	return instanceName + "/" + nodeName + "/" + interfaceName
}

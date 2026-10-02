package sshserver

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"
	"sync"

	"github.com/gliderlabs/ssh"
	"github.com/google/gopacket"
	"github.com/google/gopacket/afpacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
)

type stream struct {
	key    string
	source *afpacket.TPacket

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

func (s *Server) subscribe(
	ctx context.Context,
	instanceName string,
	nodeName string,
	interfaceName string,
) (*stream, *receiver, error) {
	captureKey := getCaptureKey(instanceName, nodeName, interfaceName)

	s.openStreamsMutex.Lock()

	captureStream, ok := s.openStreams[captureKey]
	if !ok {
		src, err := s.deploymentProvider.OpenCapture(ctx, instanceName, nodeName, interfaceName)
		if err != nil {
			s.openStreamsMutex.Unlock()
			return nil, nil, err
		}

		captureStream = &stream{
			key:       captureKey,
			source:    src,
			receivers: make(map[*receiver]struct{}),
			done:      make(chan struct{}),
		}
		s.openStreams[captureKey] = captureStream

		go s.processStream(captureStream)
	}

	s.openStreamsMutex.Unlock()

	receiver := &receiver{ch: make(chan packet, 1024)}

	captureStream.mutex.Lock()
	captureStream.receivers[receiver] = struct{}{}
	captureStream.mutex.Unlock()

	return captureStream, receiver, nil
}

func (s *Server) unsubscribe(instanceName string, nodeName string, interfaceName string, receiver *receiver) {
	captureKey := getCaptureKey(instanceName, nodeName, interfaceName)

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
func (s *Server) stream(sess ssh.Session, stream *stream, receiver *receiver) error {
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
func (s *Server) processStream(stream *stream) {
	defer s.captureEnded(stream)

	for {
		data, ci, err := stream.source.ReadPacketData()
		if err != nil {
			// The stream ends because the container stopped or the connection is interrupted
			return
		}

		p := packet{ci: ci, data: data}
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
func (s *Server) captureEnded(stream *stream) {
	// Remove the entry from the map only if it hasn't been removed yet.
	s.openStreamsMutex.Lock()
	if s.openStreams[stream.key] == stream {
		delete(s.openStreams, stream.key)
	}
	s.openStreamsMutex.Unlock()

	stream.shutdown()
}

// tcpdumpArgumentOptions are the short options of tcpdump that take an argument. They are needed to tell an
// argument apart from a group of flags, e.g. "-w -" from "-nU".
const tcpdumpArgumentOptions = "BcCEFGijmMQrsTVwWyzZ"

// parseCaptureCommand returns the interface a capture command asks for. The command is either just the interface
// name, or a tcpdump command line like the one Wireshark's sshdump sends ("tcpdump -U -i eth0 -w -", optionally
// run through sudo), whose -i option names the interface. All other tcpdump options are ignored.
func parseCaptureCommand(args []string) (string, error) {
	if len(args) > 0 && args[0] == "sudo" {
		args = args[1:]
	}

	if len(args) == 0 {
		return "", errors.New("missing interface to capture")
	}

	if path.Base(args[0]) != "tcpdump" {
		if len(args) > 1 {
			return "", fmt.Errorf("unexpected arguments %q, expected an interface name or a tcpdump command", args[1:])
		}
		return args[0], nil
	}

	for i := 1; i < len(args); i++ {
		arg := args[i]

		if value, ok := strings.CutPrefix(arg, "--interface="); ok {
			return value, nil
		}
		if arg == "--interface" {
			if i+1 < len(args) {
				return args[i+1], nil
			}
			break
		}
		if !strings.HasPrefix(arg, "-") || strings.HasPrefix(arg, "--") || arg == "-" {
			continue
		}

		// A group of short options, where an option that takes an argument consumes the rest of the group, or the
		// next argument if it is the last one.
		for j := 1; j < len(arg); j++ {
			option := arg[j]
			if !strings.ContainsRune(tcpdumpArgumentOptions, rune(option)) {
				continue
			}

			value := arg[j+1:]
			if value == "" && i+1 < len(args) {
				i++
				value = args[i]
			}

			if option == 'i' && value != "" {
				return value, nil
			}
			break
		}
	}

	return "", errors.New("the tcpdump command has no interface (-i)")
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

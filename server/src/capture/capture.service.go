package capture

import (
	"antimonyBackend/config"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/gliderlabs/ssh"
	"github.com/gorilla/websocket"
)

type (
	Service interface {
		Start() error
	}

	captureSpec struct {
		Name              string   `json:"name"`
		Type              string   `json:"type"`
		NetworkInterfaces []string `json:"network-interfaces,omitempty"`
	}

	captureService struct {
		captureConfig *config.CaptureConfig
	}
)

func CreateService(config *config.AntimonyConfig) Service {
	return &captureService{
		captureConfig: &config.Capture,
	}
}

func (s *captureService) Start() error {
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

func (s *captureService) makeSessionHandler() ssh.Handler {
	return func(sess ssh.Session) {
		container := sess.User()

		args := sess.Command()
		if len(args) == 0 {
			_, _ = fmt.Fprint(sess.Stderr(), "missing interface argument(s)")
			_ = sess.Exit(2)
			return
		}

		err := s.streamCapture(sess.Context(), sess, container, args)

		switch {
		case err == nil, errors.Is(err, context.Canceled), errors.Is(err, io.EOF):
			log.Printf("capture end:   container=%q remote=%s (clean)",
				container, sess.RemoteAddr())
			_ = sess.Exit(0)
		default:
			log.Printf("capture end:   container=%q remote=%s err=%v",
				container, sess.RemoteAddr(), err)
			_, _ = fmt.Fprintf(sess.Stderr(), "capture error: %v\n", err)
			_ = sess.Exit(1)
		}
	}
}

func (s *captureService) streamCapture(ctx context.Context, w io.Writer, container string, ifaces []string) error {
	spec := captureSpec{
		Name: container,
		Type: "docker",
	}
	if len(ifaces) > 0 {
		spec.NetworkInterfaces = ifaces
	}
	specBytes, err := json.Marshal(spec)
	if err != nil {
		return fmt.Errorf("build capture spec: %w", err)
	}

	u, _ := url.Parse(fmt.Sprintf(
		"ws://%s/capture",
		net.JoinHostPort(s.captureConfig.EdgesharkHost, strconv.Itoa(s.captureConfig.EdgesharkPort)),
	))

	u.Path = "/capture"
	q := u.Query()
	q.Set("container", string(specBytes))
	if len(ifaces) > 0 {
		q.Set("nif", strings.Join(ifaces, "/"))
	}
	u.RawQuery = q.Encode()

	dialer := *websocket.DefaultDialer
	dialer.Subprotocols = []string{"kubevirtiface"}

	conn, _, err := dialer.DialContext(ctx, u.String(), nil)
	if err != nil {
		return fmt.Errorf("dial packetflix: %w", err)
	}
	defer conn.Close()

	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("websocket read: %w", err)
		}
		if len(data) == 0 {
			continue
		}
		if _, err := w.Write(data); err != nil {
			return fmt.Errorf("write to ssh client: %w", err)
		}
	}
}

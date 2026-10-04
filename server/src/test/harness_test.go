package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/device"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/serverconfig"
	"antimonyBackend/domain/statusmessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/runtime/commands"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/runtime/scheduler"
	"antimonyBackend/runtime/shell"
	"antimonyBackend/socket"
	"antimonyBackend/storage"
	collectiontransport "antimonyBackend/transport/http/collection"
	devicetransport "antimonyBackend/transport/http/device"
	labtransport "antimonyBackend/transport/http/lab"
	schematransport "antimonyBackend/transport/http/schema"
	serverconfigtransport "antimonyBackend/transport/http/serverconfig"
	topologytransport "antimonyBackend/transport/http/topology"
	usertransport "antimonyBackend/transport/http/user"
	"antimonyBackend/utils"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	charmlog "github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	socketio "github.com/zishang520/socket.io/servers/socket/v3"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"net/http/httptest"
)

// defaultKindsConfig gives the tests one node kind that may be restarted (linux) and one that may
// not (nokia_srlinux), so both branches of the node-command guard are reachable.
const defaultKindsConfig = `nokia_srlinux:
  sshUsername: admin
  sshPassword: NokiaSrl1!

linux:
  canRestart: true
`

// Harness is the full Antimony service graph wired against temporary, in-process infrastructure:
// an in-memory SQLite database, a temp-dir storage manager and a DummyProvider in place of
// containerlab. It exposes both a gin engine (for fast in-process HTTP assertions) and a real
// httptest server (which socket.io needs, since it cannot run over httptest.ResponseRecorder).
//
// Build one with NewHarness. Everything is torn down through t.Cleanup.
type Harness struct {
	T *testing.T

	Config   *config.AntimonyConfig
	DB       *gorm.DB
	Storage  *storage.Manager
	Auth     *auth.Manager
	Sockets  *socket.Manager
	Provider *deployment.DummyProvider

	LabEventBus *utils.EventBus[*lab.Lab]

	StatusMessages *socket.OutputNamespace[statusmessage.Message]

	// StartupEvents captures lab event bus traffic from before the runtime services were created,
	// which is the only way to observe what the instance service's revive pass published.
	StartupEvents *LabEventRecorder

	LabRepo        *lab.Repository
	UserRepo       *user.Repository
	TopologyRepo   *topology.Repository
	CollectionRepo *collection.Repository

	LabService          *lab.Service
	UserService         *user.Service
	SchemaService       *schema.Service
	DeviceService       *device.Service
	TopologyService     *topology.Service
	CollectionService   *collection.Service
	ServerConfigService *serverconfig.Service
	InstanceService     *instance.Service
	ShellService        *shell.Service
	Scheduler           *scheduler.Scheduler

	Engine *gin.Engine
	Server *httptest.Server

	Seed *Seed
}

type harnessOptions struct {
	enableNative   bool
	enableOpenID   bool
	openIDIssuer   string
	openIDClientID string
	adminGroups    []string
	nativeUsername string
	nativePassword string

	shellUserLimit int
	shellTimeout   int64

	clabLogBacklog      int
	containerLogBacklog int
	shellLinesBacklog   int

	excludedInterfaces []string
	kindsConfig        string
	deploymentProvider config.DeploymentProvider
	captureEnabled     bool
	sshEnabled         bool

	seed          bool
	withScheduler bool
	devMode       bool

	configureProvider func(*deployment.DummyProvider)
}

// HarnessOption customises the harness before any service is constructed.
type HarnessOption func(*harnessOptions)

// WithoutSeed leaves the database empty apart from the native user row.
func WithoutSeed() HarnessOption {
	return func(o *harnessOptions) { o.seed = false }
}

// WithAuthMethods controls which authentication methods the server enables. Disabling both makes
// every request authenticate as the native admin.
func WithAuthMethods(native bool, openID bool) HarnessOption {
	return func(o *harnessOptions) {
		o.enableNative = native
		o.enableOpenID = openID
	}
}

// WithNativeCredentials sets the SB_NATIVE_* credentials. Passing empty strings exercises the
// "native auth enabled but unconfigured" path.
func WithNativeCredentials(username string, password string) HarnessOption {
	return func(o *harnessOptions) {
		o.nativeUsername = username
		o.nativePassword = password
	}
}

// WithOpenID points the auth manager at an OIDC issuer (see NewFakeOIDCProvider).
func WithOpenID(issuer string, clientID string, adminGroups ...string) HarnessOption {
	return func(o *harnessOptions) {
		o.enableOpenID = true
		o.openIDIssuer = issuer
		o.openIDClientID = clientID
		o.adminGroups = adminGroups
	}
}

// WithShellLimits sets the per-user shell limit and the inactivity timeout in seconds.
func WithShellLimits(userLimit int, timeout int64) HarnessOption {
	return func(o *harnessOptions) {
		o.shellUserLimit = userLimit
		o.shellTimeout = timeout
	}
}

// WithBacklogs sets the ring-buffer capacities for the log and shell streams.
func WithBacklogs(clabLog int, containerLog int, shellLines int) HarnessOption {
	return func(o *harnessOptions) {
		o.clabLogBacklog = clabLog
		o.containerLogBacklog = containerLog
		o.shellLinesBacklog = shellLines
	}
}

// WithExcludedInterfaces overrides the capture interface exclusion patterns.
func WithExcludedInterfaces(patterns ...string) HarnessOption {
	return func(o *harnessOptions) { o.excludedInterfaces = patterns }
}

// WithKindsConfig replaces the contents of the node kind configuration file.
func WithKindsConfig(contents string) HarnessOption {
	return func(o *harnessOptions) { o.kindsConfig = contents }
}

// WithDeploymentProvider sets the provider name reported by /server-config.
func WithDeploymentProvider(provider config.DeploymentProvider) HarnessOption {
	return func(o *harnessOptions) { o.deploymentProvider = provider }
}

// WithDevMode registers the development-only endpoints, as main.go does when started with -dev.
func WithDevMode() HarnessOption {
	return func(o *harnessOptions) { o.devMode = true }
}

// WithCaptureEnabled sets the capture flag reported by /server-config.
func WithCaptureEnabled(enabled bool) HarnessOption {
	return func(o *harnessOptions) { o.captureEnabled = enabled }
}

// WithSSHEnabled sets the SSH server flag reported by /server-config.
func WithSSHEnabled(enabled bool) HarnessOption {
	return func(o *harnessOptions) { o.sshEnabled = enabled }
}

// WithProvider configures the DummyProvider before any service is built. This matters because
// instance.CreateService runs its revive pass during construction.
func WithProvider(configure func(*deployment.DummyProvider)) HarnessOption {
	return func(o *harnessOptions) { o.configureProvider = configure }
}

// WithScheduler starts the lab scheduler loop, stopping it again when the test ends.
func WithScheduler() HarnessOption {
	return func(o *harnessOptions) { o.withScheduler = true }
}

//nolint:gocognit,maintidx // Wiring the whole service graph in dependency order is inherently linear.
func NewHarness(t *testing.T, options ...HarnessOption) *Harness {
	t.Helper()

	opts := &harnessOptions{
		enableNative:        true,
		enableOpenID:        false,
		nativeUsername:      "testuser",
		nativePassword:      "testpass",
		shellUserLimit:      20,
		shellTimeout:        1800,
		clabLogBacklog:      1000,
		containerLogBacklog: 1000,
		shellLinesBacklog:   1000,
		excludedInterfaces:  []string{"lo", "gway-*", "monit_in", "mgmt0*"},
		kindsConfig:         defaultKindsConfig,
		deploymentProvider:  config.Containerlab,
		captureEnabled:      true,
		sshEnabled:          true,
		seed:                true,
	}

	for _, option := range options {
		option(opts)
	}

	gin.SetMode(gin.TestMode)

	// Keep the service logs out of the test output unless something actually fails.
	charmlog.SetLevel(charmlog.FatalLevel)

	t.Setenv("SB_NATIVE_USERNAME", opts.nativeUsername)
	t.Setenv("SB_NATIVE_PASSWORD", opts.nativePassword)
	t.Setenv("SB_JWT_SECRET", "antimony-test-secret")
	t.Setenv("SB_OIDC_SECRET", "antimony-test-oidc-secret")

	tempDir := t.TempDir()

	kindsConfigPath := filepath.Join(tempDir, "kinds.conf.yml")
	require.NoError(t, os.WriteFile(kindsConfigPath, []byte(opts.kindsConfig), 0o600))

	cfg := &config.AntimonyConfig{
		Server: config.ServerConfig{Host: "127.0.0.1", Port: 0},
		Deployment: config.DeploymentConfig{
			Provider: opts.deploymentProvider,
		},
		Auth: config.AuthConfig{
			EnableNative:       opts.enableNative,
			EnableOpenID:       opts.enableOpenID,
			OpenIdIssuer:       opts.openIDIssuer,
			OpenIdClientID:     opts.openIDClientID,
			OpenIdRedirectHost: "http://127.0.0.1",
			OpenIdAdminGroups:  opts.adminGroups,
		},
		Shell: config.ShellConfig{
			UserLimit: opts.shellUserLimit,
			Timeout:   opts.shellTimeout,
		},
		SSH: config.SSHConfig{
			Enabled:    opts.sshEnabled,
			SSHHost:    "127.0.0.1",
			SSHPort:    6969,
			SSHKeyPath: filepath.Join(tempDir, "key"),
		},
		Capture: config.CaptureConfig{
			Enabled:            opts.captureEnabled,
			ExcludedInterfaces: opts.excludedInterfaces,
		},
		Streaming: config.StreamingConfig{
			ContainerLogBacklog: opts.containerLogBacklog,
			ClabLogBacklog:      opts.clabLogBacklog,
			ShellLinesBacklog:   opts.shellLinesBacklog,
		},
		FileSystem: config.FilesystemConfig{
			Storage: filepath.Join(tempDir, "storage"),
			Run:     filepath.Join(tempDir, "run"),
		},
		Containerlab: config.ClabConfig{
			// Empty so the schema service skips the network fetch and uses the local fallback.
			SchemaUrl:      "",
			SchemaFallback: repoFile(t, "data/clab.schema.json"),
			DeviceConfig:   repoFile(t, "data/device-config.json"),
			KindsConfig:    kindsConfigPath,
		},
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Discard,
	})
	require.NoError(t, err)

	require.NoError(t, db.AutoMigrate(
		&user.User{},
		&collection.Collection{},
		&topology.Topology{},
		&topology.BindFile{},
		&lab.Lab{},
	))

	var (
		authManager    = auth.CreateManager(cfg)
		socketManager  = socket.CreateManager(authManager)
		storageManager = storage.CreateManager(cfg)
		provider       = deployment.CreateDummyProvider()
	)

	if opts.configureProvider != nil {
		opts.configureProvider(provider)
	}

	labEventBus := utils.CreateEventBus[*lab.Lab]()
	startupEvents := recordLabEvents(t, labEventBus, labEventTopics...)

	statusMessages := socket.CreateOutputNamespace[statusmessage.Message](
		socketManager, false, nil, false, nil, "status-messages",
	)

	var (
		labRepo        = lab.CreateRepository(db)
		userRepo       = user.CreateRepository(db)
		topologyRepo   = topology.CreateRepository(db)
		collectionRepo = collection.CreateRepository(db)
	)

	var (
		deviceService       = device.CreateService(cfg)
		schemaService       = schema.CreateService(cfg)
		serverConfigService = serverconfig.CreateService(cfg)
		userService         = user.CreateService(userRepo, authManager)
		collectionService   = collection.CreateService(collectionRepo, userRepo)

		topologyService = topology.CreateService(
			topologyRepo, userRepo, collectionRepo, schemaService, storageManager,
		)

		labService = lab.CreateService(
			labRepo, userRepo, topologyRepo, schemaService, topologyService,
			storageManager, cfg, labEventBus, statusMessages,
		)
	)

	h := &Harness{
		T:                   t,
		Config:              cfg,
		DB:                  db,
		Storage:             storageManager,
		Auth:                authManager,
		Sockets:             socketManager,
		Provider:            provider,
		LabEventBus:         labEventBus,
		StatusMessages:      statusMessages,
		StartupEvents:       startupEvents,
		LabRepo:             labRepo,
		UserRepo:            userRepo,
		TopologyRepo:        topologyRepo,
		CollectionRepo:      collectionRepo,
		LabService:          labService,
		UserService:         userService,
		SchemaService:       schemaService,
		DeviceService:       deviceService,
		TopologyService:     topologyService,
		CollectionService:   collectionService,
		ServerConfigService: serverConfigService,
	}

	// Seed before the instance service is built: its revive pass reads the labs out of the database
	// and cross-references them against the provider's view of the world.
	if opts.seed {
		h.Seed = h.seedFixtures()
	} else {
		h.Seed = h.seedUsersOnly()
	}

	// The runtime services must come after seeding for the same reason.
	h.InstanceService = instance.CreateService(
		cfg, schemaService, labRepo, topologyService, storageManager,
		socketManager, labEventBus, statusMessages, provider,
	)
	t.Cleanup(h.InstanceService.Close)

	h.ShellService = shell.CreateService(cfg, labRepo, h.InstanceService, socketManager, provider)
	t.Cleanup(h.ShellService.Close)

	labService.SetRuntimeInfo(h.InstanceService)

	commands.CreateHandler(h.ShellService, h.InstanceService, socketManager)

	if opts.withScheduler {
		h.Scheduler = scheduler.CreateScheduler(cfg, h.InstanceService, labEventBus)
		t.Cleanup(h.Scheduler.Close)

		go h.Scheduler.Run()
	}

	// Mirrors main.go: the revive pass runs only once every event bus subscriber is in place.
	h.InstanceService.Revive()

	h.Engine = h.buildEngine(opts.devMode)
	h.Server = httptest.NewServer(h.Engine)

	t.Cleanup(h.Server.Close)
	t.Cleanup(func() { socketManager.Server().Close(nil) })

	return h
}

func (h *Harness) buildEngine(devMode bool) *gin.Engine {
	var (
		labHandler          = labtransport.CreateHandler(h.LabService, h.InstanceService)
		userHandler         = usertransport.CreateHandler(h.UserService)
		deviceHandler       = devicetransport.CreateHandler(h.DeviceService)
		schemaHandler       = schematransport.CreateHandler(h.SchemaService)
		topologyHandler     = topologytransport.CreateHandler(h.TopologyService)
		collectionHandler   = collectiontransport.CreateHandler(h.CollectionService)
		serverConfigHandler = serverconfigtransport.CreateHandler(h.ServerConfigService)
	)

	// main.go uses gin.Default(), which installs Logger and Recovery. Recovery matters here: it is
	// what turns a panic in a handler into a 500 rather than taking the process down, so the
	// harness has to have it to be representative.
	engine := gin.New()
	engine.Use(gin.Recovery())

	usertransport.RegisterRoutes(engine, userHandler)
	if devMode {
		usertransport.RegisterDevRoutes(engine, userHandler, h.Auth)
	}
	schematransport.RegisterRoutes(engine, schemaHandler)

	labtransport.RegisterRoutes(engine, labHandler, h.Auth)
	devicetransport.RegisterRoutes(engine, deviceHandler, h.Auth)
	topologytransport.RegisterRoutes(engine, topologyHandler, h.Auth)
	collectiontransport.RegisterRoutes(engine, collectionHandler, h.Auth)
	serverconfigtransport.RegisterRoutes(engine, serverConfigHandler, h.Auth)

	serverOpts := socketio.DefaultServerOptions()
	engine.GET("/socket.io/*any", gin.WrapH(h.Sockets.Server().ServeHandler(serverOpts)))
	engine.POST("/socket.io/*any", gin.WrapH(h.Sockets.Server().ServeHandler(serverOpts)))

	return engine
}

/*
 * Authentication helpers.
 */

// Token registers an authenticated user with the auth manager and returns a signed access token.
func (h *Harness) Token(authUser auth.AuthenticatedUser) string {
	h.T.Helper()

	_, err := h.Auth.RegisterTestUser(authUser)
	require.NoError(h.T, err)

	token, err := h.Auth.CreateAccessToken(authUser)
	require.NoError(h.T, err)

	return token
}

// UnregisteredToken returns a correctly signed access token for a user the auth manager has never
// seen. The signature verifies but the lookup fails, which is the 498 path.
func (h *Harness) UnregisteredToken(userId string) string {
	h.T.Helper()

	token, err := h.Auth.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      userId,
		IsAdmin:     false,
		Collections: []string{},
	})
	require.NoError(h.T, err)

	return token
}

// RefreshToken returns a long-lived auth token (the one the refresh endpoint consumes).
func (h *Harness) RefreshToken(userId string) string {
	h.T.Helper()

	token, err := h.Auth.CreateAuthToken(userId)
	require.NoError(h.T, err)

	return token
}

/*
 * Lab event bus recording.
 */

// LabEvent is one observed publication on the lab event bus.
type LabEvent struct {
	Topic string
	LabId string
}

// LabEventRecorder collects lab event bus publications for assertions.
type LabEventRecorder struct {
	mu     sync.Mutex
	events []LabEvent
}

// labEventTopics is every topic the lab event bus carries.
var labEventTopics = []string{
	"lab.created",
	"lab.moved",
	"lab.deleted",
	"lab.manually-deployed",
	"lab.restored",
}

// RecordLabEvents subscribes to the lab event bus and records everything published to it until the
// test ends. With no topics given it listens on all of them.
func (h *Harness) RecordLabEvents(topics ...string) *LabEventRecorder {
	h.T.Helper()

	if len(topics) == 0 {
		topics = labEventTopics
	}

	return recordLabEvents(h.T, h.LabEventBus, topics...)
}

func recordLabEvents(
	t *testing.T,
	bus *utils.EventBus[*lab.Lab],
	topics ...string,
) *LabEventRecorder {
	t.Helper()

	recorder := &LabEventRecorder{events: make([]LabEvent, 0)}

	for _, topic := range topics {
		subscribed := topic

		unsubscribe := bus.Subscribe(subscribed, func(eventLab *lab.Lab) {
			labId := ""
			if eventLab != nil {
				labId = eventLab.UUID
			}

			recorder.mu.Lock()
			recorder.events = append(recorder.events, LabEvent{Topic: subscribed, LabId: labId})
			recorder.mu.Unlock()
		})

		t.Cleanup(unsubscribe)
	}

	return recorder
}

// Events returns every recorded event in publication order.
func (r *LabEventRecorder) Events() []LabEvent {
	r.mu.Lock()
	defer r.mu.Unlock()

	out := make([]LabEvent, len(r.events))
	copy(out, r.events)

	return out
}

// Topics returns the topic of every recorded event, in order.
func (r *LabEventRecorder) Topics() []string {
	events := r.Events()

	topics := make([]string, 0, len(events))
	for _, event := range events {
		topics = append(topics, event.Topic)
	}

	return topics
}

// Count reports how many times a topic was published.
func (r *LabEventRecorder) Count(topic string) int {
	count := 0

	for _, event := range r.Events() {
		if event.Topic == topic {
			count++
		}
	}

	return count
}

// LabIdsFor returns the lab IDs published on a topic, in order.
func (r *LabEventRecorder) LabIdsFor(topic string) []string {
	ids := make([]string, 0)

	for _, event := range r.Events() {
		if event.Topic == topic {
			ids = append(ids, event.LabId)
		}
	}

	return ids
}

/*
 * Runtime helpers.
 */

// DeployLab deploys a seeded lab straight through the instance service, bypassing the socket command
// layer. Useful for HTTP tests that need a lab to be in the running state.
func (h *Harness) DeployLab(labId string) {
	h.T.Helper()

	instanceLab, err := h.LabRepo.GetByUuid(h.T.Context(), labId)
	require.NoError(h.T, err)
	require.NoError(h.T, h.InstanceService.DeployLab(instanceLab))
	require.True(h.T, h.InstanceService.IsRunning(labId), "expected lab %q to be running", labId)
}

// DestroyLab tears a running lab down through the instance service.
func (h *Harness) DestroyLab(labId string) {
	h.T.Helper()

	instanceLab, err := h.LabRepo.GetByUuid(h.T.Context(), labId)
	require.NoError(h.T, err)
	require.NoError(h.T, h.InstanceService.DestroyLab(instanceLab))
}

/*
 * Misc helpers.
 */

// repoFile resolves a path relative to the repository root, so tests do not depend on the working
// directory the test binary happens to run in.
func repoFile(t *testing.T, relative string) string {
	t.Helper()

	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok, "failed to locate the test source file")

	// <repo>/src/test/harness_test.go -> <repo>
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..")

	path := filepath.Join(repoRoot, relative)
	_, err := os.Stat(path)
	require.NoErrorf(t, err, "expected repository file %q to exist", relative)

	return path
}

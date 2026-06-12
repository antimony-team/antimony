package main

import (
	"antimonyBackend/auth"
	"antimonyBackend/capture"
	"antimonyBackend/config"
	"antimonyBackend/deployment"
	_ "antimonyBackend/docs"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/device"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/serverconfig"
	"antimonyBackend/domain/statusmessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/runtime/instance"
	"antimonyBackend/runtime/scheduler"
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
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/joho/godotenv"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	socketio "github.com/zishang520/socket.io/socket"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

//	@Title		Antimony API
//	@Version	1.0
//	@Desciption	The Antimony API that connects to containerlab.

//	@Contact.name	Institute for Networking at OST
//	@Contact.url	https://www.ost.ch/en/research-and-consulting-services/computer-science/ins-institute-for-network-and-security
//	@Contact.email	antimony@network.garden

//	@BasePath	/

// @securityDefinitions.basic	BasicAuth
func main() {
	// Load environment variables from .env file if present
	_ = godotenv.Load()

	cmdArgs := utils.ParseArguments()
	isDevMode := *cmdArgs.DevelopmentMode

	log.SetTimeFormat("[2006-01-02 15:04:05]")

	if isDevMode {
		log.SetReportCaller(true)
	}

	antimonyConfig := config.Load(*cmdArgs.ConfigFile)

	// Infrastructure components
	db := connectToDatabase(*cmdArgs.UseLocalDatabase, antimonyConfig)
	authManager := auth.CreateManager(antimonyConfig)
	socketManager := socket.CreateManager(authManager)
	storageManager := storage.CreateManager(antimonyConfig)
	deploymentProvider := deployment.CreateProvider(antimonyConfig)

	// The lab event bus allows communication of runtime and domain components with the scheduler.
	//
	// Supported Events:
	//  - lab.created           -> A new lab is created and put into the deployment and destruction queues.
	//  - lab.moved             -> A lab's start or end time has been changed, and it will be rescheduled accordingly.
	//  - lab.deleted           -> A lab is deleted and will be removed from the deployment and destruction queues.
	//  - lab.manually-deployed -> A lab has been manually deployed and will be moved from the deployment into the destruction queue.
	//  - lab.restored          -> A running lab has been restored and will be added to the destruction queue.
	labEventBus := utils.CreateEventBus[*lab.Lab]()

	// Global socket namespaces
	var (
		statusMessageNamespace = socket.CreateOutputNamespace[statusmessage.Message](
			socketManager, false, nil, false, nil, "status-messages",
		)
	)

	// Domain repository layer components
	var (
		labRepository        = lab.CreateRepository(db)
		userRepository       = user.CreateRepository(db)
		topologyRepository   = topology.CreateRepository(db)
		collectionRepository = collection.CreateRepository(db)
	)

	// Domain service layer components
	var (
		devicesService      = device.CreateService(antimonyConfig)
		schemaService       = schema.CreateService(antimonyConfig)
		serverConfigService = serverconfig.CreateService(antimonyConfig)
		userService         = user.CreateService(userRepository, authManager)
		collectionService   = collection.CreateService(collectionRepository, userRepository)

		topologyService = topology.CreateService(
			topologyRepository,
			userRepository,
			collectionRepository,
			schemaService,
			storageManager,
		)

		labService = lab.CreateService(
			antimonyConfig,
			labRepository,
			userRepository,
			topologyRepository,
			schemaService,
			topologyService,
			storageManager,
			labEventBus,
			statusMessageNamespace,
		)
	)

	// Runtime services and components
	var (
		instanceService = createRuntime(
			antimonyConfig,
			schemaService,
			labRepository,
			labService,
			topologyService,
			storageManager,
			socketManager,
			labEventBus,
			statusMessageNamespace,
			deploymentProvider,
		)

		labScheduler = scheduler.CreateScheduler(antimonyConfig, instanceService, labEventBus)
	)

	go labScheduler.Run()

	captureServer := capture.CreateServer(antimonyConfig, deploymentProvider)
	webServer := createWebServer(authManager,
		socketManager,
		serverConfigService,
		devicesService,
		schemaService,
		userService,
		collectionService,
		topologyService,
		labService,
		instanceService,
	)

	connection := fmt.Sprintf("%s:%d", antimonyConfig.Server.Host, antimonyConfig.Server.Port)

	var serverWaitGroup sync.WaitGroup
	serverWaitGroup.Add(2)

	go startCaptureServer(captureServer, &serverWaitGroup)
	go startWebServer(webServer, connection, &serverWaitGroup)

	time.Sleep(100 * time.Millisecond)

	log.Info("Antimony API is running and ready to serve calls!", "conn", connection)
	serverWaitGroup.Wait()
}

func createWebServer(
	authManager auth.Manager,
	socketManager socket.Manager,
	serverConfigService serverconfig.Service,
	devicesService device.Service,
	schemaService schema.Service,
	userService user.Service,
	collectionService collection.Service,
	topologyService topology.Service,
	labService lab.Service,
	instanceService instance.Service,
) *gin.Engine {
	var (
		labHandler          = labtransport.CreateHandler(labService, instanceService)
		userHandler         = usertransport.CreateHandler(userService)
		devicesHandler      = devicetransport.CreateHandler(devicesService)
		schemaHandler       = schematransport.CreateHandler(schemaService)
		topologyHandler     = topologytransport.CreateHandler(topologyService)
		collectionHandler   = collectiontransport.CreateHandler(collectionService)
		serverConfigHandler = serverconfigtransport.CreateHandler(serverConfigService)
	)

	gin.SetMode(gin.ReleaseMode)
	webServer := gin.Default()

	// Register public HTTP endpoints
	usertransport.RegisterRoutes(webServer, userHandler)
	schematransport.RegisterRoutes(webServer, schemaHandler)

	// Register authenticated HTTP endpoints
	labtransport.RegisterRoutes(webServer, labHandler, authManager)
	devicetransport.RegisterRoutes(webServer, devicesHandler, authManager)
	topologytransport.RegisterRoutes(webServer, topologyHandler, authManager)
	collectiontransport.RegisterRoutes(webServer, collectionHandler, authManager)
	serverconfigtransport.RegisterRoutes(webServer, serverConfigHandler, authManager)

	// Register Socket.IO endpoints in web server
	c := socketio.DefaultServerOptions()
	webServer.GET("/socket.io/*any", gin.WrapH(socketManager.Server().ServeHandler(c)))
	webServer.POST("/socket.io/*any", gin.WrapH(socketManager.Server().ServeHandler(c)))

	webServer.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	return webServer
}

func createRuntime(
	config *config.AntimonyConfig,
	schemaService schema.Service,
	labRepo lab.Repository,
	labService lab.Service,
	topologyService topology.Service,
	storageManager storage.Manager,
	socketManager socket.Manager,
	labEventBus utils.EventBus[*lab.Lab],
	statusMessageNamespace socket.OutputNamespace[statusmessage.Message],
	deploymentProvider deployment.DeploymentProvider,
) instance.Service {
	instanceService := instance.CreateService(
		config,
		schemaService,
		labRepo,
		topologyService,
		storageManager,
		socketManager,
		labEventBus,
		statusMessageNamespace,
		deploymentProvider,
	)

	instance.CreateHandler(instanceService, socketManager)

	// Wire instance service back to lab service through shared interface
	labService.SetRuntimeInfo(instanceService)

	return instanceService
}

func connectToDatabase(useLocalDatabase bool, config *config.AntimonyConfig) *gorm.DB {
	var (
		db  *gorm.DB
		err error
	)

	if useLocalDatabase {
		log.Info("Connecting to local SQLite database", "path", config.Database.LocalFile)
		if err := os.MkdirAll(filepath.Dir(config.Database.LocalFile), 0750); err != nil {
			log.Fatal("Failed to create database file", "path", config.Database.Database)
		}
		db, err = gorm.Open(sqlite.Open(config.Database.LocalFile), &gorm.Config{})
	} else {
		connection := fmt.Sprintf(
			"%s@%s:%d/%s",
			config.Database.User,
			config.Database.Host,
			config.Database.Port,
			config.Database.Database,
		)
		log.Info("Connecting to remote PostgreSQL database", "conn", connection)

		dsn := fmt.Sprintf(
			"host=%s user=%s password=%s dbname=%s port=%d",
			config.Database.Host,
			config.Database.User,
			os.Getenv("SB_DATABASE_PASSWORD"),
			config.Database.Database,
			config.Database.Port,
		)
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	}

	if err != nil {
		log.Fatalf("Failed to connect to database: %s", err.Error())
		os.Exit(1)
	}

	err = db.AutoMigrate(&lab.Lab{})
	if err != nil {
		log.Fatalf("Failed to migrate labs to database: %s", err.Error())
	}

	err = db.AutoMigrate(&user.User{})
	if err != nil {
		log.Fatalf("Failed to migrate users to database: %s", err.Error())
	}

	err = db.AutoMigrate(&topology.BindFile{})
	if err != nil {
		log.Fatalf("Failed to migrate bind files to database: %s", err.Error())
	}

	err = db.AutoMigrate(&topology.Topology{})
	if err != nil {
		log.Fatalf("Failed to migrate topologies to database: %s", err.Error())
	}

	err = db.AutoMigrate(&collection.Collection{})
	if err != nil {
		log.Fatalf("Failed to migrate collections to database: %s", err.Error())
	}

	return db
}

func startWebServer(server *gin.Engine, socket string, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()

	if err := server.Run(socket); err != nil {
		log.Errorf("Failed to start web server on %s: %s", socket, err.Error())
	}
}

func startCaptureServer(server capture.Server, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()

	if err := server.Start(); err != nil {
		log.Errorf("Failed to start capture service: %s", err.Error())
	}
}

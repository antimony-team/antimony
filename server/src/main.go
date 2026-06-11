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
	"antimonyBackend/domain/serverConfig"
	"antimonyBackend/domain/statusMessage"
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
	serverConfig2 "antimonyBackend/transport/http/serverConfig"
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

	db := connectToDatabase(*cmdArgs.UseLocalDatabase, antimonyConfig)

	authManager := auth.CreateAuthManager(antimonyConfig)
	socketManager := socket.CreateSocketManager(authManager)
	storageManager := storage.CreateStorageManager(antimonyConfig)
	deploymentProvider := deployment.GetProvider(antimonyConfig)
	captureService := capture.CreateService(antimonyConfig, deploymentProvider)

	labEventBus := utils.CreateEventBus[*lab.Lab]()

	statusMessageNamespace := socket.CreateOutputNamespace[statusMessage.StatusMessage](
		socketManager, false, nil, false, nil, "status-messages",
	)

	// Repository layer components
	var (
		userRepository       = user.CreateRepository(db)
		collectionRepository = collection.CreateRepository(db)
		topologyRepository   = topology.CreateRepository(db)
		labRepository        = lab.CreateRepository(db)
	)

	// Service layer components
	var (
		serverConfigService = serverConfig.CreateService(antimonyConfig)
		devicesService      = device.CreateService(antimonyConfig)
		schemaService       = schema.CreateService(antimonyConfig)
		userService         = user.CreateService(userRepository, authManager)
		collectionService   = collection.CreateService(collectionRepository, userRepository)
		topologyService     = topology.CreateService(
			topologyRepository, userRepository, collectionRepository, schemaService, storageManager,
		)
		labService = lab.CreateService(
			antimonyConfig, labRepository, userRepository, topologyRepository, schemaService,
			topologyService, storageManager, labEventBus, statusMessageNamespace,
		)
	)

	// Runtime services and components
	var (
		instanceService = instance.CreateService(
			antimonyConfig, schemaService, labRepository, topologyService, storageManager,
			socketManager, labEventBus, statusMessageNamespace, deploymentProvider,
		)
		_ = instance.CreateHandler(instanceService, socketManager)

		labScheduler = scheduler.CreateScheduler(antimonyConfig, instanceService, labEventBus)
	)

	labService.SetRuntimeInfo(instanceService)

	// HTTP Handlers
	var (
		serverConfigHandler = serverConfig2.CreateHandler(serverConfigService)
		devicesHandler      = devicetransport.CreateHandler(devicesService)
		schemaHandler       = schematransport.CreateHandler(schemaService)
		userHandler         = usertransport.CreateHandler(userService)
		collectionHandler   = collectiontransport.CreateHandler(collectionService)
		topologyHandler     = topologytransport.CreateHandler(topologyService)
		labHandler          = labtransport.CreateHandler(labService, instanceService)
	)

	go labScheduler.Run()

	go func() {
		if err := captureService.StartServer(); err != nil {
			log.Errorf("Failed to start capture service: %s", err.Error())
		}
	}()

	gin.SetMode(gin.ReleaseMode)
	webServer := gin.Default()

	// Public endpoints
	usertransport.RegisterRoutes(webServer, userHandler)
	schematransport.RegisterRoutes(webServer, schemaHandler)

	// Authenticated endpoints
	labtransport.RegisterRoutes(webServer, labHandler, authManager)
	devicetransport.RegisterRoutes(webServer, devicesHandler, authManager)
	topologytransport.RegisterRoutes(webServer, topologyHandler, authManager)
	collectiontransport.RegisterRoutes(webServer, collectionHandler, authManager)
	serverConfig2.RegisterRoutes(webServer, serverConfigHandler, authManager)

	// Register Socket.IO endpoints in web server
	c := socketio.DefaultServerOptions()
	webServer.GET("/socket.io/*any", gin.WrapH(socketManager.Server().ServeHandler(c)))
	webServer.POST("/socket.io/*any", gin.WrapH(socketManager.Server().ServeHandler(c)))

	webServer.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	var serverWaitGroup sync.WaitGroup
	connection := fmt.Sprintf("%s:%d", antimonyConfig.Server.Host, antimonyConfig.Server.Port)

	serverWaitGroup.Add(1)
	go startWebServer(webServer, connection, &serverWaitGroup)
	time.Sleep(100 * time.Millisecond)

	log.Info("Antimony API is ready to serve calls!", "conn", connection)
	serverWaitGroup.Wait()
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

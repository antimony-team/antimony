package main

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/device"
	"antimonyBackend/domain/instance"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"antimonyBackend/storage"
	"antimonyBackend/test"
	"antimonyBackend/utils"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	socketio "github.com/zishang520/socket.io/socket"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"os"
	"sync"
	"time"
)

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
	authManager := auth.CreateAuthManager(antimonyConfig)
	storageManager := storage.CreateStorageManager(antimonyConfig)

	db := connectToDatabase(*cmdArgs.UseLocalDatabase, antimonyConfig)
	test.GenerateTestData(db, storageManager)

	socketManager := socket.CreateSocketManager(authManager)

	statusMessageNamespace := socket.CreateNamespace[statusMessage.StatusMessage](socketManager, "status-messages", false)

	var (
		instanceService = instance.CreateService(antimonyConfig)

		devicesService = device.CreateService(antimonyConfig)
		devicesHandler = device.CreateHandler(devicesService)

		schemaService = schema.CreateService(antimonyConfig)
		schemaHandler = schema.CreateHandler(schemaService)

		userRepository = user.CreateRepository(db)
		userService    = user.CreateService(userRepository, authManager)
		userHandler    = user.CreateHandler(userService)

		collectionRepository = collection.CreateRepository(db)
		collectionService    = collection.CreateService(collectionRepository, userRepository)
		collectionHandler    = collection.CreateHandler(collectionService)

		topologyRepository = topology.CreateRepository(db)
		topologyService    = topology.CreateService(topologyRepository, userRepository, collectionRepository, storageManager, schemaService.Get())
		topologyHandler    = topology.CreateHandler(topologyService)

		labRepository = lab.CreateRepository(db)
		labService    = lab.CreateService(labRepository, userRepository, topologyRepository, instanceService, statusMessageNamespace)
		labHandler    = lab.CreateHandler(labService)
	)

	gin.SetMode(gin.ReleaseMode)
	webServer := gin.Default()

	// Public endpoints
	user.RegisterRoutes(webServer, userHandler)
	schema.RegisterRoutes(webServer, schemaHandler)
	device.RegisterRoutes(webServer, devicesHandler)

	// Authenticated endpoints
	lab.RegisterRoutes(webServer, labHandler, authManager)
	topology.RegisterRoutes(webServer, topologyHandler, authManager)
	collection.RegisterRoutes(webServer, collectionHandler, authManager)

	// Register Socket.IO endpoints
	c := socketio.DefaultServerOptions()
	webServer.GET("/socket.io/*any", gin.WrapH(socketManager.Server().ServeHandler(c)))
	webServer.POST("/socket.io/*any", gin.WrapH(socketManager.Server().ServeHandler(c)))

	var serverWaitGroup sync.WaitGroup
	connection := fmt.Sprintf("%s:%d", antimonyConfig.Server.Host, antimonyConfig.Server.Port)

	serverWaitGroup.Add(1)
	go startWebServer(webServer, connection, &serverWaitGroup)
	time.Sleep(100)

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

		err = os.Remove(config.Database.LocalFile)
		db, err = gorm.Open(sqlite.Open(config.Database.LocalFile), &gorm.Config{})
	} else {
		connection := fmt.Sprintf("%s@%s:%d/%s", config.Database.User, config.Database.Host, config.Database.Port, config.Database.Database)
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

	return db
}

func startWebServer(server *gin.Engine, socket string, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()

	if err := server.Run(socket); err != nil {
		log.Fatalf("Failed to start web server on %s: %s", socket, err.Error())
	}
}

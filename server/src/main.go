package main

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/core"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/device"
	"antimonyBackend/domain/instance"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/utils"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	socketio "github.com/googollee/go-socket.io"
	"github.com/joho/godotenv"
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
	storageManager := core.CreateStorageManager(antimonyConfig)

	db := connectToDatabase(*cmdArgs.UseLocalDatabase, antimonyConfig)
	loadTestData(db)

	socketServer := socketio.NewServer(nil)

	var (
		instanceService = instance.CreateService(antimonyConfig, socketServer)

		devicesService = device.CreateService(antimonyConfig)
		devicesHandler = device.CreateHandler(devicesService)

		schemaService = schema.CreateService(antimonyConfig)
		schemaHandler = schema.CreateHandler(schemaService)

		userRepository = user.CreateRepository(db)
		userService    = user.CreateService(userRepository, authManager)
		userHandler    = user.CreateHandler(userService)

		statusMessageRepository = statusMessage.CreateRepository(db)
		statusMessageService    = statusMessage.CreateService(statusMessageRepository, socketServer)
		statusMessageHandler    = statusMessage.CreateHandler(statusMessageService)

		collectionRepository = collection.CreateRepository(db)
		collectionService    = collection.CreateService(collectionRepository, userService)
		collectionHandler    = collection.CreateHandler(collectionService)

		topologyRepository = topology.CreateRepository(db)
		topologyService    = topology.CreateService(topologyRepository, collectionRepository, userService, storageManager, schemaService.Get())
		topologyHandler    = topology.CreateHandler(topologyService)

		labRepository = lab.CreateRepository(db)
		labService    = lab.CreateService(labRepository, topologyRepository, instanceService, userService)
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
	statusMessage.RegisterRoutes(webServer, statusMessageHandler, authManager)

	var serverWaitGroup sync.WaitGroup
	connection := fmt.Sprintf("%s:%d", antimonyConfig.Server.Host, antimonyConfig.Server.Port)

	go startWebServer(webServer, connection, &serverWaitGroup)
	go startSocketServer(socketServer, &serverWaitGroup)
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

func startSocketServer(socketServer *socketio.Server, waitGroup *sync.WaitGroup) {
	waitGroup.Add(1)
	defer waitGroup.Done()

	err := socketServer.Serve()
	if err != nil {
		log.Fatalf("Failed to start socket server: %s", err.Error())
	}
}

func startWebServer(server *gin.Engine, socket string, waitGroup *sync.WaitGroup) {
	waitGroup.Add(1)
	defer waitGroup.Done()

	if err := server.Run(socket); err != nil {
		log.Fatalf("Failed to start web server on %s: %s", socket, err.Error())
	}
}

func loadTestData(db *gorm.DB) {
	db.Exec("DROP TABLE IF EXISTS collections,labs,status_messages,topologies,user_status_messages,users")

	err := db.AutoMigrate(&user.User{})
	if err != nil {
		panic("Failed to migrate users")
	}

	err = db.AutoMigrate(&collection.Collection{})
	if err != nil {
		panic("Failed to migrate collections")
	}

	err = db.AutoMigrate(&topology.Topology{})
	if err != nil {
		panic("Failed to migrate topologies")
	}

	err = db.AutoMigrate(&lab.Lab{})
	if err != nil {
		panic("Failed to migrate labs")
	}

	err = db.AutoMigrate(&statusMessage.StatusMessage{})
	if err != nil {
		panic("Failed to migrate status messages")
	}

	user1 := user.User{
		UUID: utils.GenerateUuid(),
		Sub:  "doesntmatter",
		Name: "kian.gribi@ost.ch",
	}
	db.Create(&user1)

	collection1 := collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "hidden-group",
		PublicWrite:  true,
		PublicDeploy: false,
		Creator:      user1,
	}

	db.Create(&collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "fs25-cldinf",
		PublicWrite:  false,
		PublicDeploy: false,
		Creator:      user1,
	})

	db.Create(&collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "fs25-nisec",
		PublicWrite:  true,
		PublicDeploy: false,
		Creator:      user1,
	})

	db.Create(&collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "hs25-cn1",
		PublicWrite:  false,
		PublicDeploy: true,
		Creator:      user1,
	})

	db.Create(&collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "hs25-cn2",
		PublicWrite:  true,
		PublicDeploy: true,
		Creator:      user1,
	})

	db.Create(&collection1)

	db.Create(&topology.Topology{
		UUID:         utils.GenerateUuid(),
		GitSourceUrl: "",
		Collection:   collection1,
		Creator:      user1,
	})
}

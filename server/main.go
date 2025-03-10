package main

import (
	"antimonyBackend/src/auth"
	"antimonyBackend/src/config"
	"antimonyBackend/src/core"
	"antimonyBackend/src/domain/collection"
	"antimonyBackend/src/domain/instance"
	"antimonyBackend/src/domain/lab"
	"antimonyBackend/src/domain/schema"
	"antimonyBackend/src/domain/statusMessage"
	"antimonyBackend/src/domain/topology"
	"antimonyBackend/src/domain/user"
	"antimonyBackend/src/utils"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	socketio "github.com/googollee/go-socket.io"
	"github.com/joho/godotenv"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"os"
	"sync"
	"time"
)

func main() {
	_ = godotenv.Load()

	log.SetTimeFormat("[2006-01-02 15:04:05]")
	log.SetReportCaller(true)

	socketServer := socketio.NewServer(nil)

	antimonyConfig := config.Load()
	authManager := auth.CreateAuthManager(antimonyConfig)
	storageManager := core.CreateStorageManager(antimonyConfig)

	err := os.Remove(antimonyConfig.Database.LocalFile)
	db, err := gorm.Open(sqlite.Open(antimonyConfig.Database.LocalFile), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %s", err.Error())
	}

	loadTestData(db)

	var (
		instanceService = instance.CreateService(antimonyConfig, socketServer)
	)

	var (
		schemaService = schema.CreateService(antimonyConfig)
		schemaHandler = schema.CreateHandler(schemaService)
	)

	var (
		userRepository = user.CreateRepository(db)
		userService    = user.CreateService(userRepository, authManager)
		userHandler    = user.CreateHandler(userService)
	)

	var (
		statusMessageRepository = statusMessage.CreateRepository(db)
		statusMessageService    = statusMessage.CreateService(statusMessageRepository, socketServer)
		statusMessageHandler    = statusMessage.CreateHandler(statusMessageService)
	)

	var (
		collectionRepository = collection.CreateRepository(db)
		collectionService    = collection.CreateService(collectionRepository, userService)
		collectionHandler    = collection.CreateHandler(collectionService)
	)

	var (
		topologyRepository = topology.CreateRepository(db)
		topologyService    = topology.CreateService(topologyRepository, collectionRepository, userService, storageManager, schemaService.Get())
		topologyHandler    = topology.CreateHandler(topologyService)
	)

	var (
		labRepository = lab.CreateRepository(db)
		labService    = lab.CreateService(labRepository, topologyRepository, instanceService, userService)
		labHandler    = lab.CreateHandler(labService)
	)

	gin.SetMode(gin.ReleaseMode)
	webServer := gin.Default()

	// Public endpoints
	user.RegisterRoutes(webServer, userHandler)
	schema.RegisterRoutes(webServer, schemaHandler)

	// Authenticated endpoints
	lab.RegisterRoutes(webServer, labHandler, authManager)
	topology.RegisterRoutes(webServer, topologyHandler, authManager)
	collection.RegisterRoutes(webServer, collectionHandler, authManager)
	statusMessage.RegisterRoutes(webServer, statusMessageHandler, authManager)

	var serverGroup sync.WaitGroup
	serverGroup.Add(1)
	socket := fmt.Sprintf("%s:%d", antimonyConfig.Server.Host, antimonyConfig.Server.Port)

	webServer.GET("/devices", func(ctx *gin.Context) {
		ctx.JSON(utils.OkResponse(make([]string, 0)))
	})

	go startWebServer(webServer, socket, &serverGroup)
	go startSocketServer(socketServer, &serverGroup)

	time.Sleep(100)
	log.Info("Antimony API is ready to serve calls!", "conn", socket)
	serverGroup.Wait()
}

func startSocketServer(socketServer *socketio.Server, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()

	err := socketServer.Serve()
	if err != nil {
		log.Fatalf("Failed to start socket server: %s", err.Error())
	}
}

func startWebServer(server *gin.Engine, socket string, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()

	if err := server.Run(socket); err != nil {
		log.Fatalf("Failed to start web server on %s: %s", socket, err.Error())
	}
}

func loadTestData(db *gorm.DB) {
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
		Sub:  "1117",
		Name: "kian.gribi@ost.ch",
	}

	collection1 := collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "test1",
		PublicWrite:  true,
		PublicDeploy: false,
		Creator:      user1,
	}

	db.Create(&collection1)

	db.Create(&topology.Topology{
		UUID:         utils.GenerateUuid(),
		GitSourceUrl: "",
		Collection:   collection1,
		Creator:      user1,
	})
}

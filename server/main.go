package main

import (
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
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"sync"
	"time"
)

func main() {
	log.SetTimeFormat("[2006-01-02 15:04:05]")

	socketServer := socketio.NewServer(nil)

	antimonyConfig := config.Load()
	storageManager := core.CreateStorageManager(antimonyConfig)

	db, err := gorm.Open(sqlite.Open("test.db"), &gorm.Config{})
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
		userService    = user.CreateService(userRepository)
		userHandler    = user.CreateHandler(userService)
	)

	var (
		statusMessageRepository = statusMessage.CreateRepository(db)
		statusMessageService    = statusMessage.CreateService(statusMessageRepository, socketServer)
		statusMessageHandler    = statusMessage.CreateHandler(statusMessageService)
	)

	var (
		collectionRepository = collection.CreateRepository(db)
		collectionService    = collection.CreateService(collectionRepository)
		collectionHandler    = collection.CreateHandler(collectionService)
	)

	var (
		topologyRepository = topology.CreateRepository(db)
		topologyService    = topology.CreateService(topologyRepository, collectionRepository, storageManager, schemaService.Get())
		topologyHandler    = topology.CreateHandler(topologyService)
	)

	var (
		labRepository = lab.CreateRepository(db)
		labService    = lab.CreateService(labRepository, topologyRepository, instanceService)
		labHandler    = lab.CreateHandler(labService)
	)

	gin.SetMode(gin.ReleaseMode)
	webServer := gin.Default()

	lab.RegisterRoutes(webServer, labHandler)
	user.RegisterRoutes(webServer, userHandler)
	schema.RegisterRoutes(webServer, schemaHandler)
	topology.RegisterRoutes(webServer, topologyHandler)
	collection.RegisterRoutes(webServer, collectionHandler)
	statusMessage.RegisterRoutes(webServer, statusMessageHandler)

	var serverGroup sync.WaitGroup
	serverGroup.Add(1)
	socket := fmt.Sprintf("%s:%d", antimonyConfig.Server.Host, antimonyConfig.Server.Port)

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

	user1 := user.User{
		OpenID:  "123",
		Email:   "kian.gribi@ost.ch",
		IsAdmin: true,
	}

	collection1 := collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "test1",
		PublicEdit:   true,
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

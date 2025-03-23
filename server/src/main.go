package main

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/device"
	"antimonyBackend/domain/instance"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/storage"
	"antimonyBackend/test"
	"antimonyBackend/utils"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	socketio "github.com/googollee/go-socket.io"
	"github.com/joho/godotenv"
	"github.com/zishang520/socket.io/socket"
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

	//notificationEvent := events.CreateEvent[events.NotificationEventData]()

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
		labService    = lab.CreateService(labRepository, userRepository, topologyRepository, instanceService)
		labHandler    = lab.CreateHandler(labService)
	)

	gin.SetMode(gin.ReleaseMode)
	webServer := gin.Default()

	io := socket.NewServer(nil, nil)

	// Public endpoints
	user.RegisterRoutes(webServer, userHandler)
	schema.RegisterRoutes(webServer, schemaHandler)
	device.RegisterRoutes(webServer, devicesHandler)

	// Authenticated endpoints
	lab.RegisterRoutes(webServer, labHandler, authManager)
	topology.RegisterRoutes(webServer, topologyHandler, authManager)
	collection.RegisterRoutes(webServer, collectionHandler, authManager)

	//io.Of("/notifications", nil).On("connection", func(clients ...any) {
	//	log.Info("CONNECTED gmarlash")
	//	client := clients[0].(*socket.Socket)
	//	client.On("event", func(datas ...any) {
	//	})
	//
	//	client.On("disconnect", func(clients ...any) {
	//		log.Info("disconnected gmarlash")
	//	})
	//})
	//
	//fn := func(s *socket.Socket, ext func(*socket.ExtendedError)) {
	//	log.Infof("test: %+v", s.Handshake().Auth)
	//}

	//io.Use(fn)

	//socketServer.OnConnect("/", func(s socketio.Conn) error {
	//	s.SetContext("")
	//	log.Info("connected:", s.ID())
	//	return nil
	//})
	//
	//socketServer.OnEvent("/", "notice", func(s socketio.Conn, msg string) {
	//	log.Info("notice:", msg)
	//	s.Emit("reply", "have "+msg)
	//})
	//
	//socketServer.OnEvent("/chat", "msg", func(s socketio.Conn, msg string) string {
	//	s.SetContext(msg)
	//	return "recv " + msg
	//})
	//
	//socketServer.OnEvent("/", "bye", func(s socketio.Conn) string {
	//	last := s.Context().(string)
	//	s.Emit("bye", last)
	//	s.Close()
	//	return last
	//})
	//
	//socketServer.OnError("/", func(s socketio.Conn, e error) {
	//	log.Info("meet error:", e)
	//})
	//
	//socketServer.OnDisconnect("/", func(s socketio.Conn, reason string) {
	//	log.Info("closed", reason)
	//})

	//socketServer.OnConnect("/", func(s socketio.Conn) error {
	//	log.Info("client connected")
	//	fmt.Println("connected:", s.ID())
	//	//s.SetContext("")
	//	return nil
	//})
	//
	//socketServer.OnEvent("/", "connect", func(s socketio.Conn) error {
	//	fmt.Println("message:", s.ID())
	//	//s.SetContext("")
	//	return nil
	//})
	//
	//socketServer.OnEvent("/", "error", func(s socketio.Conn) error {
	//	fmt.Println("err:", s.ID())
	//	//s.SetContext("")
	//	return nil
	//})
	//
	//socketServer.OnEvent("/", "ping", func(s socketio.Conn) error {
	//	fmt.Println("ping:", s.ID())
	//	//s.SetContext("")
	//	return nil
	//})
	//
	//socketServer.OnError("/", func(s socketio.Conn, err error) {
	//	log.Infof("Socket erorr: %v, %+v", err, s.URL())
	//})
	//
	//socketServer.OnDisconnect("/", func(s socketio.Conn, msg string) {
	//	fmt.Println("disconnected:", s.ID())
	//	//s.SetContext("")
	//})

	//go func() {
	//	if err := socketServer.Serve(); err != nil {
	//		log.Fatalf("socketio listen error: %s\n", err)
	//	}
	//}()
	//defer socketServer.Close()
	//
	c := socket.DefaultServerOptions()
	webServer.GET("/socket.io/*any", gin.WrapH(io.ServeHandler(c)))
	webServer.POST("/socket.io/*any", gin.WrapH(io.ServeHandler(c)))

	//var serverWaitGroup sync.WaitGroup
	//connection := fmt.Sprintf("%s:%d", antimonyConfig.Server.Host, antimonyConfig.Server.Port)

	if err := webServer.Run(":3000"); err != nil {
		log.Fatal("failed run app: ", err)
	}

	//serverWaitGroup.Add(1)
	//go startSocketServer(socketServer, &serverWaitGroup)
	//go startWebServer(webServer, connection, &serverWaitGroup)
	time.Sleep(100)

	//log.Info("Antimony API is ready to serve calls!", "conn", connection)
	//serverWaitGroup.Wait()
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

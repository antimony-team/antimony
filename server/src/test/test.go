package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/device"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"log"
	"os"
	"testing"
	"time"
)

func GenerateTestData(db *gorm.DB, storage storage.StorageManager) {
	//db.Exec("DROP TABLE IF EXISTS collections,labs,status_messages,topologies,user_status_messages,users,bind_files")

	user1 := user.User{
		UUID: "test-user-id1",
		Sub:  "doesntmatter",
		Name: "Hans Hülsensack",
	}
	if err := db.Create(&user1).Error; err != nil {
		log.Fatalf("Create user1 failed: %v", err)
	}
	user2 := user.User{
		UUID: "test-user-id2",
		Sub:  "doesntmatter",
		Name: "Max Muster",
	}
	db.Create(&user2)
	user3 := user.User{
		UUID: "test-user-id3",
		Sub:  "irrelevant",
		Name: "Lu",
	}
	db.Create(&user3)
	user4 := user.User{
		UUID: "test-user-id4",
		Sub:  "irrelevant",
		Name: "Emergency Döner",
	}
	db.Create(&user4)
	user5 := user.User{
		UUID: "test-user-id5",
		Sub:  "irrelevant",
		Name: "Not Authenticated",
	}
	db.Create(&user5)

	db.Create(&collection.Collection{
		UUID:         utils.GenerateUuid(),
		Name:         "hidden-group",
		PublicWrite:  true,
		PublicDeploy: false,
		Creator:      user1,
	})

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

	collection1 := collection.Collection{
		UUID:         "CollectionTestUUID1",
		Name:         "hs25-cn2",
		PublicWrite:  true,
		PublicDeploy: true,
		Creator:      user1,
	}
	db.Create(&collection1)

	topology1Uuid := "TopologyTestUUID1"
	topology1 := topology.Topology{
		UUID:         topology1Uuid,
		Name:         "ctd",
		GitSourceUrl: "",
		Collection:   collection1,
		Creator:      user1,
	}
	if err := db.Create(&topology1).Error; err != nil {
		log.Fatalf("Create topology failed: %v", err)
	}

	db.Create(&topology.BindFile{
		UUID:       "BindFileTestUUID1",
		FilePath:   "leaf01/interfaces",
		Topology:   topology1,
		TopologyID: topology1.ID,
	})
	db.Create(&topology.BindFile{
		UUID:       utils.GenerateUuid(),
		FilePath:   "leaf01/daemons",
		Topology:   topology1,
		TopologyID: topology1.ID,
	})
	db.Create(&topology.BindFile{
		UUID:       utils.GenerateUuid(),
		FilePath:   "leaf01/frr.conf",
		Topology:   topology1,
		TopologyID: topology1.ID,
	})

	writeTopologyFile(topology1Uuid, cvx03, storage)
	writeBindFile(topology1Uuid, "leaf01/interfaces", "", storage)
	writeBindFile(topology1Uuid, "leaf01/daemons", "", storage)
	writeBindFile(topology1Uuid, "leaf01/frr.conf", "", storage)

	topology2Uuid := utils.GenerateUuid()
	topology2 := topology.Topology{
		UUID:         topology2Uuid,
		Name:         "test1",
		GitSourceUrl: "",
		Collection:   collection1,
		Creator:      user1,
	}
	db.Create(&topology2)
	writeTopologyFile(topology2Uuid, test1, storage)

	lab1 := lab.Lab{
		UUID:       "TestLabUUID1",
		Name:       "Test Lab",
		StartTime:  time.Now().Add(-1 * time.Hour),
		EndTime:    time.Now().Add(1 * time.Hour),
		TopologyID: topology1.ID,
		Topology:   topology1,
		CreatorID:  user1.ID,
		Creator:    user1,
	}
	db.Create(&lab1)
	lab2 := lab.Lab{
		UUID:       "TestLabUUID2",
		Name:       "Test Lab2",
		StartTime:  time.Now().Add(-1 * time.Hour),
		EndTime:    time.Now().Add(1 * time.Hour),
		TopologyID: topology1.ID,
		Topology:   topology1,
		CreatorID:  user1.ID,
		Creator:    user1,
	}
	db.Create(&lab2)
}

const test1 = `name: test1
topology:
  nodes:
    node1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux

    node2:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux

  links:
    - endpoints: ["node1:e1-1", "node2:e1-1"]`

const cvx03 = `name: ctd # Cumulus Linux Test Drive
topology:
  nodes:
    leaf01:
      kind: cvx
      image: networkop/cx:4.3.0
      binds:
        - leaf01/interfaces:/etc/network/interfaces
        - leaf01/daemons:/etc/frr/daemons
        - leaf01/frr.conf:/etc/frr/frr.conf

    leaf02:
      kind: cvx
      image: networkop/cx:4.3.0
      binds:
        - leaf02/interfaces:/etc/network/interfaces
        - leaf02/daemons:/etc/frr/daemons
        - leaf02/frr.conf:/etc/frr/frr.conf	

    spine01:
      kind: cvx
      image: networkop/cx:4.3.0
      binds:
        - spine01/interfaces:/etc/network/interfaces
        - spine01/daemons:/etc/frr/daemons
        - spine01/frr.conf:/etc/frr/frr.conf

    server01:
      kind: linux
      image: networkop/host:ifreload
      binds:
        - server01/interfaces:/etc/network/interfaces

    server02:
      kind: linux
      image: networkop/host:ifreload
      binds:
        - server02/interfaces:/etc/network/interfaces


  links:
    - endpoints: ["leaf01:swp1", "server01:eth1"]
    - endpoints: ["leaf01:swp2", "server02:eth1"]
    - endpoints: ["leaf02:swp1", "server01:eth2"]
    - endpoints: ["leaf02:swp2", "server02:eth2"]

    - endpoints: ["leaf01:swp49", "leaf02:swp49"]
    - endpoints: ["leaf01:swp50", "leaf02:swp50"]

    - endpoints: ["spine01:swp1", "leaf01:swp51"]
    - endpoints: ["spine01:swp2", "leaf02:swp51"]`

func writeTopologyFile(topologyId string, content string, storage storage.StorageManager) {
	if err := storage.WriteTopology(topologyId, content); err != nil {
		log.Fatalf("Failed to write test topology: %s", err.Error())
	}

	if err := storage.WriteMetadata(topologyId, content); err != nil {
		log.Fatalf("Failed to write test top ology: %s", err.Error())
	}
}

func writeBindFile(topologyId string, filePath string, content string, storage storage.StorageManager) {
	if err := storage.WriteBindFile(topologyId, filePath, content); err != nil {
		log.Fatalf("Failed to write test topology bind file: %s", err.Error())
	}
}

func addAuthenticatedUsers(authManager auth.AuthManager) {
	var err error

	_, err = authManager.RegisterTestUser(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group", "fs25-cldinf", "fs25-nisec", "hs25-cn1", "hs25-cn2"},
	})
	_, err = authManager.RegisterTestUser(auth.AuthenticatedUser{
		UserId:      "test-user-id2",
		IsAdmin:     true,
		Collections: []string{},
	})
	_, err = authManager.RegisterTestUser(auth.AuthenticatedUser{
		UserId:      "test-user-id3",
		IsAdmin:     false,
		Collections: []string{"hidden-group", "fs25-cldinf", "fs25-nisec", "hs25-cn1", "hs25-cn2"},
	})
	_, err = authManager.RegisterTestUser(auth.AuthenticatedUser{
		UserId:      "test-user-id4",
		IsAdmin:     false,
		Collections: []string{},
	})
	if err != nil {
		return
	}
}

func SetupTestServer(t *testing.T) (*gin.Engine, auth.AuthManager, *gorm.DB) {
	gin.SetMode(gin.TestMode)

	// Step 1: Set environment variables BEFORE creating auth manager
	_ = os.Setenv("SB_NATIVE_USERNAME", "testuser")
	_ = os.Setenv("SB_NATIVE_PASSWORD", "testpass")

	storageDir := t.TempDir()
	runDir := t.TempDir()
	// Step 2: Load config manually
	cfg := &config.AntimonyConfig{
		FileSystem: config.FilesystemConfig{
			Storage: storageDir,
			Run:     runDir,
		},
		Containerlab: config.ClabConfig{
			SchemaUrl:      "https://raw.githubusercontent.com/srl-labs/containerlab/refs/heads/main/schemas/clab.schema.json",
			SchemaFallback: "../../data/clab.schema.json",
			DeviceConfig:   "../../data/device-config.json",
		},
		Auth: config.AuthConfig{
			EnableNativeAdmin: true,
			OpenIdIssuer:      "",
			OpenIdClientId:    "",
			OpenIdAdminGroups: []string{},
		},
	}
	authManager := auth.CreateAuthManager(cfg)
	devicesService := device.CreateService(cfg)
	storageManager := storage.CreateStorageManager(cfg)
	schemaService := schema.CreateService(cfg)

	// Step 4: Setup in-memory DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	err = db.AutoMigrate(
		&user.User{},
		&collection.Collection{},
		&topology.Topology{},
		&topology.BindFile{},
		&lab.Lab{},
	)
	assert.NoError(t, err)

	// Step 5: Seed test data
	GenerateTestData(db, storageManager)

	// Step 6: Init repos, services, handlers
	socketManager := socket.CreateSocketManager(authManager)

	statusMessageNamespace := socket.CreateNamespace[statusMessage.StatusMessage](
		socketManager, false, false, nil,
		"status-messages",
	)

	userRepo := user.CreateRepository(db)
	userService := user.CreateService(userRepo, authManager)
	userHandler := user.CreateHandler(userService)

	devicesHandler := device.CreateHandler(devicesService)

	schemaHandler := schema.CreateHandler(schemaService)

	collectionRepo := collection.CreateRepository(db)
	collectionService := collection.CreateService(collectionRepo, userRepo)
	collectionHandler := collection.CreateHandler(collectionService)

	topologyRepository := topology.CreateRepository(db)
	topologyService := topology.CreateService(
		topologyRepository, userRepo, collectionRepo,
		storageManager, schemaService.Get(),
	)
	topologyHandler := topology.CreateHandler(topologyService)

	labRepository := lab.CreateRepository(db)
	labService := lab.CreateService(
		labRepository, userRepo, topologyRepository,
		storageManager, socketManager, statusMessageNamespace,
	)
	labHandler := lab.CreateHandler(labService)

	addAuthenticatedUsers(authManager)

	authManager.RegisterTestUser(auth.AuthenticatedUser{
		UserId:      auth.NativeUserID,
		IsAdmin:     true,
		Collections: []string{"hidden-group", "fs25-cldinf", "fs25-nisec", "hs25-cn1", "hs25-cn2"},
	})

	// Step 7: Setup Gin + register routes with real middleware
	router := gin.Default()
	collection.RegisterRoutes(router, collectionHandler, authManager)
	device.RegisterRoutes(router, devicesHandler, authManager)
	topology.RegisterRoutes(router, topologyHandler, authManager)
	schema.RegisterRoutes(router, schemaHandler)
	user.RegisterRoutes(router, userHandler)
	lab.RegisterRoutes(router, labHandler, authManager)
	return router, authManager, db
}

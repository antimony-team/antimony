package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"log"
	"testing"
)

func GenerateTestData(db *gorm.DB, storage storage.StorageManager) {
	//db.Exec("DROP TABLE IF EXISTS collections,labs,status_messages,topologies,user_status_messages,users,bind_files")

	user1 := user.User{
		UUID: "test-user-id1",
		Sub:  "doesntmatter",
		Name: "Hans Hülsensack",
	}
	db.Create(&user1)
	user2 := user.User{
		UUID: "test-user-id2",
		Sub:  "doesntmatter",
		Name: "Max Muster",
	}
	db.Create(&user2)
	user3 := user.User{
		UUID: "test-user-id3",
		Sub:  "irrelevant",
		Name: "Not Admin",
	}
	db.Create(&user3)

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
		UUID:         utils.GenerateUuid(),
		Name:         "hs25-cn2",
		PublicWrite:  true,
		PublicDeploy: true,
		Creator:      user1,
	}
	db.Create(&collection1)

	topology1Uuid := utils.GenerateUuid()
	topology1 := topology.Topology{
		UUID:         topology1Uuid,
		Name:         "ctd",
		GitSourceUrl: "",
		Collection:   collection1,
		Creator:      user1,
	}
	db.Create(&topology1)

	db.Create(&topology.BindFile{
		UUID:     utils.GenerateUuid(),
		FilePath: "leaf01/interfaces",
		Topology: topology1,
	})
	db.Create(&topology.BindFile{
		UUID:     utils.GenerateUuid(),
		FilePath: "leaf01/daemons",
		Topology: topology1,
	})
	db.Create(&topology.BindFile{
		UUID:     utils.GenerateUuid(),
		FilePath: "leaf01/frr.conf",
		Topology: topology1,
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
		log.Fatalf("Failed to write test topology: %s", err.Error())
	}
}

func writeBindFile(topologyId string, filePath string, content string, storage storage.StorageManager) {
	if err := storage.WriteBindFile(topologyId, filePath, content); err != nil {
		log.Fatalf("Failed to write test topology bind file: %s", err.Error())
	}
}

func SetupTestServer(t *testing.T) (*gin.Engine, *gorm.DB) {
	authUser := auth.AuthenticatedUser{
		IsAdmin:     true,
		UserId:      "test-user-id1",
		Collections: []string{"fs25-cldinf, fs25-nisec, hs25-cn1, hs25-cn2"},
	}
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	err = db.AutoMigrate(
		&user.User{},
		&collection.Collection{},
		&topology.Topology{},
		&topology.BindFile{},
	)
	assert.NoError(t, err)

	storageManager := CreateMockStorageManager()
	GenerateTestData(db, storageManager)

	userRepo := user.CreateRepository(db)
	collectionRepo := collection.CreateRepository(db)
	collectionService := collection.CreateService(collectionRepo, userRepo)
	collectionHandler := collection.CreateHandler(collectionService)

	router := gin.Default()
	authManager := MockAuthManager{User: authUser}

	collection.RegisterRoutes(router, collectionHandler, authManager)
	return router, db
}

func SetupTestServerWithUser(t *testing.T, testUser auth.AuthenticatedUser) (*gin.Engine, *gorm.DB) {

	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	err = db.AutoMigrate(&user.User{}, &collection.Collection{}, &topology.Topology{}, &topology.BindFile{})
	assert.NoError(t, err)

	storageManager := CreateMockStorageManager()
	GenerateTestData(db, storageManager)

	userRepo := user.CreateRepository(db)
	collectionRepo := collection.CreateRepository(db)
	collectionService := collection.CreateService(collectionRepo, userRepo)
	collectionHandler := collection.CreateHandler(collectionService)

	router := gin.Default()
	authManager := MockAuthManager{User: testUser}
	collection.RegisterRoutes(router, collectionHandler, authManager)

	return router, db
}

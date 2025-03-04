package main

import (
	"antimonyBackend/src/domain/collection"
	"antimonyBackend/src/domain/topology"
	"antimonyBackend/src/domain/user"
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"log"
)

func main() {
	db, err := gorm.Open(sqlite.Open("test.db"), &gorm.Config{})
	if err != nil {
		panic("failed to connect database")
	}

	loadTestData(db)

	var (
		userRepository = user.CreateRepository(db)
		userService    = user.CreateService(userRepository)
		userHandler    = user.CreateHandler(userService)
	)

	var (
		collectionRepository = collection.CreateRepository(db)
		collectionService    = collection.CreateService(collectionRepository)
		collectionHandler    = collection.CreateHandler(collectionService)
	)

	var (
		topologyRepository = topology.CreateRepository(db)
		topologyService    = topology.CreateService(topologyRepository, collectionRepository)
		topologyHandler    = topology.CreateHandler(topologyService)
	)

	server := gin.Default()

	user.RegisterResources(server, userHandler)
	topology.RegisterResources(server, topologyHandler)
	collection.RegisterResources(server, collectionHandler)

	if err := server.Run("localhost:3000"); err != nil {
		log.Fatalf("error running server: %v", err)
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
		Definition:   "",
		Metadata:     "",
		GitSourceUrl: "",
		Collection:   collection1,
		Creator:      user1,
	})
}

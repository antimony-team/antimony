package test

import (
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/lab"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"gorm.io/gorm"
	"log"
)

func GenerateTestData(db *gorm.DB, storage storage.StorageManager) {
	db.Exec("DROP TABLE IF EXISTS collections,labs,status_messages,topologies,user_status_messages,users,bind_files")

	err := db.AutoMigrate(&user.User{})
	if err != nil {
		panic("Failed to migrate users")
	}

	err = db.AutoMigrate(&collection.Collection{})
	if err != nil {
		panic("Failed to migrate collections")
	}

	err = db.AutoMigrate(&topology.BindFile{})
	if err != nil {
		panic("Failed to migrate bind files")
	}

	err = db.AutoMigrate(&topology.Topology{})
	if err != nil {
		panic("Failed to migrate topologies")
	}

	err = db.AutoMigrate(&lab.Lab{})
	if err != nil {
		panic("Failed to migrate labs")
	}

	user1 := user.User{
		UUID: utils.GenerateUuid(),
		Sub:  "doesntmatter",
		Name: "kian.gribi@ost.ch",
	}
	db.Create(&user1)

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
}

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

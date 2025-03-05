package topology

import (
	"antimonyBackend/src/core"
	"antimonyBackend/src/domain/collection"
	"antimonyBackend/src/domain/user"
	"antimonyBackend/src/utils"
	"encoding/json"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/xeipuuv/gojsonschema"
)

type (
	Service interface {
		Get(ctx *gin.Context) ([]TopologyOut, error)
		Create(ctx *gin.Context, req TopologyIn) (string, error)
		Update(ctx *gin.Context, req TopologyIn, topologyId string) error
		Delete(ctx *gin.Context, topologyId string) error
	}

	topologyService struct {
		topologyRepo   Repository
		collectionRepo collection.Repository
		storageManager core.StorageManager
		schemaLoader   gojsonschema.JSONLoader
	}
)

func CreateService(topologyRepo Repository, collectionRepo collection.Repository, storageManager core.StorageManager, clabSchema any) Service {
	return &topologyService{
		topologyRepo:   topologyRepo,
		collectionRepo: collectionRepo,
		storageManager: storageManager,
		schemaLoader:   gojsonschema.NewGoLoader(clabSchema),
	}
}

func (u *topologyService) Get(ctx *gin.Context) ([]TopologyOut, error) {
	topologies, err := u.topologyRepo.Get(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]TopologyOut, 0)
	for _, topology := range topologies {
		var (
			definition string
			metadata   string
		)

		if err := u.loadTopology(topology.UUID, &definition, &metadata); err != nil {
			log.Errorf("Failed to read definition of topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		result = append(result, TopologyOut{
			UUID:         topology.UUID,
			Definition:   definition,
			Metadata:     metadata,
			GitSourceUrl: topology.GitSourceUrl,
			CollectionId: topology.Collection.UUID,
			CreatorEmail: topology.Creator.Email,
		})
	}

	return result, err
}

func (u *topologyService) Create(ctx *gin.Context, req TopologyIn) (string, error) {
	topologyCollection, err := u.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return "", err
	}

	if err := u.validateTopology(req.Definition); err != nil {
		return "", err
	}

	if err := u.validateMetadata(req.Metadata); err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()

	if err := u.saveTopology(newUuid, req.Definition, req.Metadata); err != nil {
		return "", err
	}

	err = u.topologyRepo.Create(ctx, &Topology{
		UUID:         newUuid,
		GitSourceUrl: req.GitSourceUrl,
		Collection:   *topologyCollection,
		Creator:      user.User{},
	})

	return newUuid, err
}

func (u *topologyService) Update(ctx *gin.Context, req TopologyIn, topologyId string) error {
	topology, err := u.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	topologyCollection, err := u.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return err
	}

	if err := u.validateTopology(req.Definition); err != nil {
		return err
	}

	if err := u.validateMetadata(req.Metadata); err != nil {
		return err
	}

	if err := u.saveTopology(topology.UUID, req.Definition, req.Metadata); err != nil {
		return err
	}

	topology.GitSourceUrl = req.GitSourceUrl
	topology.Collection = *topologyCollection

	return u.topologyRepo.Update(ctx, topology)
}

func (u *topologyService) Delete(ctx *gin.Context, topologyId string) error {
	topology, err := u.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	return u.topologyRepo.Delete(ctx, topology)
}

func (u *topologyService) validateTopology(definition string) error {
	var definitionObj any

	if err := json.Unmarshal(([]byte)(definition), &definitionObj); err != nil {
		return utils.ErrorValidationError
	}

	if _, err := gojsonschema.Validate(u.schemaLoader, gojsonschema.NewGoLoader(definitionObj)); err != nil {
		return utils.ErrorValidationError
	}

	return nil
}

func (u *topologyService) validateMetadata(metadata string) error {
	// TODO: Implement
	return nil
}

func (u *topologyService) saveTopology(topologyId string, definition string, metadata string) error {
	definitionFile := getDefinitionFileName(topologyId)
	if err := u.storageManager.Write(definitionFile, definition); err != nil {
		log.Errorf("Failed to write topology definition to '%s': %s", definitionFile, err.Error())
		return err
	}

	metadataFile := getMetadataFileName(topologyId)
	if err := u.storageManager.Write(metadataFile, metadata); err != nil {
		log.Errorf("Failed to write typology metadata to '%s': %s", metadataFile, err.Error())
		return err
	}

	return nil
}

func (u *topologyService) loadTopology(topologyId string, definition *string, metadata *string) error {
	definitionFile := getDefinitionFileName(topologyId)
	if err := u.storageManager.Read(definitionFile, definition); err != nil {
		log.Errorf("Failed to read topology definition from '%s': %s", definitionFile, err.Error())
		return err
	}

	metadataFile := getMetadataFileName(topologyId)
	if err := u.storageManager.Read(metadataFile, metadata); err != nil {
		log.Errorf("Failed to read typology metadata from '%s': %s", metadataFile, err.Error())
		return err
	}

	return nil
}

func getDefinitionFileName(topologyId string) string {
	return fmt.Sprintf("%s.clab.yaml", topologyId)
}

func getMetadataFileName(topologyId string) string {
	return fmt.Sprintf("%s.meta", topologyId)
}

package topology

import (
	"antimonyBackend/auth"
	"antimonyBackend/core"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/user"
	"antimonyBackend/utils"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/xeipuuv/gojsonschema"
	"gopkg.in/yaml.v3"
	"maps"
	"slices"
)

type (
	Service interface {
		Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]TopologyOut, error)
		Create(ctx *gin.Context, req TopologyIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req TopologyIn, topologyId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, topologyId string, authUser auth.AuthenticatedUser) error
	}

	topologyService struct {
		topologyRepo   Repository
		collectionRepo collection.Repository
		userService    user.Service
		storageManager core.StorageManager
		schemaLoader   gojsonschema.JSONLoader
	}
)

func CreateService(topologyRepo Repository, collectionRepo collection.Repository, userService user.Service, storageManager core.StorageManager, clabSchema any) Service {
	return &topologyService{
		topologyRepo:   topologyRepo,
		collectionRepo: collectionRepo,
		userService:    userService,
		storageManager: storageManager,
		schemaLoader:   gojsonschema.NewGoLoader(clabSchema),
	}
}

func (u *topologyService) Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]TopologyOut, error) {
	var (
		topologies []Topology
		err        error
	)

	if authUser.IsAdmin {
		topologies, err = u.topologyRepo.GetAll(ctx)
	} else {
		topologies, err = u.topologyRepo.GetFromCollections(ctx, authUser.Collections)
	}
	if err != nil {
		return nil, err
	}

	result := make([]TopologyOut, 0)
	for _, topology := range topologies {
		var (
			definition string
			metadata   string
			bindFiles  map[string]string
			err        error
		)

		if definition, metadata, bindFiles, err = u.loadTopology(topology.UUID, topology.BindFiles); err != nil {
			log.Errorf("Failed to read definition of topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		result = append(result, TopologyOut{
			ID:           topology.UUID,
			Definition:   definition,
			Metadata:     metadata,
			GitSourceUrl: topology.GitSourceUrl,
			CollectionId: topology.Collection.UUID,
			BindFiles:    bindFiles,
			Creator:      u.userService.UserToOut(topology.Creator),
		})
	}

	return result, err
}

func (u *topologyService) Create(ctx *gin.Context, req TopologyIn, authUser auth.AuthenticatedUser) (string, error) {
	topologyCollection, err := u.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the target collection
	if !authUser.IsAdmin && (!topologyCollection.PublicWrite || !slices.Contains(authUser.Collections, topologyCollection.Name)) {
		return "", utils.ErrorNoWriteAccessToCollection
	}

	if err := u.validateTopology(req.Definition); err != nil {
		return "", err
	}
	if err := u.validateMetadata(req.Metadata); err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()

	if err := u.saveTopology(newUuid, req.Definition, req.Metadata, req.BindFiles); err != nil {
		return "", err
	}

	creatorUser, err := u.userService.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrorUnauthorized
	}

	err = u.topologyRepo.Create(ctx, &Topology{
		UUID:         newUuid,
		GitSourceUrl: req.GitSourceUrl,
		Collection:   *topologyCollection,
		BindFiles:    slices.Collect(maps.Keys(req.BindFiles)),
		Creator:      *creatorUser,
	})

	return newUuid, err
}

func (u *topologyService) Update(ctx *gin.Context, req TopologyIn, topologyId string, authUser auth.AuthenticatedUser) error {
	topology, err := u.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != topology.Creator.UUID {
		return utils.ErrorNoWriteAccessToTopology
	}

	topologyCollection, err := u.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to target collection
	if !authUser.IsAdmin && (!topologyCollection.PublicWrite || !slices.Contains(authUser.Collections, req.CollectionId)) {
		return utils.ErrorNoWriteAccessToCollection
	}

	if err := u.validateTopology(req.Definition); err != nil {
		return err
	}
	if err := u.validateMetadata(req.Metadata); err != nil {
		return err
	}

	if err := u.saveTopology(topology.UUID, req.Definition, req.Metadata, req.BindFiles); err != nil {
		return err
	}

	topology.GitSourceUrl = req.GitSourceUrl
	topology.Collection = *topologyCollection
	topology.BindFiles = slices.Collect(maps.Keys(req.BindFiles))
	
	return u.topologyRepo.Update(ctx, topology)
}

func (u *topologyService) Delete(ctx *gin.Context, topologyId string, authUser auth.AuthenticatedUser) error {
	topology, err := u.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != topology.Creator.UUID {
		return utils.ErrorNoWriteAccessToTopology
	}

	return u.topologyRepo.Delete(ctx, topology)
}

func (u *topologyService) validateTopology(definition string) error {
	var definitionObj any

	if err := yaml.Unmarshal(([]byte)(definition), &definitionObj); err != nil {
		return err
	}

	if _, err := gojsonschema.Validate(u.schemaLoader, gojsonschema.NewGoLoader(definitionObj)); err != nil {
		return err
	}

	return nil
}

func (u *topologyService) validateMetadata(metadata string) error {
	// TODO: Implement
	return nil
}

func (u *topologyService) saveTopology(topologyId string, definition string, metadata string, bindFiles map[string]string) error {
	if err := u.storageManager.WriteTopology(topologyId, definition); err != nil {
		log.Errorf("Failed to write topology definition for %s: %s", topologyId, err.Error())
		return err
	}

	if err := u.storageManager.WriteMetadata(topologyId, metadata); err != nil {
		log.Errorf("Failed to write typology metadata for %s: %s", topologyId, err.Error())
		return err
	}

	for filePath, fileContent := range bindFiles {
		if err := u.storageManager.WriteBindFile(topologyId, filePath, fileContent); err != nil {
			log.Errorf("Failed to write bind file '%s' for '%s': %s", filePath, topologyId, err.Error())
			return err
		}
	}

	return nil
}

func (u *topologyService) loadTopology(topologyId string, bindFilePaths []string) (string, string, map[string]string, error) {
	var definition, metadata string

	if err := u.storageManager.ReadTopology(topologyId, &definition); err != nil {
		log.Errorf("Failed to read topology definition for %s: %s", topologyId, err.Error())
		return "", "", nil, err
	}

	if err := u.storageManager.ReadMetadata(topologyId, &metadata); err != nil {
		log.Errorf("Failed to read typology metadata for %s: %s", topologyId, err.Error())
		return "", "", nil, err
	}

	bindFiles := make(map[string]string)
	for filePath := range bindFilePaths {
		var fileContent string
		if err := u.storageManager.ReadBindFile(topologyId, bindFilePaths[filePath], &fileContent); err != nil {
			log.Errorf("Failed to read bind file '%s' for '%s': %s", bindFilePaths[filePath], topologyId, err.Error())
			return "", "", nil, err
		}
		bindFiles[bindFilePaths[filePath]] = fileContent
	}

	return definition, metadata, bindFiles, nil
}

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
	"slices"
)

type (
	Service interface {
		Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]TopologyOut, error)
		Create(ctx *gin.Context, req TopologyIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req TopologyIn, topologyId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, topologyId string, authUser auth.AuthenticatedUser) error

		CreateBindFile(ctx *gin.Context, topologyId string, req BindFileIn, authUser auth.AuthenticatedUser) (string, error)
		UpdateBindFile(ctx *gin.Context, req BindFileIn, bindFileId string, authUser auth.AuthenticatedUser) error
		DeleteBindFile(ctx *gin.Context, bindFileId string, authUser auth.AuthenticatedUser) error
	}

	topologyService struct {
		topologyRepo   Repository
		collectionRepo collection.Repository
		userService    user.Service
		storageManager core.StorageManager
		schemaLoader   gojsonschema.JSONLoader
	}
)

func CreateService(
	topologyRepo Repository,
	collectionRepo collection.Repository,
	userService user.Service,
	storageManager core.StorageManager,
	clabSchema any,
) Service {
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
			definition   string
			metadata     string
			bindFilesOut []BindFileOut
			err          error
		)

		bindFiles, err := u.topologyRepo.GetBindFileForTopology(ctx, topology.UUID)
		if err != nil {
			log.Errorf("Failed to get bind files for topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		if definition, metadata, bindFilesOut, err = u.loadTopology(topology.UUID, *bindFiles); err != nil {
			log.Errorf("Failed to read definition of topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		result = append(result, TopologyOut{
			ID:           topology.UUID,
			Definition:   definition,
			Metadata:     metadata,
			GitSourceUrl: topology.GitSourceUrl,
			CollectionId: topology.Collection.UUID,
			Creator:      u.userService.UserToOut(topology.Creator),
			BindFiles:    bindFilesOut,
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

	// Don't allow duplicate topology names within the same collection
	topologyName := u.getNameFromDefinition(req.Definition)
	if nameExists, err := u.topologyRepo.DoesNameExist(ctx, topologyName, req.CollectionId); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrorTopologyExists
	}

	newUuid := utils.GenerateUuid()
	if err := u.saveTopology(newUuid, req.Definition, req.Metadata); err != nil {
		return "", err
	}

	creatorUser, err := u.userService.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrorUnauthorized
	}

	err = u.topologyRepo.Create(ctx, &Topology{
		UUID:         newUuid,
		Name:         topologyName,
		GitSourceUrl: req.GitSourceUrl,
		Collection:   *topologyCollection,
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
	if !authUser.IsAdmin && (!topologyCollection.PublicWrite && !slices.Contains(authUser.Collections, req.CollectionId)) {
		return utils.ErrorNoWriteAccessToCollection
	}

	if err := u.validateTopology(req.Definition); err != nil {
		return err
	}
	if err := u.validateMetadata(req.Metadata); err != nil {
		return err
	}

	// Don't allow duplicate topology names within the same collection
	topologyName := u.getNameFromDefinition(req.Definition)
	if nameExists, err := u.topologyRepo.DoesNameExist(ctx, topologyName, req.CollectionId); err != nil {
		return err
	} else if nameExists {
		return utils.ErrorTopologyExists
	}

	if err := u.saveTopology(topology.UUID, req.Definition, req.Metadata); err != nil {
		return err
	}

	topology.Name = u.getNameFromDefinition(req.Definition)
	topology.GitSourceUrl = req.GitSourceUrl
	topology.Collection = *topologyCollection

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

func (u *topologyService) saveTopology(topologyId string, definition string, metadata string) error {
	if err := u.storageManager.WriteTopology(topologyId, definition); err != nil {
		log.Errorf("Failed to write topology definition for %s: %s", topologyId, err.Error())
		return err
	}

	if err := u.storageManager.WriteMetadata(topologyId, metadata); err != nil {
		log.Errorf("Failed to write typology metadata for %s: %s", topologyId, err.Error())
		return err
	}

	return nil
}

func (u *topologyService) loadTopology(topologyId string, bindFiles []BindFile) (string, string, []BindFileOut, error) {
	var definition, metadata string

	if err := u.storageManager.ReadTopology(topologyId, &definition); err != nil {
		log.Errorf("Failed to read topology definition for %s: %s", topologyId, err.Error())
		return "", "", nil, err
	}

	if err := u.storageManager.ReadMetadata(topologyId, &metadata); err != nil {
		log.Errorf("Failed to read typology metadata for %s: %s", topologyId, err.Error())
		return "", "", nil, err
	}

	bindFilesOut := make([]BindFileOut, 0)
	for _, bindFile := range bindFiles {
		var fileContent string
		if err := u.storageManager.ReadBindFile(topologyId, bindFile.FilePath, &fileContent); err != nil {
			log.Errorf("Failed to read bind file '%s' for '%s': %s", bindFile.FilePath, topologyId, err.Error())
			return "", "", nil, err
		}
		bindFilesOut = append(bindFilesOut, u.topologyRepo.BindFileToOut(bindFile, fileContent))
	}

	return definition, metadata, bindFilesOut, nil
}

func (u *topologyService) CreateBindFile(ctx *gin.Context, topologyId string, req BindFileIn, authUser auth.AuthenticatedUser) (string, error) {
	bindFileTopology, err := u.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && bindFileTopology.Creator.UUID != authUser.UserId {
		return "", utils.ErrorNoWriteAccessToBindFile
	}

	// Don't allow duplicate bind file names within the same topology
	if nameExists, err := u.topologyRepo.DoesBindFilePathExist(ctx, req.FilePath, bindFileTopology.UUID); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrorBindFileExists
	}

	if err := u.saveBindFile(topologyId, req.FilePath, req.Content); err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()
	err = u.topologyRepo.CreateBindFile(ctx, &BindFile{
		UUID:     newUuid,
		FilePath: req.FilePath,
		Topology: *bindFileTopology,
	})

	return newUuid, err
}

func (u *topologyService) UpdateBindFile(ctx *gin.Context, req BindFileIn, bindFileId string, authUser auth.AuthenticatedUser) error {
	bindFile, err := u.topologyRepo.GetBindFileByUuid(ctx, bindFileId)
	if err != nil {
		return err
	}

	bindFileTopology, err := u.topologyRepo.GetByUuid(ctx, bindFile.Topology.UUID)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && authUser.UserId != bindFileTopology.Creator.UUID {
		return utils.ErrorNoWriteAccessToBindFile
	}

	// Don't allow duplicate bind file names within the same topology
	if nameExists, err := u.topologyRepo.DoesBindFilePathExist(ctx, req.FilePath, bindFileTopology.UUID); err != nil {
		return err
	} else if nameExists {
		return utils.ErrorBindFileExists
	}

	// Delete old file if file path has changed
	if bindFile.FilePath != req.FilePath {
		if err := u.removeBindFile(bindFileTopology.UUID, bindFile.FilePath); err != nil {
			log.Errorf("Failed to delete old bind file '%s': %s", bindFile.FilePath, err.Error())
		}
	}

	if err := u.saveBindFile(bindFileTopology.UUID, req.FilePath, req.Content); err != nil {
		return err
	}

	bindFile.FilePath = req.FilePath

	return u.topologyRepo.UpdateBindFile(ctx, bindFile)
}

func (u *topologyService) DeleteBindFile(ctx *gin.Context, bindFileId string, authUser auth.AuthenticatedUser) error {
	bindFile, err := u.topologyRepo.GetBindFileByUuid(ctx, bindFileId)
	if err != nil {
		return err
	}

	bindFileTopology, err := u.topologyRepo.GetByUuid(ctx, bindFile.Topology.UUID)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && authUser.UserId != bindFileTopology.Creator.UUID {
		return utils.ErrorNoWriteAccessToBindFile
	}

	if err := u.removeBindFile(bindFileTopology.UUID, bindFile.FilePath); err != nil {
		log.Errorf("Failed to delete bind file '%s': %s", bindFile.FilePath, err.Error())
	}

	return u.topologyRepo.DeleteBindFile(ctx, bindFile)
}

func (u *topologyService) removeBindFile(topologyId string, filePath string) error {
	if err := u.storageManager.DeleteBindFile(topologyId, filePath); err != nil {
		log.Errorf("Failed to delete bind file '%s' for '%s': %s", filePath, topologyId, err.Error())
		return err
	}

	return nil
}

func (u *topologyService) saveBindFile(topologyId string, filePath string, fileContent string) error {
	if err := u.storageManager.WriteBindFile(topologyId, filePath, fileContent); err != nil {
		log.Errorf("Failed to write bind file '%s' for '%s': %s", filePath, topologyId, err.Error())
		return err
	}

	return nil
}

func (u *topologyService) getNameFromDefinition(definitionString string) string {
	var topologyDefinition struct {
		Name string `yaml:"name"`
	}
	_ = yaml.Unmarshal([]byte(definitionString), &topologyDefinition)

	return topologyDefinition.Name
}

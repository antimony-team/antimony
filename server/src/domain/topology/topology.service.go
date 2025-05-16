package topology

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/user"
	"antimonyBackend/storage"
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
		userRepo       user.Repository
		collectionRepo collection.Repository
		storageManager storage.StorageManager
		schemaLoader   gojsonschema.JSONLoader
	}
)

func CreateService(
	topologyRepo Repository,
	userRepo user.Repository,
	collectionRepo collection.Repository,
	storageManager storage.StorageManager,
	clabSchema any,
) Service {
	return &topologyService{
		topologyRepo:   topologyRepo,
		userRepo:       userRepo,
		collectionRepo: collectionRepo,
		storageManager: storageManager,
		schemaLoader:   gojsonschema.NewGoLoader(clabSchema),
	}
}

func (s *topologyService) Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]TopologyOut, error) {
	var (
		topologies []Topology
		err        error
	)

	if authUser.IsAdmin {
		topologies, err = s.topologyRepo.GetAll(ctx)
	} else {
		topologies, err = s.topologyRepo.GetFromCollections(ctx, authUser.Collections)
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

		bindFiles, err := s.topologyRepo.GetBindFileForTopology(ctx, topology.UUID)
		if err != nil {
			log.Errorf("Failed to get bind files for topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		if definition, metadata, bindFilesOut, err = s.loadTopology(topology.UUID, *bindFiles); err != nil {
			log.Errorf("Failed to read definition of topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		result = append(result, TopologyOut{
			ID:               topology.UUID,
			Definition:       definition,
			Metadata:         metadata,
			GitSourceUrl:     topology.GitSourceUrl,
			CollectionId:     topology.Collection.UUID,
			Creator:          s.userRepo.UserToOut(topology.Creator),
			BindFiles:        bindFilesOut,
			LastDeployFailed: topology.LastDeployFailed,
		})
	}

	return result, err
}

func (s *topologyService) Create(ctx *gin.Context, req TopologyIn, authUser auth.AuthenticatedUser) (string, error) {
	topologyCollection, err := s.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the target collection
	if !authUser.IsAdmin && (!topologyCollection.PublicWrite || !slices.Contains(authUser.Collections, topologyCollection.Name)) {
		return "", utils.ErrorNoWriteAccessToCollection
	}

	if err := s.validateTopology(req.Definition); err != nil {
		return "", err
	}
	if err := s.validateMetadata(req.Metadata); err != nil {
		return "", err
	}

	// Don't allow duplicate topology names within the same collection
	topologyName := s.getNameFromDefinition(req.Definition)
	if topologies, err := s.topologyRepo.GetByName(ctx, topologyName, req.CollectionId); err != nil {
		return "", err
	} else if len(topologies) > 0 {
		return "", utils.ErrorTopologyExists
	}

	newUuid := utils.GenerateUuid()
	if err := s.saveTopology(newUuid, req.Definition, req.Metadata); err != nil {
		return "", err
	}

	creatorUser, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrorUnauthorized
	}

	err = s.topologyRepo.Create(ctx, &Topology{
		UUID:             newUuid,
		Name:             topologyName,
		GitSourceUrl:     req.GitSourceUrl,
		Collection:       *topologyCollection,
		Creator:          *creatorUser,
		LastDeployFailed: false,
	})

	return newUuid, err
}

func (s *topologyService) Update(ctx *gin.Context, req TopologyIn, topologyId string, authUser auth.AuthenticatedUser) error {
	topology, err := s.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != topology.Creator.UUID {
		return utils.ErrorNoWriteAccessToTopology
	}

	topologyCollection, err := s.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to target collection
	if !authUser.IsAdmin && (!topologyCollection.PublicWrite && !slices.Contains(authUser.Collections, req.CollectionId)) {
		return utils.ErrorNoWriteAccessToCollection
	}

	if err := s.validateTopology(req.Definition); err != nil {
		return err
	}
	if err := s.validateMetadata(req.Metadata); err != nil {
		return err
	}

	// Don't allow duplicate topology names within the same collection
	if topologyName := s.getNameFromDefinition(req.Definition); topologyName != topology.Name {
		if topologies, err := s.topologyRepo.GetByName(ctx, topologyName, req.CollectionId); err != nil {
			return err
		} else if len(topologies) > 0 {
			return utils.ErrorTopologyExists
		}
	}

	if err := s.saveTopology(topology.UUID, req.Definition, req.Metadata); err != nil {
		return err
	}

	topology.Name = s.getNameFromDefinition(req.Definition)
	topology.GitSourceUrl = req.GitSourceUrl
	topology.Collection = *topologyCollection

	return s.topologyRepo.Update(ctx, topology)
}

func (s *topologyService) Delete(ctx *gin.Context, topologyId string, authUser auth.AuthenticatedUser) error {
	topology, err := s.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != topology.Creator.UUID {
		return utils.ErrorNoWriteAccessToTopology
	}

	return s.topologyRepo.Delete(ctx, topology)
}

func (s *topologyService) validateTopology(definition string) error {
	var definitionObj any

	if err := yaml.Unmarshal(([]byte)(definition), &definitionObj); err != nil {
		return err
	}

	if _, err := gojsonschema.Validate(s.schemaLoader, gojsonschema.NewGoLoader(definitionObj)); err != nil {
		return err
	}

	return nil
}

func (s *topologyService) validateMetadata(metadata string) error {
	// TODO: Implement
	return nil
}

func (s *topologyService) saveTopology(topologyId string, definition string, metadata string) error {
	if err := s.storageManager.WriteTopology(topologyId, definition); err != nil {
		log.Errorf("Failed to write topology definition for %s: %s", topologyId, err.Error())
		return err
	}

	if err := s.storageManager.WriteMetadata(topologyId, metadata); err != nil {
		log.Errorf("Failed to write typology metadata for %s: %s", topologyId, err.Error())
		return err
	}

	return nil
}

func (s *topologyService) loadTopology(topologyId string, bindFiles []BindFile) (string, string, []BindFileOut, error) {
	var definition, metadata string

	if err := s.storageManager.ReadTopology(topologyId, &definition); err != nil {
		log.Errorf("Failed to read topology definition for %s: %s", topologyId, err.Error())
		return "", "", nil, err
	}

	if err := s.storageManager.ReadMetadata(topologyId, &metadata); err != nil {
		log.Errorf("Failed to read typology metadata for %s: %s", topologyId, err.Error())
		return "", "", nil, err
	}

	bindFilesOut := make([]BindFileOut, 0)
	for _, bindFile := range bindFiles {
		var fileContent string
		if err := s.storageManager.ReadBindFile(topologyId, bindFile.FilePath, &fileContent); err != nil {
			log.Errorf("Failed to read bind file '%s' for '%s': %s", bindFile.FilePath, topologyId, err.Error())
			return "", "", nil, err
		}
		bindFilesOut = append(bindFilesOut, s.topologyRepo.BindFileToOut(bindFile, fileContent))
	}

	return definition, metadata, bindFilesOut, nil
}

func (s *topologyService) CreateBindFile(ctx *gin.Context, topologyId string, req BindFileIn, authUser auth.AuthenticatedUser) (string, error) {
	bindFileTopology, err := s.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && bindFileTopology.Creator.UUID != authUser.UserId {
		return "", utils.ErrorNoWriteAccessToBindFile
	}

	// Don't allow duplicate bind file names within the same topology
	if nameExists, err := s.topologyRepo.DoesBindFilePathExist(ctx, req.FilePath, bindFileTopology.UUID); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrorBindFileExists
	}

	if err := s.saveBindFile(topologyId, req.FilePath, req.Content); err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()
	err = s.topologyRepo.CreateBindFile(ctx, &BindFile{
		UUID:     newUuid,
		FilePath: req.FilePath,
		Topology: *bindFileTopology,
	})

	return newUuid, err
}

func (s *topologyService) UpdateBindFile(ctx *gin.Context, req BindFileIn, bindFileId string, authUser auth.AuthenticatedUser) error {
	bindFile, err := s.topologyRepo.GetBindFileByUuid(ctx, bindFileId)
	if err != nil {
		return err
	}

	bindFileTopology, err := s.topologyRepo.GetByUuid(ctx, bindFile.Topology.UUID)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && authUser.UserId != bindFileTopology.Creator.UUID {
		return utils.ErrorNoWriteAccessToBindFile
	}

	// Don't allow duplicate bind file names within the same topology
	if nameExists, err := s.topologyRepo.DoesBindFilePathExist(ctx, req.FilePath, bindFileTopology.UUID); err != nil {
		return err
	} else if nameExists {
		return utils.ErrorBindFileExists
	}

	// Delete old file if file path has changed
	if bindFile.FilePath != req.FilePath {
		if err := s.removeBindFile(bindFileTopology.UUID, bindFile.FilePath); err != nil {
			log.Errorf("Failed to delete old bind file '%s': %s", bindFile.FilePath, err.Error())
		}
	}

	if err := s.saveBindFile(bindFileTopology.UUID, req.FilePath, req.Content); err != nil {
		return err
	}

	bindFile.FilePath = req.FilePath

	return s.topologyRepo.UpdateBindFile(ctx, bindFile)
}

func (s *topologyService) DeleteBindFile(ctx *gin.Context, bindFileId string, authUser auth.AuthenticatedUser) error {
	bindFile, err := s.topologyRepo.GetBindFileByUuid(ctx, bindFileId)
	if err != nil {
		return err
	}

	bindFileTopology, err := s.topologyRepo.GetByUuid(ctx, bindFile.Topology.UUID)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && authUser.UserId != bindFileTopology.Creator.UUID {
		return utils.ErrorNoWriteAccessToBindFile
	}

	if err := s.removeBindFile(bindFileTopology.UUID, bindFile.FilePath); err != nil {
		log.Errorf("Failed to delete bind file '%s': %s", bindFile.FilePath, err.Error())
	}

	return s.topologyRepo.DeleteBindFile(ctx, bindFile)
}

func (s *topologyService) removeBindFile(topologyId string, filePath string) error {
	if err := s.storageManager.DeleteBindFile(topologyId, filePath); err != nil {
		log.Errorf("Failed to delete bind file '%s' for '%s': %s", filePath, topologyId, err.Error())
		return err
	}

	return nil
}

func (s *topologyService) saveBindFile(topologyId string, filePath string, fileContent string) error {
	if err := s.storageManager.WriteBindFile(topologyId, filePath, fileContent); err != nil {
		log.Errorf("Failed to write bind file '%s' for '%s': %s", filePath, topologyId, err.Error())
		return err
	}

	return nil
}

func (s *topologyService) getNameFromDefinition(definitionString string) string {
	var topologyDefinition struct {
		Name string `yaml:"name"`
	}
	_ = yaml.Unmarshal([]byte(definitionString), &topologyDefinition)

	return topologyDefinition.Name
}

package topology

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/user"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"context"
	"slices"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

type Service struct {
	repo           *Repository
	userRepo       *user.Repository
	collectionRepo *collection.Repository

	schemaService  *schema.Service
	storageManager *storage.Manager
}

func CreateService(
	repo *Repository,
	userRepo *user.Repository,
	collectionRepo *collection.Repository,
	schemaService *schema.Service,
	storageManager *storage.Manager,
) *Service {
	return &Service{
		repo:           repo,
		userRepo:       userRepo,
		collectionRepo: collectionRepo,
		schemaService:  schemaService,
		storageManager: storageManager,
	}
}

func (s *Service) Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]TopologyFull, error) {
	var (
		topologies []Topology
		err        error
	)

	if authUser.IsAdmin {
		topologies, err = s.repo.GetAll(ctx)
	} else {
		topologies, err = s.repo.GetFromCollections(ctx, authUser.Collections)
	}

	if err != nil {
		return nil, err
	}
	result := make([]TopologyFull, 0)
	for _, topology := range topologies {
		var (
			definition    string
			bindFilesFull []BindFileFull
		)

		bindFiles, err := s.repo.GetBindFileForTopology(ctx, topology.UUID)
		if err != nil {
			log.Errorf("Failed to get bind files for topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		if definition, bindFilesFull, err = s.LoadTopology(topology.UUID, bindFiles); err != nil {
			log.Errorf("Failed to read definition of topology '%s': %s", topology.UUID, err.Error())
			continue
		}

		result = append(result, TopologyFull{
			ID:               topology.UUID,
			Definition:       definition,
			SyncUrl:          topology.SyncUrl,
			Collection:       topology.Collection,
			Creator:          topology.Creator,
			BindFiles:        bindFilesFull,
			LastDeployFailed: topology.LastDeployFailed,
		})
	}

	return result, err
}

func (s *Service) GetByUuid(
	ctx *gin.Context,
	labId string,
	authUser auth.AuthenticatedUser,
) (*TopologyFull, error) {
	var (
		topology      *Topology
		definition    string
		bindFilesFull []BindFileFull
		err           error
	)
	if topology, err = s.repo.GetByUuid(ctx, labId); err != nil {
		return nil, err
	}

	// Deny request if user doesn't have access to the specified topology (Return generic not found error)
	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, topology.Collection.Name) {
		return nil, utils.ErrUuidNotFound
	}

	bindFiles, err := s.repo.GetBindFileForTopology(ctx, topology.UUID)
	if err != nil {
		log.Errorf("Failed to get bind files for topology '%s': %s", topology.UUID, err.Error())
		return nil, utils.ErrInvalidTopology
	}

	if definition, bindFilesFull, err = s.LoadTopology(topology.UUID, bindFiles); err != nil {
		log.Errorf("Failed to read definition of topology '%s': %s", topology.UUID, err.Error())
		return nil, utils.ErrInvalidTopology
	}

	result := &TopologyFull{
		ID:               topology.UUID,
		Definition:       definition,
		SyncUrl:          topology.SyncUrl,
		Collection:       topology.Collection,
		Creator:          topology.Creator,
		BindFiles:        bindFilesFull,
		LastDeployFailed: topology.LastDeployFailed,
	}

	return result, err
}

func (s *Service) Create(ctx *gin.Context, req TopologyIn, authUser auth.AuthenticatedUser) (string, error) {
	topologyCollection, err := s.collectionRepo.GetByUuid(ctx, *req.CollectionId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the target collection
	if !authUser.IsAdmin &&
		(!topologyCollection.PublicWrite || !slices.Contains(authUser.Collections, topologyCollection.Name)) {
		return "", utils.ErrNoWriteAccessToCollection
	}

	if _, err := s.schemaService.Parse(*req.Definition); err != nil {
		return "", err
	}

	// Don't allow duplicate topology names within the same collection
	topologyName := s.getNameFromDefinition(*req.Definition)
	if topologies, err := s.repo.GetByName(ctx, topologyName, *req.CollectionId); err != nil {
		return "", err
	} else if len(topologies) > 0 {
		return "", utils.ErrTopologyExists
	}

	newUuid := utils.GenerateUuid()
	if err := s.saveTopology(newUuid, *req.Definition); err != nil {
		return "", err
	}

	creatorUser, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrUnauthorized
	}

	err = s.repo.Create(ctx, &Topology{
		UUID:             newUuid,
		Name:             topologyName,
		SyncUrl:          *req.SyncUrl,
		Collection:       *topologyCollection,
		Creator:          *creatorUser,
		LastDeployFailed: false,
	})

	return newUuid, err
}

func (s *Service) Update(
	ctx *gin.Context,
	req TopologyInPartial,
	topologyId string,
	authUser auth.AuthenticatedUser,
) error {
	topology, err := s.repo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != topology.Creator.UUID {
		return utils.ErrNoWriteAccessToTopology
	}

	// Deny request if user does not have access to topology's collection
	if !authUser.IsAdmin &&
		(!topology.Collection.PublicWrite || !slices.Contains(authUser.Collections, topology.Collection.Name)) {
		return utils.ErrNoWriteAccessToCollection
	}

	topologyCollection := topology.Collection
	topologyName := topology.Name

	if req.CollectionId != nil {
		newCollection, err := s.collectionRepo.GetByUuid(ctx, *req.CollectionId)
		if err != nil {
			return err
		}

		// Deny change of a collection if the user does not have access to the new collection
		if !authUser.IsAdmin &&
			(!newCollection.PublicWrite || !slices.Contains(authUser.Collections, newCollection.Name)) {
			return utils.ErrNoWriteAccessToCollection
		}

		topologyCollection = *newCollection
	}

	if req.Definition != nil {
		if _, err := s.schemaService.Parse(*req.Definition); err != nil {
			return err
		}

		topologyName = s.getNameFromDefinition(*req.Definition)
	}

	// Don't allow duplicate topology names within the same collection
	if topologyName != topology.Name {
		if topologies, err := s.repo.GetByName(ctx, topologyName, topologyCollection.UUID); err != nil {
			return err
		} else if len(topologies) > 0 {
			return utils.ErrTopologyExists
		}
	}

	if req.Definition != nil {
		if err := s.saveTopology(topology.UUID, *req.Definition); err != nil {
			return err
		}
	}

	topology.Name = topologyName
	topology.Collection = topologyCollection

	if req.SyncUrl != nil {
		topology.SyncUrl = *req.SyncUrl
	}

	return s.repo.Update(ctx, topology)
}

func (s *Service) Delete(ctx *gin.Context, topologyId string, authUser auth.AuthenticatedUser) error {
	topology, err := s.repo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != topology.Creator.UUID {
		return utils.ErrNoWriteAccessToTopology
	}

	return s.repo.Delete(ctx, topology)
}

func (s *Service) CreateBindFile(
	ctx *gin.Context,
	topologyId string,
	req BindFileIn,
	authUser auth.AuthenticatedUser,
) (string, error) {
	bindFileTopology, err := s.repo.GetByUuid(ctx, topologyId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && bindFileTopology.Creator.UUID != authUser.UserId {
		return "", utils.ErrNoWriteAccessToBindFile
	}

	// Don't allow duplicate bind file names within the same topology
	if nameExists, err := s.repo.DoesBindFilePathExist(
		ctx,
		*req.FilePath,
		bindFileTopology.UUID,
		"",
	); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrBindFileExists
	}

	if err := s.saveBindFile(topologyId, *req.FilePath, *req.Content); err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()
	err = s.repo.CreateBindFile(ctx, &BindFile{
		UUID:     newUuid,
		FilePath: *req.FilePath,
		Topology: *bindFileTopology,
	})

	return newUuid, err
}

func (s *Service) UpdateBindFile(
	ctx *gin.Context,
	req BindFileInPartial,
	bindFileUuid string,
	authUser auth.AuthenticatedUser,
) error {
	bindFile, err := s.repo.GetBindFileByUuid(ctx, bindFileUuid)
	if err != nil {
		return err
	}

	bindFileTopology, err := s.repo.GetByUuid(ctx, bindFile.Topology.UUID)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && authUser.UserId != bindFileTopology.Creator.UUID {
		return utils.ErrNoWriteAccessToBindFile
	}

	bindFilePath := bindFile.FilePath

	if req.FilePath != nil {
		// Don't allow duplicate bind file names within the same topology
		if nameExists, err := s.repo.DoesBindFilePathExist(
			ctx,
			*req.FilePath,
			bindFileTopology.UUID,
			bindFileUuid,
		); err != nil {
			return err
		} else if nameExists {
			return utils.ErrBindFileExists
		}

		// Delete the old file if the file path has changed
		if bindFile.FilePath != *req.FilePath {
			if err := s.removeBindFile(bindFileTopology.UUID, bindFile.FilePath); err != nil {
				log.Errorf("Failed to delete old bind file '%s': %s", bindFile.FilePath, err.Error())
			}
		}

		bindFilePath = *req.FilePath
	}

	var bindFileContent string
	if req.Content != nil {
		bindFileContent = *req.Content
	} else {
		bindFileOut, err := s.loadBindFile(bindFileTopology.UUID, *bindFile)
		if err != nil {
			return err
		}

		bindFileContent = bindFileOut.Content
	}

	if err := s.saveBindFile(bindFileTopology.UUID, bindFilePath, bindFileContent); err != nil {
		return err
	}

	bindFile.FilePath = bindFilePath

	return s.repo.UpdateBindFile(ctx, bindFile)
}

func (s *Service) DeleteBindFile(ctx *gin.Context, bindFileId string, authUser auth.AuthenticatedUser) error {
	bindFile, err := s.repo.GetBindFileByUuid(ctx, bindFileId)
	if err != nil {
		return err
	}

	bindFileTopology, err := s.repo.GetByUuid(ctx, bindFile.Topology.UUID)
	if err != nil {
		return err
	}

	// Deny request if user does not have access to the owning topology
	if !authUser.IsAdmin && authUser.UserId != bindFileTopology.Creator.UUID {
		return utils.ErrNoWriteAccessToBindFile
	}

	if err := s.removeBindFile(bindFileTopology.UUID, bindFile.FilePath); err != nil {
		log.Errorf("Failed to delete bind file '%s': %s", bindFile.FilePath, err.Error())
	}

	return s.repo.DeleteBindFile(ctx, bindFile)
}

func (s *Service) saveTopology(topologyId string, definition string) error {
	if err := s.storageManager.WriteTopology(topologyId, definition); err != nil {
		log.Errorf("Failed to write topology definition for %s: %s", topologyId, err.Error())
		return err
	}

	return nil
}

func (s *Service) LoadTopology(topologyId string, bindFiles []BindFile) (string, []BindFileFull, error) {
	var definition string

	if err := s.storageManager.ReadTopology(topologyId, &definition); err != nil {
		log.Errorf("Failed to read topology definition for %s: %s", topologyId, err.Error())
		return "", nil, err
	}

	bindFilesFull := make([]BindFileFull, 0)
	for _, bindFile := range bindFiles {
		bindFileOut, err := s.loadBindFile(topologyId, bindFile)
		if err != nil {
			return "", nil, err
		}

		bindFilesFull = append(bindFilesFull, *bindFileOut)
	}

	return definition, bindFilesFull, nil
}

func (s *Service) SetLastDeployFailed(ctx context.Context, topology *Topology, hasFailed bool) {
	topology.LastDeployFailed = hasFailed
	err := s.repo.Update(ctx, topology)

	if err != nil {
		log.Error("Failed to set last deployment failed on topology", "topo", topology.UUID)
	}
}

func (s *Service) loadBindFile(topologyId string, bindFile BindFile) (*BindFileFull, error) {
	var fileContent string
	if err := s.storageManager.ReadBindFile(topologyId, bindFile.FilePath, &fileContent); err != nil {
		log.Errorf("Failed to read bind file '%s' for '%s': %s", bindFile.FilePath, topologyId, err.Error())
		return nil, err
	}

	bindFileFull := &BindFileFull{
		ID:       bindFile.UUID,
		FilePath: bindFile.FilePath,
		Content:  fileContent,
		Topology: bindFile.Topology,
	}

	return bindFileFull, nil
}

func (s *Service) removeBindFile(topologyId string, filePath string) error {
	if err := s.storageManager.DeleteBindFile(topologyId, filePath); err != nil {
		log.Errorf("Failed to delete bind file '%s' for '%s': %s", filePath, topologyId, err.Error())
		return err
	}

	return nil
}

func (s *Service) saveBindFile(topologyId string, filePath string, fileContent string) error {
	if err := s.storageManager.WriteBindFile(topologyId, filePath, fileContent); err != nil {
		log.Errorf("Failed to write bind file '%s' for '%s': %s", filePath, topologyId, err.Error())
		return err
	}

	return nil
}

func (s *Service) getNameFromDefinition(definitionString string) string {
	var topologyDefinition struct {
		Name string `yaml:"name"`
	}
	_ = yaml.Unmarshal([]byte(definitionString), &topologyDefinition)

	return topologyDefinition.Name
}

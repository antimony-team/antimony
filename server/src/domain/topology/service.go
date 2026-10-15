package topology

import (
	"context"
	"slices"

	"github.com/charmbracelet/log"
	"github.com/samber/lo"

	"github.com/antimony-team/antimony-server/auth"
	"github.com/antimony-team/antimony-server/clabtypes"
	"github.com/antimony-team/antimony-server/domain/collection"
	"github.com/antimony-team/antimony-server/domain/schema"
	"github.com/antimony-team/antimony-server/domain/user"
	"github.com/antimony-team/antimony-server/policy"
	"github.com/antimony-team/antimony-server/storage"
	"github.com/antimony-team/antimony-server/utils"
)

type Service struct {
	repo           *Repository
	userRepo       *user.Repository
	collectionRepo *collection.Repository

	schemaService  *schema.Service
	storageManager *storage.Manager

	policyEngine *policy.Engine
}

func CreateService(
	repo *Repository,
	userRepo *user.Repository,
	collectionRepo *collection.Repository,
	schemaService *schema.Service,
	storageManager *storage.Manager,
	policyEngine *policy.Engine,
) *Service {
	return &Service{
		repo:           repo,
		userRepo:       userRepo,
		collectionRepo: collectionRepo,
		schemaService:  schemaService,
		storageManager: storageManager,
		policyEngine:   policyEngine,
	}
}

func (s *Service) Get(ctx context.Context, authUser auth.AuthenticatedUser) ([]TopologyFull, error) {
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

	result := lo.FilterMap(topologies, func(topology Topology, index int) (TopologyFull, bool) {
		if topologyFull, err := s.createTopologyFull(ctx, &topology); err != nil {
			return TopologyFull{}, false
		} else {
			return *topologyFull, true
		}
	})

	return result, nil
}

func (s *Service) GetByUuid(
	ctx context.Context,
	labId string,
	authUser auth.AuthenticatedUser,
) (*TopologyFull, error) {
	var (
		topology *Topology
		err      error
	)
	if topology, err = s.repo.GetByUuid(ctx, labId); err != nil {
		return nil, err
	}

	// Deny request if user doesn't have access to the specified topology (Return generic not found error)
	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, topology.Collection.Name) {
		return nil, utils.ErrNoAccessToTopology
	}

	return s.createTopologyFull(ctx, topology)
}

func (s *Service) Create(ctx context.Context, req TopologyIn, authUser auth.AuthenticatedUser) (string, error) {
	topologyCollection, err := s.collectionRepo.GetByUuid(ctx, *req.CollectionId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the target collection
	if !authUser.IsAdmin &&
		(!topologyCollection.PublicWrite || !slices.Contains(authUser.Collections, topologyCollection.Name)) {
		return "", utils.ErrNoWriteAccessToCollection
	}

	var definition clabtypes.TopologyDefinition
	if err = s.schemaService.Parse(*req.Definition, &definition, new(any)); err != nil {
		return "", err
	}

	if _, err := s.schemaService.ParseAnnotations(*req.Annotations); err != nil {
		return "", err
	}

	// Don't allow duplicate topology names within the same collection
	if topologies, err := s.repo.GetByName(ctx, definition.Name, *req.CollectionId); err != nil {
		return "", err
	} else if len(topologies) > 0 {
		return "", utils.ErrTopologyNameExists
	}

	newUuid := utils.GenerateUuid()
	if err := s.saveTopology(newUuid, req.Definition, req.Annotations); err != nil {
		return "", err
	}

	creatorUser, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrUnauthorized
	}

	err = s.repo.Create(ctx, &Topology{
		UUID:             newUuid,
		Name:             definition.Name,
		SyncUrl:          *req.SyncUrl,
		Collection:       *topologyCollection,
		Creator:          *creatorUser,
		LastDeployFailed: false,
	})

	return newUuid, err
}

func (s *Service) Update(
	ctx context.Context,
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
		var definition clabtypes.TopologyDefinition
		if err := s.schemaService.Parse(*req.Definition, &definition, new(any)); err != nil {
			return err
		} else {
			topologyName = definition.Name
		}
	}

	if req.Annotations != nil {
		if _, err := s.schemaService.ParseAnnotations(*req.Annotations); err != nil {
			return err
		}
	}

	// Don't allow duplicate topology names within the same collection
	if topologyName != topology.Name || topologyCollection.ID != topology.Collection.ID {
		if topologies, err := s.repo.GetByName(ctx, topologyName, topologyCollection.UUID); err != nil {
			return err
		} else if len(topologies) > 0 {
			return utils.ErrTopologyNameExists
		}
	}

	if req.Definition != nil || req.Annotations != nil {
		if err := s.saveTopology(topology.UUID, req.Definition, req.Annotations); err != nil {
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

func (s *Service) Delete(ctx context.Context, topologyId string, authUser auth.AuthenticatedUser) error {
	topology, err := s.repo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != topology.Creator.UUID {
		return utils.ErrNoWriteAccessToTopology
	}

	if err := s.repo.Delete(ctx, topology); err != nil {
		return err
	}

	s.policyEngine.Forget(topology.UUID)
	return nil
}

// DeleteTopologiesOfCollection deletes all topologies of the collection with the given UUID.
//
// It doesn't check permissions; the caller has already decided that the collection may be deleted.
func (s *Service) DeleteTopologiesOfCollection(ctx context.Context, collectionId string) error {
	topologyIds, err := s.repo.DeleteByCollection(ctx, collectionId)
	if err != nil {
		return err
	}

	// Make sure the topology engine forgets the topologies
	for i := range topologyIds {
		s.policyEngine.Forget(topologyIds[i])
	}

	return nil
}

func (s *Service) CreateBindFile(
	ctx context.Context,
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

	// Validate and canonicalize the client-supplied path before anything else
	filePath, err := storage.ValidateBindFilePath(*req.FilePath)
	if err != nil {
		return "", err
	}

	// Don't allow duplicate bind file names within the same topology
	if nameExists, err := s.repo.DoesBindFilePathExist(
		ctx,
		filePath,
		bindFileTopology.UUID,
		"",
	); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrBindFileExists
	}

	if err := s.saveBindFile(topologyId, filePath, *req.Content); err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()
	err = s.repo.CreateBindFile(ctx, &BindFile{
		UUID:     newUuid,
		FilePath: filePath,
		Topology: *bindFileTopology,
	})

	return newUuid, err
}

func (s *Service) UpdateBindFile(
	ctx context.Context,
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
		// Validate and canonicalize the client-supplied path before anything else
		newPath, err := storage.ValidateBindFilePath(*req.FilePath)
		if err != nil {
			return err
		}

		// Don't allow duplicate bind file names within the same topology
		if nameExists, err := s.repo.DoesBindFilePathExist(
			ctx,
			newPath,
			bindFileTopology.UUID,
			bindFileUuid,
		); err != nil {
			return err
		} else if nameExists {
			return utils.ErrBindFileExists
		}

		bindFilePath = newPath
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

	// Only now that the content is in hand is it safe to drop the file at the old path.
	if bindFile.FilePath != bindFilePath {
		if err := s.removeBindFile(bindFileTopology.UUID, bindFile.FilePath); err != nil {
			log.Errorf("Failed to delete old bind file '%s': %s", bindFile.FilePath, err.Error())
		}
	}

	if err := s.saveBindFile(bindFileTopology.UUID, bindFilePath, bindFileContent); err != nil {
		return err
	}

	bindFile.FilePath = bindFilePath

	return s.repo.UpdateBindFile(ctx, bindFile)
}

func (s *Service) DeleteBindFile(ctx context.Context, bindFileId string, authUser auth.AuthenticatedUser) error {
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

func (s *Service) saveTopology(topologyId string, definition *string, annotations *string) error {
	if err := s.storageManager.WriteTopology(topologyId, definition, annotations); err != nil {
		log.Errorf("Failed to write topology definition for %s: %s", topologyId, err.Error())
		return err
	}

	return nil
}

func (s *Service) LoadTopology(topologyId string, bindFiles []BindFile) (string, string, []BindFileFull, error) {
	var definition string
	var annotations string

	if err := s.storageManager.ReadTopology(topologyId, &definition, &annotations); err != nil {
		log.Errorf("Failed to read topology for %s: %s", topologyId, err.Error())
		return "", "", nil, err
	}

	bindFilesFull := make([]BindFileFull, 0)
	for _, bindFile := range bindFiles {
		bindFileOut, err := s.loadBindFile(topologyId, bindFile)
		if err != nil {
			return "", "", nil, err
		}

		bindFilesFull = append(bindFilesFull, *bindFileOut)
	}

	return definition, annotations, bindFilesFull, nil
}

func (s *Service) SetLastDeployFailed(ctx context.Context, topology *Topology, hasFailed bool) {
	topology.LastDeployFailed = hasFailed
	err := s.repo.Update(ctx, topology)

	if err != nil {
		log.Error("Failed to set last deployment failed on topology", "topo", topology.UUID)
	}
}

func (s *Service) createTopologyFull(ctx context.Context, topology *Topology) (*TopologyFull, error) {
	var (
		definition       clabtypes.TopologyDefinition
		definitionRaw    any
		definitionString string
		annotations      string
		bindFilesFull    []BindFileFull
	)

	bindFiles, err := s.repo.GetBindFileForTopology(ctx, topology.UUID)
	if err != nil {
		log.Errorf("Failed to get bind files for topology '%s': %s", topology.UUID, err.Error())
		return nil, utils.ErrInvalidTopology
	}

	if definitionString, annotations, bindFilesFull, err = s.LoadTopology(topology.UUID, bindFiles); err != nil {
		log.Errorf("Failed to read definition of topology '%s': %s", topology.UUID, err.Error())
		return nil, utils.ErrInvalidTopology
	}

	bindFilePaths := lo.Map(bindFiles, func(bindFile BindFile, _ int) string {
		return bindFile.FilePath
	})

	if err = s.schemaService.Parse(definitionString, &definition, &definitionRaw); err != nil {
		return nil, err
	}

	findings := s.policyEngine.Check(topology.UUID, definitionRaw, definition.Topology, definitionString, bindFilePaths)

	return &TopologyFull{
		ID:               topology.UUID,
		Definition:       definitionString,
		Annotations:      annotations,
		SyncUrl:          topology.SyncUrl,
		Collection:       topology.Collection,
		Creator:          topology.Creator,
		BindFiles:        bindFilesFull,
		LastDeployFailed: topology.LastDeployFailed,
		PolicyFindings:   findings,
	}, nil
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

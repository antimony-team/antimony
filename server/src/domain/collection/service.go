package collection

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/user"
	"antimonyBackend/utils"
	"context"
)

type (
	// LabRemover deletes the labs of a collection. Implemented by lab.Service and wired in main.go, since the
	// collection package can't depend on the lab package.
	LabRemover interface {
		DeleteLabsOfCollection(ctx context.Context, collectionId string) error
	}

	// TopologyRemover deletes the topologies of a collection. Implemented by topology.Service and wired in main.go,
	// since the collection package can't depend on the topology package.
	TopologyRemover interface {
		DeleteTopologiesOfCollection(ctx context.Context, collectionId string) error
	}

	Service struct {
		repo     *Repository
		userRepo *user.Repository

		labRemover      LabRemover
		topologyRemover TopologyRemover
	}
)

func CreateService(repo *Repository, userRepo *user.Repository) *Service {
	return &Service{
		repo:     repo,
		userRepo: userRepo,
	}
}

func (s *Service) Get(ctx context.Context, authUser auth.AuthenticatedUser) ([]Collection, error) {
	var (
		collections []Collection
		err         error
	)

	if authUser.IsAdmin {
		collections, err = s.repo.GetAll(ctx)
	} else {
		collections, err = s.repo.GetByNames(ctx, authUser.Collections)
	}

	return collections, err
}

func (s *Service) Create(
	ctx context.Context,
	req CollectionIn,
	authUser auth.AuthenticatedUser,
) (string, error) {
	// Deny request if the user is not an admin
	if !authUser.IsAdmin {
		return "", utils.ErrNoPermissionToCreateCollections
	}

	// Don't allow duplicate collection names
	if nameExists, err := s.repo.DoesNameExist(ctx, *req.Name); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrCollectionExists
	}

	newUuid := utils.GenerateUuid()

	creator, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", err
	}

	return newUuid, s.repo.Create(ctx, &Collection{
		UUID:         newUuid,
		Name:         *req.Name,
		PublicWrite:  *req.PublicWrite,
		PublicDeploy: *req.PublicDeploy,
		Creator:      *creator,
	})
}

func (s *Service) Update(
	ctx context.Context,
	req CollectionInPartial,
	collectionId string,
	authUser auth.AuthenticatedUser,
) error {
	collection, err := s.repo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != collection.Creator.UUID {
		return utils.ErrNoWriteAccessToCollection
	}

	if req.Name != nil {
		// Don't allow duplicate collection names
		if collection.Name != *req.Name {
			if nameExists, err := s.repo.DoesNameExist(ctx, *req.Name); err != nil {
				return err
			} else if nameExists {
				return utils.ErrCollectionExists
			}
		}

		collection.Name = *req.Name
	}

	if req.PublicWrite != nil {
		collection.PublicWrite = *req.PublicWrite
	}

	if req.PublicDeploy != nil {
		collection.PublicDeploy = *req.PublicDeploy
	}

	return s.repo.Update(ctx, collection)
}

func (s *Service) Delete(ctx context.Context, collectionId string, authUser auth.AuthenticatedUser) error {
	collection, err := s.repo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != collection.Creator.UUID {
		return utils.ErrNoWriteAccessToCollection
	}

	if err := s.labRemover.DeleteLabsOfCollection(ctx, collectionId); err != nil {
		return err
	}

	if err := s.topologyRemover.DeleteTopologiesOfCollection(ctx, collectionId); err != nil {
		return err
	}

	return s.repo.Delete(ctx, collection)
}

func (s *Service) SetLabRemover(labRemover LabRemover) {
	s.labRemover = labRemover
}

func (s *Service) SetTopologyRemover(topologyRemover TopologyRemover) {
	s.topologyRemover = topologyRemover
}

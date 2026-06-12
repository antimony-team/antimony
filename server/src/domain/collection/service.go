package collection

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/user"
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
)

type Service struct {
	repo     *Repository
	userRepo *user.Repository
}

func CreateService(repo *Repository, userRepo *user.Repository) *Service {
	return &Service{
		repo:     repo,
		userRepo: userRepo,
	}
}

func (u *Service) Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]Collection, error) {
	var (
		collections []Collection
		err         error
	)

	if authUser.IsAdmin {
		collections, err = u.repo.GetAll(ctx)
	} else {
		collections, err = u.repo.GetByNames(ctx, authUser.Collections)
	}

	return collections, err
}

func (u *Service) Create(
	ctx *gin.Context,
	req CollectionIn,
	authUser auth.AuthenticatedUser,
) (string, error) {
	// Deny request if the user is not an admin
	if !authUser.IsAdmin {
		return "", utils.ErrNoPermissionToCreateCollections
	}

	// Don't allow duplicate collection names
	if nameExists, err := u.repo.DoesNameExist(ctx, *req.Name); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrCollectionExists
	}

	newUuid := utils.GenerateUuid()

	creator, err := u.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", err
	}

	return newUuid, u.repo.Create(ctx, &Collection{
		UUID:         newUuid,
		Name:         *req.Name,
		PublicWrite:  *req.PublicWrite,
		PublicDeploy: *req.PublicDeploy,
		Creator:      *creator,
	})
}

func (u *Service) Update(
	ctx *gin.Context,
	req CollectionInPartial,
	collectionId string,
	authUser auth.AuthenticatedUser,
) error {
	collection, err := u.repo.GetByUuid(ctx, collectionId)
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
			if nameExists, err := u.repo.DoesNameExist(ctx, *req.Name); err != nil {
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

	return u.repo.Update(ctx, collection)
}

func (u *Service) Delete(ctx *gin.Context, collectionId string, authUser auth.AuthenticatedUser) error {
	collection, err := u.repo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != collection.Creator.UUID {
		return utils.ErrNoWriteAccessToCollection
	}

	return u.repo.Delete(ctx, collection)
}

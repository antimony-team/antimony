package collection

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/user"
	"antimonyBackend/utils"

	"github.com/gin-gonic/gin"
)

type (
	Service interface {
		Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]CollectionOut, error)
		Create(ctx *gin.Context, req CollectionIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req CollectionInPartial, collectionId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, collectionId string, authUser auth.AuthenticatedUser) error
	}

	collectionService struct {
		userRepo       user.Repository
		collectionRepo Repository
	}
)

func CreateService(collectionRepo Repository, userRepo user.Repository) Service {
	return &collectionService{
		userRepo:       userRepo,
		collectionRepo: collectionRepo,
	}
}

func (u *collectionService) Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]CollectionOut, error) {
	var (
		collections []Collection
		err         error
	)

	if authUser.IsAdmin {
		collections, err = u.collectionRepo.GetAll(ctx)
	} else {
		collections, err = u.collectionRepo.GetByNames(ctx, authUser.Collections)
	}
	if err != nil {
		return nil, err
	}

	result := make([]CollectionOut, len(collections))
	for i, collection := range collections {
		result[i] = CollectionOut{
			ID:           collection.UUID,
			Name:         collection.Name,
			PublicWrite:  collection.PublicWrite,
			PublicDeploy: collection.PublicDeploy,
			Creator:      u.userRepo.UserToOut(collection.Creator),
		}
	}

	return result, err
}

func (u *collectionService) Create(
	ctx *gin.Context,
	req CollectionIn,
	authUser auth.AuthenticatedUser,
) (string, error) {
	// Deny request if the user is not an admin
	if !authUser.IsAdmin {
		return "", utils.ErrNoPermissionToCreateCollections
	}

	// Don't allow duplicate collection names
	if nameExists, err := u.collectionRepo.DoesNameExist(ctx, *req.Name); err != nil {
		return "", err
	} else if nameExists {
		return "", utils.ErrCollectionExists
	}

	newUuid := utils.GenerateUuid()

	creator, err := u.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", err
	}

	return newUuid, u.collectionRepo.Create(ctx, &Collection{
		UUID:         newUuid,
		Name:         *req.Name,
		PublicWrite:  *req.PublicWrite,
		PublicDeploy: *req.PublicDeploy,
		Creator:      *creator,
	})
}

func (u *collectionService) Update(
	ctx *gin.Context,
	req CollectionInPartial,
	collectionId string,
	authUser auth.AuthenticatedUser,
) error {
	collection, err := u.collectionRepo.GetByUuid(ctx, collectionId)
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
			if nameExists, err := u.collectionRepo.DoesNameExist(ctx, *req.Name); err != nil {
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

	return u.collectionRepo.Update(ctx, collection)
}

func (u *collectionService) Delete(ctx *gin.Context, collectionId string, authUser auth.AuthenticatedUser) error {
	collection, err := u.collectionRepo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested topology or an admin
	if !authUser.IsAdmin && authUser.UserId != collection.Creator.UUID {
		return utils.ErrNoWriteAccessToCollection
	}

	return u.collectionRepo.Delete(ctx, collection)
}

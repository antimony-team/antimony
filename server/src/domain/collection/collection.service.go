package collection

import (
	"antimonyBackend/src/domain/user"
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
)

type (
	Service interface {
		Get(ctx *gin.Context) ([]CollectionOut, error)
		Create(ctx *gin.Context, req CollectionIn) (string, error)
		Update(ctx *gin.Context, req CollectionIn, collectionId string) error
		Delete(ctx *gin.Context, collectionId string) error
	}

	collectionService struct {
		collectionRepo Repository
	}
)

func CreateService(collectionRepo Repository) Service {
	return &collectionService{
		collectionRepo: collectionRepo,
	}
}

func (u *collectionService) Get(ctx *gin.Context) ([]CollectionOut, error) {
	objs, err := u.collectionRepo.Get(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]CollectionOut, len(objs))
	for i, obj := range objs {
		result[i] = CollectionOut{
			UUID:         obj.UUID,
			PublicEdit:   obj.PublicEdit,
			PublicDeploy: obj.PublicDeploy,
			CreatorEmail: obj.Creator.Email,
		}
	}

	return result, err
}

func (u *collectionService) Create(ctx *gin.Context, req CollectionIn) (string, error) {
	newUuid := utils.GenerateUuid()
	err := u.collectionRepo.Create(ctx, &Collection{
		UUID:         newUuid,
		PublicEdit:   req.PublicEdit,
		PublicDeploy: req.PublicDeploy,
		Creator:      user.User{},
	})

	return newUuid, err
}

func (u *collectionService) Update(ctx *gin.Context, req CollectionIn, collectionId string) error {
	collection, err := u.collectionRepo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	collection.Name = req.Name
	collection.PublicEdit = req.PublicEdit
	collection.PublicDeploy = req.PublicDeploy

	return u.collectionRepo.Update(ctx, collection)
}

func (u *collectionService) Delete(ctx *gin.Context, collectionId string) error {
	collection, err := u.collectionRepo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	return u.collectionRepo.Delete(ctx, collection)
}

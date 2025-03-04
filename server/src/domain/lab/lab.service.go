package lab

import (
	"antimonyBackend/src/domain/user"
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
)

type (
	Service interface {
		Get(ctx *gin.Context) ([]LabOut, error)
		Create(ctx *gin.Context, req LabIn) (string, error)
		Update(ctx *gin.Context, req LabIn, labId string) error
		Delete(ctx *gin.Context, labId string) error
	}

	labService struct {
		labRepo Repository
	}
)

func CreateService(labRepo Repository) Service {
	return &labService{
		labRepo: labRepo,
	}
}

func (u *labService) Get(ctx *gin.Context) ([]LabOut, error) {
	objs, err := u.labRepo.Get(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]LabOut, len(objs))
	for i, obj := range objs {
		result[i] = LabOut{
			UUID:         obj.UUID,
			PublicEdit:   obj.PublicEdit,
			PublicDeploy: obj.PublicDeploy,
			CreatorEmail: obj.Creator.Email,
		}
	}

	return result, err
}

func (u *labService) Create(ctx *gin.Context, req LabIn) (string, error) {
	newUuid := utils.GenerateUuid()
	err := u.labRepo.Create(ctx, &LabIn{
		UUID:         newUuid,
		PublicEdit:   req.PublicEdit,
		PublicDeploy: req.PublicDeploy,
		Creator:      user.User{},
	})

	return newUuid, err
}

func (u *labService) Update(ctx *gin.Context, req LabIn, collectionId string) error {
	collection, err := u.labRepo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	collection.Name = req.Name
	collection.PublicEdit = req.PublicEdit
	collection.PublicDeploy = req.PublicDeploy

	return u.labRepo.Update(ctx, collection)
}

func (u *labService) Delete(ctx *gin.Context, collectionId string) error {
	collection, err := u.labRepo.GetByUuid(ctx, collectionId)
	if err != nil {
		return err
	}

	return u.labRepo.Delete(ctx, collection)
}

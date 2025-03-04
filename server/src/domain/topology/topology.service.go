package topology

import (
	"antimonyBackend/src/domain/collection"
	"antimonyBackend/src/domain/user"
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
)

type (
	Service interface {
		Get(ctx *gin.Context) ([]TopologyOut, error)
		Create(ctx *gin.Context, req TopologyIn) (string, error)
		Update(ctx *gin.Context, req TopologyIn, topologyId string) error
		Delete(ctx *gin.Context, topologyId string) error
	}

	userService struct {
		topologyRepo   Repository
		collectionRepo collection.Repository
	}
)

func CreateService(topologyRepo Repository, collectionRepo collection.Repository) Service {
	return &userService{
		topologyRepo:   topologyRepo,
		collectionRepo: collectionRepo,
	}
}

func (u *userService) Get(ctx *gin.Context) ([]TopologyOut, error) {
	objs, err := u.topologyRepo.Get(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]TopologyOut, len(objs))
	for i, obj := range objs {
		result[i] = TopologyOut{
			UUID:         obj.UUID,
			Definition:   obj.Definition,
			Metadata:     obj.Metadata,
			GitSourceUrl: obj.GitSourceUrl,
			CollectionId: obj.Collection.UUID,
			CreatorEmail: obj.Creator.Email,
		}
	}

	return result, err
}

func (u *userService) Create(ctx *gin.Context, req TopologyIn) (string, error) {
	topologyCollection, err := u.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()
	err = u.topologyRepo.Create(ctx, &Topology{
		UUID:         newUuid,
		Definition:   req.Definition,
		Metadata:     req.Metadata,
		GitSourceUrl: req.GitSourceUrl,
		Collection:   *topologyCollection,
		Creator:      user.User{},
	})

	return newUuid, err
}

func (u *userService) Update(ctx *gin.Context, req TopologyIn, topologyId string) error {
	topology, err := u.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	topologyCollection, err := u.collectionRepo.GetByUuid(ctx, req.CollectionId)
	if err != nil {
		return err
	}

	topology.Definition = req.Definition
	topology.Metadata = req.Metadata
	topology.GitSourceUrl = req.GitSourceUrl
	topology.Collection = *topologyCollection

	return u.topologyRepo.Update(ctx, topology)
}

func (u *userService) Delete(ctx *gin.Context, topologyId string) error {
	topology, err := u.topologyRepo.GetByUuid(ctx, topologyId)
	if err != nil {
		return err
	}

	return u.topologyRepo.Delete(ctx, topology)
}

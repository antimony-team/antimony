package lab

import (
	"antimonyBackend/src/domain/instance"
	"antimonyBackend/src/domain/topology"
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
		labRepo         Repository
		topologyRepo    topology.Repository
		instanceService instance.Service
	}
)

func CreateService(labRepo Repository, topologyRepo topology.Repository, instanceService instance.Service) Service {
	return &labService{
		labRepo:         labRepo,
		topologyRepo:    topologyRepo,
		instanceService: instanceService,
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
			Name:         obj.Name,
			StartTime:    obj.StartTime,
			EndTime:      obj.EndTime,
			CreatorEmail: obj.Creator.Email,
			TopologyId:   obj.Topology.UUID,
			Instance:     u.instanceService.GetInstanceForLab(obj.UUID),
		}
	}

	return result, err
}

func (u *labService) Create(ctx *gin.Context, req LabIn) (string, error) {
	labTopology, err := u.topologyRepo.GetByUuid(ctx, req.TopologyId)
	if err != nil {
		return "", err
	}

	newUuid := utils.GenerateUuid()
	err = u.labRepo.Create(ctx, &Lab{
		UUID:      newUuid,
		Name:      req.Name,
		StartTime: req.StartTime,
		EndTime:   req.EndTime,
		Creator:   user.User{},
		Topology:  *labTopology,
	})

	return newUuid, err
}

func (u *labService) Update(ctx *gin.Context, req LabIn, labId string) error {
	lab, err := u.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Don't allow modifications to running labs
	if lab.Instance != nil {
		return utils.ErrorRunningLab
	}

	labTopology, err := u.topologyRepo.GetByUuid(ctx, req.TopologyId)
	if err != nil {
		return err
	}

	lab.Name = req.Name
	lab.StartTime = req.StartTime
	lab.EndTime = req.EndTime
	lab.Topology = *labTopology

	return u.labRepo.Update(ctx, lab)
}

func (u *labService) Delete(ctx *gin.Context, labId string) error {
	lab, err := u.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Don't allow the deletion of running labs
	if lab.Instance != nil {
		return utils.ErrorRunningLab
	}

	return u.labRepo.Delete(ctx, lab)
}

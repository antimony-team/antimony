package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/deployment/containerlab"
	"antimonyBackend/domain/instance"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/utils"
	"context"
	"fmt"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"slices"
	"sort"
	"sync"
	"time"
)

type (
	Service interface {
		Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]LabOut, error)
		Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req LabIn, labId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error
	}

	labService struct {
		labRepo           Repository
		topologyRepo      topology.Repository
		instanceService   instance.Service
		userService       user.Service
		labScheduleMutex  *sync.Mutex
		labSchedule       []*Lab
		containerProvider containerlab.DeploymentProvider
	}
)

func CreateService(labRepo Repository, topologyRepo topology.Repository, instanceService instance.Service, userService user.Service) Service {
	labSchedule, err := labRepo.Get()
	if err != nil {
		log.Fatal("Failed to load scheduled labs from database. Exiting.")
	}

	labService := &labService{
		labRepo:           labRepo,
		topologyRepo:      topologyRepo,
		instanceService:   instanceService,
		userService:       userService,
		labScheduleMutex:  &sync.Mutex{},
		labSchedule:       labSchedule,
		containerProvider: &containerlab.Service{},
	}

	go labService.LabDeployer()

	return labService
}

func (s *labService) LabDeployer() {
	for {
		if len(s.labSchedule) > 0 && s.labSchedule[0].StartTime.Unix() <= time.Now().Unix() {
			labName := s.labSchedule[0].Name
			log.Infof("[SCHEDULER] Deploying lab %s (%s) with containerlab", s.labSchedule[0].Name, s.labSchedule[0].Topology.Collection.Name)
			collectionID := fmt.Sprintf("%v", s.labSchedule[0].Topology.UUID)

			topologyFile := fmt.Sprintf("storage/%s/topology.clab.yaml", collectionID)

			log.Infof("[SCHEDULER] Deploying topology file: %s", topologyFile)
			ctx := context.Background()
			err := s.containerProvider.Deploy(ctx, topologyFile)
			if err != nil {
				log.Errorf("[SCHEDULER] Failed to deploy lab %s: %v", labName, err)
			} else {
				log.Infof("[SCHEDULER] Successfully deployed lab %s", labName)
			}
			// Remove lab from schedule list
			s.labScheduleMutex.Lock()
			s.labSchedule = s.labSchedule[1:]
			s.labScheduleMutex.Unlock()
		}
		time.Sleep(5 * time.Second)
	}
}

func (s *labService) Get(ctx *gin.Context, authUser auth.AuthenticatedUser) ([]LabOut, error) {
	labs, err := s.labRepo.GetFromCollections(ctx, authUser.Collections)
	if err != nil {
		return nil, err
	}

	result := make([]LabOut, len(labs))
	for i, lab := range labs {
		result[i] = LabOut{
			ID:         lab.UUID,
			Name:       lab.Name,
			StartTime:  lab.StartTime,
			EndTime:    lab.EndTime,
			TopologyId: lab.Topology.UUID,
			Creator:    s.userService.UserToOut(lab.Creator),
			Instance:   s.instanceService.GetInstanceForLab(lab.UUID),
		}
	}

	return result, err
}

func (s *labService) Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error) {
	labTopology, err := s.topologyRepo.GetByUuid(ctx, req.TopologyId)
	if err != nil {
		return "", err
	}
	// Deny request if user does not have access to the lab topology's collection
	if !authUser.IsAdmin && (!labTopology.Collection.PublicDeploy || !slices.Contains(authUser.Collections, labTopology.Collection.Name)) {
		return "", utils.ErrorNoDeployAccessToCollection
	}

	newUuid := utils.GenerateUuid()
	lab := &Lab{
		UUID:      newUuid,
		Name:      req.Name,
		StartTime: req.StartTime,
		EndTime:   req.EndTime,
		Creator:   user.User{},
		Topology:  *labTopology,
	}

	// Add created lab to schedule if it was successfully added to the database
	if err := s.labRepo.Create(ctx, lab); err == nil {
		s.scheduleLab(lab)
	}

	return newUuid, err
}

func (s *labService) Update(ctx *gin.Context, req LabIn, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrorNoWriteAccessToLab
	}

	// Don't allow modifications to running labs
	if lab.Instance != nil {
		return utils.ErrorRunningLab
	}

	labTopology, err := s.topologyRepo.GetByUuid(ctx, req.TopologyId)
	if err != nil {
		return err
	}

	lab.Name = req.Name
	lab.StartTime = req.StartTime
	lab.EndTime = req.EndTime
	lab.Topology = *labTopology

	return s.labRepo.Update(ctx, lab)
}

func (s *labService) Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrorNoWriteAccessToLab
	}

	// Don't allow the deletion of running labs
	if lab.Instance != nil {
		return utils.ErrorRunningLab
	}

	return s.labRepo.Delete(ctx, lab)
}

func (s *labService) scheduleLab(lab *Lab) {
	insertIndex := sort.Search(len(s.labSchedule), func(i int) bool {
		return s.labSchedule[i].StartTime.Unix() >= lab.StartTime.Unix()
	})

	if insertIndex == len(s.labSchedule) {
		s.labScheduleMutex.Lock()
		s.labSchedule = append(s.labSchedule, lab)
		s.labScheduleMutex.Unlock()
		return
	}

	s.labScheduleMutex.Lock()
	s.labSchedule = append(s.labSchedule[:insertIndex+1], s.labSchedule[insertIndex:]...)
	s.labSchedule[insertIndex] = lab
	s.labScheduleMutex.Unlock()
}

package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/deployment/containerlab"
	"antimonyBackend/domain/instance"
	"antimonyBackend/domain/statusMessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
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
		labRepo                Repository
		userRepo               user.Repository
		topologyRepo           topology.Repository
		instanceService        instance.Service
		labScheduleMutex       *sync.Mutex
		labSchedule            []Lab
		containerProvider      containerlab.DeploymentProvider
		statusMessageNamespace socket.NamespaceManager[statusMessage.StatusMessage]
	}
)

func CreateService(
	labRepo Repository,
	userRepo user.Repository,
	topologyRepo topology.Repository,
	instanceService instance.Service,
	statusMessageNamespace socket.NamespaceManager[statusMessage.StatusMessage],
) Service {
	labSchedule, err := labRepo.GetAll()
	if err != nil {
		log.Fatal("Failed to load scheduled labs from database. Exiting.")
	}

	labService := &labService{
		labRepo:                labRepo,
		userRepo:               userRepo,
		topologyRepo:           topologyRepo,
		instanceService:        instanceService,
		labScheduleMutex:       &sync.Mutex{},
		labSchedule:            labSchedule,
		containerProvider:      &containerlab.Service{},
		statusMessageNamespace: statusMessageNamespace,
	}

	go labService.LabDeployer()

	return labService
}

func (s *labService) LabDeployer() {
	for {
		if len(s.labSchedule) > 0 && s.labSchedule[0].StartTime.Unix() <= time.Now().Unix() {
			lab := s.labSchedule[0]
			topologyFile := fmt.Sprintf("storage/%s/topology.clab.yaml", lab.Topology.UUID)

			log.Infof("[SCHEDULER] Deploying topology %s (%s)", lab.Name, lab.Topology.Name)
			s.statusMessageNamespace.Send(statusMessage.Info(
				"Lab Scheduler", fmt.Sprintf("Deploying topology %s (%s)", lab.Name, lab.Topology.Name),
			))

			ctx := context.Background()
			err := s.containerProvider.Deploy(ctx, topologyFile)
			if err != nil {
				log.Infof("[SCHEDULER] Failed to deploy lab %s: %s", lab.Name, err.Error())
				s.statusMessageNamespace.Send(statusMessage.Error(
					"Lab Scheduler", fmt.Sprintf("Failed to deploy lab %s: %s", lab.Name, err.Error()),
				))
			} else {
				log.Infof("[SCHEDULER] Successfully deployed lab %s!", lab.Name)
				s.statusMessageNamespace.Send(statusMessage.Success(
					"Lab Scheduler", fmt.Sprintf("Successfully deployed lab %s!", lab.Name),
				))
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
	var (
		labs []Lab
		err  error
	)

	if authUser.IsAdmin {
		labs, err = s.labRepo.GetAll()
	} else {
		labs, err = s.labRepo.GetFromCollections(ctx, authUser.Collections)
	}
	if err != nil {
		return nil, err
	}

	result := make([]LabOut, len(labs))
	for i, lab := range labs {
		result[i] = LabOut{
			ID:           lab.UUID,
			Name:         lab.Name,
			StartTime:    lab.StartTime,
			EndTime:      lab.EndTime,
			TopologyId:   lab.Topology.UUID,
			CollectionId: lab.Topology.Collection.UUID,
			Creator:      s.userRepo.UserToOut(lab.Creator),
			Instance:     s.instanceService.GetInstanceForLab(lab.UUID),
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

	log.Errorf("Start date: %s", req.StartTime)

	creatorUser, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		log.Errorf("lab create uuid: %+v", authUser)

		return "", utils.ErrorUnauthorized
	}

	newUuid := utils.GenerateUuid()
	lab := &Lab{
		UUID:      newUuid,
		Name:      req.Name,
		StartTime: req.StartTime,
		EndTime:   req.EndTime,
		Creator:   *creatorUser,
		Topology:  *labTopology,
	}

	// Add created lab to schedule if it was successfully added to the database
	if err := s.labRepo.Create(ctx, lab); err == nil {
		s.scheduleLab(*lab)
	}

	log.Errorf("created: %v", lab)

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

func (s *labService) scheduleLab(lab Lab) {
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

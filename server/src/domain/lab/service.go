package lab

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"antimonyBackend/domain/schema"
	"antimonyBackend/domain/statusmessage"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/socket"
	"antimonyBackend/storage"
	"antimonyBackend/utils"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"gopkg.in/yaml.v3"
)

const ShellTimeout = 60

type (
	Service interface {
		Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]Lab, error)
		GetByUuid(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) (*Lab, error)
		Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error)
		Update(ctx *gin.Context, req LabInPartial, labId string, authUser auth.AuthenticatedUser) error
		Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error

		SetRuntimeInfo(runtimeInfo RuntimeInfo)
	}

	RuntimeInfo interface {
		IsRunning(labId string) bool
		CanDelete(labId string) bool
	}

	service struct {
		config *config.AntimonyConfig

		labRepo         Repository
		userRepo        user.Repository
		topologyRepo    topology.Repository
		schemaService   schema.Service
		topologyService topology.Service
		storageManager  storage.Manager

		runtimeInfo RuntimeInfo

		labEventBus utils.EventBus[*Lab]

		statusMessageNamespace socket.OutputNamespace[statusmessage.Message]
	}
)

func CreateService(
	config *config.AntimonyConfig,
	labRepo Repository,
	userRepo user.Repository,
	topologyRepo topology.Repository,
	schemaService schema.Service,
	topologyService topology.Service,
	storageManager storage.Manager,
	labEventBus utils.EventBus[*Lab],
	statusMessageNamespace socket.OutputNamespace[statusmessage.Message],
) Service {
	labService := &service{
		config:                 config,
		labRepo:                labRepo,
		userRepo:               userRepo,
		topologyRepo:           topologyRepo,
		schemaService:          schemaService,
		topologyService:        topologyService,
		storageManager:         storageManager,
		labEventBus:            labEventBus,
		runtimeInfo:            nil,
		statusMessageNamespace: statusMessageNamespace,
	}

	return labService
}

func (s *service) Get(ctx *gin.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]Lab, error) {
	var (
		labs []Lab
		err  error
	)

	if labs, err = s.labRepo.GetAll(ctx, &labFilter); err != nil {
		return nil, err
	}

	return lo.Filter(labs, func(lab Lab, _ int) bool {
		return authUser.IsAdmin || slices.Contains(authUser.Collections, lab.Topology.Collection.Name)
	}), nil
}

func (s *service) GetByUuid(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) (*Lab, error) {
	var (
		lab *Lab
		err error
	)
	if lab, err = s.labRepo.GetByUuid(ctx, labId); err != nil {
		return nil, err
	}

	// Deny request if user doesn't have access to the lab
	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, lab.Topology.Collection.Name) {
		return nil, utils.ErrNoAccessToLab
	}

	return lab, err
}

func (s *service) Create(ctx *gin.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error) {
	labTopology, err := s.topologyRepo.GetByUuid(ctx, *req.TopologyId)
	if err != nil {
		return "", err
	}

	// Deny request if user does not have access to the lab topology's collection
	if !authUser.IsAdmin &&
		(!labTopology.Collection.PublicDeploy || !slices.Contains(authUser.Collections, labTopology.Collection.Name)) {
		return "", utils.ErrNoDeployAccessToCollection
	}

	creator, err := s.userRepo.GetByUuid(ctx, authUser.UserId)
	if err != nil {
		return "", utils.ErrUnauthorized
	}

	topologyDefinition, _, err := s.topologyService.LoadTopology(labTopology.UUID, []topology.BindFile{})
	if err != nil {
		log.Error("Failed to read definition of topology", "topology", labTopology.UUID, "error", err.Error())
		return "", utils.ErrAntimony
	}

	labUuid := utils.GenerateUuid()
	lab := &Lab{
		UUID:               labUuid,
		Name:               *req.Name,
		StartTime:          *req.StartTime,
		EndTime:            req.EndTime,
		Creator:            *creator,
		Topology:           *labTopology,
		TopologyDefinition: &topologyDefinition,
	}

	fmt.Printf("CREATING LAB RIGHT NOW\n\n\n")

	var instanceName string
	if instanceName, err = s.createLabEnvironment(lab); err != nil {
		log.Error("Failed to create lab environment", "topology", "error", err.Error())
		return "", utils.ErrAntimony
	}

	lab.InstanceName = instanceName

	if err := s.labRepo.Create(ctx, lab); err != nil {
		return "", err
	}

	// Publish that a new lab has been created for the scheduler
	s.labEventBus.Publish("lab.created", lab)

	// Send update to clients
	//s.notifyUpdate(*lab, nil)

	return labUuid, nil
}

func (s *service) Update(ctx *gin.Context, req LabInPartial, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrNoWriteAccessToLab
	}

	// Don't allow modifications to running labs
	if s.runtimeInfo == nil || s.runtimeInfo.IsRunning(lab.UUID) {
		return utils.ErrLabRunning
	}

	timeChanged := false

	if req.Indefinite != nil && *req.Indefinite {
		lab.EndTime = nil
		timeChanged = true
	} else if req.EndTime != nil {
		lab.EndTime = req.EndTime
		timeChanged = true
	}

	if req.StartTime != nil {
		lab.StartTime = *req.StartTime
		timeChanged = true
	}

	if req.Name != nil {
		lab.Name = *req.Name
	}

	if err := s.labRepo.Update(ctx, lab); err != nil {
		return err
	}

	if timeChanged {
		s.labEventBus.Publish("lab.moved", lab)
	}

	return nil
}

func (s *service) Delete(ctx *gin.Context, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.labRepo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrNoWriteAccessToLab
	}

	fmt.Printf("DELETING LAB RIGHT NOW1: %+v\n\n\n", s.runtimeInfo)

	// Don't allow the deletion of running labs
	if s.runtimeInfo == nil || !s.runtimeInfo.CanDelete(lab.UUID) {
		return utils.ErrLabRunning
	}

	fmt.Printf("DELETING LAB RIGHT NOW2\n\n\n")

	if err := s.storageManager.DeleteRunEnvironment(lab.UUID); err != nil {
		s.statusMessageNamespace.Send(*statusmessage.Warning(
			"Lab Manager", fmt.Sprintf("Failed to remove run environment for %s: %s", lab.Name, err.Error()),
			"Failed to remove run environment", "lab", lab.UUID, "instance", lab.InstanceName, "topo", lab.Topology.Name,
		))

		return err
	}

	fmt.Printf("DELETING LAB RIGHT NOW3\n\n\n")

	// Publish that a lab has been deleted for the scheduler
	s.labEventBus.Publish("lab.deleted", lab)

	return s.labRepo.Delete(ctx, lab)
}

func (s *service) SetRuntimeInfo(runtimeInfo RuntimeInfo) {
	s.runtimeInfo = runtimeInfo
}

func (s *service) createLabEnvironment(lab *Lab) (string, error) {
	var (
		runTopologyName       string
		runTopologyDefinition string
		runTopologyFile       string
	)

	runTopologyName = strings.ReplaceAll(lab.Topology.Name, " ", "-")
	runTopologyName = strings.ReplaceAll(runTopologyName, "_", "-")
	runTopologyName = fmt.Sprintf("%s-%d", runTopologyName, time.Now().UnixMilli())

	if err := s.renameTopology(lab.Topology.UUID, runTopologyName, &runTopologyDefinition); err != nil {
		return "", err
	}

	if err := s.storageManager.CreateRunEnvironment(
		lab.Topology.UUID,
		lab.UUID,
		runTopologyDefinition,
		&runTopologyFile,
	); err != nil {
		return "", err
	}

	return runTopologyName, nil
}

// Read a topology, changes its name, and returns the re-marshaled output.
func (s *service) renameTopology(topologyId string, topologyName string, runTopologyDefinition *string) error {
	var (
		topologyRaw        string
		topologyDefinition = make(map[interface{}]interface{})
	)
	if err := s.storageManager.ReadTopology(topologyId, &topologyRaw); err != nil {
		return err
	}

	if err := yaml.Unmarshal([]byte(topologyRaw), &topologyDefinition); err != nil {
		return err
	}

	topologyDefinition["name"] = topologyName
	if runTopologyRaw, err := yaml.Marshal(topologyDefinition); err != nil {
		return err
	} else {
		*runTopologyDefinition = string(runTopologyRaw)
		return nil
	}
}

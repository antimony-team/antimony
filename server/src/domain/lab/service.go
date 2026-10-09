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
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	"gopkg.in/yaml.v3"
)

const ShellTimeout = 60

type (
	RuntimeService interface {
		IsRunning(labId string) bool
		CanDelete(labId string) bool
	}

	Service struct {
		config *config.AntimonyConfig

		repo            *Repository
		userRepo        *user.Repository
		topologyRepo    *topology.Repository
		schemaService   *schema.Service
		topologyService *topology.Service
		storageManager  *storage.Manager

		runtimeService RuntimeService

		labEventBus *utils.EventBus[*Lab]

		statusMessageNamespace *socket.OutputNamespace[statusmessage.Message]
	}
)

func CreateService(
	repo *Repository,
	userRepo *user.Repository,
	topologyRepo *topology.Repository,
	schemaService *schema.Service,
	topologyService *topology.Service,
	storageManager *storage.Manager,
	config *config.AntimonyConfig,
	labEventBus *utils.EventBus[*Lab],
	statusMessageNamespace *socket.OutputNamespace[statusmessage.Message],
) *Service {
	labService := &Service{
		config:                 config,
		repo:                   repo,
		userRepo:               userRepo,
		topologyRepo:           topologyRepo,
		schemaService:          schemaService,
		topologyService:        topologyService,
		storageManager:         storageManager,
		labEventBus:            labEventBus,
		runtimeService:         nil,
		statusMessageNamespace: statusMessageNamespace,
	}

	return labService
}

func (s *Service) Get(ctx context.Context, labFilter LabFilter, authUser auth.AuthenticatedUser) ([]Lab, error) {
	var (
		labs []Lab
		err  error
	)

	if labs, err = s.repo.GetAll(ctx, &labFilter); err != nil {
		return nil, err
	}

	return lo.Filter(labs, func(lab Lab, _ int) bool {
		return authUser.IsAdmin || slices.Contains(authUser.Collections, lab.Collection.Name)
	}), nil
}

func (s *Service) GetByUuid(ctx context.Context, labId string, authUser auth.AuthenticatedUser) (*Lab, error) {
	var (
		lab *Lab
		err error
	)
	if lab, err = s.repo.GetByUuid(ctx, labId); err != nil {
		return nil, err
	}

	// Deny request if user doesn't have access to the lab
	if !authUser.IsAdmin && !slices.Contains(authUser.Collections, lab.Collection.Name) {
		return nil, utils.ErrNoAccessToLab
	}

	return lab, err
}

func (s *Service) Create(ctx context.Context, req LabIn, authUser auth.AuthenticatedUser) (string, error) {
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

	// Lab name can't contain slash characters
	if strings.Contains(*req.Name, "/") {
		return "", fmt.Errorf("%w: the lab name can't contain slashes", utils.ErrInvalidLabName)
	}

	// Lab names have to be unique per collection
	if _, err := s.repo.GetByCollectionAndName(ctx, labTopology.Collection.Name, *req.Name); err == nil {
		return "", utils.ErrLabNameExists
	} else if !errors.Is(err, utils.ErrLabNotFound) {
		return "", err
	}

	topologyDefinition, topologyAnnotations, _, err := s.topologyService.LoadTopology(
		labTopology.UUID,
		[]topology.BindFile{},
	)
	if err != nil {
		log.Error("Failed to read definition of topology", "topology", labTopology.UUID, "error", err.Error())
		return "", utils.ErrAntimony
	}

	labUuid := utils.GenerateUuid()
	lab := &Lab{
		UUID:                labUuid,
		Name:                *req.Name,
		StartTime:           *req.StartTime,
		EndTime:             req.EndTime,
		Creator:             *creator,
		Topology:            *labTopology,
		Collection:          labTopology.Collection,
		TopologyDefinition:  &topologyDefinition,
		TopologyAnnotations: &topologyAnnotations,
	}

	var instanceName string
	if instanceName, err = s.createLabEnvironment(lab); err != nil {
		log.Error("Failed to create lab environment", "topology", "error", err.Error())
		return "", utils.ErrAntimony
	}

	lab.InstanceName = instanceName

	if err := s.repo.Create(ctx, lab); err != nil {
		return "", err
	}

	// Publish that a new lab has been created for the scheduler
	s.labEventBus.Publish("lab.created", lab)

	return labUuid, nil
}

func (s *Service) Update(ctx context.Context, req LabInPartial, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.repo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrNoWriteAccessToLab
	}

	// Don't allow modifications to running labs
	if s.runtimeService == nil || s.runtimeService.IsRunning(lab.UUID) {
		return utils.ErrLabRunning
	}

	if req.Name != nil {
		// Lab name can't contain slash characters
		if strings.Contains(*req.Name, "/") {
			return fmt.Errorf("%w: the lab name can't contain slashes", utils.ErrInvalidLabName)
		}

		// Lab names have to be unique per collection
		if existing, err := s.repo.GetByCollectionAndName(ctx, lab.Collection.Name, *req.Name); err == nil {
			if existing.UUID != lab.UUID {
				return utils.ErrLabNameExists
			}
		} else if !errors.Is(err, utils.ErrLabNotFound) {
			return err
		}

		lab.Name = *req.Name
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

	if err := s.repo.Update(ctx, lab); err != nil {
		return err
	}

	if timeChanged {
		s.labEventBus.Publish("lab.moved", lab)
	}

	return nil
}

func (s *Service) Delete(ctx context.Context, labId string, authUser auth.AuthenticatedUser) error {
	lab, err := s.repo.GetByUuid(ctx, labId)
	if err != nil {
		return err
	}

	// Deny request if user is not the owner of the requested lab or an admin
	if !authUser.IsAdmin && authUser.UserId != lab.Creator.UUID {
		return utils.ErrNoWriteAccessToLab
	}

	return s.deleteLab(ctx, lab)
}

// DeleteLabsOfCollection deletes all labs of the collection with the given UUID. If any of them are running, it
// deletes none of them and returns utils.ErrLabRunning.
//
// It doesn't check permissions; the caller has already decided that the collection may be deleted.
func (s *Service) DeleteLabsOfCollection(ctx context.Context, collectionId string) error {
	labs, err := s.repo.GetByCollection(ctx, collectionId)
	if err != nil {
		return err
	}

	// Check all labs first, so a running lab doesn't leave the collection half deleted
	for i := range labs {
		if s.runtimeService == nil || !s.runtimeService.CanDelete(labs[i].UUID) {
			return fmt.Errorf("%w: lab %q is still running", utils.ErrLabRunning, labs[i].Name)
		}
	}

	for i := range labs {
		if err := s.deleteLab(ctx, &labs[i]); err != nil {
			return err
		}
	}

	return nil
}

func (s *Service) SetRuntimeService(runtimeService RuntimeService) {
	s.runtimeService = runtimeService
}

func (s *Service) deleteLab(ctx context.Context, lab *Lab) error {
	// Don't allow the deletion of running labs
	if s.runtimeService == nil || !s.runtimeService.CanDelete(lab.UUID) {
		return utils.ErrLabRunning
	}

	if err := s.storageManager.DeleteRunEnvironment(lab.UUID); err != nil {
		s.statusMessageNamespace.Send(*statusmessage.Warning(
			"Lab Manager", fmt.Sprintf("Failed to remove run environment for %s: %s", lab.Name, err.Error()),
			"Failed to remove run environment", "lab", lab.UUID, "instance", lab.InstanceName, "topo", lab.Topology.Name,
		))

		return err
	}

	// Publish that a lab has been deleted for the scheduler
	s.labEventBus.Publish("lab.deleted", lab)

	return s.repo.Delete(ctx, lab)
}

func (s *Service) createLabEnvironment(lab *Lab) (string, error) {
	var (
		runTopologyName       string
		runTopologyDefinition string
		runTopologyFile       string
	)

	runTopologyName = strings.ReplaceAll(lab.Topology.Name, " ", "-")
	runTopologyName = strings.ReplaceAll(runTopologyName, "_", "-")
	runTopologyName = fmt.Sprintf("%s-%s", runTopologyName, instanceNameSuffix())

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
func (s *Service) renameTopology(topologyId string, topologyName string, runTopologyDefinition *string) error {
	var (
		topologyRaw        string
		topologyDefinition = make(map[interface{}]interface{})
	)
	if err := s.storageManager.ReadTopology(topologyId, &topologyRaw, new(string)); err != nil {
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

// instanceNameSuffix returns a short, unique, containerlab-safe suffix for an instance name.
func instanceNameSuffix() string {
	return strings.ReplaceAll(utils.GenerateUuid(), "-", "")[:12]
}

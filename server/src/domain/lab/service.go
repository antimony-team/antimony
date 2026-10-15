package lab

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/samber/lo"
	"gopkg.in/yaml.v3"

	"github.com/antimony-team/antimony-server/auth"
	"github.com/antimony-team/antimony-server/clabtypes"
	"github.com/antimony-team/antimony-server/config"
	"github.com/antimony-team/antimony-server/domain/schema"
	"github.com/antimony-team/antimony-server/domain/statusmessage"
	"github.com/antimony-team/antimony-server/domain/topology"
	"github.com/antimony-team/antimony-server/domain/user"
	"github.com/antimony-team/antimony-server/policy"
	"github.com/antimony-team/antimony-server/socket"
	"github.com/antimony-team/antimony-server/storage"
	"github.com/antimony-team/antimony-server/utils"
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

		topologyPolicyEngine *policy.Engine

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
	topologyPolicyEngine *policy.Engine,
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
		topologyPolicyEngine:   topologyPolicyEngine,
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

	topologyDefinitionString, topologyAnnotationsString, _, err := s.topologyService.LoadTopology(
		labTopology.UUID,
		[]topology.BindFile{},
	)
	if err != nil {
		log.Error(
			"Failed to read definition of topology at lab creation",
			"topology", labTopology.UUID,
			"error", err.Error(),
		)
		return "", utils.ErrAntimony
	}

	var topologyDefinitionRaw any
	var topologyDefinition clabtypes.TopologyDefinition

	if err := s.schemaService.Parse(topologyDefinitionString, &topologyDefinition, &topologyDefinitionRaw); err != nil {
		log.Error(
			"Failed to parse topology definition at lab creation",
			"topology", labTopology.UUID,
			"error", err.Error(),
		)

		return "", utils.ErrAntimony
	}

	bindFiles, err := s.topologyRepo.GetBindFileForTopology(ctx, labTopology.UUID)
	if err != nil {
		log.Error(
			"Failed to get bind files for topology at lab creation",
			"topology", labTopology.UUID,
			"error", err.Error(),
		)
		return "", utils.ErrAntimony
	}

	// If the policy is enabled and the user is not an admin, the topology can't contain any unsafe features
	if s.config.Security.TopologyPolicy && !authUser.IsAdmin {
		bindFilePaths := lo.Map(bindFiles, func(bindFile topology.BindFile, index int) string {
			return bindFile.FilePath
		})

		findings := s.topologyPolicyEngine.Check(
			labTopology.UUID,
			topologyDefinitionRaw,
			topologyDefinition.Topology,
			topologyDefinitionString,
			bindFilePaths,
		)

		if len(findings) > 0 {
			return "", utils.ErrUnsafeTopology
		}
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
		TopologyDefinition:  &topologyDefinitionString,
		TopologyAnnotations: &topologyAnnotationsString,
	}

	var instanceName string
	if instanceName, err = s.createLabEnvironment(lab); err != nil {
		log.Error(
			"Failed to create lab environment",
			"topology", labTopology.UUID,
			"error", err.Error(),
		)
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

// renameTopology reads a topology and returns its definition with the given name.
func (s *Service) renameTopology(topologyId string, topologyName string, runTopologyDefinition *string) error {
	var definitionString string
	if err := s.storageManager.ReadTopology(topologyId, &definitionString, new(string)); err != nil {
		return err
	}

	renamed, err := renameDefinition(definitionString, topologyName)
	if err != nil {
		return err
	}

	*runTopologyDefinition = renamed
	return nil
}

// renameDefinition returns a topology definition with the given name. Only the value of the name changes,
// everything else is written back as it was, including comments, anchors, the notation of links and the
// fields Antimony doesn't know.
func renameDefinition(definition string, name string) (string, error) {
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(definition), &document); err != nil {
		return "", err
	}

	if len(document.Content) == 0 || document.Content[0].Kind != yaml.MappingNode {
		return "", utils.ErrInvalidTopology
	}

	// Other fields that are aliases of the name keep the old one
	if nameNode := utils.MappingValue(document.Content[0], "name"); nameNode != nil && nameNode.Anchor != "" {
		utils.DetachAliases(&document, nameNode)
		nameNode.Anchor = ""
	}

	utils.SetMappingValue(document.Content[0], "name", name)

	return utils.EncodeYaml(&document)
}

// instanceNameSuffix returns a short, unique, containerlab-safe suffix for an instance name.
func instanceNameSuffix() string {
	return strings.ReplaceAll(utils.GenerateUuid(), "-", "")[:12]
}

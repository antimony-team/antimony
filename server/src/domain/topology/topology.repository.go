package topology

import (
	"antimonyBackend/utils"
	"context"
	"github.com/charmbracelet/log"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type (
	Repository interface {
		GetAll(ctx context.Context) ([]Topology, error)
		GetByUuid(ctx context.Context, topologyId string) (*Topology, error)
		GetByName(ctx context.Context, topologyName string, collectionId string) ([]Topology, error)
		GetFromCollections(ctx context.Context, collectionNames []string) ([]Topology, error)

		Create(ctx context.Context, topology *Topology) error
		Update(ctx context.Context, topology *Topology) error
		Delete(ctx context.Context, topology *Topology) error

		GetBindFileByUuid(ctx context.Context, bindFileId string) (*BindFile, error)
		GetBindFileForTopology(ctx context.Context, topologyId string) ([]BindFile, error)
		CreateBindFile(ctx context.Context, bindFile *BindFile) error
		UpdateBindFile(ctx context.Context, bindFile *BindFile) error
		DeleteBindFile(ctx context.Context, bindFile *BindFile) error
		DoesBindFilePathExist(ctx context.Context, bindFilePath string, topologyId string, excludeString string) (bool, error)
		BindFileToOut(bindFile BindFile, content string) BindFileOut
	}

	topologyRepository struct {
		db *gorm.DB
	}
)

func CreateRepository(db *gorm.DB) Repository {
	return &topologyRepository{
		db: db,
	}
}

func (r *topologyRepository) GetAll(ctx context.Context) ([]Topology, error) {
	var topologies []Topology
	result := r.db.WithContext(ctx).
		Preload(clause.Associations).
		Find(&topologies)

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch all topologies. Error: %s", result.Error.Error())
		return nil, utils.ErrorDatabaseError
	}

	return topologies, nil
}

func (r *topologyRepository) GetByUuid(ctx context.Context, topologyId string) (*Topology, error) {
	var topology Topology
	result := r.db.WithContext(ctx).Where("uuid = ?", topologyId).
		Preload("Collection").
		Preload("Creator").
		Find(&topology)

	if result.RowsAffected < 1 {
		return nil, utils.ErrorUuidNotFound
	}

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch topology by UUID. Error: %s", result.Error.Error())
		return nil, utils.ErrorDatabaseError
	}

	return &topology, nil
}

func (r *topologyRepository) GetByName(ctx context.Context, topologyName string, collectionId string) ([]Topology, error) {
	var topologies []Topology
	result := r.db.WithContext(ctx).
		Joins("JOIN collections ON collections.id = topologies.collection_id").
		Where("topologies.name = ? AND collections.uuid = ? AND topologies.deleted_at IS NULL", topologyName, collectionId).
		Limit(1).
		Find(&topologies)

	if result.RowsAffected < 1 {
		return topologies, nil
	}

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch topologies by name. Error: %s", result.Error.Error())
		return nil, utils.ErrorDatabaseError
	}

	return topologies, nil
}

func (r *topologyRepository) GetFromCollections(ctx context.Context, collectionNames []string) ([]Topology, error) {
	var topologies []Topology
	result := r.db.WithContext(ctx).
		Preload(clause.Associations).
		Joins("JOIN collections ON collections.id = topologies.collection_id").
		Where("collections.name IN ?", collectionNames).
		Find(&topologies)

	if result.RowsAffected < 1 {
		return topologies, nil
	}

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch topologies from collections. Error: %s", result.Error.Error())
		return nil, utils.ErrorDatabaseError
	}

	return topologies, nil
}

func (r *topologyRepository) Create(ctx context.Context, topology *Topology) error {
	if err := r.db.WithContext(ctx).Create(topology).Error; err != nil {
		log.Errorf("[DB] Failed to create topology. Error: %s", err.Error())
		return utils.ErrorDatabaseError
	}

	return nil
}

func (r *topologyRepository) Update(ctx context.Context, topology *Topology) error {
	if err := r.db.WithContext(ctx).Save(topology).Error; err != nil {
		log.Errorf("[DB] Failed to update topology. Error: %s", err.Error())
		return utils.ErrorDatabaseError
	}

	return nil
}

func (r *topologyRepository) Delete(ctx context.Context, topology *Topology) error {
	if err := r.db.WithContext(ctx).Delete(topology).Error; err != nil {
		log.Errorf("[DB] Failed to delete topology. Error: %s", err.Error())
		return utils.ErrorDatabaseError
	}

	return nil
}

func (r *topologyRepository) GetBindFileByUuid(ctx context.Context, bindFileId string) (*BindFile, error) {
	var bindFile BindFile
	result := r.db.WithContext(ctx).
		Preload("Topology").
		Where("uuid = ?", bindFileId).
		Find(&bindFile)

	if result.RowsAffected < 1 {
		return nil, utils.ErrorUuidNotFound
	}

	if result.Error != nil {
		log.Errorf("[DB] Failed to find bind file by UUID. Error: %s", result.Error.Error())
		return nil, utils.ErrorDatabaseError
	}

	return &bindFile, nil
}

func (r *topologyRepository) GetBindFileForTopology(ctx context.Context, topologyId string) ([]BindFile, error) {
	var bindFiles []BindFile
	result := r.db.WithContext(ctx).
		Preload("Topology").
		Joins("JOIN topologies ON topologies.id = bind_files.topology_id").
		Where("topologies.uuid = ?", topologyId).
		Find(&bindFiles)
	
	if result.Error != nil {
		log.Errorf("[DB] Failed to find bind files by topology. Error: %s", result.Error.Error())
		return nil, utils.ErrorDatabaseError
	}

	return bindFiles, nil
}

func (r *topologyRepository) CreateBindFile(ctx context.Context, bindFile *BindFile) error {
	if err := r.db.WithContext(ctx).Create(bindFile).Error; err != nil {
		log.Errorf("[DB] Failed to create bind file. Error: %s", err.Error())
		return utils.ErrorDatabaseError
	}

	return nil
}

func (r *topologyRepository) UpdateBindFile(ctx context.Context, bindFile *BindFile) error {
	if err := r.db.WithContext(ctx).Save(bindFile).Error; err != nil {
		log.Errorf("[DB] Failed to update bind file. Error: %s", err.Error())
		return utils.ErrorDatabaseError
	}

	return nil
}

func (r *topologyRepository) DeleteBindFile(ctx context.Context, bindFile *BindFile) error {
	if err := r.db.WithContext(ctx).Delete(bindFile).Error; err != nil {
		log.Errorf("[DB] Failed to update delete file. Error: %s", err.Error())
		return utils.ErrorDatabaseError
	}

	return nil
}

func (r *topologyRepository) BindFileToOut(bindFile BindFile, content string) BindFileOut {
	return BindFileOut{
		ID:         bindFile.UUID,
		FilePath:   bindFile.FilePath,
		Content:    content,
		TopologyId: bindFile.Topology.UUID,
	}
}

func (r *topologyRepository) DoesBindFilePathExist(ctx context.Context, bindFilePath, topologyId, excludeUUID string) (bool, error) {
	var bindFile BindFile
	result := r.db.WithContext(ctx).
		Joins("JOIN topologies ON topologies.id = bind_files.topology_id").
		Where("bind_files.file_path = ? AND topologies.uuid = ? AND bind_files.uuid != ?", bindFilePath, topologyId, excludeUUID).
		Limit(1).
		Find(&bindFile)

	if result.Error != nil {
		log.Errorf("[DB] Failed to check if bind file exist. Error: %s", result.Error.Error())
		return false, utils.ErrorDatabaseError
	}

	return result.RowsAffected > 0, nil
}

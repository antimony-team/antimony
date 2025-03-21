package topology

import (
	"antimonyBackend/utils"
	"context"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type (
	Repository interface {
		GetAll(ctx context.Context) ([]Topology, error)
		GetByUuid(ctx context.Context, topologyId string) (*Topology, error)
		GetFromCollections(ctx context.Context, collectionNames []string) ([]Topology, error)
		DoesNameExist(ctx context.Context, topologyName string, collectionId string) (bool, error)
		Create(ctx context.Context, topology *Topology) error
		Update(ctx context.Context, topology *Topology) error
		Delete(ctx context.Context, topology *Topology) error

		GetBindFileByUuid(ctx context.Context, bindFileId string) (*BindFile, error)
		GetBindFileForTopology(ctx context.Context, topologyId string) (*[]BindFile, error)
		CreateBindFile(ctx context.Context, bindFile *BindFile) error
		UpdateBindFile(ctx context.Context, bindFile *BindFile) error
		DeleteBindFile(ctx context.Context, bindFile *BindFile) error
		DoesBindFilePathExist(ctx context.Context, bindFilePath string, topologyId string) (bool, error)
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
	result := r.db.WithContext(ctx).Preload(clause.Associations).Find(&topologies)

	return topologies, result.Error
}

func (r *topologyRepository) GetFromCollections(ctx context.Context, collectionNames []string) ([]Topology, error) {
	var topologies []Topology
	result := r.db.WithContext(ctx).
		Preload(clause.Associations).
		Joins("JOIN collections ON collections.id = topologies.collection_id").
		Where("collections.name IN ?", collectionNames).
		Find(&topologies)

	return topologies, result.Error
}

func (r *topologyRepository) DoesNameExist(ctx context.Context, topologyName string, collectionId string) (bool, error) {
	var topology Topology
	result := r.db.WithContext(ctx).
		Joins("JOIN collections ON collections.id = topologies.collection_id").
		Where("topologies.name = ? AND collections.uuid = ? AND topologies.deleted_at IS NULL", topologyName, collectionId).
		Limit(1).
		Find(&topology)

	return result.RowsAffected > 0, result.Error
}

func (r *topologyRepository) GetByUuid(ctx context.Context, topologyId string) (*Topology, error) {
	var topology Topology
	result := r.db.WithContext(ctx).Where("uuid = ?", topologyId).
		Preload("Collection").
		Preload("Creator").
		First(&topology)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return &topology, result.Error
}

func (r *topologyRepository) Create(ctx context.Context, topology *Topology) error {
	return r.db.WithContext(ctx).Create(topology).Error
}

func (r *topologyRepository) Update(ctx context.Context, topology *Topology) error {
	return r.db.WithContext(ctx).Save(topology).Error
}

func (r *topologyRepository) Delete(ctx context.Context, topology *Topology) error {
	return r.db.WithContext(ctx).Delete(topology).Error
}

func (r *topologyRepository) GetBindFileByUuid(ctx context.Context, bindFileId string) (*BindFile, error) {
	var bindFile BindFile
	result := r.db.WithContext(ctx).Preload("Topology").Where("uuid = ?", bindFileId).First(&bindFile)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return &bindFile, result.Error
}

func (r *topologyRepository) GetBindFileForTopology(ctx context.Context, topologyId string) (*[]BindFile, error) {
	var bindFiles []BindFile
	result := r.db.WithContext(ctx).
		Preload("Topology").
		Joins("JOIN topologies ON topologies.id = bind_files.topology_id").
		Where("topologies.uuid = ?", topologyId).
		Find(&bindFiles)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return &bindFiles, result.Error
}

func (r *topologyRepository) CreateBindFile(ctx context.Context, bindFile *BindFile) error {
	return r.db.WithContext(ctx).Create(bindFile).Error
}

func (r *topologyRepository) UpdateBindFile(ctx context.Context, bindFile *BindFile) error {
	return r.db.WithContext(ctx).Save(bindFile).Error
}

func (r *topologyRepository) DeleteBindFile(ctx context.Context, bindFile *BindFile) error {
	return r.db.WithContext(ctx).Delete(bindFile).Error
}

func (r *topologyRepository) BindFileToOut(bindFile BindFile, content string) BindFileOut {
	return BindFileOut{
		ID:         bindFile.UUID,
		FilePath:   bindFile.FilePath,
		Content:    content,
		TopologyId: bindFile.Topology.UUID,
	}
}

func (r *topologyRepository) DoesBindFilePathExist(ctx context.Context, bindFilePath string, topologyId string) (bool, error) {
	var bindFile BindFile
	result := r.db.WithContext(ctx).
		Joins("JOIN topologies ON topologies.id = bind_files.topology_id").
		Where("bind_files.file_path = ? AND topologies.uuid = ?", bindFilePath, topologyId).
		Limit(1).
		Find(&bindFile)

	return result.RowsAffected > 0, result.Error
}

package topology

import (
	"antimonyBackend/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		GetAll(ctx context.Context) ([]Topology, error)
		GetByUuid(ctx context.Context, topologyId string) (*Topology, error)
		GetFromCollections(ctx context.Context, collectionNames []string) ([]Topology, error)
		Create(ctx context.Context, topology *Topology) error
		Update(ctx context.Context, topology *Topology) error
		Delete(ctx context.Context, topology *Topology) error
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
	collections := make([]Topology, 0)
	result := r.db.WithContext(ctx).Preload("Collection").Preload("Creator").Find(&collections)

	return collections, result.Error
}

func (r *topologyRepository) GetFromCollections(ctx context.Context, collectionNames []string) ([]Topology, error) {
	var topologies []Topology
	result := r.db.WithContext(ctx).
		Joins("JOIN collections ON collections.id = topologies.collection_id").
		Joins("JOIN users ON users.id = topologies.creator_id").
		Where("collections.name IN ?", collectionNames).
		Find(&topologies)

	return topologies, result.Error
}

func (r *topologyRepository) GetByUuid(ctx context.Context, topologyId string) (*Topology, error) {
	topology := &Topology{}
	result := r.db.WithContext(ctx).Where("uuid = ?", topologyId).Preload("Collection").Preload("Creator").First(topology)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return topology, result.Error
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

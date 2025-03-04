package topology

import (
	"antimonyBackend/src/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Get(ctx context.Context) ([]Topology, error)
		GetByUuid(ctx context.Context, topologyId string) (*Topology, error)
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

func (r *topologyRepository) Get(ctx context.Context) ([]Topology, error) {
	topologies := make([]Topology, 0)
	result := r.db.WithContext(ctx).Preload("Collection").Preload("Creator").Find(&topologies)

	return topologies, result.Error
}

func (r *topologyRepository) GetByUuid(ctx context.Context, topologyId string) (*Topology, error) {
	topology := &Topology{}
	result := r.db.WithContext(ctx).Where("uuid = ?", topologyId).First(topology)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return topology, utils.ErrorUuidNotFound
	}

	return topology, r.db.Error
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

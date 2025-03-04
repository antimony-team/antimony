package lab

import (
	"antimonyBackend/src/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Get(ctx context.Context) ([]Lab, error)
		Create(ctx context.Context, lab *Lab) error
		Update(ctx context.Context, lab *Lab) error
		Delete(ctx context.Context, lab *Lab) error
	}

	labRepository struct {
		db *gorm.DB
	}
)

func CreateRepository(db *gorm.DB) Repository {
	return &labRepository{
		db: db,
	}
}

func (r *labRepository) Get(ctx context.Context) ([]Collection, error) {
	topologies := make([]Collection, 0)
	result := r.db.WithContext(ctx).Preload("Creator").Find(&topologies)

	return topologies, result.Error
}

func (r *labRepository) GetByUuid(ctx context.Context, topologyId string) (*Collection, error) {
	topology := &Collection{}
	result := r.db.WithContext(ctx).Where("uuid = ?", topologyId).Preload("Creator").First(topology)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return topology, utils.ErrorUuidNotFound
	}

	return topology, r.db.Error
}

func (r *labRepository) Create(ctx context.Context, topology *Collection) error {
	return r.db.WithContext(ctx).Create(topology).Error
}

func (r *labRepository) Update(ctx context.Context, topology *Collection) error {
	return r.db.WithContext(ctx).Save(topology).Error
}

func (r *labRepository) Delete(ctx context.Context, topology *Collection) error {
	return r.db.WithContext(ctx).Delete(topology).Error
}

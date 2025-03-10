package lab

import (
	"antimonyBackend/src/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Get() ([]*Lab, error)
		GetByUuid(ctx context.Context, labId string) (*Lab, error)
		GetFromCollections(ctx context.Context, collectionNames []string) ([]Lab, error)
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

func (r *labRepository) Get() ([]*Lab, error) {
	labs := make([]*Lab, 0)
	result := r.db.
		Preload("Topology.Collection").
		Preload("Creator").
		Order("start_time").
		Find(&labs)

	return labs, result.Error
}

func (r *labRepository) GetFromCollections(ctx context.Context, collectionNames []string) ([]Lab, error) {
	labs := make([]Lab, 0)
	result := r.db.WithContext(ctx).
		Joins("JOIN topologies ON topologies.uuid = labs.topology_id").
		Joins("JOIN collections ON collections.uuid = topologies.collection_id").
		Where("collections.name IN ?", collectionNames).
		Find(&labs)

	return labs, result.Error
}

func (r *labRepository) GetByUuid(ctx context.Context, labId string) (*Lab, error) {
	lab := &Lab{}
	result := r.db.WithContext(ctx).Where("uuid = ?", labId).Preload("Creator").Preload("Topology").First(labId)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return lab, result.Error
}

func (r *labRepository) Create(ctx context.Context, lab *Lab) error {
	return r.db.WithContext(ctx).Create(lab).Error
}

func (r *labRepository) Update(ctx context.Context, lab *Lab) error {
	return r.db.WithContext(ctx).Save(lab).Error
}

func (r *labRepository) Delete(ctx context.Context, lab *Lab) error {
	return r.db.WithContext(ctx).Delete(lab).Error
}

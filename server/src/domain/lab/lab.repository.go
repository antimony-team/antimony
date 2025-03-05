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
		GetByUuid(ctx context.Context, labId string) (*Lab, error)
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

func (r *labRepository) Get(ctx context.Context) ([]Lab, error) {
	labs := make([]Lab, 0)
	result := r.db.WithContext(ctx).Preload("Creator").Preload("Topology").Find(&labs)

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

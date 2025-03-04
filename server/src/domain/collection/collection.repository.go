package collection

import (
	"antimonyBackend/src/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Get(ctx context.Context) ([]Collection, error)
		GetByUuid(ctx context.Context, collectionId string) (*Collection, error)
		Create(ctx context.Context, collection *Collection) error
		Update(ctx context.Context, collection *Collection) error
		Delete(ctx context.Context, collection *Collection) error
	}

	collectionRepository struct {
		db *gorm.DB
	}
)

func CreateRepository(db *gorm.DB) Repository {
	return &collectionRepository{
		db: db,
	}
}

func (r *collectionRepository) Get(ctx context.Context) ([]Collection, error) {
	collections := make([]Collection, 0)
	result := r.db.WithContext(ctx).Preload("Creator").Find(&collections)

	return collections, result.Error
}

func (r *collectionRepository) GetByUuid(ctx context.Context, collectionId string) (*Collection, error) {
	collection := &Collection{}
	result := r.db.WithContext(ctx).Where("uuid = ?", collectionId).Preload("Creator").First(collection)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return collection, utils.ErrorUuidNotFound
	}

	return collection, r.db.Error
}

func (r *collectionRepository) Create(ctx context.Context, collection *Collection) error {
	return r.db.WithContext(ctx).Create(collection).Error
}

func (r *collectionRepository) Update(ctx context.Context, collection *Collection) error {
	return r.db.WithContext(ctx).Save(collection).Error
}

func (r *collectionRepository) Delete(ctx context.Context, collection *Collection) error {
	return r.db.WithContext(ctx).Delete(collection).Error
}

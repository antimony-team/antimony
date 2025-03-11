package collection

import (
	"antimonyBackend/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		GetAll(ctx context.Context) ([]Collection, error)
		GetByNames(ctx context.Context, collectionNames []string) ([]Collection, error)
		GetByUuid(ctx context.Context, collectionId string) (*Collection, error)
		DoesNameExist(ctx context.Context, collectionName string) (bool, error)
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

func (r *collectionRepository) GetAll(ctx context.Context) ([]Collection, error) {
	collections := make([]Collection, 0)
	result := r.db.WithContext(ctx).Preload("Creator").Find(&collections)

	return collections, result.Error
}

func (r *collectionRepository) GetByNames(ctx context.Context, collectionNames []string) ([]Collection, error) {
	collections := make([]Collection, 0)
	result := r.db.WithContext(ctx).
		Preload("Creator").
		Where("Name IN ?", collectionNames).
		Find(&collections)

	return collections, result.Error
}

func (r *collectionRepository) DoesNameExist(ctx context.Context, collectionName string) (bool, error) {
	collection := &Collection{}
	result := r.db.WithContext(ctx).
		Where("name = ? AND deleted_at IS NULL", collectionName).
		Limit(1).
		Find(collection)

	return result.RowsAffected > 0, result.Error
}

func (r *collectionRepository) GetByUuid(ctx context.Context, collectionId string) (*Collection, error) {
	collection := &Collection{}
	result := r.db.WithContext(ctx).
		Preload("Creator").
		Where("uuid = ?", collectionId).
		First(collection)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return collection, result.Error
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

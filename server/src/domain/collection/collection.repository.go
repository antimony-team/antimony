package collection

import (
	"antimonyBackend/utils"
	"context"

	"github.com/charmbracelet/log"
	"gorm.io/gorm"
)

type (
	Repository interface {
		GetAll(ctx context.Context) ([]Collection, error)
		GetByUuid(ctx context.Context, collectionId string) (*Collection, error)
		GetByNames(ctx context.Context, collectionNames []string) ([]Collection, error)
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
	var collections []Collection
	result := r.db.WithContext(ctx).
		Preload("Creator").
		Find(&collections)

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch all collections. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return collections, nil
}

func (r *collectionRepository) GetByUuid(ctx context.Context, collectionId string) (*Collection, error) {
	var collection Collection
	result := r.db.WithContext(ctx).
		Preload("Creator").
		Where("uuid = ?", collectionId).
		Find(&collection)

	if result.RowsAffected < 1 {
		return nil, utils.ErrUuidNotFound
	}

	if result.Error != nil {
		log.Errorf("[DB] Failed to get collection by UUID. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return &collection, result.Error
}

func (r *collectionRepository) GetByNames(ctx context.Context, collectionNames []string) ([]Collection, error) {
	var collections []Collection
	result := r.db.WithContext(ctx).
		Preload("Creator").
		Where("Name IN ?", collectionNames).
		Find(&collections)

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch collections by names. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return collections, nil
}

func (r *collectionRepository) DoesNameExist(ctx context.Context, collectionName string) (bool, error) {
	var collection Collection
	result := r.db.WithContext(ctx).
		Where("name = ? AND deleted_at IS NULL", collectionName).
		Limit(1).
		Find(&collection)

	if result.Error != nil {
		log.Errorf("[DB] Failed to check if collection name exists. Error: %s", result.Error.Error())
		return false, utils.ErrDatabaseError
	}

	return result.RowsAffected > 0, nil
}

func (r *collectionRepository) Create(ctx context.Context, collection *Collection) error {
	if err := r.db.WithContext(ctx).Create(collection).Error; err != nil {
		log.Errorf("[DB] Failed to create collection. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

func (r *collectionRepository) Update(ctx context.Context, collection *Collection) error {
	if err := r.db.WithContext(ctx).Save(collection).Error; err != nil {
		log.Errorf("[DB] Failed to update collection. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

func (r *collectionRepository) Delete(ctx context.Context, collection *Collection) error {
	if err := r.db.WithContext(ctx).Delete(collection).Error; err != nil {
		log.Errorf("[DB] Failed to delete collection. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

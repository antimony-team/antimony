package lab

import (
	"antimonyBackend/utils"
	"context"

	"github.com/charmbracelet/log"
	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func CreateRepository(db *gorm.DB) *Repository {
	return &Repository{
		db: db,
	}
}

func (r *Repository) GetAll(ctx context.Context, labFilter *LabFilter) ([]Lab, error) {
	var labs []Lab
	query := r.db.WithContext(ctx).
		Preload("Topology").
		Preload("Collection").
		Preload("Creator").
		Order("labs.start_time")

	if labFilter != nil {
		hasCollectionFilter := len(labFilter.CollectionFilter) > 0
		hasSearchQuery := labFilter.SearchQuery != nil && len(*labFilter.SearchQuery) > 0

		if hasCollectionFilter || hasSearchQuery {
			query = query.Joins(
				"JOIN collections ON collections.id = labs.collection_id AND collections.deleted_at IS NULL",
			)
		}

		if labFilter.StartDate != nil {
			query = query.Where("labs.start_time >= ?", labFilter.StartDate)
		}

		if labFilter.EndDate != nil {
			query = query.Where("labs.end_time <= ?", labFilter.EndDate)
		}

		if hasCollectionFilter {
			query = query.Where("collections.uuid IN ?", labFilter.CollectionFilter)
		}

		if hasSearchQuery {
			query = query.Joins(
				"LEFT JOIN topologies ON topologies.id = labs.topology_id AND topologies.deleted_at IS NULL",
			)

			matchQuery := "%" + *labFilter.SearchQuery + "%"
			query = query.Where(
				"labs.name LIKE ? OR topologies.name LIKE ? OR collections.name LIKE ?",
				matchQuery, matchQuery, matchQuery,
			)
		}

		if labFilter.Limit > 0 {
			query = query.Limit(labFilter.Limit)
		}

		if labFilter.Offset > 0 {
			query = query.Offset(labFilter.Offset)
		}
	}

	result := query.Find(&labs)

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch all labs. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return labs, nil
}

func (r *Repository) GetByUuid(ctx context.Context, labId string) (*Lab, error) {
	var lab Lab
	result := r.db.WithContext(ctx).
		Preload("Topology").
		Preload("Collection").
		Preload("Creator").
		Where("uuid = ?", labId).
		Find(&lab)

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch lab by UUID. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	if result.RowsAffected < 1 {
		return nil, utils.ErrUuidNotFound
	}

	return &lab, nil
}

// GetByCollection returns all labs of the collection with the given UUID.
func (r *Repository) GetByCollection(ctx context.Context, collectionId string) ([]Lab, error) {
	var labs []Lab
	result := r.db.WithContext(ctx).
		Preload("Topology").
		Preload("Collection").
		Preload("Creator").
		Joins("JOIN collections ON collections.id = labs.collection_id").
		Where("collections.uuid = ?", collectionId).
		Find(&labs)

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch labs of collection. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return labs, nil
}

// GetByCollectionAndName returns the lab with the given name in the collection with the given name.
func (r *Repository) GetByCollectionAndName(ctx context.Context, collectionName string, labName string) (*Lab, error) {
	var lab Lab
	result := r.db.WithContext(ctx).
		Preload("Topology").
		Preload("Collection").
		Preload("Creator").
		Joins("JOIN collections ON collections.id = labs.collection_id AND collections.deleted_at IS NULL").
		Where("collections.name = ? AND labs.name = ?", collectionName, labName).
		Find(&lab)

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch lab by collection and name. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	if result.RowsAffected < 1 {
		return nil, utils.ErrLabNotFound
	}

	return &lab, nil
}

func (r *Repository) Create(ctx context.Context, lab *Lab) error {
	if err := r.db.WithContext(ctx).Create(lab).Error; err != nil {
		log.Errorf("[DB] Failed to create lab. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

func (r *Repository) Update(ctx context.Context, lab *Lab) error {
	if err := r.db.WithContext(ctx).Save(lab).Error; err != nil {
		log.Errorf("[DB] Failed to update lab. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

func (r *Repository) Delete(ctx context.Context, lab *Lab) error {
	if err := r.db.WithContext(ctx).Delete(lab).Error; err != nil {
		log.Errorf("[DB] Failed to delete lab. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

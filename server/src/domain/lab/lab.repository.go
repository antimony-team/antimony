package lab

import (
	"antimonyBackend/utils"
	"context"
	"gorm.io/gorm"
)

type (
	Repository interface {
		GetAll(labFilter *LabFilter) ([]Lab, error)
		GetByUuid(ctx context.Context, labId string) (*Lab, error)
		GetFromCollections(ctx context.Context, labFilter LabFilter, collectionNames []string) ([]Lab, error)
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

func (r *labRepository) GetAll(labFilter *LabFilter) ([]Lab, error) {
	var labs []Lab
	query := r.db.
		Preload("Topology.Collection").
		Preload("Creator").
		Order("labs.start_time")

	if labFilter != nil {
		if labFilter.StartDate != nil {
			query = query.Where("labs.start_time >= ?", labFilter.StartDate)
		}
		if labFilter.EndDate != nil {
			query = query.Where("labs.end_time <= ?", labFilter.EndDate)
		}
		if len(labFilter.CollectionFilter) > 0 {
			query = query.
				Joins("JOIN topologies ON topologies.id = labs.topology_id").
				Joins("JOIN collections ON collections.id = topologies.collection_id").
				Where("collections.uuid IN ?", labFilter.CollectionFilter)
		}
		if labFilter.SearchQuery != nil && len(*labFilter.SearchQuery) > 0 {
			matchQuery := "%" + *labFilter.SearchQuery + "%"
			query = query.
				Joins("JOIN topologies ON topologies.id = labs.topology_id").
				Joins("JOIN collections ON collections.id = topologies.collection_id").
				Where(
					"labs.name LIKE ? OR topologies.name LIKE ? OR collections.name LIKE ?",
					matchQuery, matchQuery, matchQuery,
				)
		}
		query = query.Limit(labFilter.Limit).Offset(labFilter.Offset)
	}
	result := query.Find(&labs)

	return labs, result.Error
}

func (r *labRepository) GetByUuid(ctx context.Context, labId string) (*Lab, error) {
	var lab Lab
	result := r.db.WithContext(ctx).
		Preload("Creator").
		Preload("Topology").
		Where("uuid = ?", labId).
		Limit(1).
		Find(&lab)

	if result.RowsAffected < 1 {
		return nil, utils.ErrorUuidNotFound
	}

	return &lab, result.Error
}

func (r *labRepository) GetFromCollections(ctx context.Context, labFilter LabFilter, collectionNames []string) ([]Lab, error) {
	var labs []Lab
	result := r.db.WithContext(ctx).
		Joins("JOIN topologies ON topologies.id = labs.topology_id").
		Joins("JOIN collections ON collections.id = topologies.collection_id").
		Where("collections.name IN ?", collectionNames).
		Find(&labs)

	return labs, result.Error
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

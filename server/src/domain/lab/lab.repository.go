package lab

import (
	"antimonyBackend/utils"
	"context"

	"github.com/charmbracelet/log"
	"gorm.io/gorm"
)

type (
	Repository interface {
		GetAll(ctx context.Context, labFilter *LabFilter) ([]Lab, error)
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

func (r *labRepository) GetAll(ctx context.Context, labFilter *LabFilter) ([]Lab, error) {
	var labs []Lab
	query := r.db.WithContext(ctx).
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

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch all labs. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return labs, nil
}

func (r *labRepository) GetByUuid(ctx context.Context, labId string) (*Lab, error) {
	var lab Lab
	result := r.db.WithContext(ctx).
		Preload("Topology.Collection").
		Preload("Creator").
		Where("uuid = ?", labId).
		Find(&lab)

	if result.RowsAffected < 1 {
		return nil, utils.ErrUuidNotFound
	}

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch lab by UUID. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return &lab, nil
}

func (r *labRepository) Create(ctx context.Context, lab *Lab) error {
	if err := r.db.WithContext(ctx).Create(lab).Error; err != nil {
		log.Errorf("[DB] Failed to create lab. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

func (r *labRepository) Update(ctx context.Context, lab *Lab) error {
	if err := r.db.WithContext(ctx).Save(lab).Error; err != nil {
		log.Errorf("[DB] Failed to update lab. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

func (r *labRepository) Delete(ctx context.Context, lab *Lab) error {
	if err := r.db.WithContext(ctx).Delete(lab).Error; err != nil {
		log.Errorf("[DB] Failed to delete lab. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

package statusMessage

import (
	"context"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Create(ctx context.Context, user *StatusMessage) error
		Get(ctx context.Context, userId string) ([]*StatusMessage, error)
	}

	statusMessageRepository struct {
		db *gorm.DB
	}
)

func CreateRepository(db *gorm.DB) Repository {
	return &statusMessageRepository{
		db: db,
	}
}

func (r *statusMessageRepository) Create(ctx context.Context, user *StatusMessage) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *statusMessageRepository) Get(ctx context.Context, userId string) ([]*StatusMessage, error) {
	statusMessages := make([]*StatusMessage, 0)
	result := r.db.WithContext(ctx).Where("uuid = ?", userId).Preload("Receivers").Find(&statusMessages)

	return statusMessages, result.Error
}

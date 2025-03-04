package user

import (
	"context"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Create(ctx context.Context, user *User) error
	}

	userRepository struct {
		db *gorm.DB
	}
)

func CreateRepository(db *gorm.DB) Repository {
	return &userRepository{
		db: db,
	}
}

func (r *userRepository) Create(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

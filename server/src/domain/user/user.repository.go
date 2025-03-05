package user

import (
	"antimonyBackend/src/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Create(ctx context.Context, user *User) error
		GetByUuid(ctx context.Context, uuid string) (*User, error)
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

func (r *userRepository) GetByUuid(ctx context.Context, userId string) (*User, error) {
	user := &User{}
	result := r.db.WithContext(ctx).Where("uuid = ?", userId).Preload("StatusMessages").First(user)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return user, nil
}

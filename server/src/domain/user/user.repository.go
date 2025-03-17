package user

import (
	"antimonyBackend/utils"
	"context"
	"errors"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Create(ctx context.Context, user *User) error
		Update(ctx context.Context, user *User) error
		GetByUuid(ctx context.Context, uuid string) (*User, error)
		GetBySub(ctx context.Context, openId string) (*User, bool, error)
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

func (r *userRepository) GetByUuid(ctx context.Context, userId string) (*User, error) {
	user := &User{}
	result := r.db.WithContext(ctx).Where("uuid = ?", userId).First(user)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, utils.ErrorUuidNotFound
	}

	return user, nil
}

func (r *userRepository) GetBySub(ctx context.Context, userSub string) (*User, bool, error) {
	user := &User{}
	result := r.db.WithContext(ctx).Find(&user, "sub = ?", userSub).Limit(1)

	return user, result.RowsAffected > 0, result.Error
}

func (r *userRepository) Update(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Save(user).Error
}

func (r *userRepository) Create(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

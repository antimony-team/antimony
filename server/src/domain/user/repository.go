package user

import (
	"antimonyBackend/utils"
	"context"

	"github.com/charmbracelet/log"
	"gorm.io/gorm"
)

type (
	Repository interface {
		GetByUuid(ctx context.Context, userId string) (*User, error)
		GetBySub(ctx context.Context, openId string) (*User, bool, error)

		Create(ctx context.Context, user *User) error
		Update(ctx context.Context, user *User) error
	}

	repository struct {
		db *gorm.DB
	}
)

func CreateRepository(db *gorm.DB) Repository {
	return &repository{
		db: db,
	}
}

func (r *repository) GetByUuid(ctx context.Context, userId string) (*User, error) {
	var user User
	result := r.db.WithContext(ctx).Where("uuid = ?", userId).Limit(1).Find(&user)

	if result.RowsAffected < 1 {
		return nil, utils.ErrUuidNotFound
	}

	if result.Error != nil {
		log.Errorf("[DB] Failed to fetch user by UUID. Error: %s", result.Error.Error())
		return nil, utils.ErrDatabaseError
	}

	return &user, nil
}

func (r *repository) GetBySub(ctx context.Context, userSub string) (*User, bool, error) {
	var user User
	result := r.db.WithContext(ctx).
		Limit(1).
		Find(&user, "sub = ?", userSub)

	if result.Error != nil {
		log.Errorf("[DB] Failed to get user by sub. Error: %s", result.Error.Error())
		return nil, false, utils.ErrDatabaseError
	}

	return &user, result.RowsAffected > 0, nil
}

func (r *repository) Update(ctx context.Context, user *User) error {
	if err := r.db.WithContext(ctx).Save(user).Error; err != nil {
		log.Errorf("[DB] Failed to update user. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

func (r *repository) Create(ctx context.Context, user *User) error {
	if err := r.db.WithContext(ctx).Create(user).Error; err != nil {
		log.Errorf("[DB] Failed to create user. Error: %s", err.Error())
		return utils.ErrDatabaseError
	}

	return nil
}

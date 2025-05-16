package user

import (
	"antimonyBackend/utils"
	"context"
	"gorm.io/gorm"
)

type (
	Repository interface {
		Create(ctx context.Context, user *User) error
		Update(ctx context.Context, user *User) error
		GetByUuid(ctx context.Context, userId string) (*User, error)
		GetBySub(ctx context.Context, openId string) (*User, bool, error)
		UserToOut(user User) UserOut
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
	var user User
	result := r.db.WithContext(ctx).Where("uuid = ?", userId).Limit(1).Find(&user)

	if result.RowsAffected < 1 {
		return nil, utils.ErrorUuidNotFound
	}
	
	return &user, nil
}

func (r *userRepository) GetBySub(ctx context.Context, userSub string) (*User, bool, error) {
	var user User
	result := r.db.WithContext(ctx).Find(&user, "sub = ?", userSub).Limit(1)

	return &user, result.RowsAffected > 0, result.Error
}

func (r *userRepository) Update(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Save(user).Error
}

func (r *userRepository) Create(ctx context.Context, user *User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *userRepository) UserToOut(user User) UserOut {
	return UserOut{
		ID:   user.UUID,
		Name: user.Name,
	}
}

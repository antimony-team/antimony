package user

import (
	"antimonyBackend/src/utils"
	"github.com/gin-gonic/gin"
)

type (
	Service interface {
		Login(ctx *gin.Context, req Credentials) (string, error)
		Persist(ctx *gin.Context, req User) error
	}

	userService struct {
		userRepo Repository
	}
)

func CreateService(userRepo Repository) Service {
	return &userService{
		userRepo: userRepo,
	}
}

func (u *userService) Login(ctx *gin.Context, req Credentials) (string, error) {
	// TODO: Implement
	return "", utils.ErrorInvalidCredentials
}

func (u *userService) Persist(ctx *gin.Context, req User) error {
	return u.userRepo.Create(ctx, &req)
}

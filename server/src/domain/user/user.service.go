package user

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"context"
	"github.com/gin-gonic/gin"
)

type (
	Service interface {
		UserToOut(user User) UserOut
		GetByUuid(ctx context.Context, userId string) (*User, error)
		GetAuthCodeURL(stateToken string) string
		LoginNative(req CredentialsIn) (string, string, error)
		RefreshAccessToken(authToken string) (string, error)
		AuthenticateWithCode(ctx *gin.Context, authCode string) (string, string, error)
	}

	userService struct {
		userRepo    Repository
		authManager auth.AuthManager
	}
)

func CreateService(userRepo Repository, authManager auth.AuthManager) Service {
	userService := &userService{
		userRepo:    userRepo,
		authManager: authManager,
	}

	return userService
}

func (s *userService) UserToOut(user User) UserOut {
	return UserOut{
		ID:   user.UUID,
		Name: user.Name,
	}
}

func (s *userService) RefreshAccessToken(authToken string) (string, error) {
	return s.authManager.RefreshAccessToken(authToken)
}

func (s *userService) GetByUuid(ctx context.Context, userId string) (*User, error) {
	return s.userRepo.GetByUuid(ctx, userId)
}

func (s *userService) LoginNative(req CredentialsIn) (string, string, error) {
	return s.authManager.LoginNative(req.Username, req.Password)
}

func (s *userService) GetAuthCodeURL(stateToken string) string {
	return s.authManager.GetAuthCodeURL(stateToken)
}

func (s *userService) AuthenticateWithCode(ctx *gin.Context, authCode string) (string, string, error) {
	authUser, err := s.authManager.AuthenticateWithCode(authCode, func(userSub string, userProfile string) (string, error) {
		var (
			user       *User
			userExists bool
			err        error
		)

		if user, userExists, err = s.userRepo.GetBySub(ctx, userSub); err != nil {
			return "", err
		}

		if !userExists {
			// Create the user if not registered yet
			err = s.userRepo.Create(ctx, &User{
				UUID: utils.GenerateUuid(),
				Sub:  userSub,
				Name: userProfile,
			})
		} else {
			// Update the name of the user in case it has changed
			user.Name = userProfile
			err = s.userRepo.Update(ctx, user)
		}

		return user.UUID, err
	})
	if err != nil {
		return "", "", err
	}

	if authToken, err := s.authManager.CreateAuthToken(authUser.UserId); err != nil {
		return "", "", err
	} else if accessToken, err := s.authManager.CreateAccessToken(*authUser); err != nil {
		return "", "", err
	} else {
		return authToken, accessToken, nil
	}
}

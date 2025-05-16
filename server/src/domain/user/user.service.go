package user

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"context"
	"errors"
	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
)

type (
	Service interface {
		GetByUuid(ctx context.Context, userId string) (*User, error)
		GetAuthCodeURL(stateToken string) (string, error)
		LoginNative(req CredentialsIn) (string, string, error)
		IsTokenValid(accessToken string) bool
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

	if _, err := userRepo.GetByUuid(context.Background(), auth.NativeUserID); errors.Is(err, utils.ErrorUuidNotFound) {
		nativeUser := &User{
			UUID: auth.NativeUserID,
			Sub:  "Admin",
			Name: "Admin",
		}
		if err := userRepo.Create(context.Background(), nativeUser); err != nil {
			log.Fatal("Failed to register native user in database")
		}
	}

	return userService
}

func (s *userService) IsTokenValid(accessToken string) bool {
	_, err := s.authManager.AuthenticateUser(accessToken)
	return err == nil
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

func (s *userService) GetAuthCodeURL(stateToken string) (string, error) {
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
			user = &User{
				UUID: utils.GenerateUuid(),
				Sub:  userSub,
				Name: userProfile,
			}
			err = s.userRepo.Create(ctx, user)
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

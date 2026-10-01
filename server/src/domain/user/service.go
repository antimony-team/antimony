package user

import (
	"antimonyBackend/auth"
	"antimonyBackend/utils"
	"context"
	"errors"

	"github.com/charmbracelet/log"
)

type Service struct {
	repo        *Repository
	authManager *auth.Manager
}

func CreateService(repo *Repository, authManager *auth.Manager) *Service {
	userService := &Service{
		repo:        repo,
		authManager: authManager,
	}

	if _, err := repo.GetByUuid(context.Background(), auth.NativeUserID); errors.Is(err, utils.ErrUuidNotFound) {
		nativeUser := &User{
			UUID: auth.NativeUserID,
			Sub:  "Admin",
			Name: "Admin",
		}
		if err := repo.Create(context.Background(), nativeUser); err != nil {
			log.Fatal("Failed to register native user in database")
		}
	}

	return userService
}

func (s *Service) IsTokenValid(accessToken string) bool {
	_, err := s.authManager.AuthenticateUser(accessToken)
	return err == nil
}

func (s *Service) RefreshAccessToken(authToken string) (string, error) {
	return s.authManager.RefreshAccessToken(authToken)
}

func (s *Service) GetByUuid(ctx context.Context, userId string) (*User, error) {
	return s.repo.GetByUuid(ctx, userId)
}

func (s *Service) LoginNative(req CredentialsIn) (string, string, error) {
	return s.authManager.LoginNative(req.Username, req.Password)
}

// CreateNativeUser registers a non-admin native user that has access to the given collections and returns
// its ID. Only admins may create users.
func (s *Service) CreateNativeUser(
	ctx context.Context,
	req NativeUserIn,
	authUser auth.AuthenticatedUser,
) (string, error) {
	if !authUser.IsAdmin {
		return "", utils.ErrForbidden
	}

	userId := utils.GenerateUuid()
	if err := s.authManager.RegisterNativeUser(userId, req.Username, req.Password, req.Collections); err != nil {
		return "", err
	}

	if err := s.repo.Create(ctx, &User{UUID: userId, Sub: req.Username, Name: req.Username}); err != nil {
		return "", err
	}

	return userId, nil
}

func (s *Service) GetAuthCodeURL(stateToken string) (string, error) {
	return s.authManager.GetAuthCodeURL(stateToken)
}

func (s *Service) AuthenticateWithCode(ctx context.Context, authCode string) (string, string, error) {
	authUser, err := s.authManager.AuthenticateWithCode(
		authCode,
		func(userSub string, userProfile string) (string, error) {
			var (
				user       *User
				userExists bool
				err        error
			)

			if user, userExists, err = s.repo.GetBySub(ctx, userSub); err != nil {
				return "", err
			}

			if !userExists {
				// Create the user if not registered yet
				user = &User{
					UUID: utils.GenerateUuid(),
					Sub:  userSub,
					Name: userProfile,
				}
				err = s.repo.Create(ctx, user)
			} else {
				// Update the name of the user in case it has changed
				user.Name = userProfile
				err = s.repo.Update(ctx, user)
			}

			return user.UUID, err
		},
	)
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

func (s *Service) GetAuthConfig() auth.AuthConfig {
	return s.authManager.GetAuthConfig()
}

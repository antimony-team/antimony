package user

import (
	"antimonyBackend/auth"
	"antimonyBackend/config"
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"testing"
)

type mockAuthManager struct {
	mock.Mock
}

func (m *mockAuthManager) Init(config *config.AntimonyConfig) {
	m.Called(config)
}
func (m *mockAuthManager) CreateAuthToken(userId string) (string, error) {
	args := m.Called(userId)
	return args.String(0), args.Error(1)
}
func (m *mockAuthManager) CreateAccessToken(user auth.AuthenticatedUser) (string, error) {
	args := m.Called(user)
	return args.String(0), args.Error(1)
}
func (m *mockAuthManager) AuthenticateUser(token string) (*auth.AuthenticatedUser, error) {
	args := m.Called(token)
	return args.Get(0).(*auth.AuthenticatedUser), args.Error(1)
}
func (m *mockAuthManager) LoginNative(username string, password string) (string, string, error) {
	args := m.Called(username, password)
	return args.String(0), args.String(1), args.Error(2)
}
func (m *mockAuthManager) GetAuthCodeURL(stateToken string) (string, error) {
	args := m.Called(stateToken)
	return args.String(0), args.Error(1)
}
func (m *mockAuthManager) AuthenticateWithCode(
	authCode string,
	userSubToIdMapper func(string, string) (string, error),
) (*auth.AuthenticatedUser, error) {
	args := m.Called(authCode, userSubToIdMapper)
	user, _ := args.Get(0).(*auth.AuthenticatedUser)
	return user, args.Error(1)
}
func (m *mockAuthManager) AuthenticatorMiddleware() gin.HandlerFunc {
	args := m.Called()
	return args.Get(0).(gin.HandlerFunc)
}
func (m *mockAuthManager) RefreshAccessToken(authToken string) (string, error) {
	args := m.Called(authToken)
	return args.String(0), args.Error(1)
}
func (m *mockAuthManager) RegisterTestUser(user auth.AuthenticatedUser) (string, error) {
	args := m.Called(user)
	return args.String(0), args.Error(1)
}

type mockUserRepo struct {
	mock.Mock
}

func (m *mockUserRepo) Create(ctx context.Context, usr *User) error {
	args := m.Called(ctx, usr)
	return args.Error(0)
}
func (m *mockUserRepo) Update(ctx context.Context, usr *User) error {
	args := m.Called(ctx, usr)
	return args.Error(0)
}
func (m *mockUserRepo) GetByUuid(ctx context.Context, uuid string) (*User, error) {
	args := m.Called(ctx, uuid)
	var usr *User
	if val := args.Get(0); val != nil {
		usr = val.(*User)
	}
	return usr, args.Error(1)
}
func (m *mockUserRepo) GetBySub(ctx context.Context, sub string) (*User, bool, error) {
	args := m.Called(ctx, sub)
	return args.Get(0).(*User), args.Bool(1), args.Error(2)
}
func (m *mockUserRepo) UserToOut(user User) UserOut {
	return UserOut{
		ID:   user.UUID,
		Name: user.Name,
	}
}

func TestAuthenticateWithCode(t *testing.T) {
	testCases := []struct {
		name       string
		mockSetup  func(mAuth *mockAuthManager, mRepo *mockUserRepo)
		expectErr  bool
		expectUUID string
	}{
		{
			name: "creates new user",
			mockSetup: func(mAuth *mockAuthManager, mRepo *mockUserRepo) {
				// Simulate user not found, so Create will be called
				mRepo.On("GetBySub", mock.Anything, "sub123").
					Return(&User{}, false, nil)
				mRepo.On("GetByUuid", mock.Anything, "00000000-0000-0000-0000-00000000000").
					Return(nil, nil)
				mRepo.On("Create", mock.Anything, mock.AnythingOfType("*user.User")).
					Return(nil)

				mAuth.On("AuthenticateWithCode", "authCode123", mock.Anything).
					Run(func(args mock.Arguments) {
						mapper := args.Get(1).(func(string, string) (string, error))
						uuid, err := mapper("sub123", "John")
						assert.NotEmpty(t, uuid)
						assert.NoError(t, err)
					}).
					Return(&auth.AuthenticatedUser{UserId: "uuid-123"}, nil)

				mAuth.On("CreateAuthToken", "uuid-123").
					Return("auth-token", nil)

				mAuth.On("CreateAccessToken", auth.AuthenticatedUser{UserId: "uuid-123"}).
					Return("access-token", nil)
			},
			expectErr:  false,
			expectUUID: "uuid-123",
		},
		{
			name: "updates existing user",
			mockSetup: func(mAuth *mockAuthManager, mRepo *mockUserRepo) {
				mRepo.On("GetBySub", mock.Anything, "sub123").
					Return(&User{UUID: "uuid-123"}, true, nil)

				mRepo.On("Update", mock.Anything, mock.AnythingOfType("*user.User")).
					Return(nil)

				mAuth.On("AuthenticateWithCode", "authCode123", mock.Anything).
					Run(func(args mock.Arguments) {
						mapper := args.Get(1).(func(string, string) (string, error))
						uuid, err := mapper("sub123", "John")
						assert.Equal(t, "uuid-123", uuid)
						assert.NoError(t, err)
					}).
					Return(&auth.AuthenticatedUser{UserId: "uuid-123"}, nil)
				mRepo.On("GetByUuid", mock.Anything, "00000000-0000-0000-0000-00000000000").
					Return(&User{UUID: "uuid-123"}, nil)
				mAuth.On("CreateAuthToken", "uuid-123").
					Return("auth-token", nil)

				mAuth.On("CreateAccessToken", auth.AuthenticatedUser{UserId: "uuid-123"}).
					Return("access-token", nil)
			},
			expectErr:  false,
			expectUUID: "uuid-123",
		},
		{
			name: "fails in AuthenticateWithCode",
			mockSetup: func(mAuth *mockAuthManager, mRepo *mockUserRepo) {
				mRepo.On("GetByUuid", mock.Anything, "00000000-0000-0000-0000-00000000000").
					Return(&User{UUID: "uuid-123"}, nil)
				mAuth.On("AuthenticateWithCode", "authCode123", mock.Anything).
					Return(nil, errors.New("auth failed"))
			},
			expectErr: true,
		},
		{
			name: "CreateAuthToken fails",
			mockSetup: func(mAuth *mockAuthManager, mRepo *mockUserRepo) {
				mRepo.On("GetBySub", mock.Anything, "sub123").
					Return(&User{}, false, nil)
				mRepo.On("GetByUuid", mock.Anything, "00000000-0000-0000-0000-00000000000").
					Return(&User{UUID: "uuid-123"}, nil)
				mRepo.On("Create", mock.Anything, mock.Anything).
					Return(nil)

				mAuth.On("AuthenticateWithCode", "authCode123", mock.Anything).
					Run(func(args mock.Arguments) {
						mapper := args.Get(1).(func(string, string) (string, error))
						mapper("sub123", "John")
					}).
					Return(&auth.AuthenticatedUser{UserId: "uuid-123"}, nil)

				mAuth.On("CreateAuthToken", "uuid-123").
					Return("", errors.New("token error"))
			},
			expectErr: true,
		},
	}

	for _, tt := range testCases {
		t.Run(tt.name, func(t *testing.T) {
			mockAuth := &mockAuthManager{}
			mockRepo := &mockUserRepo{}

			tt.mockSetup(mockAuth, mockRepo)

			svc := CreateService(mockRepo, mockAuth)
			authToken, accessToken, err := svc.AuthenticateWithCode(&gin.Context{}, "authCode123")

			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, "auth-token", authToken)
				assert.Equal(t, "access-token", accessToken)
			}

			mockAuth.AssertExpectations(t)
			mockRepo.AssertExpectations(t)
		})
	}
}

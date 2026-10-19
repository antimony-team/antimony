package auth

import (
	"os"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/antimony-team/antimony-server/config"
	"github.com/antimony-team/antimony-server/utils"
)

const (
	testAdminUsername = "admin"
	testAdminPassword = "admin-password"
	testDesktopToken  = "desktop-token"
)

func createTestManager(t *testing.T, methods ...config.AuthMethod) *Manager {
	t.Helper()

	t.Setenv("SB_ADMIN_USERNAME", testAdminUsername)
	t.Setenv("SB_ADMIN_PASSWORD", testAdminPassword)
	t.Setenv("SB_DESKTOP_TOKEN", testDesktopToken)
	t.Setenv("SB_JWT_SECRET", "auth-test-secret")

	manager := CreateManager(&config.AntimonyConfig{Auth: config.AuthConfig{Methods: methods}})
	require.NotNil(t, manager)

	return manager
}

/*
 * LoginNative
 */

func TestLoginNative_AdminCredentialsLogInAsTheNativeAdmin(t *testing.T) {
	manager := createTestManager(t, config.AuthMethods.Admin)

	authToken, accessToken, err := manager.LoginNative(testAdminUsername, testAdminPassword)
	require.NoError(t, err)
	assert.NotEmpty(t, authToken)

	authUser, err := manager.AuthenticateUser(accessToken)
	require.NoError(t, err)
	assert.Equal(t, NativeUserID, authUser.UserId)
	assert.True(t, authUser.IsAdmin)
}

func TestLoginNative_WrongCredentialsAreRejected(t *testing.T) {
	manager := createTestManager(t, config.AuthMethods.Admin)

	for name, credentials := range map[string][2]string{
		"wrong password":    {testAdminUsername, "nope"},
		"wrong username":    {"someone", testAdminPassword},
		"password prefix":   {testAdminUsername, testAdminPassword[:3]},
		"swapped":           {testAdminPassword, testAdminUsername},
		"empty credentials": {"", ""},
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := manager.LoginNative(credentials[0], credentials[1])
			require.ErrorIs(t, err, utils.ErrInvalidCredentials)
		})
	}
}

func TestLoginNative_DisabledIsRejected(t *testing.T) {
	manager := createTestManager(t, config.AuthMethods.Desktop)

	_, _, err := manager.LoginNative(testAdminUsername, testAdminPassword)
	require.ErrorIs(t, err, utils.ErrAdminAuthDisabledError)
}

/*
 * LoginDesktop
 */

func TestLoginDesktop_ValidTokenLogsInAsTheNativeAdmin(t *testing.T) {
	manager := createTestManager(t, config.AuthMethods.Desktop)

	accessToken, err := manager.LoginDesktop(testDesktopToken)
	require.NoError(t, err)

	authUser, err := manager.AuthenticateUser(accessToken)
	require.NoError(t, err)
	assert.Equal(t, NativeUserID, authUser.UserId)
	assert.True(t, authUser.IsAdmin)
}

func TestLoginDesktop_WrongTokenIsRejected(t *testing.T) {
	manager := createTestManager(t, config.AuthMethods.Desktop)

	for _, token := range []string{"", "wrong", testDesktopToken + " ", testDesktopToken[1:]} {
		_, err := manager.LoginDesktop(token)
		require.ErrorIs(t, err, utils.ErrDesktopTokenInvalid)
	}
}

func TestLoginDesktop_DisabledIsRejected(t *testing.T) {
	manager := createTestManager(t, config.AuthMethods.Admin)

	_, err := manager.LoginDesktop(testDesktopToken)
	require.ErrorIs(t, err, utils.ErrDesktopAuthDisabledError)
}

func TestCreateManager_NoMethodsRegisterNoNativeAdmin(t *testing.T) {
	manager := createTestManager(t)

	token, err := manager.CreateAccessToken(AuthenticatedUser{UserId: NativeUserID, IsAdmin: true})
	require.NoError(t, err)

	_, err = manager.AuthenticateUser(token)
	require.ErrorIs(t, err, utils.ErrAccessTokenInvalid)
}

/*
 * Missing secrets
 */

// fatalCaseEnv selects the CreateManager call TestCreateManager_MissingSecretIsFatal runs in a child process.
const fatalCaseEnv = "ANTIMONY_AUTH_FATAL_CASE"

func TestCreateManager_MissingSecretIsFatal(t *testing.T) {
	if fatalCase := os.Getenv(fatalCaseEnv); fatalCase != "" {
		runFatalCase(fatalCase)
		return
	}

	for _, fatalCase := range []string{"admin-username", "admin-password", "desktop-token", "openid-secret"} {
		t.Run(fatalCase, func(t *testing.T) {
			//nolint:gosec // Re-runs this test binary to observe the process exit.
			cmd := exec.Command(os.Args[0], "-test.run=^TestCreateManager_MissingSecretIsFatal$")
			cmd.Env = append(os.Environ(), fatalCaseEnv+"="+fatalCase)

			output, err := cmd.CombinedOutput()

			var exitErr *exec.ExitError
			require.ErrorAsf(t, err, &exitErr, "CreateManager must exit the process, output: %s", output)
			assert.NotEqual(t, 0, exitErr.ExitCode())
			assert.Contains(t, string(output), "not been set")
		})
	}
}

func runFatalCase(fatalCase string) {
	_ = os.Setenv("SB_ADMIN_USERNAME", testAdminUsername)
	_ = os.Setenv("SB_ADMIN_PASSWORD", testAdminPassword)
	_ = os.Setenv("SB_DESKTOP_TOKEN", testDesktopToken)
	_ = os.Setenv("SB_OIDC_SECRET", "oidc-secret")

	methods := []config.AuthMethod{config.AuthMethods.Admin}

	switch fatalCase {
	case "admin-username":
		_ = os.Unsetenv("SB_ADMIN_USERNAME")
	case "admin-password":
		_ = os.Setenv("SB_ADMIN_PASSWORD", "")
	case "desktop-token":
		methods = []config.AuthMethod{config.AuthMethods.Desktop}
		_ = os.Unsetenv("SB_DESKTOP_TOKEN")
	case "openid-secret":
		methods = []config.AuthMethod{config.AuthMethods.OpenID}
		_ = os.Unsetenv("SB_OIDC_SECRET")
	}

	CreateManager(&config.AntimonyConfig{Auth: config.AuthConfig{Methods: methods}})

	// Reaching this point means CreateManager accepted the missing secret
	os.Exit(0)
}

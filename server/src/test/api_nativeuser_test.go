package test

import (
	"antimonyBackend/domain/collection"
	"antimonyBackend/domain/topology"
	"antimonyBackend/domain/user"
	"antimonyBackend/transport"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * Development-only native users (POST /users, registered with -dev).
 *
 * They let end-to-end tests create non-admin users with a chosen set of collection memberships, which
 * native auth otherwise can't express since it only knows the single admin account.
 */

// createNativeUser creates a non-admin native user as the admin.
func createNativeUser(h *Harness, username string, collections ...string) {
	h.T.Helper()

	var userId string
	h.POST("/users", user.NativeUserIn{
		Username:    username,
		Password:    username + "-password",
		Collections: collections,
	}, h.Seed.Admin.Token).RequireOk(&userId)

	require.NotEmpty(h.T, userId)
}

// loginNative logs in via the native login and returns the access token.
func loginNative(h *Harness, username string, password string) string {
	h.T.Helper()

	response := h.POST("/users/login/native", user.CredentialsIn{Username: username, Password: password}, "")
	response.RequireEmptyOk()

	return response.RequireCookie("accessToken").Value
}

func TestCreateNativeUser_IsNotAvailableWithoutDevMode(t *testing.T) {
	h := NewHarness(t)

	h.POST("/users", user.NativeUserIn{Username: "student", Password: "student"}, h.Seed.Admin.Token).
		RequireStatus(http.StatusNotFound)
}

func TestCreateNativeUser_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	h.POST("/users", user.NativeUserIn{Username: "student", Password: "student"}, "").
		RequireError(http.StatusUnauthorized, 401)
}

func TestCreateNativeUser_NonAdminIsForbidden(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	h.POST("/users", user.NativeUserIn{Username: "student", Password: "student"}, h.Seed.Member.Token).
		RequireError(http.StatusForbidden, 403)
}

func TestCreateNativeUser_InvalidRequestsAreRejected(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	createNativeUser(h, "taken")

	cases := []struct {
		name    string
		request user.NativeUserIn
	}{
		{"empty username", user.NativeUserIn{Username: "", Password: "password"}},
		{"empty password", user.NativeUserIn{Username: "student", Password: ""}},
		{"the admin's username", user.NativeUserIn{Username: "testuser", Password: "password"}},
		{"a username that is already taken", user.NativeUserIn{Username: "taken", Password: "password"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h.POST("/users", c.request, h.Seed.Admin.Token).RequireError(http.StatusBadRequest, 1001)
		})
	}
}

func TestCreateNativeUser_CannotShadowTheAdmin(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	h.POST("/users", user.NativeUserIn{Username: "testuser", Password: "other"}, h.Seed.Admin.Token).
		RequireError(http.StatusBadRequest, 1001)

	// The admin login is unaffected and still yields an admin.
	token := loginNative(h, "testuser", "testpass")
	h.POST("/collections", collection.CollectionIn{
		Name: ptr("admin-still-works"), PublicWrite: ptr(false), PublicDeploy: ptr(false),
	}, token).RequireStatus(http.StatusOK)
}

func TestCreateNativeUser_CanLogInButNotWithTheWrongPassword(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	createNativeUser(h, "student")

	assert.NotEmpty(t, loginNative(h, "student", "student-password"))

	h.POST("/users/login/native", user.CredentialsIn{Username: "student", Password: "nope"}, "").
		RequireError(http.StatusBadRequest, 1001)
}

func TestCreateNativeUser_SeesOnlyItsCollections(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	createNativeUser(h, "student", CollectionPublicRW, CollectionPrivate)
	token := loginNative(h, "student", "student-password")

	var collections []transport.CollectionOut
	h.GET("/collections", token).RequireOk(&collections)

	assert.ElementsMatch(t, []string{CollectionPublicRW, CollectionPrivate},
		lo.Map(collections, func(c transport.CollectionOut, _ int) string { return c.Name }))
}

func TestCreateNativeUser_WithoutCollectionsSeesNothing(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	createNativeUser(h, "student")
	token := loginNative(h, "student", "student-password")

	for _, path := range []string{"/collections", "/topologies", "/labs"} {
		t.Run(path, func(t *testing.T) {
			var items []any
			h.GET(path, token).RequireOk(&items)

			assert.Empty(t, items)
		})
	}
}

func TestCreateNativeUser_PermissionsFollowTheCollectionFlags(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	createNativeUser(h, "student", CollectionPublicRW, CollectionPrivate)
	token := loginNative(h, "student", "student-password")

	t.Run("can write to a publicWrite collection it is a member of", func(t *testing.T) {
		h.POST("/topologies", topology.TopologyIn{
			Definition:   ptr(freshTopologyDefinition),
			SyncUrl:      ptr(""),
			CollectionId: ptr(h.Seed.PublicRW.UUID),
		}, token).RequireStatus(http.StatusOK)
	})

	t.Run("cannot write to a collection without publicWrite", func(t *testing.T) {
		h.POST("/topologies", topology.TopologyIn{
			Definition:   ptr(freshTopologyDefinition),
			SyncUrl:      ptr(""),
			CollectionId: ptr(h.Seed.Private.UUID),
		}, token).RequireError(http.StatusForbidden, 403)
	})

	t.Run("is not an admin", func(t *testing.T) {
		h.POST("/collections", collection.CollectionIn{
			Name: ptr("student-collection"), PublicWrite: ptr(true), PublicDeploy: ptr(true),
		}, token).RequireError(http.StatusForbidden, 403)
	})
}

func TestCreateNativeUser_ConcurrentRegistrationAndLoginIsSafe(t *testing.T) {
	h := NewHarness(t, WithDevMode())

	// Users are registered while other requests authenticate, so this guards the auth manager's
	// user maps. It only proves something under -race.
	const workers = 16

	var wait sync.WaitGroup
	errs := make(chan error, workers*2)

	for i := range workers {
		wait.Add(2)

		go func() {
			defer wait.Done()

			username := fmt.Sprintf("student-%d", i)
			if err := h.Auth.RegisterNativeUser(fmt.Sprintf("id-%d", i), username, "password", nil); err != nil {
				errs <- err
				return
			}
			if _, _, err := h.Auth.LoginNative(username, "password"); err != nil {
				errs <- err
			}
		}()

		go func() {
			defer wait.Done()

			if _, err := h.Auth.AuthenticateUser(h.Seed.Admin.Token); err != nil {
				errs <- err
			}
		}()
	}

	wait.Wait()
	close(errs)

	for err := range errs {
		require.NoError(t, err)
	}
}

package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/utils"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
)

// === GET ===
func TestGetCollections(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// Create a valid token for the test user
	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)

	// Create a GET request with the token as a cookie
	req, _ := http.NewRequest("GET", "/collections", nil)
	req.AddCookie(&http.Cookie{
		Name:  "accessToken",
		Value: token,
	})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var response utils.OkResponse[[]collection.CollectionOut]
	err = json.Unmarshal(resp.Body.Bytes(), &response)
	require.NoError(t, err)
	require.NoError(t, err)

	assert.GreaterOrEqual(t, len(response.Payload), 1)

	// ✅ Check for specific collection names
	expectedNames := map[string]bool{
		"hidden-group": true,
		"fs25-cldinf":  true,
		"fs25-nisec":   true,
		"hs25-cn1":     true,
		"hs25-cn2":     true,
	}

	for _, coll := range response.Payload {
		assert.True(t, expectedNames[coll.Name], "unexpected collection: "+coll.Name)
	}
}

func TestGetCollections_NoAccess_ReturnsEmpty(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// Simulate a non-admin user with no collection access
	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4",
		IsAdmin:     false,
		Collections: []string{},
	})
	require.NoError(t, err)

	req, _ := http.NewRequest("GET", "/collections", nil)
	req.AddCookie(&http.Cookie{
		Name:  "accessToken",
		Value: token,
	})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var response utils.OkResponse[[]collection.CollectionOut]
	err = json.Unmarshal(resp.Body.Bytes(), &response)
	require.NoError(t, err)

	// ✅ Expect no collections returned
	assert.Empty(t, response.Payload)
}

func TestGetCollections_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("GET", "/collections", nil)
	// No cookie attached
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestGetCollections_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	// Deliberately malformed token
	req, _ := http.NewRequest("GET", "/collections", nil)
	req.AddCookie(&http.Cookie{
		Name:  "accessToken",
		Value: "invalid.jwt.token",
	})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

// === POST ===
func TestCreateCollection(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1", // ✅ Admin user
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)

	name := "test-create"
	publicWrite := true
	publicDeploy := false

	newCollection := collection.CollectionIn{
		Name:         &name,
		PublicWrite:  &publicWrite,
		PublicDeploy: &publicDeploy,
	}
	payload, _ := json.Marshal(newCollection)

	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var response utils.OkResponse[string]
	err = json.Unmarshal(resp.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.NotEmpty(t, response.Payload)
}

func TestCreateCollection_Unauthorized(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id3", // Non-admin
		IsAdmin:     false,           // <--- Key part
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)

	name := "should-fail"
	publicWrite := false
	publicDeploy := false

	newCollection := collection.CollectionIn{
		Name:         &name,
		PublicWrite:  &publicWrite,
		PublicDeploy: &publicDeploy,
	}

	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	// Now this will hit the IsAdmin check and return 403
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCreateCollection_DuplicateName(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)
	name := "hidden-group"
	newCollection := collection.CollectionIn{Name: &name} // Already exists
	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestCreateCollection_Unauthorized_NoToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)
	name := "should-not-work"
	newCollection := collection.CollectionIn{Name: &name}
	payload, _ := json.Marshal(newCollection)

	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestCreateCollection_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)
	name := "bad-token"
	newCollection := collection.CollectionIn{Name: &name}
	payload, _ := json.Marshal(newCollection)

	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "invalid.token.here"})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

func TestCreateCollection_MissingName(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:  "test-user-id1",
		IsAdmin: true,
	})

	// Missing required "Name" field
	invalidPayload := `{"publicWrite": true, "publicDeploy": false}`
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBufferString(invalidPayload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

// === PATCH ===
func TestUpdateCollection_DuplicateName(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1", // Admin
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)
	name := "update-source"
	publicWrite := true
	publicDeploy := true
	// Create a collection
	initial := collection.CollectionIn{
		Name:         &name,
		PublicWrite:  &publicWrite,
		PublicDeploy: &publicDeploy,
	}
	payload, _ := json.Marshal(initial)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)
	collectionName := "hidden-group"
	// Try renaming to a name that already exists
	dup := collection.CollectionIn{Name: &collectionName}
	body, _ := json.Marshal(dup)
	req2, _ := http.NewRequest("PATCH", "/collections/"+created.Payload, bytes.NewBuffer(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp2 := httptest.NewRecorder()
	router.ServeHTTP(resp2, req2)

	assert.Equal(t, http.StatusBadRequest, resp2.Code)
}

func TestUpdateCollection(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)

	// Create
	name := "test-update"
	publicWrite := true
	publicDeploy := true

	newCollection := collection.CollectionIn{
		Name:         &name,
		PublicWrite:  &publicWrite,
		PublicDeploy: &publicDeploy,
	}

	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)

	// Update
	updateName := "updated-name"
	updatePublicWrite := false
	updatePublicDeploy := true

	updated := collection.CollectionIn{
		Name:         &updateName,
		PublicWrite:  &updatePublicWrite,
		PublicDeploy: &updatePublicDeploy,
	}
	updatePayload, _ := json.Marshal(updated)
	updateReq, _ := http.NewRequest("PATCH", "/collections/"+created.Payload, bytes.NewBuffer(updatePayload))
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	updateResp := httptest.NewRecorder()
	router.ServeHTTP(updateResp, updateReq)

	assert.Equal(t, http.StatusOK, updateResp.Code)
}

func TestUpdateCollection_InvalidID(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)
	name := "nonexistent"
	update := collection.CollectionIn{Name: &name}
	body, _ := json.Marshal(update)
	req, _ := http.NewRequest("PATCH", "/collections/not-a-real-id", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestUpdateCollection_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	// No token
	req, _ := http.NewRequest("PATCH", "/collections/some-id", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestUpdateCollection_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("PATCH", "/collections/some-id", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "malformed.token.value"})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

func TestUpdateCollection_Forbidden(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// Create a collection as admin
	adminToken, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	name := "forbidden-test"
	publicWrite := true
	publicDeploy := true
	coll := collection.CollectionIn{
		Name:         &name,
		PublicWrite:  &publicWrite,
		PublicDeploy: &publicDeploy,
	}
	body, _ := json.Marshal(coll)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: adminToken})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)

	// Try to update with a non-admin, non-creator
	userToken, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4", // Not creator, not admin
		IsAdmin:     false,
		Collections: []string{},
	})
	collectionName := "unauthorized-update"
	update := collection.CollectionIn{Name: &collectionName}
	updateBody, _ := json.Marshal(update)
	updateReq, _ := http.NewRequest("PATCH", "/collections/"+created.Payload, bytes.NewBuffer(updateBody))
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.AddCookie(&http.Cookie{Name: "accessToken", Value: userToken})
	updateResp := httptest.NewRecorder()
	router.ServeHTTP(updateResp, updateReq)

	assert.Equal(t, http.StatusForbidden, updateResp.Code)
}

func TestUpdateCollection_BadInput(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)

	// Intentionally malformed JSON
	badJSON := []byte(`{"name": "valid", "publicWrite": tru`)

	req, _ := http.NewRequest("PATCH", "/collections/some-id", bytes.NewBuffer(badJSON))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.GreaterOrEqual(t, resp.Code, 400) // Can be 400 or 422 depending on handler
}

// === DELETE ===
func TestDeleteCollection(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1", // ✅ Admin
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)

	name := "test-delete"
	publicWrite := true
	publicDeploy := true

	newCollection := collection.CollectionIn{
		Name:         &name,
		PublicWrite:  &publicWrite,
		PublicDeploy: &publicDeploy,
	}
	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)

	deleteReq, _ := http.NewRequest("DELETE", "/collections/"+created.Payload, nil)
	deleteReq.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	deleteResp := httptest.NewRecorder()
	router.ServeHTTP(deleteResp, deleteReq)

	assert.Equal(t, http.StatusOK, deleteResp.Code)
}

func TestDeleteCollection_NotFound(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	require.NoError(t, err)

	req, _ := http.NewRequest("DELETE", "/collections/not-found-id", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestDeleteCollection_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("DELETE", "/collections/some-id", nil)
	// No token attached
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestDeleteCollection_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("DELETE", "/collections/some-id", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "broken.token.here"})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

func TestDeleteCollection_Forbidden(t *testing.T) {
	router, authManager, db := SetupTestServer(t)

	// This user is not an admin and owns nothing
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id3",
		IsAdmin:     false,
		Collections: []string{},
	})
	var target collection.Collection
	err := db.Where("name = ?", "hidden-group").First(&target).Error
	require.NoError(t, err)
	// Try to delete a known collection created by someone else
	req, _ := http.NewRequest("DELETE", "/collections/"+target.UUID, nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestDeleteCollection_InvalidIDFormat(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:  "test-user-id1",
		IsAdmin: true,
	})

	req, _ := http.NewRequest("DELETE", "/collections/!!!invalidID!!!", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code) // 404 instead of 422 since it cant find id
}

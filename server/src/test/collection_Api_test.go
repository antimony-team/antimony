package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/utils"
	"bytes"
	"encoding/json"
	"github.com/stretchr/testify/assert"
	"net/http"
	"net/http/httptest"
	"testing"
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
	assert.NoError(t, err)

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
	assert.NoError(t, err)

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
	assert.NoError(t, err)

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
	assert.NoError(t, err)

	// ✅ Expect no collections returned
	assert.Len(t, response.Payload, 0)
}

func TestGetCollections_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("GET", "/collections", nil)
	// No cookie attached
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

//forbidden not testable

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
	assert.NoError(t, err)

	newCollection := collection.CollectionIn{
		Name:         "test-create",
		PublicWrite:  true,
		PublicDeploy: false,
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
	assert.NoError(t, err)
	assert.NotEmpty(t, response.Payload)
}

func TestCreateCollection_Unauthorized(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id3", // Non-admin
		IsAdmin:     false,
		Collections: []string{"hidden-group"},
	})
	assert.NoError(t, err)

	newCollection := collection.CollectionIn{Name: "should-fail"}
	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCreateCollection_DuplicateName(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	assert.NoError(t, err)

	newCollection := collection.CollectionIn{Name: "hidden-group"} // Already exists
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

	newCollection := collection.CollectionIn{Name: "should-not-work"}
	payload, _ := json.Marshal(newCollection)

	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestCreateCollection_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	newCollection := collection.CollectionIn{Name: "bad-token"}
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

// === PUT ===
func TestUpdateCollection_DuplicateName(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, err := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1", // Admin
		IsAdmin:     true,
		Collections: []string{"hidden-group"},
	})
	assert.NoError(t, err)

	// Create a collection
	initial := collection.CollectionIn{Name: "update-source"}
	payload, _ := json.Marshal(initial)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)

	// Try renaming to a name that already exists
	dup := collection.CollectionIn{Name: "hidden-group"}
	body, _ := json.Marshal(dup)
	req2, _ := http.NewRequest("PUT", "/collections/"+created.Payload, bytes.NewBuffer(body))
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
	assert.NoError(t, err)

	// Create
	newCollection := collection.CollectionIn{
		Name:         "test-update",
		PublicWrite:  true,
		PublicDeploy: true,
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
	updated := collection.CollectionIn{
		Name:         "updated-name",
		PublicWrite:  false,
		PublicDeploy: true,
	}
	updatePayload, _ := json.Marshal(updated)
	updateReq, _ := http.NewRequest("PUT", "/collections/"+created.Payload, bytes.NewBuffer(updatePayload))
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
	assert.NoError(t, err)

	update := collection.CollectionIn{Name: "nonexistent"}
	body, _ := json.Marshal(update)
	req, _ := http.NewRequest("PUT", "/collections/not-a-real-id", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestUpdateCollection_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	// No token
	req, _ := http.NewRequest("PUT", "/collections/some-id", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestUpdateCollection_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req, _ := http.NewRequest("PUT", "/collections/some-id", nil)
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

	coll := collection.CollectionIn{Name: "forbidden-test"}
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

	update := collection.CollectionIn{Name: "unauthorized-update"}
	updateBody, _ := json.Marshal(update)
	updateReq, _ := http.NewRequest("PUT", "/collections/"+created.Payload, bytes.NewBuffer(updateBody))
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
	assert.NoError(t, err)

	// Intentionally malformed JSON
	badJSON := []byte(`{"name": "valid", "publicWrite": tru`)

	req, _ := http.NewRequest("PUT", "/collections/some-id", bytes.NewBuffer(badJSON))
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
	assert.NoError(t, err)

	newCollection := collection.CollectionIn{
		Name:         "test-delete",
		PublicWrite:  true,
		PublicDeploy: true,
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
	assert.NoError(t, err)

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
	assert.NoError(t, err)
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

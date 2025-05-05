package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/collection"
	"antimonyBackend/utils"
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"net/http"
	"net/http/httptest"
	"testing"
)

// === GET ===
func TestGetCollections(t *testing.T) {
	router, _ := SetupTestServer(t)

	req, _ := http.NewRequest("GET", "/collections", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var response utils.OkResponse[[]collection.CollectionOut]
	err := json.Unmarshal(resp.Body.Bytes(), &response)
	assert.NoError(t, err)

	assert.GreaterOrEqual(t, len(response.Payload), 1)
	assert.Equal(t, "hidden-group", response.Payload[0].Name)
}

func TestGetCollections_Unauthorized(t *testing.T) {
	router, _ := SetupTestServerWithUser(t, auth.AuthenticatedUser{}) // Empty user, no token logic

	router.Use(func(c *gin.Context) {
		c.Next()
	})

	req, _ := http.NewRequest("GET", "/collections", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestGetCollections_Forbidden(t *testing.T) {
	router, _ := SetupTestServerWithUser(t, auth.AuthenticatedUser{
		IsAdmin:     false,
		UserId:      "non-admin-id1",
		Collections: []string{}, // No access
	})

	req, _ := http.NewRequest("GET", "/collections", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestGetCollections_InvalidToken(t *testing.T) {
	router, _ := SetupTestServer(t)

	// Simulate token failure
	router.Use(func(c *gin.Context) {
		c.AbortWithStatus(498)
	})

	req, _ := http.NewRequest("GET", "/collections", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

// === POST ===
func TestCreateCollection(t *testing.T) {
	router, _ := SetupTestServer(t)

	newCollection := collection.CollectionIn{
		Name:         "test-create",
		PublicWrite:  true,
		PublicDeploy: false,
	}
	payload, _ := json.Marshal(newCollection)

	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var response utils.OkResponse[string]
	err := json.Unmarshal(resp.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.NotEmpty(t, response.Payload)
}

func TestDeleteCollection(t *testing.T) {
	router, _ := SetupTestServer(t)

	newCollection := collection.CollectionIn{
		Name:         "test-delete",
		PublicWrite:  true,
		PublicDeploy: true,
	}
	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)

	// Now delete it
	deleteReq, _ := http.NewRequest("DELETE", "/collections/"+created.Payload, nil)
	deleteResp := httptest.NewRecorder()
	router.ServeHTTP(deleteResp, deleteReq)

	assert.Equal(t, http.StatusOK, deleteResp.Code)
}

func TestCreateCollection_Unauthorized(t *testing.T) {
	router, _ := SetupTestServerWithUser(t, auth.AuthenticatedUser{
		IsAdmin:     false,
		UserId:      "test-user-id2",
		Collections: []string{"hidden-group"},
	})

	router.Use(func(c *gin.Context) {
		c.Set("authUser", auth.AuthenticatedUser{
			UserId:      "test-user-id1",
			IsAdmin:     false,
			Collections: []string{"hidden-group"},
		})
		c.Next()
	})

	newCollection := collection.CollectionIn{Name: "should-fail"}
	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCreateCollection_DuplicateName(t *testing.T) {
	router, _ := SetupTestServer(t)

	newCollection := collection.CollectionIn{Name: "hidden-group"} // Exists in test data
	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

// === PUT ===
func TestUpdateCollection_DuplicateName(t *testing.T) {
	router, _ := SetupTestServer(t)

	// First, create a collection
	initial := collection.CollectionIn{Name: "update-source"}
	payload, _ := json.Marshal(initial)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)

	// Now try to rename to "hidden-group"
	dup := collection.CollectionIn{Name: "hidden-group"} // Already exists
	body, _ := json.Marshal(dup)
	req2, _ := http.NewRequest("PUT", "/collections/"+created.Payload, bytes.NewBuffer(body))
	req2.Header.Set("Content-Type", "application/json")
	resp2 := httptest.NewRecorder()
	router.ServeHTTP(resp2, req2)

	assert.Equal(t, http.StatusBadRequest, resp2.Code)
}

func TestUpdateCollection(t *testing.T) {
	router, _ := SetupTestServer(t)

	// First, create a collection
	newCollection := collection.CollectionIn{
		Name:         "test-update",
		PublicWrite:  true,
		PublicDeploy: true,
	}
	payload, _ := json.Marshal(newCollection)
	req, _ := http.NewRequest("POST", "/collections", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	var created utils.OkResponse[string]
	_ = json.Unmarshal(resp.Body.Bytes(), &created)

	// Now update it
	updated := collection.CollectionIn{
		Name:         "updated-name",
		PublicWrite:  false,
		PublicDeploy: true,
	}
	updatePayload, _ := json.Marshal(updated)
	updateReq, _ := http.NewRequest("PUT", "/collections/"+created.Payload, bytes.NewBuffer(updatePayload))
	updateReq.Header.Set("Content-Type", "application/json")
	updateResp := httptest.NewRecorder()
	router.ServeHTTP(updateResp, updateReq)

	assert.Equal(t, http.StatusOK, updateResp.Code)
}

func TestUpdateCollection_InvalidID(t *testing.T) {
	router, _ := SetupTestServer(t)

	update := collection.CollectionIn{Name: "nonexistent"}
	body, _ := json.Marshal(update)
	req, _ := http.NewRequest("PUT", "/collections/not-a-real-id", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

// === DELETE ===
func TestDeleteCollection_NotFound(t *testing.T) {
	router, _ := SetupTestServer(t)

	req, _ := http.NewRequest("DELETE", "/collections/not-found-id", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

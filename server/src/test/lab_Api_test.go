package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/lab"
	"antimonyBackend/utils"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
)

func TestGetLabs_AdminSuccess(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token := getValidAccessToken(authManager, "test-user-id1")

	req := httptest.NewRequest("GET", "/labs?limit=10&offset=0", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body utils.OkResponse[[]lab.LabOut]
	err := json.NewDecoder(resp.Body).Decode(&body)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(body.Payload), 1)
}

func TestGetLabs_UserSuccess(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token := getValidAccessToken(authManager, "test-user-id3")

	req := httptest.NewRequest("GET", "/labs?limit=10&offset=0", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body utils.OkResponse[[]lab.LabOut]
	err := json.NewDecoder(resp.Body).Decode(&body)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(body.Payload), 1)
}

func TestGetLabs_SearchQuery(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token := getValidAccessToken(authManager, "test-user-id1")

	req := httptest.NewRequest("GET", "/labs?limit=10&offset=0&searchQuery=Test", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body utils.OkResponse[[]lab.LabOut]
	err := json.NewDecoder(resp.Body).Decode(&body)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(body.Payload), 1)
}

func TestGetLabs_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/labs?limit=10&offset=0", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestGetLabs_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/labs?limit=10&offset=0", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "invalid"})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

func TestGetLabs_noLabs(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token := getValidAccessToken(authManager, "test-user-id4")

	req := httptest.NewRequest("GET", "/labs?limit=10&offset=0", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body utils.OkResponse[[]lab.LabOut]
	err := json.NewDecoder(resp.Body).Decode(&body)
	require.NoError(t, err)
	assert.Empty(t, body.Payload)
}

func TestGetLabs_FilterByState(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token := getValidAccessToken(authManager, "test-user-id1")

	req := httptest.NewRequest("GET", "/labs?limit=10&offset=0&stateFilter[]=0", nil) // filtering deploying state
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestGetLabs_BindQueryFailure(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token := getValidAccessToken(authManager, "test-user-id1")

	// Inject a type mismatch: `limit` expects an int
	req := httptest.NewRequest("GET", "/labs?limit=notAnInt", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

// === POST ===
func TestCreateLab_Success(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	name := "New Test Lab"
	topo := "TopologyTestUUID1"
	start := time.Now().Add(1 * time.Hour)
	end := time.Now().Add(2 * time.Hour)

	payload := lab.LabIn{
		Name:       &name,
		TopologyId: &topo,
		StartTime:  &start,
		EndTime:    &end,
	}
	body, _ := json.Marshal(payload)

	token := getValidAccessToken(authManager, "test-user-id1")
	req := httptest.NewRequest("POST", "/labs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var result utils.OkResponse[string]
	err := json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(t, err)
	assert.NotEmpty(t, result.Payload)
}

func TestCreateLab_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("POST", "/labs", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestCreateLab_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("POST", "/labs", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "invalid"})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

func TestCreateLab_NoDeployAccess(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	name := "Forbidden Lab"
	topo := "TopologyTestUUID1"
	start := time.Now().Add(1 * time.Hour)
	end := time.Now().Add(2 * time.Hour)

	payload := lab.LabIn{
		Name:       &name,
		TopologyId: &topo,
		StartTime:  &start,
		EndTime:    &end,
	}
	body, _ := json.Marshal(payload)

	token := getValidAccessToken(authManager, "test-user-id4") // not in collection
	req := httptest.NewRequest("POST", "/labs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCreateLab_ValidationFailure(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// Missing Name, TopologyId, etc.
	body := []byte(`{}`)

	token := getValidAccessToken(authManager, "test-user-id1")
	req := httptest.NewRequest("POST", "/labs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

// === PATCH ===
func TestUpdateLab_Success(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	name := "Updated Lab Name"
	topo := "TopologyTestUUID1"
	start := time.Now().Add(1 * time.Hour)
	end := time.Now().Add(2 * time.Hour)

	payload := lab.LabIn{
		Name:       &name,
		TopologyId: &topo,
		StartTime:  &start,
		EndTime:    &end,
	}
	body, _ := json.Marshal(payload)

	token := getValidAccessToken(authManager, "test-user-id1")
	req := httptest.NewRequest("PATCH", "/labs/TestLabUUID1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestUpdateLab_Forbidden(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	name := "Illegal Edit"
	topo := "TopologyTestUUID1"
	start := time.Now().Add(1 * time.Hour)
	end := time.Now().Add(2 * time.Hour)

	payload := lab.LabIn{
		Name:       &name,
		TopologyId: &topo,
		StartTime:  &start,
		EndTime:    &end,
	}
	body, _ := json.Marshal(payload)

	token := getValidAccessToken(authManager, "test-user-id4") // not the owner
	req := httptest.NewRequest("PATCH", "/labs/TestLabUUID1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestUpdateLab_InvalidLabId(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	name := "Missing Lab"
	topo := "TopologyTestUUID1"
	start := time.Now().Add(1 * time.Hour)
	end := time.Now().Add(2 * time.Hour)

	payload := lab.LabIn{
		Name:       &name,
		TopologyId: &topo,
		StartTime:  &start,
		EndTime:    &end,
	}

	body, _ := json.Marshal(payload)

	token := getValidAccessToken(authManager, "test-user-id1")
	req := httptest.NewRequest("PATCH", "/labs/InvalidUUID", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestUpdateLab_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	name := "No Auth"
	topo := "TopologyTestUUID1"
	start := time.Now().Add(1 * time.Hour)
	end := time.Now().Add(2 * time.Hour)

	payload := lab.LabIn{
		Name:       &name,
		TopologyId: &topo,
		StartTime:  &start,
		EndTime:    &end,
	}

	body, _ := json.Marshal(payload)

	req := httptest.NewRequest("PATCH", "/labs/TestLabUUID1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestUpdateLab_ValidationFailure(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	body := []byte(`{"name": 123}`)
	token := getValidAccessToken(authManager, "test-user-id1")

	req := httptest.NewRequest("PATCH", "/labs/TestLabUUID1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestUpdateLab_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	name := "Invalid Token Update"
	topo := "TopologyTestUUID1"
	start := time.Now().Add(1 * time.Hour)
	end := time.Now().Add(2 * time.Hour)

	payload := lab.LabIn{
		Name:       &name,
		TopologyId: &topo,
		StartTime:  &start,
		EndTime:    &end,
	}

	body, _ := json.Marshal(payload)

	req := httptest.NewRequest("PATCH", "/labs/TestLabUUID1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "invalidtoken"})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, 498, resp.Code)
}

// === DELETE ===
func TestDeleteLab_Success(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token := getValidAccessToken(authManager, "test-user-id1") // Creator/admin
	req := httptest.NewRequest("DELETE", "/labs/TestLabUUID2", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestDeleteLab_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("DELETE", "/labs/TestLabUUID2", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestDeleteLab_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("DELETE", "/labs/TestLabUUID2", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "invalid"})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

func TestDeleteLab_Forbidden(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token := getValidAccessToken(authManager, "test-user-id4") // Not owner or admin
	req := httptest.NewRequest("DELETE", "/labs/TestLabUUID2", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestDeleteLab_NotFound(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token := getValidAccessToken(authManager, "test-user-id1")
	req := httptest.NewRequest("DELETE", "/labs/NonExistingUUID", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

// helpers
func getValidAccessToken(authManager auth.AuthManager, userId string) string {
	authUser, _ := authManager.AuthenticateUser(mustToken(authManager.CreateAuthToken(userId)))
	token, _ := authManager.CreateAccessToken(*authUser)
	return token
}

func mustToken(token string, err error) string {
	if err != nil {
		panic(err)
	}
	return token
}

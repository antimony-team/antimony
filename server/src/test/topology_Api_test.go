package test

import (
	"antimonyBackend/auth"
	"antimonyBackend/domain/topology"
	"antimonyBackend/utils"
	"bytes"
	"encoding/json"
	"github.com/charmbracelet/log"
	"github.com/stretchr/testify/assert"
	"gopkg.in/yaml.v3"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var testTopo = `name: testTopo
topology:
  nodes:
    node1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux

    node2:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux

  links:
    - endpoints: ["node1:e1-1", "node2:e1-1"]`

func extractTopologyName(def string) string {
	var parsed struct {
		Name string `yaml:"name"`
	}
	_ = yaml.Unmarshal([]byte(def), &parsed)
	return parsed.Name
}

// === GET ===
func TestGetTopologies(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	req := httptest.NewRequest("GET", "/topologies", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var result utils.OkResponse[[]topology.TopologyOut]
	err = json.Unmarshal(resp.Body.Bytes(), &result)
	assert.NoError(t, err)

	// Validate the returned topologies
	names := make([]string, 0)
	for _, topo := range result.Payload {
		names = append(names, extractTopologyName(topo.Definition))
	}
	assert.Contains(t, names, "ctd")
	assert.Contains(t, names, "test1")
}

func TestGetTopologies_UserWithAccess(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id3",
		IsAdmin:     false,
		Collections: []string{"hidden-group", "fs25-cldinf", "fs25-nisec", "hs25-cn1", "hs25-cn2"},
	})

	req := httptest.NewRequest("GET", "/topologies", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var result utils.OkResponse[[]topology.TopologyOut]
	err := json.Unmarshal(resp.Body.Bytes(), &result)
	assert.NoError(t, err)

	names := make([]string, 0)
	for _, topo := range result.Payload {
		names = append(names, extractTopologyName(topo.Definition))
	}
	log.Infof("first topology name: %s", names[0])
	assert.Contains(t, names, "ctd")
	assert.Contains(t, names, "test1")
}

func TestGetTopologies_UserWithoutAccess(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4",
		IsAdmin:     false,
		Collections: []string{},
	})

	req := httptest.NewRequest("GET", "/topologies", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var result utils.OkResponse[[]topology.TopologyOut]
	err := json.Unmarshal(resp.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Len(t, result.Payload, 0)
}

func TestGetTopologies_Unauthorized_NoToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/topologies", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestGetTopologies_InvalidToken(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("GET", "/topologies", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: "invalid.token.value"})
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, 498, resp.Code)
}

// === POST ===
func TestCreateTopology(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	body := map[string]string{
		"definition":   testTopo,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	topologyBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/topologies", bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)

	var result utils.OkResponse[string]
	err = json.Unmarshal(resp.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.NotEmpty(t, result.Payload)
}

func TestCreateTopology_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	body := map[string]string{
		"definition":   testTopo,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	topologyBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/topologies", bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestCreateTopology_Forbidden(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4", // not in collection
		IsAdmin:     false,
		Collections: []string{},
	})

	body := map[string]string{
		"definition":   testTopo,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	topologyBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/topologies", bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCreateTopology_InvalidJson(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// Bad JSON
	req := httptest.NewRequest("POST", "/topologies", strings.NewReader(`{invalid json}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestCreateTopology_DuplicateName(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	body := map[string]string{
		"definition":   cvx03, // Already seeded as "ctd"
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	topologyBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/topologies", bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestCreateTopology_MissingCollectionID(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	body := map[string]string{
		"definition": testTopo,
		"syncUrl":    "https://example.com",
		// Missing collectionId
	}
	topologyBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/topologies", bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestCreateTopology_InvalidTopology(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// Valid YAML, but missing required 'topology' field
	invalidSchemaDef := `
name: "test-bad-topo
nodes:
  node1:
    kind: nokia_srlinux
    image: ghcr.io/nokia/srlinux
`

	body := map[string]string{
		"definition":   invalidSchemaDef,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	topologyBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/topologies", bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	var response utils.ErrorResponse
	err := json.Unmarshal(resp.Body.Bytes(), &response)
	assert.NoError(t, err)
	assert.Equal(t, 3003, response.Code)
}

// === PATCH ===
func TestUpdateTopology(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	topologyId := "TopologyTestUUID1"
	updateBody := map[string]string{
		"definition":   testTopo,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	topologyBody, _ := json.Marshal(updateBody)

	req := httptest.NewRequest("PATCH", "/topologies/"+topologyId, bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestUpdateTopology_UnauthorizedUser(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// Not admin, not the creator
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4",
		IsAdmin:     false,
		Collections: []string{"hs25-cn2"},
	})

	updateBody := map[string]string{
		"definition":   test1,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	topologyBody, _ := json.Marshal(updateBody)

	req := httptest.NewRequest("PATCH", "/topologies/TopologyTestUUID1", bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestUpdateTopology_InvalidTopologyYaml(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	updateBody := map[string]string{
		"definition":   "invalid: \"unterminated quote",
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	bodyBytes, _ := json.Marshal(updateBody)

	req := httptest.NewRequest("PATCH", "/topologies/TopologyTestUUID1", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestUpdateTopology_DuplicateName(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// Try renaming "ctd" to "test1" which already exists
	def := strings.Replace(cvx03, "ctd", "test1", 1)

	updateBody := map[string]string{
		"definition":   def,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	bodyBytes, _ := json.Marshal(updateBody)

	req := httptest.NewRequest("PATCH", "/topologies/TopologyTestUUID1", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestUpdateTopology_TopologyNotFound(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	updateBody := map[string]string{
		"definition":   test1,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	bodyBytes, _ := json.Marshal(updateBody)

	req := httptest.NewRequest("PATCH", "/topologies/nonexistent-uuid", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

// === DELETE ===
func TestDeleteTopology(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	topologyId := "TopologyTestUUID1"
	req := httptest.NewRequest("DELETE", "/topologies/"+topologyId, nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestDeleteTopology_NotFound(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	req := httptest.NewRequest("DELETE", "/topologies/NonExistentID123", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestDeleteTopology_Forbidden(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// User 4 has no write rights and is not the creator
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4",
		IsAdmin:     false,
		Collections: []string{"hs25-cn2"},
	})

	req := httptest.NewRequest("DELETE", "/topologies/TopologyTestUUID1", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestDeleteTopology_OwnerCanDelete(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// Create a topology as user 3 (non-admin)
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id3",
		IsAdmin:     false,
		Collections: []string{"hs25-cn2"},
	})
	log.Infof(test1)
	body := map[string]string{
		"definition":   testTopo,
		"syncUrl":      "https://example.com",
		"collectionId": "CollectionTestUUID1",
	}
	bodyBytes, _ := json.Marshal(body)

	createReq := httptest.NewRequest("POST", "/topologies", bytes.NewReader(bodyBytes))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	createResp := httptest.NewRecorder()
	log.Infof("raw response: %s", createResp.Body.String())
	router.ServeHTTP(createResp, createReq)
	assert.Equal(t, http.StatusOK, createResp.Code)

	var result utils.OkResponse[string]
	_ = json.Unmarshal(createResp.Body.Bytes(), &result)
	log.Infof("payload info: %v", result.Payload)
	// Try deleting it
	deleteReq := httptest.NewRequest("DELETE", "/topologies/"+result.Payload, nil)
	deleteReq.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	deleteResp := httptest.NewRecorder()
	router.ServeHTTP(deleteResp, deleteReq)

	assert.Equal(t, http.StatusOK, deleteResp.Code)
}

func TestDeleteTopology_AlreadyDeleted(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// First delete
	req1 := httptest.NewRequest("DELETE", "/topologies/TopologyTestUUID1", nil)
	req1.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp1 := httptest.NewRecorder()
	router.ServeHTTP(resp1, req1)
	assert.Equal(t, http.StatusOK, resp1.Code)

	// Second delete attempt should 404
	req2 := httptest.NewRequest("DELETE", "/topologies/TopologyTestUUID1", nil)
	req2.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp2 := httptest.NewRecorder()
	router.ServeHTTP(resp2, req2)
	assert.Equal(t, http.StatusNotFound, resp2.Code)
}

func TestDeleteTopology_Unauthorized(t *testing.T) {
	router, _, _ := SetupTestServer(t)

	req := httptest.NewRequest("DELETE", "/topologies/TopologyTestUUID1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

// === Bind file ===
// === POST ===
func TestCreateBindFile(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	topologyId := "TopologyTestUUID1"
	body := `{
		"filePath": "new/file.txt",
		"content": "example config"
	}`

	req := httptest.NewRequest("POST", "/topologies/"+topologyId+"/files", http.NoBody)
	req.Body = io.NopCloser(strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestCreateBindFile_MissingFilePath(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	topologyId := "TopologyTestUUID1"
	body := `{"content": "no path here"}`
	req := httptest.NewRequest("POST", "/topologies/"+topologyId+"/files", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestCreateBindFile_DuplicateFilePath(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// "leaf01/interfaces" already exists in the test setup
	topologyId := "TopologyTestUUID1"
	body := `{
		"filePath": "leaf01/interfaces",
		"content": "duplicate content"
	}`

	req := httptest.NewRequest("POST", "/topologies/"+topologyId+"/files", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)

	var errResp utils.ErrorResponse
	_ = json.Unmarshal(resp.Body.Bytes(), &errResp)
	assert.Equal(t, 4001, errResp.Code)
}

func TestCreateBindFile_ForbiddenUser(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4", // not admin, no access
		IsAdmin:     false,
		Collections: []string{}, // empty
	})

	topologyId := "TopologyTestUUID1"
	body := `{
		"filePath": "unauthorized/file",
		"content": "some data"
	}`

	req := httptest.NewRequest("POST", "/topologies/"+topologyId+"/files", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCreateBindFile_TopologyNotFound(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	body := `{
		"filePath": "ghost/file.txt",
		"content": "won't be saved"
	}`

	req := httptest.NewRequest("POST", "/topologies/non-existent-id/files", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

// === PATCH ===
func TestUpdateBindFile(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	topologyId := "TopologyTestUUID1"
	bindFileId := "BindFileTestUUID1"

	body := map[string]string{
		"content":  "updated config",
		"filePath": "leaf01/interfaces2",
	}
	topologyBody, _ := json.Marshal(body)

	req := httptest.NewRequest("PATCH", "/topologies/"+topologyId+"/files/"+bindFileId, bytes.NewReader(topologyBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestUpdateBindFile_BindFileNotFound(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	body := map[string]string{
		"content":  "irrelevant",
		"filePath": "nonexistent.txt",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest("PATCH", "/topologies/TopologyTestUUID1/files/non-existent-id", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestUpdateBindFile_ForbiddenUser(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// Not admin, no access to topology
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4",
		IsAdmin:     false,
		Collections: []string{},
	})

	body := map[string]string{
		"content":  "hacky update",
		"filePath": "leaf01/interfaces",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest("PATCH", "/topologies/TopologyTestUUID1/files/BindFileTestUUID1", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestUpdateBindFile_DuplicatePath(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// This will attempt to rename BindFileTestUUID1 to a filePath that already exists: "leaf01/daemons"
	body := map[string]string{
		"content":  "duplicate content",
		"filePath": "leaf01/daemons",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest("PATCH", "/topologies/TopologyTestUUID1/files/BindFileTestUUID1", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)

	var errResp utils.ErrorResponse
	_ = json.Unmarshal(resp.Body.Bytes(), &errResp)
	assert.Equal(t, 4001, errResp.Code)
}

func TestUpdateBindFile_MissingFilePath(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// filePath is missing here
	body := map[string]string{
		"content": "no path",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest("PATCH", "/topologies/TopologyTestUUID1/files/BindFileTestUUID1", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

// === DELETE ===
func TestDeleteBindFile(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	authUser := auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	}
	token, err := authManager.CreateAccessToken(authUser)
	assert.NoError(t, err)

	topologyId := "TopologyTestUUID1"
	bindFileId := "BindFileTestUUID1"

	req := httptest.NewRequest("DELETE", "/topologies/"+topologyId+"/files/"+bindFileId, nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestDeleteBindFile_NotFound(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	req := httptest.NewRequest("DELETE", "/topologies/TopologyTestUUID1/files/non-existent-file", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestDeleteBindFile_Forbidden(t *testing.T) {
	router, authManager, _ := SetupTestServer(t)

	// user4 is not the creator and not an admin
	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id4",
		IsAdmin:     false,
		Collections: []string{},
	})

	req := httptest.NewRequest("DELETE", "/topologies/TopologyTestUUID1/files/BindFileTestUUID1", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestDeleteBindFile_TopologyNotFound(t *testing.T) { // check
	router, authManager, db := SetupTestServer(t)

	token, _ := authManager.CreateAccessToken(auth.AuthenticatedUser{
		UserId:      "test-user-id1",
		IsAdmin:     true,
		Collections: []string{"hs25-cn2"},
	})

	// Simulate DB inconsistency by removing topology before deletion
	db.Exec("DELETE FROM topologies WHERE uuid = ?", "TopologyTestUUID1")

	req := httptest.NewRequest("DELETE", "/topologies/TopologyTestUUID1/files/BindFileTestUUID1", nil)
	req.AddCookie(&http.Cookie{Name: "accessToken", Value: token})
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

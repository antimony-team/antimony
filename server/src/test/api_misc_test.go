package test

import (
	"antimonyBackend/config"
	"antimonyBackend/domain/device"
	"antimonyBackend/domain/serverconfig"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * GET /devices
 */

func TestGetDevices_ReturnsTheParsedDeviceConfig(t *testing.T) {
	h := NewHarness(t)

	var devices []device.DeviceConfig
	h.GET("/devices", h.Seed.Admin.Token).RequireOk(&devices)

	require.NotEmpty(t, devices, "the shipped data/device-config.json must be loaded")

	kinds := make([]string, 0, len(devices))
	for _, item := range devices {
		kinds = append(kinds, item.Kind)
	}

	assert.Contains(t, kinds, "nokia_srlinux")
	assert.Contains(t, kinds, "linux")
	assert.Contains(t, kinds, "arista_ceos")
}

func TestGetDevices_CarriesTheInterfaceNamingRules(t *testing.T) {
	h := NewHarness(t)

	var devices []device.DeviceConfig
	h.GET("/devices", h.Seed.Admin.Token).RequireOk(&devices)

	var srlinux *device.DeviceConfig
	for i := range devices {
		if devices[i].Kind == "nokia_srlinux" {
			srlinux = &devices[i]
			break
		}
	}

	require.NotNil(t, srlinux)
	assert.Equal(t, "Nokia SR Linux", srlinux.Name)
	assert.Equal(t, "e1-$", srlinux.InterfacePattern)
	assert.Equal(t, uint(1), srlinux.InterfaceStart)
}

func TestGetDevices_IsTheSameForEveryUser(t *testing.T) {
	h := NewHarness(t)

	// The device catalogue is static configuration, not per-user data.
	var asAdmin, asOutsider []device.DeviceConfig
	h.GET("/devices", h.Seed.Admin.Token).RequireOk(&asAdmin)
	h.GET("/devices", h.Seed.Outsider.Token).RequireOk(&asOutsider)

	assert.Equal(t, asAdmin, asOutsider)
}

func TestGetDevices_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.GET("/devices", "").RequireError(http.StatusUnauthorized, 401)
	h.GET("/devices", "garbage").RequireError(498, 498)
}

// TestGetDevices_MissingConfigFileYieldsAnEmptyList checks the degraded path: a missing device
// config is logged and the endpoint answers with an empty list rather than failing.
func TestGetDevices_MissingConfigFileYieldsAnEmptyList(t *testing.T) {
	h := NewHarness(t)

	// Rebuild just the device service against a path that does not exist.
	service := device.CreateService(&config.AntimonyConfig{
		Containerlab: config.ClabConfig{DeviceConfig: "/nonexistent/device-config.json"},
	})

	assert.Empty(t, service.Get())

	// The real endpoint is unaffected.
	var devices []device.DeviceConfig
	h.GET("/devices", h.Seed.Admin.Token).RequireOk(&devices)
	assert.NotEmpty(t, devices)
}

/*
 * GET /clab-schema
 */

func TestGetClabSchema_IsPublic(t *testing.T) {
	h := NewHarness(t)

	// The schema is needed by the editor before the user has logged in, so it is deliberately
	// outside the authenticated route groups.
	h.GET("/clab-schema", "").RequireStatus(http.StatusOK)
}

func TestGetClabSchema_ReturnsAJsonSchemaObject(t *testing.T) {
	h := NewHarness(t)

	var schema map[string]any
	h.GET("/clab-schema", "").RequireOk(&schema)

	assert.NotEmpty(t, schema)
	assert.Contains(t, schema, "properties", "the payload must be the containerlab JSON schema")

	properties, ok := schema["properties"].(map[string]any)
	require.True(t, ok)
	assert.Contains(t, properties, "topology")
	assert.Contains(t, properties, "name")
}

func TestGetClabSchema_MatchesTheSchemaUsedForValidation(t *testing.T) {
	h := NewHarness(t)

	var overHttp map[string]any
	h.GET("/clab-schema", "").RequireOk(&overHttp)

	// The endpoint must serve the very schema the topology validator uses, otherwise the editor
	// would accept definitions the API then rejects.
	assert.JSONEq(t, h.SchemaService.Get(), toJSON(t, overHttp))
}

func TestGetClabSchema_IgnoresAnAccessToken(t *testing.T) {
	h := NewHarness(t)

	// A garbage token must not turn a public endpoint into a 498.
	h.GET("/clab-schema", "garbage").RequireStatus(http.StatusOK)
}

/*
 * GET /server-config
 */

func TestGetServerConfig_ReportsCaptureAndDeploymentSettings(t *testing.T) {
	h := NewHarness(t)

	var serverConfig serverconfig.ServerConfig
	h.GET("/server-config", h.Seed.Admin.Token).RequireOk(&serverConfig)

	assert.True(t, serverConfig.CaptureConfig.Enabled)
	assert.Equal(t, 6969, serverConfig.CaptureConfig.Port)
	assert.Equal(t, []string{"lo", "gway-*", "monit_in", "mgmt0*"},
		serverConfig.CaptureConfig.ExcludedInterfaces)
	assert.Equal(t, "containerlab", serverConfig.DeploymentConfig.Provider)
}

func TestGetServerConfig_ReflectsTheConfiguredProvider(t *testing.T) {
	for _, provider := range []config.DeploymentProvider{config.Clabernetes, config.Dummy} {
		t.Run(provider.String(), func(t *testing.T) {
			h := NewHarness(t, WithDeploymentProvider(provider))

			var serverConfig serverconfig.ServerConfig
			h.GET("/server-config", h.Seed.Admin.Token).RequireOk(&serverConfig)

			assert.Equal(t, provider.String(), serverConfig.DeploymentConfig.Provider)
		})
	}
}

func TestGetServerConfig_ReflectsDisabledCapture(t *testing.T) {
	h := NewHarness(t, WithCaptureEnabled(false))

	var serverConfig serverconfig.ServerConfig
	h.GET("/server-config", h.Seed.Admin.Token).RequireOk(&serverConfig)

	assert.False(t, serverConfig.CaptureConfig.Enabled)
}

func TestGetServerConfig_ReflectsCustomExcludedInterfaces(t *testing.T) {
	h := NewHarness(t, WithExcludedInterfaces("eth9", "dummy*"))

	var serverConfig serverconfig.ServerConfig
	h.GET("/server-config", h.Seed.Admin.Token).RequireOk(&serverConfig)

	assert.Equal(t, []string{"eth9", "dummy*"}, serverConfig.CaptureConfig.ExcludedInterfaces)
}

func TestGetServerConfig_IsVisibleToNonAdmins(t *testing.T) {
	h := NewHarness(t)

	// Every authenticated client needs this to know whether capture is available.
	var serverConfig serverconfig.ServerConfig
	h.GET("/server-config", h.Seed.Outsider.Token).RequireOk(&serverConfig)

	assert.Equal(t, "containerlab", serverConfig.DeploymentConfig.Provider)
}

func TestGetServerConfig_RequiresAuthentication(t *testing.T) {
	h := NewHarness(t)

	h.GET("/server-config", "").RequireError(http.StatusUnauthorized, 401)
	h.GET("/server-config", "garbage").RequireError(498, 498)
}

/*
 * Route surface
 */

func TestRoutes_UnknownPathsAre404(t *testing.T) {
	h := NewHarness(t)

	for _, path := range []string{"/", "/nope", "/collections/extra/segments", "/labs/x/y/z"} {
		t.Run(path, func(t *testing.T) {
			h.GET(path, h.Seed.Admin.Token).RequireStatus(http.StatusNotFound)
		})
	}
}

func TestRoutes_WrongMethodIsRejected(t *testing.T) {
	h := NewHarness(t)

	// gin answers 404 rather than 405 by default, since HandleMethodNotAllowed is off.
	h.POST("/devices", map[string]any{}, h.Seed.Admin.Token).RequireStatus(http.StatusNotFound)
	h.DELETE("/clab-schema", "").RequireStatus(http.StatusNotFound)
}

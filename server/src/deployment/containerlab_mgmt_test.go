package deployment

import (
	"context"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/antimony-team/antimony/server/src/config"
)

/*
 * The management networks of the labs.
 *
 * Every lab gets a Docker network of its own before containerlab deploys it. The fake rejects subnets that overlap
 * a network it knows, like Docker does.
 */

// testMgmt holds the ranges of the default config
var testMgmt = config.MgmtConfig{
	IPv4:       netip.MustParsePrefix("10.200.0.0/16"),
	IPv4Prefix: 24,
	IPv6:       netip.MustParsePrefix("fd00:200::/48"),
	IPv6Prefix: 64,
}

type fakeNetworks struct {
	client.APIClient

	mu sync.Mutex

	// taken holds the subnets of the networks that exist
	taken     []netip.Prefix
	created   map[string]network.CreateOptions
	removed   []string
	createErr error
}

func newFakeNetworks(taken ...string) *fakeNetworks {
	networks := &fakeNetworks{created: map[string]network.CreateOptions{}}
	for _, subnet := range taken {
		networks.taken = append(networks.taken, netip.MustParsePrefix(subnet))
	}

	return networks
}

func (d *fakeNetworks) NetworkCreate(
	_ context.Context,
	name string,
	options network.CreateOptions,
) (network.CreateResponse, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.createErr != nil {
		return network.CreateResponse{}, d.createErr
	}

	subnets := make([]netip.Prefix, 0)
	for _, ipam := range options.IPAM.Config {
		subnet := netip.MustParsePrefix(ipam.Subnet)
		if slices.ContainsFunc(d.taken, subnet.Overlaps) {
			return network.CreateResponse{}, errors.New(
				"Error response from daemon: invalid pool request: Pool overlaps with other one on this address space",
			)
		}
		subnets = append(subnets, subnet)
	}

	d.taken = append(d.taken, subnets...)
	d.created[name] = options

	return network.CreateResponse{ID: name}, nil
}

func (d *fakeNetworks) NetworkRemove(_ context.Context, name string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.removed = append(d.removed, name)
	return nil
}

func writeTopology(t *testing.T, definition string) string {
	t.Helper()

	topologyFile := filepath.Join(t.TempDir(), "topology.clab.yaml")
	require.NoError(t, os.WriteFile(topologyFile, []byte(definition), 0o600))

	return topologyFile
}

// writeTopologyWithMgmtNetwork writes a topology that already has its management network, so deploying it only
// runs containerlab.
func writeTopologyWithMgmtNetwork(t *testing.T) string {
	t.Helper()

	return writeTopology(t, "name: demo\nmgmt:\n  network: demo\ntopology:\n  nodes: {}\n")
}

// withoutAntimonyLines drops the lines Antimony writes to the lab log itself, such as the ones about the management
// network, and keeps containerlab's output.
func withoutAntimonyLines(lines []string) []string {
	return slices.DeleteFunc(lines, func(line string) bool {
		return strings.Contains(line, " SERV ")
	})
}

func readMgmt(t *testing.T, topologyFile string) map[string]any {
	t.Helper()

	content, err := os.ReadFile(topologyFile)
	require.NoError(t, err)

	var topology struct {
		Mgmt map[string]any `yaml:"mgmt"`
	}
	require.NoError(t, yaml.Unmarshal(content, &topology))

	return topology.Mgmt
}

func TestNthSubnet_ReturnsTheNetworksOfTheRangeInOrder(t *testing.T) {
	ipv4 := netip.MustParsePrefix("10.200.0.0/16")
	ipv6 := netip.MustParsePrefix("fd00:200::/48")

	assert.Equal(t, "10.200.0.0/24", nthSubnet(ipv4, 24, 0).String())
	assert.Equal(t, "10.200.3.0/24", nthSubnet(ipv4, 24, 3).String())
	assert.Equal(t, "10.200.255.0/24", nthSubnet(ipv4, 24, 255).String())
	assert.Equal(t, "10.200.1.128/25", nthSubnet(ipv4, 25, 3).String())
	assert.Equal(t, "fd00:200::/64", nthSubnet(ipv6, 64, 0).String())
	assert.Equal(t, "fd00:200:0:3::/64", nthSubnet(ipv6, 64, 3).String())
}

func TestContainerlabDeploy_GivesTheLabAManagementNetworkOfItsOwn(t *testing.T) {
	clab := newFakeClab(t)
	networks := newFakeNetworks()
	provider := &ContainerlabProvider{client: networks, mgmt: testMgmt}
	logs := &logCollector{}
	topologyFile := writeTopology(t, "# The lab\nname: demo\ntopology:\n  nodes: {}\n")

	require.NoError(t, provider.Deploy(context.Background(), topologyFile, "demo", logs.log))

	require.Contains(t, networks.created, "demo")
	assert.Equal(t, map[string]any{
		"network":     "demo",
		"ipv4-subnet": "10.200.0.0/24",
		"ipv6-subnet": "fd00:200::/64",
	}, readMgmt(t, topologyFile))
	assert.Equal(t, []string{"deploy -t " + topologyFile}, clab.calls(t))

	content, err := os.ReadFile(topologyFile)
	require.NoError(t, err)
	assert.Contains(t, string(content), "# The lab")

	require.Len(t, logs.all(), 1)
	assert.Contains(t, logs.all()[0], "Created auto assigned management network")
}

func TestContainerlabDeploy_SkipsSubnetsOtherNetworksUse(t *testing.T) {
	newFakeClab(t)
	networks := newFakeNetworks("10.200.0.0/24", "10.200.1.0/25", "fd00:200:0:2::/64")
	provider := &ContainerlabProvider{client: networks, mgmt: testMgmt}
	topologyFile := writeTopology(t, "name: demo\n")

	require.NoError(t, provider.Deploy(context.Background(), topologyFile, "demo", nil))

	mgmt := readMgmt(t, topologyFile)
	assert.Equal(t, "10.200.3.0/24", mgmt["ipv4-subnet"])
	assert.Equal(t, "fd00:200:0:3::/64", mgmt["ipv6-subnet"])
}

func TestContainerlabDeploy_LabsDeployedAtTheSameTimeGetDifferentNetworks(t *testing.T) {
	newFakeClab(t)
	networks := newFakeNetworks()
	provider := &ContainerlabProvider{client: networks, mgmt: testMgmt}
	topologyFiles := []string{writeTopology(t, "name: one\n"), writeTopology(t, "name: two\n")}

	var wg sync.WaitGroup
	for i, topologyFile := range topologyFiles {
		wg.Go(func() {
			assert.NoError(t, provider.Deploy(context.Background(), topologyFile, []string{"one", "two"}[i], nil))
		})
	}
	wg.Wait()

	assert.NotEqual(t, readMgmt(t, topologyFiles[0])["ipv4-subnet"], readMgmt(t, topologyFiles[1])["ipv4-subnet"])
}

func TestContainerlabDeploy_KeepsAManagementNetworkSetInTheTopology(t *testing.T) {
	newFakeClab(t)
	networks := newFakeNetworks()
	provider := &ContainerlabProvider{client: networks, mgmt: testMgmt}
	logs := &logCollector{}
	topologyFile := writeTopology(t, "name: demo\nmgmt:\n  network: custom\n  ipv4-subnet: 172.100.100.0/24\n")

	require.NoError(t, provider.Deploy(context.Background(), topologyFile, "demo", logs.log))

	assert.Empty(t, networks.created)
	assert.Equal(t, map[string]any{"network": "custom", "ipv4-subnet": "172.100.100.0/24"}, readMgmt(t, topologyFile))

	require.Len(t, logs.all(), 1)
	assert.Contains(t, logs.all()[0], "Using the lab's specified mgmt network")
	assert.Contains(t, logs.all()[0], "network=custom")
}

func TestContainerlabDeploy_KeepsOtherManagementSettings(t *testing.T) {
	newFakeClab(t)
	provider := &ContainerlabProvider{client: newFakeNetworks(), mgmt: testMgmt}
	topologyFile := writeTopology(t, "name: demo\nmgmt:\n  mtu: 9000\n")

	require.NoError(t, provider.Deploy(context.Background(), topologyFile, "demo", nil))

	mgmt := readMgmt(t, topologyFile)
	assert.Equal(t, 9000, mgmt["mtu"])
	assert.Equal(t, "demo", mgmt["network"])
}

func TestContainerlabRedeploy_GivesALabWithoutOneAManagementNetwork(t *testing.T) {
	clab := newFakeClab(t)
	networks := newFakeNetworks()
	provider := &ContainerlabProvider{client: networks, mgmt: testMgmt}
	topologyFile := writeTopology(t, "name: demo\n")

	require.NoError(t, provider.Redeploy(context.Background(), topologyFile, "demo", nil))

	assert.Contains(t, networks.created, "demo")
	assert.Equal(t, []string{"redeploy -t " + topologyFile}, clab.calls(t))
}

func TestContainerlabDeploy_FailsWhenNoManagementNetworkIsLeft(t *testing.T) {
	clab := newFakeClab(t)
	networks := newFakeNetworks("10.200.0.0/16")
	provider := &ContainerlabProvider{client: networks, mgmt: testMgmt}
	logs := &logCollector{}
	topologyFile := writeTopology(t, "name: demo\n")

	err := provider.Deploy(context.Background(), topologyFile, "demo", logs.log)

	require.ErrorContains(t, err, "no free management network left in 10.200.0.0/16")
	assert.Empty(t, clab.calls(t))
	assert.Nil(t, readMgmt(t, topologyFile))

	require.Len(t, logs.all(), 1)
	assert.Contains(t, logs.all()[0], "Failed to create management network")
	assert.Contains(t, logs.all()[0], "no free management network left")
}

func TestContainerlabDeploy_ReportsOtherDockerErrorsRightAway(t *testing.T) {
	clab := newFakeClab(t)
	networks := newFakeNetworks()
	networks.createErr = errors.New("permission denied")
	provider := &ContainerlabProvider{client: networks, mgmt: testMgmt}
	logs := &logCollector{}

	err := provider.Deploy(context.Background(), writeTopology(t, "name: demo\n"), "demo", logs.log)

	require.ErrorContains(t, err, "permission denied")
	assert.Empty(t, clab.calls(t))
	require.Len(t, logs.all(), 1)
	assert.Contains(t, logs.all()[0], "Failed to create management network")
}

func TestContainerlabDeploy_FailsForATopologyThatIsNoMapping(t *testing.T) {
	clab := newFakeClab(t)
	provider := &ContainerlabProvider{client: newFakeNetworks(), mgmt: testMgmt}

	err := provider.Deploy(context.Background(), writeTopology(t, "- demo\n"), "demo", nil)

	require.Error(t, err)
	assert.Empty(t, clab.calls(t))
}

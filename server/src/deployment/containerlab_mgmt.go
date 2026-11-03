package deployment

import (
	"context"
	"fmt"
	"math/big"
	"net/netip"
	"os"
	"strings"

	"github.com/docker/docker/api/types/network"
	"gopkg.in/yaml.v3"

	"github.com/antimony-team/antimony/server/src/utils"
	"github.com/antimony-team/antimony/server/src/utils/serverlog"
)

type mgmtNetwork struct {
	ipv4 netip.Prefix
	ipv6 netip.Prefix
}

// ensureMgmtNetwork assigns the lab a management network of its own, unless its topology already defines one. The
// network is created in Docker and written into the topology, containerlab then uses the existing network.
func (p *ContainerlabProvider) ensureMgmtNetwork(
	ctx context.Context,
	topologyFile string,
	instanceName string,
	onLog LogFunc,
) error {
	definition, err := os.ReadFile(topologyFile)
	if err != nil {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to read topology for management network",
			"instance", instanceName,
			"err", err.Error(),
		))
		return err
	}

	var document yaml.Node
	if err := yaml.Unmarshal(definition, &document); err != nil {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to parse topology for management network",
			"instance", instanceName,
			"err", err.Error(),
		))
		return err
	}
	if len(document.Content) == 0 || document.Content[0].Kind != yaml.MappingNode {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to parse topology for management network",
			"instance", instanceName,
			"err", utils.ErrInvalidTopology.Error(),
		))

		return utils.ErrInvalidTopology
	}
	root := document.Content[0]

	// A network in the topology was set by an admin or created by an earlier deployment
	if hasMgmtNetwork(root, instanceName, onLog) {
		return nil
	}

	mgmt, err := p.createMgmtNetwork(ctx, instanceName)
	if err != nil {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to create management network",
			"instance", instanceName,
			"err", err.Error(),
		))
		return err
	}

	onLog.Log(serverlog.CreateAntimonyLog(
		serverlog.InfoLevel,
		"Created auto assigned management network",
		"network", instanceName,
		"ipv4", mgmt.ipv4.String(),
		"ipv6", mgmt.ipv6.String(),
	))

	setMgmtNetwork(root, instanceName, mgmt)

	encoded, err := utils.EncodeYaml(&document)
	if err == nil {
		err = os.WriteFile(topologyFile, []byte(encoded), 0o644)
	}

	if err != nil {
		// The network would otherwise block its subnets without the topology knowing about it
		_ = p.client.NetworkRemove(ctx, instanceName)

		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.ErrorLevel,
			"Failed to write management network into topology",
			"instance", instanceName,
			"err", err.Error(),
		))

		return err
	}

	return nil
}

// createMgmtNetwork creates the lab's management network with the first subnets of the ranges that Docker accepts.
// Docker rejects subnets that overlap any other network, so deploys that run at the same time can't get the same one.
func (p *ContainerlabProvider) createMgmtNetwork(ctx context.Context, instanceName string) (mgmtNetwork, error) {
	count := 1 << (p.mgmt.IPv4Prefix - p.mgmt.IPv4.Bits())

	for i := range count {
		candidate := mgmtNetwork{
			ipv4: nthSubnet(p.mgmt.IPv4, p.mgmt.IPv4Prefix, i),
			ipv6: nthSubnet(p.mgmt.IPv6, p.mgmt.IPv6Prefix, i),
		}

		_, err := p.client.NetworkCreate(ctx, instanceName, network.CreateOptions{
			EnableIPv6: new(true),
			IPAM: &network.IPAM{Config: []network.IPAMConfig{
				{Subnet: candidate.ipv4.String()},
				{Subnet: candidate.ipv6.String()},
			}},
		})
		if err == nil {
			return candidate, nil
		}
		if !isPoolOverlap(err) {
			return mgmtNetwork{}, err
		}
	}

	return mgmtNetwork{}, fmt.Errorf("no free management network left in %s", p.mgmt.IPv4)
}

// isPoolOverlap reports whether Docker rejected a network because a subnet overlaps another network.
func isPoolOverlap(err error) bool {
	return strings.Contains(err.Error(), "Pool overlaps with other one on this address space")
}

// nthSubnet returns the nth network with the given prefix length in the range.
func nthSubnet(pool netip.Prefix, bits int, n int) netip.Prefix {
	addr := pool.Addr().AsSlice()
	offset := new(big.Int).Lsh(big.NewInt(int64(n)), uint(len(addr)*8-bits))
	sum := new(big.Int).Add(new(big.Int).SetBytes(addr), offset).FillBytes(make([]byte, len(addr)))

	subnetAddr, _ := netip.AddrFromSlice(sum)
	return netip.PrefixFrom(subnetAddr, bits)
}

// hasMgmtNetwork reports whether the topology defines the network or a subnet of its management network.
// If a mgmt network is specified, it will be logged using the onLog function.
func hasMgmtNetwork(root *yaml.Node, instanceName string, onLog LogFunc) bool {
	mgmt := utils.MappingValue(root, "mgmt")
	if mgmt == nil || mgmt.Kind != yaml.MappingNode {
		return false
	}

	if mgmtNetwork := utils.MappingValue(mgmt, "network"); mgmtNetwork != nil {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.InfoLevel,
			"Using the lab's specified mgmt network",
			"instance", instanceName,
			"network", mgmtNetwork.Value,
		))

		return true
	}

	if mgmtIpv4 := utils.MappingValue(mgmt, "ipv4-subnet"); mgmtIpv4 != nil {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.InfoLevel,
			"Using the lab's specified mgmt IPv4 subnet",
			"instance", instanceName,
			"ipv4", mgmtIpv4.Value,
		))

		return true
	}

	if mgmtIpv6 := utils.MappingValue(mgmt, "ipv6-subnet"); mgmtIpv6 != nil {
		onLog.Log(serverlog.CreateAntimonyLog(
			serverlog.InfoLevel,
			"Using the lab's specified mgmt IPv6 subnet",
			"instance", instanceName,
			"ipv6", mgmtIpv6.Value,
		))

		return true
	}

	return false
}

// setMgmtNetwork writes the management network into the topology. Other keys of the mgmt block stay.
func setMgmtNetwork(root *yaml.Node, instanceName string, mgmt mgmtNetwork) {
	mgmtNode := utils.MappingValue(root, "mgmt")
	if mgmtNode == nil {
		mgmtNode = &yaml.Node{}
		root.Content = append(root.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "mgmt"}, mgmtNode)
	}
	if mgmtNode.Kind != yaml.MappingNode {
		*mgmtNode = yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	}

	utils.SetMappingValue(mgmtNode, "network", instanceName)
	utils.SetMappingValue(mgmtNode, "ipv4-subnet", mgmt.ipv4.String())
	utils.SetMappingValue(mgmtNode, "ipv6-subnet", mgmt.ipv6.String())
}

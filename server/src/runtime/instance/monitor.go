package instance

import (
	"antimonyBackend/deployment"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
	"maps"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/samber/lo"
)

type Monitor struct {
	socketManager      *socket.Manager
	deploymentProvider deployment.DeploymentProvider

	monitoredNodes      map[string]monitoredNode
	monitoredNodesMutex sync.Mutex
}

type NodeStats struct {
	Timestamp time.Time `json:"timestamp"`

	CPUUsagePercent float32 `json:"cpuPercent"`
	MemoryUsage     float32 `json:"memoryUsage"`
	MemoryLimit     float32 `json:"memoryLimit"`

	Interfaces map[string]NodeInterfaceStats `json:"interfaces"`
}

type NodeInterfaceStats struct {
	RxBps int `json:"rxBps"`
	TxBps int `json:"txBps"`
}

type monitoredNode struct {
	instanceName          string
	namespace             *socket.OutputNamespace[NodeStats]
	instanceDeploymentCtx context.Context
}

func CreateMonitor(
	socketManager *socket.Manager,
	deploymentProvider deployment.DeploymentProvider,
) *Monitor {
	return &Monitor{
		socketManager:      socketManager,
		deploymentProvider: deploymentProvider,

		monitoredNodes:      make(map[string]monitoredNode),
		monitoredNodesMutex: sync.Mutex{},
	}
}

func (m *Monitor) Run() {
	for {
		// Duplicate the list so we don't have to keep the mutex locked until every node stat is sent
		m.monitoredNodesMutex.Lock()
		monitoredNodes := maps.Clone(m.monitoredNodes)
		m.monitoredNodesMutex.Unlock()

		for containerId, node := range monitoredNodes {
			stats, err := m.deploymentProvider.ReadNodeStats(node.instanceDeploymentCtx, node.instanceName, containerId)
			if err != nil {
				// Node is not running or is no longer available, remove from monitor list
				m.RemoveNode(containerId)

				// Ignore the error if the context was canceled and the node instance's deployment was aborted
				if node.instanceDeploymentCtx.Err() == nil {
					log.Warn(
						"[Monitor] Failed to read node stats",
						"instanceName", node.instanceName,
						"containerId", containerId,
						"error", err,
					)
				}

				continue
			}

			node.namespace.Send(NodeStats{
				Timestamp:       time.Now(),
				CPUUsagePercent: float32(stats.CPUUsagePercent),
				MemoryUsage:     float32(stats.MemoryUsage),
				MemoryLimit:     float32(stats.MemoryLimit),
				Interfaces: lo.MapValues(
					stats.Interfaces,
					func(i deployment.NodeInterfaceStats, key string) NodeInterfaceStats {
						return NodeInterfaceStats{
							RxBps: i.RxBps,
							TxBps: i.TxBps,
						}
					},
				),
			})
		}

		time.Sleep(1 * time.Second)
	}
}

func (m *Monitor) AddNode(ctx context.Context, containerId string, instanceName string) {
	m.monitoredNodesMutex.Lock()
	if node, ok := m.monitoredNodes[containerId]; ok {
		node.namespace.ClearBacklog()
	} else {
		namespace := socket.CreateOutputNamespace[NodeStats](
			m.socketManager,
			false,
			&socket.BacklogConfig{
				Capacity: 20,
				Kind:     utils.RingKindValue,
			},
			true,
			nil,
			"stats",
			containerId,
		)

		m.monitoredNodes[containerId] = monitoredNode{
			instanceDeploymentCtx: ctx,
			instanceName:          instanceName,
			namespace:             namespace,
		}
	}
	m.monitoredNodesMutex.Unlock()
}

func (m *Monitor) RemoveNode(containerId string) {
	m.monitoredNodesMutex.Lock()
	if node, ok := m.monitoredNodes[containerId]; ok {
		node.namespace.Release()
	}
	delete(m.monitoredNodes, containerId)
	m.monitoredNodesMutex.Unlock()
}

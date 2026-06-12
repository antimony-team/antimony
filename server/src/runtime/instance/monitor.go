package instance

import (
	"antimonyBackend/deployment"
	"antimonyBackend/socket"
	"antimonyBackend/utils"
	"context"
	"maps"
	"sync"
	"time"

	"github.com/samber/lo"
)

type Monitor struct {
	socketManager      *socket.Manager
	deploymentProvider deployment.DeploymentProvider

	monitoredNodes      map[string]socket.OutputNamespace[NodeStats]
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

func CreateMonitor(
	socketManager *socket.Manager,
	deploymentProvider deployment.DeploymentProvider,
) *Monitor {
	return &Monitor{
		socketManager:      socketManager,
		deploymentProvider: deploymentProvider,

		monitoredNodes:      make(map[string]socket.OutputNamespace[NodeStats]),
		monitoredNodesMutex: sync.Mutex{},
	}
}

func (m *Monitor) Run() {
	ctx := context.Background()

	for {
		// Duplicate the list so we don't have to keep the mutex locked until every node stat is sent
		m.monitoredNodesMutex.Lock()
		monitoredNodes := maps.Clone(m.monitoredNodes)
		m.monitoredNodesMutex.Unlock()

		for containerId, namespace := range monitoredNodes {
			stats, err := m.deploymentProvider.ReadNodeStats(ctx, containerId)
			if err != nil {
				// Node is not running or is no longer available, remove from monitor list
				m.monitoredNodesMutex.Lock()
				delete(m.monitoredNodes, containerId)
				m.monitoredNodesMutex.Unlock()
				continue
			}

			if namespace == nil {
				continue
			}

			namespace.Send(NodeStats{
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

func (m *Monitor) AddNode(containerId string) {
	m.monitoredNodesMutex.Lock()
	if namespace, ok := m.monitoredNodes[containerId]; ok {
		namespace.ClearBacklog()
	} else {
		m.monitoredNodes[containerId] = socket.CreateOutputNamespace[NodeStats](
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
	}
	m.monitoredNodesMutex.Unlock()
}

func (m *Monitor) RemoveNode(containerId string) {
	m.monitoredNodesMutex.Lock()
	delete(m.monitoredNodes, containerId)
	m.monitoredNodesMutex.Unlock()
}

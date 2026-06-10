package nodemonitor

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

type (
	NodeStats struct {
		Timestamp time.Time `json:"timestamp"`

		CPUUsage    float32 `json:"cpuUsage"`
		MemoryUsage float32 `json:"memoryUsage"`
		MemoryLimit float32 `json:"memoryLimit" json:"memoryLimit"`

		Interfaces map[string]NodeInterfaceStats `json:"interfaces"`
	}

	NodeInterfaceStats struct {
		RxBps int `json:"rxBps"`
		TxBps int `json:"txBps"`
	}

	NodeMonitor interface {
		Run()

		AddNode(containerId string)
		RemoveNode(containerId string)
	}

	nodeMonitor struct {
		socketManager      socket.SocketManager
		deploymentProvider deployment.DeploymentProvider

		monitoredNodes      map[string]socket.OutputNamespace[NodeStats]
		monitoredNodesMutex sync.Mutex
	}
)

func CreateNodeMonitor(
	socketManager socket.SocketManager,
	deploymentProvider deployment.DeploymentProvider,
) NodeMonitor {
	return &nodeMonitor{
		socketManager:      socketManager,
		deploymentProvider: deploymentProvider,

		monitoredNodes:      make(map[string]socket.OutputNamespace[NodeStats]),
		monitoredNodesMutex: sync.Mutex{},
	}
}

func (m *nodeMonitor) Run() {
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
				Timestamp:   time.Now(),
				CPUUsage:    float32(stats.CPUUsagePercent),
				MemoryUsage: float32(stats.MemoryUsage),
				MemoryLimit: float32(stats.MemoryLimit),
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

func (m *nodeMonitor) AddNode(containerId string) {
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

func (m *nodeMonitor) RemoveNode(containerId string) {
	m.monitoredNodesMutex.Lock()
	delete(m.monitoredNodes, containerId)
	m.monitoredNodesMutex.Unlock()
}

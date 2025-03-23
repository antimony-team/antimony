package instance

import "time"

type Instance struct {
	Deployed          time.Time      `json:"deployed"`
	EdgesharkLink     string         `json:"edgesharkLink"`
	State             InstanceState  `json:"state"`
	LatestStateChange time.Time      `json:"latestStateChange"`
	Nodes             []InstanceNode `json:"nodes"`
}

type InstanceNode struct {
	Name   string `json:"name"`
	IPv4   string `json:"ipv4"`
	IPV6   string `json:"ipv6"`
	Port   int    `json:"port"`
	User   string `json:"user"`
	WebSSH string `json:"webSSH"`
}

type InstanceState int

const (
	InstanceDeploying InstanceState = iota
	InstanceStopping
	InstanceRunning
	InstanceFailed
	InstanceDone
)

type InstanceCommand string

const (
	Deploy    InstanceCommand = "deploy"
	Destroy   InstanceCommand = "destroy"
	Redeploy  InstanceCommand = "redeploy"
	StartNode InstanceCommand = "start-node"
	StopNode  InstanceCommand = "stop-node"
	SaveNode  InstanceCommand = "save-node"
)

package policy

// Impact describes who can use an unsafe feature. The values are sent to the frontend.
type Impact string

const (
	impactDeploy     Impact = "deploy"
	impactShell      Impact = "shell"
	impactUnreviewed Impact = "unreviewed"
)

var Impacts = struct {
	// Deploy features act on the server or other labs while the lab is being deployed.
	Deploy Impact
	// Shell features give anyone with a shell on a node access beyond the lab.
	Shell Impact
	// Unreviewed marks fields the policy doesn't know. The policy fails closed on them.
	Unreviewed Impact
}{
	Deploy:     impactDeploy,
	Shell:      impactShell,
	Unreviewed: impactUnreviewed,
}

// RuleId identifies the rule that produced a finding. The values are sent to the frontend and
// stored, so they must never be renamed.
type RuleId string

const (
	ruleNetlab            RuleId = "netlab"
	ruleUnreviewedField   RuleId = "unreviewed-field"
	ruleGoTemplate        RuleId = "go-template"
	ruleEnvExpansion      RuleId = "env-expansion"
	ruleMgmt              RuleId = "mgmt"
	rulePrefix            RuleId = "prefix"
	ruleSettings          RuleId = "settings"
	ruleEnvFiles          RuleId = "env-files"
	ruleHostKind          RuleId = "host-kind"
	ruleImageNotAllowed   RuleId = "image-not-allowed"
	rulePrivileged        RuleId = "privileged"
	rulePrivileges        RuleId = "privileges"
	ruleHostNamespace     RuleId = "host-namespace"
	ruleKernelSettings    RuleId = "kernel-settings"
	ruleRuntime           RuleId = "runtime"
	ruleHostPorts         RuleId = "host-ports"
	ruleVolumes           RuleId = "volumes"
	ruleStaticMgmtAddress RuleId = "static-mgmt-address"
	ruleHostExec          RuleId = "host-exec"
	ruleRemoteFile        RuleId = "remote-file"
	ruleForeignFile       RuleId = "foreign-file"
	ruleHostLink          RuleId = "host-link"
)

var Rules = struct {
	// general topology policy errors
	Netlab          RuleId
	UnreviewedField RuleId
	GoTemplate      RuleId
	EnvExpansion    RuleId

	// top-level settings Antimony controls
	Mgmt     RuleId
	Prefix   RuleId
	Settings RuleId

	// node fields
	EnvFiles          RuleId
	HostKind          RuleId
	ImageNotAllowed   RuleId
	Privileged        RuleId
	Privileges        RuleId
	HostNamespace     RuleId
	KernelSettings    RuleId
	Runtime           RuleId
	HostPorts         RuleId
	Volumes           RuleId
	StaticMgmtAddress RuleId
	HostExec          RuleId
	RemoteFile        RuleId
	ForeignFile       RuleId

	// links
	HostLink RuleId
}{
	Netlab:            ruleNetlab,
	UnreviewedField:   ruleUnreviewedField,
	GoTemplate:        ruleGoTemplate,
	EnvExpansion:      ruleEnvExpansion,
	Mgmt:              ruleMgmt,
	Prefix:            rulePrefix,
	Settings:          ruleSettings,
	EnvFiles:          ruleEnvFiles,
	HostKind:          ruleHostKind,
	ImageNotAllowed:   ruleImageNotAllowed,
	Privileged:        rulePrivileged,
	Privileges:        rulePrivileges,
	HostNamespace:     ruleHostNamespace,
	KernelSettings:    ruleKernelSettings,
	Runtime:           ruleRuntime,
	HostPorts:         ruleHostPorts,
	Volumes:           ruleVolumes,
	StaticMgmtAddress: ruleStaticMgmtAddress,
	HostExec:          ruleHostExec,
	RemoteFile:        ruleRemoteFile,
	ForeignFile:       ruleForeignFile,
	HostLink:          ruleHostLink,
}

// Finding is a flagged unsafe feature of a topology.
type Finding struct {
	RuleId  RuleId `json:"ruleId"`
	Impact  Impact `json:"impact"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

// Input is a containerlab topology to check.
type Input struct {
	Definition string
	// BindFiles are the topology's normalized bind file paths, relative to the topology directory.
	BindFiles []string
}

// Options configure the checks.
type Options struct {
	// AllowedImagePrefixes restricts node images. Empty allows every image.
	AllowedImagePrefixes []string
}

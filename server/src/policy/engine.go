// Package policy decides whether a topology is unsafe, i.e. whether deploying it can affect
// anything outside its own lab. It only parses the definition and never executes anything, so it
// is safe to run on untrusted input. A topology is unsafe if it has any finding.
package policy

import (
	"fmt"
	"maps"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	clablinks "github.com/srl-labs/containerlab/links"
	clab "github.com/srl-labs/containerlab/types"
)

type (
	// Engine checks topologies against the policy and caches the findings per topology.
	Engine struct {
		options Options
		cache   *findingsCache
	}

	// checker holds the state of a single check. A new one is created for every check, so concurrent
	// checks never share findings.
	checker struct {
		options   Options
		bindFiles []string
		findings  []Finding
	}

	// nodeField says how a node field is treated. Denied fields are reported whenever they are set,
	// all others are allowed or have their values checked on the typed definition.
	nodeField struct {
		isDenied bool
		ruleId   RuleId
		impact   Impact
		message  string
	}
)

// CreateEngine creates a policy engine with the given options.
func CreateEngine(options Options) *Engine {
	return &Engine{
		options: options,
		cache:   createFindingsCache(),
	}
}

// NetlabFindings returns the findings of a netlab topology, which is always unsafe.
func NetlabFindings() []Finding {
	return []Finding{{
		RuleId:  Rules.Netlab,
		Impact:  Impacts.Deploy,
		Message: "netlab topologies run code on the server while the lab is created and deployed",
	}}
}

// Check returns every unsafe feature of a containerlab topology, reusing the cached result while
// its content is unchanged.
//
// generic must be decoded from definitionString with yaml.v3, topology must be the topology
// section decoded from definitionString with containerlab's types.
func (e *Engine) Check(
	topologyId string,
	definitionRaw any,
	topology *clab.Topology,
	definitionString string,
	bindFiles []string,
) []Finding {
	inputHash := hashInput(definitionString, bindFiles)

	if findings, ok := e.cache.get(topologyId, inputHash); ok {
		return findings
	}

	findings := e.check(definitionRaw, topology, definitionString, bindFiles)
	e.cache.set(topologyId, inputHash, findings)

	return findings
}

// Forget removes a deleted topology from the cache.
func (e *Engine) Forget(topologyId string) {
	e.cache.forget(topologyId)
}

// check runs every rule on a topology without using the cache.
func (e *Engine) check(
	definitionRaw any,
	topology *clab.Topology,
	definitionString string,
	bindFiles []string,
) []Finding {
	c := &checker{options: e.options, bindFiles: bindFiles}

	c.checkRawText(definitionString)
	c.checkRootKeys(definitionRaw)

	if topology != nil {
		c.checkNodeDefinition("topology.defaults", topology.Defaults)
		for _, name := range sortedKeys(topology.Kinds) {
			c.checkNodeDefinition("topology.kinds."+name, topology.Kinds[name])
		}
		for _, name := range sortedKeys(topology.Groups) {
			c.checkNodeDefinition("topology.groups."+name, topology.Groups[name])
		}
		for _, name := range sortedKeys(topology.Nodes) {
			c.checkNodeDefinition("topology.nodes."+name, topology.Nodes[name])
		}
		c.checkLinks("topology.links", topology.Links)
	}

	return c.findings
}

var rawTextRules = []struct {
	pattern *regexp.Regexp
	ruleId  RuleId
	message string
}{
	{
		pattern: regexp.MustCompile(`\{\{`),
		ruleId:  Rules.GoTemplate,
		message: "containerlab renders the topology as a Go template, so templated topologies can't be checked",
	},
	{
		pattern: regexp.MustCompile(`\$(\{|[A-Za-z_])`),
		ruleId:  Rules.EnvExpansion,
		message: "containerlab replaces $VAR and ${VAR} with environment variables of the deploying process",
	},
}

// checkRawText reports templating and environment expansion, which containerlab applies before parsing.
func (c *checker) checkRawText(text string) {
	for _, rule := range rawTextRules {
		if rule.pattern.MatchString(text) {
			c.add("", rule.ruleId, Impacts.Deploy, rule.message)
		}
	}
}

// checkRootKeys reports top-level keys that Antimony controls or that are not reviewed.
func (c *checker) checkRootKeys(generic any) {
	root, _ := generic.(map[string]any)

	for _, key := range sortedKeys(root) {
		switch key {
		case "name", "debug":
		case "topology":
			c.checkTopologyKeys(root[key])
		case "mgmt":
			c.add(key, Rules.Mgmt, Impacts.Shell, "the management network is set by Antimony")
		case "prefix":
			c.add(key, Rules.Prefix, Impacts.Deploy, "the container name prefix is set by Antimony")
		case "settings":
			c.add(key, Rules.Settings, Impacts.Deploy, "lab settings can reference files on the server")
		default:
			c.unknown(key)
		}
	}
}

// checkTopologyKeys reports unknown sections and checks the keys of every node definition.
func (c *checker) checkTopologyKeys(value any) {
	topology, _ := value.(map[string]any)

	for _, section := range sortedKeys(topology) {
		path := "topology." + section

		switch section {
		case "defaults":
			c.checkNodeKeys(path, topology[section])
		case "kinds", "groups", "nodes":
			definitions, _ := topology[section].(map[string]any)
			for _, name := range sortedKeys(definitions) {
				c.checkNodeKeys(path+"."+name, definitions[name])
			}
		case "links":
		default:
			c.unknown(path)
		}
	}
}

// checkNodeKeys reports denied and unreviewed keys of one node definition.
func (c *checker) checkNodeKeys(path string, value any) {
	definition, _ := value.(map[string]any)

	for _, key := range sortedKeys(definition) {
		fieldPath := path + "." + key

		field, isReviewed := nodeFields[key]
		if !isReviewed {
			c.unknown(fieldPath)
			continue
		}

		if field.isDenied {
			c.add(fieldPath, field.ruleId, field.impact, field.message)
		}
	}
}

// allowed marks a node field as safe or as checked on the typed definition.
var allowed = nodeField{}

// denied marks a node field that is reported whenever it is set.
func denied(ruleId RuleId, impact Impact, message string) nodeField {
	return nodeField{isDenied: true, ruleId: ruleId, impact: impact, message: message}
}

// nodeFields is an allowlist of node keys. Any key missing here is reported as unreviewed. It must
// contain every yaml tag of containerlab's NodeDefinition, which a test enforces.
var nodeFields = map[string]nodeField{
	// harmless
	"group":                   allowed,
	"type":                    allowed,
	"startup-delay":           allowed,
	"enforce-startup-config":  allowed,
	"suppress-startup-config": allowed,
	"auto-remove":             allowed,
	"restart-policy":          allowed,
	"config":                  allowed,
	"image-pull-policy":       allowed,
	"position":                allowed,
	"hostname":                allowed,
	"entrypoint":              allowed,
	"cmd":                     allowed,
	"exec":                    allowed, // runs inside the node
	"env":                     allowed,
	"user":                    allowed,
	"labels":                  allowed, // containerlab overwrites its reserved labels
	"dns":                     allowed,
	"aliases":                 allowed,
	"healthcheck":             allowed,
	"link-apply-mode":         allowed,
	"credentials":             allowed,
	"certificate":             allowed,

	// resources, to be capped by admin limits later
	"cpu":      allowed,
	"cpu-set":  allowed,
	"memory":   allowed,
	"shm-size": allowed,
	"tmpfs":    allowed,

	// values checked on the typed definition
	"kind":           allowed,
	"image":          allowed,
	"privileged":     allowed,
	"stages":         allowed,
	"binds":          allowed,
	"startup-config": allowed,
	"license":        allowed,

	// unsafe
	"env-files": denied(
		Rules.EnvFiles,
		Impacts.Deploy,
		"env files are read on the server and can expand its environment variables",
	),
	"network-mode": denied(
		Rules.HostNamespace,
		Impacts.Shell,
		"shares a network namespace with the server or another container",
	),
	"pid-mode": denied(
		Rules.HostNamespace,
		Impacts.Shell,
		"shares a process namespace with the server or another container",
	),
	"cgroupns-mode": denied(Rules.HostNamespace, Impacts.Shell, "shares the cgroup namespace with the server"),
	"cgroup-parent": denied(Rules.HostNamespace, Impacts.Deploy, "places the node in a cgroup of the server"),
	"cap-add":       denied(Rules.Privileges, Impacts.Shell, "grants additional Linux capabilities"),
	"devices":       denied(Rules.Privileges, Impacts.Shell, "gives the node access to devices of the server"),
	"security-opts": denied(Rules.Privileges, Impacts.Shell, "changes the node's security profile"),
	"sysctls":       denied(Rules.KernelSettings, Impacts.Deploy, "changes kernel settings"),
	"runtime":       denied(Rules.Runtime, Impacts.Deploy, "selects the container runtime"),
	"ports":         denied(Rules.HostPorts, Impacts.Deploy, "publishes ports on the server"),
	"volumes":       denied(Rules.Volumes, Impacts.Shell, "mounts container volumes, which other labs can share"),
	"mgmt-ipv4": denied(
		Rules.StaticMgmtAddress,
		Impacts.Shell,
		"static management addresses can take another lab's address",
	),
	"mgmt-ipv6": denied(
		Rules.StaticMgmtAddress,
		Impacts.Shell,
		"static management addresses can take another lab's address",
	),
	"extras": denied(
		Rules.UnreviewedField,
		Impacts.Unreviewed,
		"kind-specific extras can reference files on the server",
	),
	"components": denied(Rules.UnreviewedField, Impacts.Unreviewed, "node components are not reviewed"),
}

// hostReachingKinds connect a lab to the server or to networks outside the lab.
var hostReachingKinds = []string{"host", "bridge", "ovs-bridge", "ext-container", "k8s-kind", "tailscale"}

// checkNodeDefinition checks the values of one node definition (defaults, a kind, a group or a node).
func (c *checker) checkNodeDefinition(path string, definition *clab.NodeDefinition) {
	if definition == nil {
		return
	}

	kind := strings.ToLower(strings.TrimSpace(definition.Kind))
	if slices.Contains(hostReachingKinds, kind) {
		c.add(path+".kind", Rules.HostKind, Impacts.Shell,
			fmt.Sprintf("kind %q connects the lab to the server or networks outside the lab", kind))
	}

	if definition.Image != "" {
		c.checkImage(path+".image", definition.Image)
	}

	if definition.Privileged != nil && *definition.Privileged {
		c.add(path+".privileged", Rules.Privileged, Impacts.Shell, "privileged nodes can access the server")
	}

	for i, bind := range definition.Binds {
		// Docker bind syntax: source:target[:options]
		source, _, _ := strings.Cut(bind, ":")
		c.checkFileReference(fmt.Sprintf("%s.binds[%d]", path, i), source)
	}

	// A multi-line startup-config is an inline configuration, not a file reference
	if definition.StartupConfig != "" && !strings.Contains(definition.StartupConfig, "\n") {
		c.checkFileReference(path+".startup-config", definition.StartupConfig)
	}

	if definition.License != "" {
		c.checkFileReference(path+".license", definition.License)
	}

	if definition.Credentials.IdentityFile != "" {
		c.checkFileReference(path+".credentials.identity-file", definition.Credentials.IdentityFile)
	}

	c.checkStages(path+".stages", definition.Stages)
}

// checkImage reports images that are not on the configured allowlist.
func (c *checker) checkImage(path string, image string) {
	if len(c.options.AllowedImagePrefixes) == 0 {
		return
	}

	image = strings.TrimSpace(image)
	isAllowed := slices.ContainsFunc(c.options.AllowedImagePrefixes, func(imagePrefix string) bool {
		return strings.HasPrefix(image, imagePrefix)
	})

	if !isAllowed {
		c.add(path, Rules.ImageNotAllowed, Impacts.Shell, fmt.Sprintf("image %q is not on the allowlist", image))
	}
}

// checkStages reports stage commands that run on the server instead of inside the node.
func (c *checker) checkStages(path string, stages *clab.Stages) {
	if stages == nil {
		return
	}

	namedStages := map[string]*clab.StageBase{}
	if stages.Create != nil {
		namedStages["create"] = &stages.Create.StageBase
	}
	if stages.CreateLinks != nil {
		namedStages["create-links"] = &stages.CreateLinks.StageBase
	}
	if stages.Configure != nil {
		namedStages["configure"] = &stages.Configure.StageBase
	}
	if stages.Healthy != nil {
		namedStages["healthy"] = &stages.Healthy.StageBase
	}
	if stages.Exit != nil {
		namedStages["exit"] = &stages.Exit.StageBase
	}

	for _, name := range sortedKeys(namedStages) {
		for i, exec := range namedStages[name].Execs {
			if exec == nil {
				continue
			}

			target := clab.ExecTarget(strings.ToLower(strings.TrimSpace(string(exec.Target))))
			if target != "" && target != clab.CommandTargetContainer {
				c.add(
					fmt.Sprintf("%s.%s.exec[%d].target", path, name, i),
					Rules.HostExec,
					Impacts.Deploy,
					"stage commands with this target run on the server",
				)
			}
		}
	}
}

// checkFileReference requires a file reference to be one of the topology's own files or a directory containing them.
func (c *checker) checkFileReference(path string, reference string) {
	reference = strings.TrimSpace(reference)

	if strings.Contains(reference, "://") {
		c.add(path, Rules.RemoteFile, Impacts.Deploy, "remote files are downloaded by the server")
		return
	}

	if !c.isOwnFile(reference) {
		c.add(path, Rules.ForeignFile, Impacts.Shell, fmt.Sprintf("%q is not one of the topology's files", reference))
	}
}

// isOwnFile reports whether a path names one of the topology's files or a directory containing them.
func (c *checker) isOwnFile(reference string) bool {
	if reference == "" || strings.HasPrefix(reference, "~") {
		return false
	}

	cleaned := filepath.Clean(filepath.ToSlash(reference))
	if !filepath.IsLocal(cleaned) || cleaned == "." {
		return false
	}

	return slices.ContainsFunc(c.bindFiles, func(bindFile string) bool {
		return bindFile == cleaned || strings.HasPrefix(bindFile, cleaned+"/")
	})
}

// hostEndpointNodes are endpoint node names containerlab treats as the server or its networks.
var hostEndpointNodes = []string{"host", "macvlan", "mgmt-net"}

// checkLinks reports links that leave the lab. containerlab's decoder has already turned brief links
// into their specific type, e.g. a brief link with an endpoint on host into a host link. Any type that
// isn't known to stay in the lab is reported.
func (c *checker) checkLinks(path string, links []*clablinks.LinkDefinition) {
	for i, link := range links {
		if link == nil || link.Link == nil {
			continue
		}

		linkPath := fmt.Sprintf("%s[%d]", path, i)

		switch linkType := link.Link.GetType(); linkType {
		case clablinks.LinkTypeDummy:
		case clablinks.LinkTypeVEth:
			c.checkVethEndpoints(linkPath, link.Link)
		default:
			c.add(linkPath, Rules.HostLink, Impacts.Shell,
				fmt.Sprintf("link type %q connects the lab to the server or networks outside the lab", linkType))
		}
	}
}

// checkVethEndpoints reports veth endpoints that name the server or its networks instead of a lab node.
func (c *checker) checkVethEndpoints(path string, rawLink clablinks.RawLink) {
	veth, isVeth := rawLink.(*clablinks.LinkVEthRaw)
	if !isVeth {
		return
	}

	for j, endpoint := range veth.Endpoints {
		if endpoint == nil {
			continue
		}

		if slices.Contains(hostEndpointNodes, strings.ToLower(strings.TrimSpace(endpoint.Node))) {
			c.add(fmt.Sprintf("%s.endpoints[%d]", path, j), Rules.HostLink, Impacts.Shell,
				fmt.Sprintf("endpoint %q connects the lab to the server or networks outside the lab", endpoint.Node))
		}
	}
}

// add records a finding.
func (c *checker) add(path string, ruleId RuleId, impact Impact, message string) {
	c.findings = append(c.findings, Finding{
		RuleId:  ruleId,
		Impact:  impact,
		Path:    path,
		Message: message,
	})
}

// unknown reports a key that is not on the allowlist.
func (c *checker) unknown(path string) {
	c.add(path, Rules.UnreviewedField, Impacts.Unreviewed, fmt.Sprintf("%q is not a reviewed field", path))
}

// sortedKeys returns the keys of a map in a fixed order, so findings are deterministic.
func sortedKeys[V any](mapping map[string]V) []string {
	return slices.Sorted(maps.Keys(mapping))
}

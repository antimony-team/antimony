package utils

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// SetMappingValue sets a key of a YAML mapping to a string, the key is added if the mapping doesn't have it. A
// string that replaces another one keeps its quotes.
func SetMappingValue(mapping *yaml.Node, key string, value string) {
	if valueNode := MappingValue(mapping, key); valueNode != nil {
		style := yaml.Style(0)
		if valueNode.Kind == yaml.ScalarNode {
			style = valueNode.Style
		}

		valueNode.Kind = yaml.ScalarNode
		valueNode.Tag = "!!str"
		valueNode.Value = value
		valueNode.Style = stringStyle(value, style)
		valueNode.Content = nil
		valueNode.Alias = nil
		return
	}

	mapping.Content = append(mapping.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value, Style: stringStyle(value, 0)},
	)
}

// stringStyle returns how a string is written. yaml.v3 writes a string of line breaks as a block that reads back
// as an empty string, so strings with line breaks are double-quoted.
func stringStyle(value string, style yaml.Style) yaml.Style {
	if strings.ContainsAny(value, "\r\n") {
		return yaml.DoubleQuotedStyle
	}

	return style
}

// MappingValue returns the value of a key of a YAML mapping, or nil if the mapping doesn't have it.
func MappingValue(mapping *yaml.Node, key string) *yaml.Node {
	for index := 0; index+1 < len(mapping.Content); index += 2 {
		if mapping.Content[index].Value == key {
			return mapping.Content[index+1]
		}
	}

	return nil
}

// DetachAliases gives every alias of the given node in the document a copy of it, so the node can be changed
// without changing its aliases along with it.
func DetachAliases(document *yaml.Node, target *yaml.Node) {
	for index, child := range document.Content {
		if child.Kind == yaml.AliasNode && child.Alias == target {
			detached := *target
			detached.Anchor = ""
			document.Content[index] = &detached
			continue
		}

		DetachAliases(child, target)
	}
}

// EncodeYaml writes a YAML document with two spaces of indentation. yaml.v3 would write every merge key with an
// explicit !!merge tag, so they are written the way they are usually written instead.
func EncodeYaml(document *yaml.Node) (string, error) {
	clearMergeTags(document)

	var output strings.Builder
	encoder := yaml.NewEncoder(&output)
	encoder.SetIndent(2)

	if err := encoder.Encode(document); err != nil {
		return "", err
	}
	if err := encoder.Close(); err != nil {
		return "", err
	}

	return output.String(), nil
}

// clearMergeTags removes the !!merge tag of merge keys, a plain << key is a merge key as well.
func clearMergeTags(node *yaml.Node) {
	if node.Kind == yaml.MappingNode {
		for index := 0; index < len(node.Content); index += 2 {
			if key := node.Content[index]; key.Tag == "!!merge" {
				key.Tag = ""
			}
		}
	}

	for _, child := range node.Content {
		clearMergeTags(child)
	}
}

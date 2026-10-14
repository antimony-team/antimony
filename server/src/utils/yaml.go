package utils

import "gopkg.in/yaml.v3"

// SetMappingValue sets a key of a YAML mapping to a string, the key is added if the mapping doesn't have it.
func SetMappingValue(mapping *yaml.Node, key string, value string) {
	for index := 0; index+1 < len(mapping.Content); index += 2 {
		if mapping.Content[index].Value == key {
			valueNode := mapping.Content[index+1]
			valueNode.Kind = yaml.ScalarNode
			valueNode.Tag = "!!str"
			valueNode.Value = value
			valueNode.Content = nil
			valueNode.Alias = nil
			return
		}
	}

	mapping.Content = append(mapping.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value},
	)
}

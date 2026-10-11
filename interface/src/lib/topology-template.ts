import YAML from 'yaml';

/**
 * Returns the definition of a new topology. Like the containerlab quickstart
 * example, it connects two SR Linux nodes, so a new topology already shows
 * something in the graph and can be deployed right away.
 */
export function createTopologyTemplate(name: string): string {
  return YAML.stringify({
    name,
    topology: {
      nodes: {
        srl1: srlinuxNode(-100, 0),
        srl2: srlinuxNode(100, -160),
      },
      links: [{endpoints: ['srl1:e1-1', 'srl2:e1-1']}],
    },
  });
}

function srlinuxNode(x: number, y: number) {
  return {
    kind: 'nokia_srlinux',
    image: 'ghcr.io/nokia/srlinux',
    labels: {
      'graph-icon': 'router',
      'graph-posX': x.toString(),
      'graph-posY': y.toString(),
    },
  };
}

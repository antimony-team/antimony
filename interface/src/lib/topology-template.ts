import YAML from 'yaml';

import {TopologyManager} from '@sb/lib/topology-manager';
import {NodeAnnotation, TopologyIn} from '@sb/types/domain/topology';

/**
 * Returns the definition and annotations of a new topology. Like the containerlab
 * quickstart example, it connects two SR Linux nodes, so a new topology already
 * shows something in the graph and can be deployed right away.
 */
export function createTopologyTemplate(
  name: string,
): Pick<TopologyIn, 'definition' | 'annotations'> {
  const definition = {
    name,
    topology: {
      nodes: {
        srl1: srlinuxNode(),
        srl2: srlinuxNode(),
      },
      links: [{endpoints: ['srl1:e1-1', 'srl2:e1-1']}],
    },
  };

  const annotations = {
    nodeAnnotations: [
      routerAnnotation('srl1', -100, 0),
      routerAnnotation('srl2', 100, -160),
    ],
  };

  return {
    definition: YAML.stringify(definition),
    annotations: TopologyManager.serializeAnnotations(annotations),
  };
}

function srlinuxNode() {
  return {
    kind: 'nokia_srlinux',
    image: 'ghcr.io/nokia/srlinux',
  };
}

function routerAnnotation(id: string, x: number, y: number): NodeAnnotation {
  return {
    id,
    position: {x, y},
    icon: 'router',
  };
}

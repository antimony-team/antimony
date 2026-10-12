import {NodeConnection} from '@sb/types/domain/topology';

/*
 * Checks for names that are edited in the graph. They return an error that is
 * shown to the user, or null if the name is valid.
 */

/**
 * Checks a new name for a node.
 *
 * @param name The new name.
 * @param currentName The current name of the node.
 * @param nodeNames The names of all nodes of the topology.
 */
export function validateNodeName(
  name: string,
  currentName: string,
  nodeNames: string[],
): string | null {
  if (name === '') return "The name can't be empty";

  const error = validateEndpointPart(name);
  if (error) return error;

  if (name !== currentName && nodeNames.includes(name)) {
    return `${name} already exists`;
  }

  return null;
}

/**
 * Checks a new name for the interface at one end of a link.
 *
 * @param name The new name.
 * @param nodeName The node of the interface.
 * @param connectionIndex The index of the link of the interface.
 * @param connections All links of the topology.
 */
export function validateInterfaceName(
  name: string,
  nodeName: string,
  connectionIndex: number,
  connections: NodeConnection[],
): string | null {
  if (name === '') return "The interface can't be empty";

  const error = validateEndpointPart(name);
  if (error) return error;

  for (const connection of connections) {
    if (connection.index === connectionIndex) continue;

    if (connection.hostNode === nodeName && connection.hostInterface === name) {
      return `${name} is already used by the link to ${connection.targetNode}`;
    }

    if (
      connection.targetNode === nodeName &&
      connection.targetInterface === name
    ) {
      return `${name} is already used by the link to ${connection.hostNode}`;
    }
  }

  return null;
}

// Node and interface names are joined to the endpoints of links, e.g. srl1:e1-1
function validateEndpointPart(name: string): string | null {
  if (name.includes(':')) {
    return '“:” separates node and interface, it can’t be part of the name';
  }

  if (/\s/.test(name)) return "The name can't contain spaces";

  return null;
}

import {InterfaceConfig, InterfacePattern} from '@sb/types/domain/device-info';
import {TopologyDefinition} from '@sb/types/domain/topology-definition';

/*
 * The interfaces of a node are named after the patterns of its device, e.g.
 * e1-$ for interfaces like e1-1. A device can have several patterns for the
 * same interfaces, e.g. ether2 and eth1 are the first interface of a MikroTik
 * router. Only formats with named interfaces use them.
 */

export interface InterfaceMatch {
  pattern: InterfacePattern;
  number: number;
}

/**
 * Returns the pattern an interface name follows and its number in it, null if
 * the name doesn't follow any of the patterns of the device.
 */
export function matchInterface(
  interfaceName: string | undefined,
  config: InterfaceConfig,
): InterfaceMatch | null {
  if (!interfaceName) return null;

  for (const pattern of config.interfaces) {
    const match = interfaceName.match(patternExpression(pattern.pattern));
    if (match) return {pattern, number: Number(match[1])};
  }

  return null;
}

// The name of the interface with the given number in a pattern
export function interfaceName(
  number: number,
  pattern: InterfacePattern,
): string {
  return pattern.pattern.replaceAll('$', String(number));
}

/**
 * Returns the first interface of a node that none of its links uses yet,
 * named after the first pattern of its device.
 */
export function nextInterface(
  definition: TopologyDefinition,
  nodeName: string,
  config: InterfaceConfig,
): string {
  const [pattern] = config.interfaces;

  // The interfaces by their position from the first one, the same in all patterns
  const used = new Set(
    definition
      .linksOf(nodeName)
      .flatMap(link => link.endpoints)
      .filter(endpoint => endpoint.node === nodeName)
      .map(endpoint => matchInterface(endpoint.interface, config))
      .filter(match => match !== null)
      .map(match => match.number - match.pattern.start),
  );

  let position = 0;
  while (used.has(position)) position++;

  return interfaceName(pattern.start + position, pattern);
}

function patternExpression(pattern: string): RegExp {
  const parts = pattern
    .split('$')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  return new RegExp(`^${parts.join('(\\d+)')}$`);
}

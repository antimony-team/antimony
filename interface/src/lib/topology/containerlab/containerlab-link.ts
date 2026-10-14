import {LinkEndpoint, TopologyLink} from '@sb/types/domain/topology-definition';

// Node names of the brief form that make a link to the host instead of to a node
const HOST_NODES = new Set(['host', 'mgmt-net', 'macvlan']);

/**
 * A link of a containerlab topology. A link in the brief form has two
 * 'node:interface' endpoints, one of them can be the host, the management
 * network or a macvlan. A link with a type has an object per endpoint, or a
 * single endpoint for all types except veth.
 */
export class ContainerlabLink implements TopologyLink {
  public readonly index: number;
  public readonly type: string;

  // Whether the link is written in the brief 'node:interface' form or as an object per endpoint
  public readonly notation: 'brief' | 'extended';
  public readonly endpoints: readonly LinkEndpoint[];
  public readonly hostInterface: string | undefined;

  private constructor(
    index: number,
    type: string,
    notation: 'brief' | 'extended',
    endpoints: LinkEndpoint[],
    hostInterface?: string,
  ) {
    this.index = index;
    this.type = type;
    this.notation = notation;
    this.endpoints = endpoints;
    this.hostInterface = hostInterface;
  }

  // Links with two or more endpoints connect nodes, the others go to the host or another network
  public get isBetweenNodes(): boolean {
    return this.endpoints.length >= 2;
  }

  /**
   * Reads a link of a topology, null if it isn't a link containerlab reads.
   *
   * @param link The link as it's written in the topology.
   * @param index The position of the link in the topology.
   */
  public static read(link: unknown, index: number): ContainerlabLink | null {
    if (!link || typeof link !== 'object') return null;

    const {
      type,
      endpoints,
      endpoint,
      'host-interface': hostInterface,
    } = link as Record<string, unknown>;
    const linkType = typeof type === 'string' ? type.trim().toLowerCase() : '';

    if (!linkType) return ContainerlabLink.readBrief(endpoints, index);

    return new ContainerlabLink(
      index,
      linkType,
      'extended',
      (Array.isArray(endpoints) ? endpoints : endpoint ? [endpoint] : [])
        .map(ContainerlabLink.readEndpoint)
        .filter(endpoint => endpoint !== null),
      typeof hostInterface === 'string' ? hostInterface : undefined,
    );
  }

  /*
   * The first endpoint of the host, the management network or a macvlan turns
   * the link into a link of that type, its interface is the one on the host.
   */
  private static readBrief(
    endpoints: unknown,
    index: number,
  ): ContainerlabLink | null {
    if (!Array.isArray(endpoints) || endpoints.length !== 2) return null;

    const [first, second] = endpoints.map(ContainerlabLink.readEndpoint);
    if (!first || !second) return null;

    const host = [first, second].find(endpoint =>
      HOST_NODES.has(endpoint.node.toLowerCase()),
    );
    if (!host) {
      return new ContainerlabLink(index, 'veth', 'brief', [first, second]);
    }

    return new ContainerlabLink(
      index,
      host.node.toLowerCase(),
      'brief',
      [host === first ? second : first],
      host.interface,
    );
  }

  // A 'node:interface' string is split at its first colon, the interface can contain more
  private static readEndpoint(endpoint: unknown): LinkEndpoint | null {
    if (typeof endpoint === 'string') {
      const separator = endpoint.indexOf(':');
      if (separator <= 0 || separator === endpoint.length - 1) return null;

      return {
        node: endpoint.slice(0, separator),
        interface: endpoint.slice(separator + 1),
      };
    }

    if (endpoint && typeof endpoint === 'object') {
      const {node, interface: interfaceName} = endpoint as Record<
        string,
        unknown
      >;
      if (typeof node === 'string' && typeof interfaceName === 'string') {
        return {node, interface: interfaceName};
      }
    }

    return null;
  }
}

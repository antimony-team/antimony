import {YAMLDocument} from '@sb/types/types';

/*
 * The definition of a topology: what a topology file means, independent of the
 * format it is written in. A topology format reads its files as definitions.
 *
 * Definitions don't change, an edit returns a new definition of an edited copy
 * of the file. So definitions can be shared and kept, e.g. for undoing.
 */

/**
 * A level of the topology that a node property comes from. A node inherits
 * properties from the definitions it's written on top of, its groups, its
 * device type and the defaults, in the order of its format, the node itself
 * takes precedence over all of them.
 */
export type PropertySource =
  | {level: 'node'}
  | {level: 'base'; name: string}
  | {level: 'group'; name: string}
  | {level: 'device'; name: string}
  | {level: 'defaults'};

export interface NodeProperty {
  value: unknown;

  // The levels the value comes from, most specific first, merged values combine several
  sources: PropertySource[];
}

/**
 * A node of a topology with its effective properties, the inherited ones
 * included.
 */
export interface TopologyNode {
  readonly name: string;

  // The type of device the node runs, e.g. the kind of a containerlab node
  readonly device: string | undefined;

  // The groups of the node, most specific first, a node can be in several groups in some formats
  readonly groups: readonly string[];
  readonly properties: ReadonlyMap<string, NodeProperty>;

  // The effective value of a property
  get(key: string): unknown;

  // The effective value at the given path, e.g. ['env', 'HOME']
  valueAt(path: readonly string[]): unknown;

  // The value the node would have at the given path if it didn't set it itself
  inherited(path: readonly string[]): unknown;

  // The levels the value of a property comes from, most specific first
  sourcesOf(key: string): PropertySource[];

  // Whether the node doesn't set the property itself but inherits it
  isInherited(key: string): boolean;

  // The value the node itself sets at the given path, the whole definition of the node by default
  own(path?: readonly string[]): unknown;

  // Sets a value at the given path of the node itself, the node then doesn't inherit it anymore
  set(path: readonly string[], value: unknown): TopologyDefinition;

  // Removes the value at the given path of the node itself, so the node inherits it again
  reset(path: readonly string[]): TopologyDefinition;
}

/**
 * An end of a link at a node of the topology. Formats that assign the
 * interfaces when the topology is deployed don't name them.
 */
export interface LinkEndpoint {
  node: string;
  interface?: string;
}

/**
 * A link of a topology. A link between nodes has two or more endpoints, a
 * link to the host, the management network or a remote host has one.
 */
export interface TopologyLink {
  // The position of the link in the topology
  readonly index: number;

  // The type of the link, e.g. veth, host, mgmt-net, macvlan, vxlan or dummy
  readonly type: string;
  readonly endpoints: readonly LinkEndpoint[];

  // The interface on the host of a link to the host, the management network or a macvlan
  readonly hostInterface: string | undefined;

  readonly isBetweenNodes: boolean;
}

/**
 * A node that is added with its definition as the format writes it, e.g. a
 * node that was copied.
 */
export interface AddedNode {
  name: string;
  definition: unknown;
}

export interface TopologyDefinition {
  /*
   * The document of the file. Only the formats read it, and the clipboard,
   * which copies the definitions of nodes and links as they are written.
   */
  readonly document: YAMLDocument<unknown>;

  readonly name: string | undefined;

  // The names of the nodes, without resolving them
  readonly nodeNames: readonly string[];

  // The nodes by name, resolved when they are first needed
  readonly nodes: ReadonlyMap<string, TopologyNode>;
  readonly links: readonly TopologyLink[];

  // Whether the file contains template actions, which are rendered before the topology is read
  readonly isTemplate: boolean;

  // The links that have an endpoint at the given node
  linksOf(nodeName: string): TopologyLink[];

  // Whether both definitions have the same content, however it's formatted
  equals(other: TopologyDefinition): boolean;

  // The text of the topology, as it was written or as an edit produced it
  toString(): string;

  setName(name: string): TopologyDefinition;

  // Renames a node, the links follow the new name
  renameNode(nodeName: string, newName: string): TopologyDefinition;

  /**
   * Renames the interface at an endpoint of a link.
   *
   * @param linkIndex The position of the link in the topology.
   * @param endpointIndex The position of the endpoint in the endpoints of the link.
   * @param interfaceName The new name of the interface.
   */
  renameInterface(
    linkIndex: number,
    endpointIndex: number,
    interfaceName: string,
  ): TopologyDefinition;

  // Adds a link between the given endpoints
  connect(endpoints: LinkEndpoint[]): TopologyDefinition;

  // Removes nodes together with all links that have an endpoint at them
  deleteNodes(nodeNames: readonly string[]): TopologyDefinition;

  // Removes links by their position in the topology
  deleteLinks(linkIndices: readonly number[]): TopologyDefinition;

  /**
   * Adds nodes and links as the format writes them, e.g. copied ones. The
   * links refer to the nodes by their names before they were renamed.
   *
   * @param nodes The nodes by their new names.
   * @param links The links as they are written.
   * @param names The new name of each node by its name in the links.
   */
  addNodes(
    nodes: readonly AddedNode[],
    links: readonly unknown[],
    names: ReadonlyMap<string, string>,
  ): TopologyDefinition;
}

/**
 * What the files of a format can express, the interface only offers the edits
 * a format can store.
 */
export interface TopologyCapabilities {
  // Whether links name the interfaces of their nodes
  namedInterfaces: boolean;

  // Whether a link can connect more than two nodes
  multiNodeLinks: boolean;

  // Whether the nodes of the format can be edited in the node dialog
  nodeDialog: boolean;
}

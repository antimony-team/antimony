import {YAMLDocument} from '@sb/types/types';

/*
 * The model of a topology: what a topology file means, independent of the
 * format it is written in. A topology format opens its files as such a model.
 */

/**
 * A level of the topology that a node property comes from. A node inherits
 * properties from its groups, its device type and the defaults, in the order
 * of its format, the node itself takes precedence over all of them.
 */
export type PropertySource =
  | {level: 'node'}
  | {level: 'group'; name: string}
  | {level: 'device'; name: string}
  | {level: 'defaults'};

export interface ResolvedProperty {
  value: unknown;

  // The levels the value comes from, most specific first, merged values combine several
  sources: PropertySource[];
}

/**
 * A node of a topology with its effective properties, the inherited ones
 * included.
 */
export interface ResolvedNode {
  readonly name: string;

  // The type of device the node runs, e.g. the kind of a containerlab node
  readonly device: string | undefined;

  // The groups of the node, most specific first, a node can be in several groups in some formats
  readonly groups: readonly string[];
  readonly properties: ReadonlyMap<string, ResolvedProperty>;

  // The effective value of a property
  get(key: string): unknown;

  // The levels the value of a property comes from, most specific first
  sourcesOf(key: string): PropertySource[];

  // Whether the node doesn't set the property itself but inherits it
  isInherited(key: string): boolean;
}

/**
 * An end of a link at a node of the topology. Formats that assign the
 * interfaces when the topology is deployed don't name them.
 */
export interface ResolvedEndpoint {
  node: string;
  interface?: string;
}

/**
 * A link of a topology. A link between nodes has two or more endpoints, a
 * link to the host, the management network or a remote host has one.
 */
export interface ResolvedLink {
  // The position of the link in the topology
  readonly index: number;

  // The type of the link, e.g. veth, host, mgmt-net, macvlan, vxlan or dummy
  readonly type: string;
  readonly endpoints: readonly ResolvedEndpoint[];

  // The interface on the host of a link to the host, the management network or a macvlan
  readonly hostInterface: string | undefined;

  readonly isBetweenNodes: boolean;
}

export interface TopologyModel<T = unknown> {
  // The document the topology is read from
  readonly document: YAMLDocument<T>;

  readonly name: string | undefined;
  readonly nodes: ReadonlyMap<string, ResolvedNode>;
  readonly links: readonly ResolvedLink[];

  // Whether the file contains template actions, which are rendered before the topology is read
  readonly isTemplate: boolean;

  // The links that have an endpoint at the given node
  linksOf(nodeName: string): ResolvedLink[];

  // A model of a copy of the document, which can be edited without changing this one
  clone(): TopologyModel<T>;

  // The text of the topology, as it was written or as an edit produced it
  toString(): string;
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

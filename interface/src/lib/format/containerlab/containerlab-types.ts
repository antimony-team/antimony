/*
 * The structure of a containerlab topology file, as far as it's read here.
 * Only the containerlab format works with it, everything else works with the
 * definition of the topology.
 */

// A node definition of containerlab, which the defaults, the kinds and the groups share
export type ContainerlabNodeDefinition = Record<string, unknown>;

// A link as it's written, in the brief form or with a type
export type ContainerlabLinkDefinition = Record<string, unknown>;

/**
 * The definitions of a containerlab topology that the nodes inherit from.
 */
export interface ContainerlabDefinitions {
  defaults?: ContainerlabNodeDefinition | null;
  kinds?: Record<string, ContainerlabNodeDefinition | null> | null;
  groups?: Record<string, ContainerlabNodeDefinition | null> | null;
}

export interface ContainerlabFile {
  name?: unknown;
  topology?:
    | (ContainerlabDefinitions & {
        nodes?: Record<string, ContainerlabNodeDefinition | null> | null;
        links?: unknown;
      })
    | null;
}

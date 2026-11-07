import {
  TopologyCapabilities,
  TopologyDefinition,
} from '@sb/types/domain/topology-definition';

/**
 * A format of topology files. It reads the files of the format as topology
 * definitions, which the rest of the interface works with.
 */
export abstract class TopologyFormat {
  // What the files of the format can express
  public abstract readonly capabilities: TopologyCapabilities;

  /**
   * Reads a file of the format, null if it isn't valid YAML. The definition
   * keeps the text as it's written.
   */
  public abstract read(source: string): TopologyDefinition | null;

  // Checks a definition against the rules of the format, returns the error or null if it's valid
  public abstract validate(definition: TopologyDefinition): string | null;
}

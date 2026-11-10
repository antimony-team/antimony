import {FileCodec} from '@sb/lib/format/file-codec';
import {
  TopologyCapabilities,
  TopologyDefinition,
} from '@sb/types/domain/topology-definition';

/**
 * A format of topology files. It reads the files of the format as topology
 * definitions, which the rest of the interface works with, and is the codec of
 * the definition file in the editor. What a definition contains and how it's
 * edited is up to the definition the format reads.
 */
export abstract class TopologyFormat implements FileCodec<TopologyDefinition> {
  // What the files of the format can express
  public abstract readonly capabilities: TopologyCapabilities;

  /**
   * Reads a file of the format, null if it isn't valid YAML. The definition
   * keeps the text as it's written.
   */
  public abstract read(source: string): TopologyDefinition | null;

  // Checks a definition against the rules of the format, returns the error or null if it's valid
  public abstract validate(definition: TopologyDefinition): string | null;

  /**
   * Reads a file of the format and checks it, null if it isn't a valid
   * topology. An empty file isn't a topology, even if the format accepts it.
   */
  public parse(text: string): TopologyDefinition | null {
    if (!text.trim()) return null;

    const definition = this.read(text);
    if (!definition || this.validate(definition) !== null) return null;

    return definition;
  }

  // The definition keeps the text as it's written, so this gives the text back
  public serialize(definition: TopologyDefinition): string {
    return definition.toString();
  }
}

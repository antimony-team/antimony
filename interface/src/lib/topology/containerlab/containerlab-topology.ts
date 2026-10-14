import {ContainerlabLink} from '@sb/lib/topology/containerlab/containerlab-link';
import {
  ContainerlabDefinitions,
  ContainerlabNode,
} from '@sb/lib/topology/containerlab/containerlab-node';
import {asDefinition} from '@sb/lib/topology/containerlab/property-rules';
import {TopologyDefinition} from '@sb/types/domain/topology';
import {TopologyModel} from '@sb/types/domain/topology-model';
import {YAMLDocument} from '@sb/types/types';

interface ContainerlabFile {
  name?: unknown;
  topology?:
    | (ContainerlabDefinitions & {nodes?: unknown; links?: unknown})
    | null;
}

/**
 * A containerlab topology as containerlab reads it. The nodes and the links
 * are resolved from the document when they are first needed.
 */
export class ContainerlabTopology implements TopologyModel<TopologyDefinition> {
  public readonly document: YAMLDocument<TopologyDefinition>;

  // The text of the topology, the one it was read from or the serialized document once it's needed
  private text: string | null;
  private file: ContainerlabFile | null = null;
  private resolvedNodes: Map<string, ContainerlabNode> | null = null;
  private resolvedLinks: ContainerlabLink[] | null = null;

  /**
   * @param document The document of the topology.
   * @param text The text the document was read from, if it was read from one.
   */
  constructor(document: YAMLDocument<TopologyDefinition>, text?: string) {
    this.document = document;
    this.text = text ?? null;
  }

  public get name(): string | undefined {
    const name = this.read().name;
    return typeof name === 'string' ? name : undefined;
  }

  public get nodes(): ReadonlyMap<string, ContainerlabNode> {
    if (!this.resolvedNodes) {
      const definitions = this.read().topology ?? {};

      this.resolvedNodes = new Map(
        Object.entries(asDefinition(definitions.nodes) ?? {}).map(
          ([name, node]) => [
            name,
            new ContainerlabNode(name, asDefinition(node), definitions),
          ],
        ),
      );
    }

    return this.resolvedNodes;
  }

  public get links(): readonly ContainerlabLink[] {
    if (!this.resolvedLinks) {
      const links = this.read().topology?.links;

      this.resolvedLinks = Array.isArray(links)
        ? links
            .map((link, index) => ContainerlabLink.read(link, index))
            .filter(link => link !== null)
        : [];
    }

    return this.resolvedLinks;
  }

  // Containerlab renders template actions anywhere in the file, even in comments
  public get isTemplate(): boolean {
    return this.toString().includes('{{');
  }

  public linksOf(nodeName: string): ContainerlabLink[] {
    return this.links.filter(link =>
      link.endpoints.some(endpoint => endpoint.node === nodeName),
    );
  }

  // The copy keeps the text, the document of the copy is the same until it's edited
  public clone(): ContainerlabTopology {
    return new ContainerlabTopology(this.document.clone(), this.toString());
  }

  public toString(): string {
    this.text ??= this.document.toString({collectionStyle: 'block'});
    return this.text;
  }

  private read(): ContainerlabFile {
    this.file ??= (this.document.toJS() as ContainerlabFile | null) ?? {};
    return this.file;
  }
}

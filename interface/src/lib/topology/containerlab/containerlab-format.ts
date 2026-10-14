import {parseDocument} from 'yaml';

import {ContainerlabTopology} from '@sb/lib/topology/containerlab/containerlab-topology';
import {TopologyFormat} from '@sb/lib/topology/topology-format';
import {TopologyDefinition} from '@sb/types/domain/topology';
import {
  TopologyCapabilities,
  TopologyModel,
} from '@sb/types/domain/topology-model';
import {YAMLDocument} from '@sb/types/types';

/**
 * Topology files of containerlab, read the way containerlab v0.81 reads them.
 * Containerlab renders every file as a template and expands environment
 * variables before it reads the YAML, both are kept as they are written.
 */
export class ContainerlabFormat extends TopologyFormat<TopologyDefinition> {
  public readonly capabilities: TopologyCapabilities = {
    namedInterfaces: true,
    multiNodeLinks: false,
    nodeDialog: true,
  };

  protected parse(source: string): YAMLDocument<TopologyDefinition> | null {
    // Containerlab supports the merge keys of YAML 1.1, e.g. <<: *defaults
    const document = parseDocument(source, {merge: true});
    if (document.errors.length > 0) return null;

    return document as YAMLDocument<TopologyDefinition>;
  }

  protected createModel(
    document: YAMLDocument<TopologyDefinition>,
    text?: string,
  ): TopologyModel<TopologyDefinition> {
    return new ContainerlabTopology(document, text);
  }
}

export const containerlabFormat = new ContainerlabFormat();

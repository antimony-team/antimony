import {ValidateFunction} from 'ajv';
import {parseDocument} from 'yaml';

import {ContainerlabDefinition} from '@sb/lib/topology/containerlab/containerlab-definition';
import {ContainerlabFile} from '@sb/lib/topology/containerlab/containerlab-types';
import {TopologyFormat} from '@sb/lib/topology/topology-format';
import {
  TopologyCapabilities,
  TopologyDefinition,
} from '@sb/types/domain/topology-definition';
import {YAMLDocument} from '@sb/types/types';

/**
 * Topology files of containerlab, read the way containerlab v0.81 reads them.
 * Containerlab renders every file as a template and expands environment
 * variables before it reads the YAML, both are kept as they are written.
 */
export class ContainerlabFormat extends TopologyFormat {
  public readonly capabilities: TopologyCapabilities = {
    namedInterfaces: true,
    multiNodeLinks: false,
    nodeDialog: true,
  };

  // The validator of the containerlab schema, the schema is fetched from the server
  private readonly getValidator: () => ValidateFunction | null;

  constructor(getValidator: () => ValidateFunction | null) {
    super();
    this.getValidator = getValidator;
  }

  public read(source: string): ContainerlabDefinition | null {
    // Containerlab supports the merge keys of YAML 1.1, e.g. <<: *defaults
    const document = parseDocument(source, {merge: true});
    if (document.errors.length > 0) return null;

    return new ContainerlabDefinition(
      document as YAMLDocument<ContainerlabFile>,
      source,
    );
  }

  public validate(definition: TopologyDefinition): string | null {
    const validator = this.getValidator();
    if (!validator) return 'The containerlab schema is not loaded';
    if (validator(definition.document.toJS())) return null;

    // The error deepest in the topology is the most specific one, alternatives of the schema are reported as well
    const error = validator.errors?.reduce((deepest, current) =>
      current.instancePath.length > deepest.instancePath.length
        ? current
        : deepest,
    );

    return error
      ? `${error.instancePath} ${error.message}`.trim()
      : 'Invalid topology';
  }
}

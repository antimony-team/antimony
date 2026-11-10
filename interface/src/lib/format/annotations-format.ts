import {ValidateFunction} from 'ajv';

import {FileCodec} from '@sb/lib/format/file-codec';
import {TopologyAnnotations} from '@sb/types/domain/topology';

// Serialized annotations by object. Edits always replace the annotations
// instead of changing them, so a serialized value stays valid.
const serializedAnnotations = new WeakMap<TopologyAnnotations, string>();

/**
 * Serializes annotations the way the server stores them.
 */
export function serializeAnnotations(annotations: TopologyAnnotations) {
  let serialized = serializedAnnotations.get(annotations);

  if (serialized === undefined) {
    serialized = JSON.stringify(annotations, null, 2);
    serializedAnnotations.set(annotations, serialized);
  }

  return serialized;
}

/**
 * Containerlab's annotations format, which the annotations file of every
 * topology is written in. Annotations are checked against its schema once the
 * schema is loaded.
 */
export class AnnotationsFormat implements FileCodec<TopologyAnnotations> {
  constructor(private readonly getValidator: () => ValidateFunction | null) {}

  public parse(text: string): TopologyAnnotations | null {
    let annotations: TopologyAnnotations;

    try {
      annotations = JSON.parse(text);
    } catch {
      return null;
    }

    if (typeof annotations !== 'object' || annotations === null) return null;

    const validator = this.getValidator();
    if (validator && !validator(annotations)) return null;

    return annotations;
  }

  public serialize(annotations: TopologyAnnotations): string {
    return serializeAnnotations(annotations);
  }

  // The server stores the annotations reformatted
  public normalize(text: string): string {
    const annotations = this.parse(text);
    return annotations ? serializeAnnotations(annotations) : text;
  }
}

import {
  TopologyCapabilities,
  TopologyModel,
} from '@sb/types/domain/topology-model';
import {YAMLDocument} from '@sb/types/types';

/**
 * A format of topology files. It reads the files of the format as a topology
 * model, which the rest of the interface works with.
 */
export abstract class TopologyFormat<T> {
  // What the files of the format can express
  public abstract readonly capabilities: TopologyCapabilities;

  // The model of each document, an edit replaces the document with an edited copy
  private readonly models = new WeakMap<YAMLDocument<T>, TopologyModel<T>>();

  /**
   * Reads a file of the format, null if it isn't valid YAML. The model keeps
   * the text as it's written.
   */
  public read(source: string): TopologyModel<T> | null {
    const document = this.parse(source);
    if (!document) return null;

    const model = this.createModel(document, source);
    this.models.set(document, model);

    return model;
  }

  /**
   * Returns the model of a document, e.g. of an edited copy. Each document is
   * only resolved once, the same model is returned when it's opened again.
   */
  public open(document: YAMLDocument<T>): TopologyModel<T> {
    let model = this.models.get(document);
    if (!model) {
      model = this.createModel(document);
      this.models.set(document, model);
    }

    return model;
  }

  // Parses a file of the format, null if it isn't valid YAML
  protected abstract parse(source: string): YAMLDocument<T> | null;

  /**
   * @param document The document of the topology.
   * @param text The text the document was read from, if it was read from one.
   */
  protected abstract createModel(
    document: YAMLDocument<T>,
    text?: string,
  ): TopologyModel<T>;
}

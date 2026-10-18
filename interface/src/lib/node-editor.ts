import {isEqual} from 'lodash-es';
import objectPath from 'object-path';

import {
  findNodeAnnotation,
  renameNodeAnnotation,
  updateNodeAnnotations,
} from '@sb/lib/graph/topology-annotations';
import {readNodeIcon} from '@sb/lib/graph/topology-graph';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {TopologyFormat} from '@sb/lib/topology/topology-format';
import {Binding} from '@sb/lib/utils/binding';
import {arrayOf, filterSchemaEnum} from '@sb/lib/utils/utils';
import {
  ClabSchema,
  PatternPropertyDefinition,
  PropertySchema,
  PropertyType,
} from '@sb/types/domain/schema';
import {NodeLabels, TopologyAnnotations} from '@sb/types/domain/topology';
import {
  TopologyDefinition,
  TopologyLink,
  TopologyNode,
} from '@sb/types/domain/topology-definition';
import {FieldType} from '@sb/types/types';

/*
 * Object used by the view to communicate with the Node Editor.
 */
export type PropertyIO = PropertyDefinition & {
  key: string;

  // The value the node sets itself, undefined if it only inherits the property
  value: FieldType | undefined;

  // The value the node would inherit without its own, for lists the inherited entries it adds to
  inheritedValue: FieldType | undefined;
  wasEdited: boolean;
  wasAdded: boolean;

  // Removes the value of the node itself, so the inherited value applies again
  onReset: () => void;
  onUpdateValue: (value: FieldType) => string | null;
  onUpdateKey: (value: string) => string | null;
};

export type PropertyDefinition = {
  type: FieldType;
  isArray?: boolean;
  description?: string;
  availableValues?: string[];
  minItems?: number;
  uniqueItems?: boolean;
};

export class NodeEditor {
  public readonly clabSchema: ClabSchema;
  private readonly format: TopologyFormat;
  public readonly onEdit: Binding<TopologyDefinition> = new Binding();
  private readonly originalTopology: TopologyDefinition;
  private readonly statusMessageStore: StatusMessageStore;
  // Name of the current node in the original topology, which isn't changed by renaming
  private readonly originalNode: string;
  private editingNode: string;
  private editingTopology: TopologyDefinition;
  private originalAnnotations: TopologyAnnotations;
  private editingAnnotations: TopologyAnnotations;

  private hasChangedName: boolean = false;

  constructor(
    clabSchema: ClabSchema,
    format: TopologyFormat,
    editingNode: string,
    originalTopology: TopologyDefinition,
    originalAnnotations: TopologyAnnotations,
    statusMessageStore: StatusMessageStore,
  ) {
    this.clabSchema = clabSchema;
    this.format = format;
    this.originalNode = editingNode;
    this.editingNode = editingNode;
    this.statusMessageStore = statusMessageStore;
    this.originalTopology = originalTopology;
    this.editingTopology = originalTopology;
    this.originalAnnotations = originalAnnotations;
    this.editingAnnotations = originalAnnotations;

    this.onUpdateName = this.onUpdateName.bind(this);
    this.getObjectProperties = this.getObjectProperties.bind(this);
  }

  /**
   * Replaces the current node's name with a new one.
   *
   * @param value The new name for the node.
   */
  public onUpdateName(value: string): string | null {
    if (value === this.editingNode) {
      return null;
    }

    const oldName = this.editingNode;

    if (this.editingTopology.nodes.has(value)) {
      return 'A node with that name already exists';
    }

    this.editingTopology = this.editingTopology.renameNode(oldName, value);

    this.editingAnnotations = renameNodeAnnotation(
      this.editingAnnotations,
      oldName,
      value,
    );
    this.originalAnnotations = renameNodeAnnotation(
      this.originalAnnotations,
      oldName,
      value,
    );

    this.editingNode = value;
    this.hasChangedName = true;

    return null;
  }

  /**
   * Generates PropertyIO objects for all properties of a given object of the
   * current node.
   *
   * Returns the root node properties by default.
   *
   * @param objectKey The key path to the object in the topology.
   * @param schemaKey The key path to the schema definition of the object.
   */
  public getObjectProperties(
    objectKey: string = '',
    schemaKey: string = 'node-config',
  ): PropertyIO[] {
    const objectPath = objectPathOf(objectKey);

    return this.propertyKeys(objectKey).flatMap(propertyKey => {
      const propertyType = this.getPropertyType(propertyKey, schemaKey);

      // Skip object properties as they are handled manually.
      if (propertyType.type === 'object') return [];

      const path = [...objectPath, propertyKey];
      const value = this.getNode()?.own(path) as FieldType | undefined;

      return [
        {
          key: propertyKey,
          value,
          inheritedValue: this.inheritedValue(path, value),
          wasEdited: this.wasPropertyEdited(propertyKey, objectKey),
          wasAdded: this.wasPropertyAdded(propertyKey, objectKey),
          ...propertyType,
          onReset: () => {
            this.resetProperty(propertyKey, objectKey);
          },
          onUpdateValue: value => {
            return this.updatePropertyValue(propertyKey, objectKey, value);
          },
          onUpdateKey: value => {
            return this.updatePropertyKey(propertyKey, objectKey, value);
          },
        },
      ];
    });
  }

  /**
   * Returns a list of available    return properties;
  }

  /**
   * Returns a list of available non-set property keys of an object of the node.
   *
   * Returns null if there are no restrictions on properties.
   *
   * @param objectKey The key path to the object in the topology.
   * @param schemaKey The key path to the schema definition of the object.
   */
  public getAvailableProperties(
    objectKey: string = '',
    schemaKey: string = 'node-config',
  ): string[] | null {
    const schemaProperties = objectPath.get(
      this.clabSchema.definitions,
      schemaKey,
    )?.properties;
    if (!schemaProperties) return null;

    const schemaPropertyKeys = new Set(Object.keys(schemaProperties));

    const setPropertyKeys = new Set(this.propertyKeys(objectKey));

    return [...schemaPropertyKeys.difference(setPropertyKeys)].filter(
      property => !IgnoredGenericProperties.has(property),
    );
  }

  /**
   * Adds a new property to an object of the current node.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   * @param schemaRootPath The key path of the property's parent in the schema.
   */
  public addProperty(
    propertyKey: string,
    objectRootPath: string,
    schemaRootPath: string,
  ): string | null {
    return this.setPropertyDefault(propertyKey, objectRootPath, schemaRootPath);
  }

  /**
   * Returns the current topology.
   */
  public getTopology(): TopologyDefinition {
    return this.editingTopology;
  }

  /**
   * Returns the current annotations.
   */
  public getAnnotations(): TopologyAnnotations {
    return this.editingAnnotations;
  }

  /**
   * Returns the current node with its inherited properties.
   */
  public getNode(): TopologyNode | undefined {
    return this.editingTopology.nodes.get(this.editingNode);
  }

  /**
   * Returns the links between the current node and other nodes.
   */
  public getLinks(): TopologyLink[] {
    return this.editingTopology
      .linksOf(this.editingNode)
      .filter(
        link =>
          link.endpoints.length === 2 &&
          link.endpoints.every(
            endpoint =>
              endpoint.interface &&
              this.editingTopology.nodes.has(endpoint.node),
          ),
      );
  }

  /**
   * Returns the name of the current node.
   */
  public getNodeName(): string {
    return this.editingNode;
  }

  /**
   * Updates the value of a property of an object of the current node.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   * @param value The new value of the property.
   */
  public updatePropertyValue(
    propertyKey: string,
    objectRootPath: string,
    value: FieldType,
  ): string | null {
    // An emptied value of an inherited property is the inherited value again
    if (
      value === '' &&
      this.getNode()?.inherited(
        this.propertyPath(objectRootPath, propertyKey),
      ) !== undefined
    ) {
      return this.resetProperty(propertyKey, objectRootPath);
    }

    const updatedTopology = this.editingNodeIn(this.editingTopology).set(
      this.propertyPath(objectRootPath, propertyKey),
      value,
    );

    return this.validateAndSetTopology(
      updatedTopology,
      `Invalid value for property '${objectRootPath}/${propertyKey}'`,
    );
  }

  /**
   * Returns the icon of a node, the current node by default.
   */
  public getNodeIcon(nodeName: string = this.editingNode): string | undefined {
    return readNodeIcon(
      this.editingTopology.nodes.get(nodeName)?.get('labels') as
        | NodeLabels
        | undefined,
      findNodeAnnotation(this.editingAnnotations, nodeName),
    );
  }

  public onUpdateIcon(icon: string) {
    this.editingAnnotations = updateNodeAnnotations(
      this.editingAnnotations,
      new Map([[this.editingNode, {icon}]]),
    );
  }

  /**
   * Returns whether the current object has been edited.
   */
  public hasEdits(): boolean {
    return (
      !this.originalTopology.equals(this.editingTopology) ||
      !isEqual(this.originalAnnotations, this.editingAnnotations) ||
      this.hasChangedName
    );
  }

  /**
   * Renames the interface at an end of a link of the current node.
   *
   * @param linkIndex The position of the link in the topology.
   * @param endpointIndex The position of the endpoint in the link.
   * @param interfaceName The new name of the interface.
   */
  public renameInterface(
    linkIndex: number,
    endpointIndex: number,
    interfaceName: string,
  ) {
    this.validateAndSetTopology(
      this.editingTopology.renameInterface(
        linkIndex,
        endpointIndex,
        interfaceName,
      ),
      'Failed to update connection.',
    );
  }

  /**
   * Updates the value of a property of an object of the current node.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   * @param newKey The new key of the property.
   */
  private updatePropertyKey(
    propertyKey: string,
    objectRootPath: string,
    newKey: string,
  ): string | null {
    const node = this.editingNodeIn(this.editingTopology);
    const updatedTopology = this.editingNodeIn(
      node.set(
        this.propertyPath(objectRootPath, newKey),
        node.own(this.propertyPath(objectRootPath, propertyKey)),
      ),
    ).reset(this.propertyPath(objectRootPath, propertyKey));

    return this.validateAndSetTopology(
      updatedTopology,
      `Invalid value for property '${objectRootPath}/${propertyKey}'`,
    );
  }

  /**
   * Removes the value the current node sets itself, so it inherits the
   * property again. Objects that are empty without it are removed as well.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   */
  private resetProperty(propertyKey: string, objectRootPath: string) {
    const updatedTopology = this.editingNodeIn(this.editingTopology).reset(
      this.propertyPath(objectRootPath, propertyKey),
    );

    return this.validateAndSetTopology(
      updatedTopology,
      'Unable to reset property.',
    );
  }

  /**
   * Adds a new property with its default value to an object of the current node.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   * @param schemaRootPath The key path of the property's parent in the schema.
   */
  private setPropertyDefault(
    propertyKey: string,
    objectRootPath: string,
    schemaRootPath: string,
  ) {
    const updatedTopology = this.editingNodeIn(this.editingTopology).set(
      this.propertyPath(objectRootPath, propertyKey),
      this.getPropertyDefault(propertyKey, schemaRootPath),
    );

    return this.validateAndSetTopology(
      updatedTopology,
      `Failed to add property '${propertyKey}'.`,
    );
  }

  /**
   * Checks whether the current node sets a property that it didn't set before.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   */
  private wasPropertyAdded(
    propertyKey: string,
    objectRootPath: string,
  ): boolean {
    return (
      this.originalValue(objectRootPath, propertyKey) === undefined &&
      this.getNode()?.own(this.propertyPath(objectRootPath, propertyKey)) !==
        undefined
    );
  }

  /**
   * Checks whether the value the current node sets itself was changed.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   */
  private wasPropertyEdited(
    propertyKey: string,
    objectRootPath: string,
  ): boolean {
    const originalValue = this.originalValue(objectRootPath, propertyKey);
    const currentValue = this.getNode()?.own(
      this.propertyPath(objectRootPath, propertyKey),
    );

    return originalValue !== undefined && !isEqual(currentValue, originalValue);
  }

  // The keys of an object of the current node, the ones it sets itself and the inherited ones
  private propertyKeys(objectKey: string): string[] {
    const path = objectPathOf(objectKey);
    const node = this.getNode();

    return [
      ...new Set([
        ...Object.keys(asObject(node?.own(path))),
        ...Object.keys(asObject(node?.valueAt(path))),
      ]),
    ].filter(key => !IgnoredGenericProperties.has(key));
  }

  /*
   * The inherited value of a property. Lists are added to the inherited ones,
   * so the inherited entries are the ones the node doesn't set itself.
   */
  private inheritedValue(
    path: string[],
    ownValue: FieldType | undefined,
  ): FieldType | undefined {
    const node = this.getNode();
    const value = (
      Array.isArray(ownValue) ? node?.valueAt(path) : node?.inherited(path)
    ) as FieldType | undefined;

    if (Array.isArray(value)) {
      const entries = value.filter(
        entry => !Array.isArray(ownValue) || !ownValue.includes(entry),
      );
      return entries.length > 0 ? entries : undefined;
    }

    return value;
  }

  /**
   * Returns the default value of a property, the first value of its enum or
   * the default value of its type.
   *
   * @param propertyKey The key of the property.
   * @param schemaRootPath The key path of the property's parent in the schema.
   */
  private getPropertyDefault(propertyKey: string, schemaRootPath: string) {
    const propertyType = this.getPropertyType(propertyKey, schemaRootPath);

    const defaultEnumValue = propertyType.availableValues
      ? propertyType.availableValues[0]
      : '';

    if (propertyType.isArray) {
      return arrayOf(defaultEnumValue, propertyType.minItems ?? 0);
    }

    switch (propertyType.type) {
      case 'integer':
      case 'number':
        return 0;
      case 'boolean':
        return false;
      default:
        return defaultEnumValue;
    }
  }

  /**
   * Gets information about a property of an object in the current node.
   *
   * @param propertyKey The key of the property.
   * @param schemaRootPath The key path of the property's parent in the schema.
   */
  private getPropertyType(
    propertyKey: string,
    schemaRootPath: string,
  ): PropertyDefinition {
    const regularDefinition: PropertySchema | undefined = objectPath.get(
      this.clabSchema.definitions,
      schemaRootPath + '.properties.' + propertyKey,
    );

    if (regularDefinition) {
      return this.getRegularPropertyType(regularDefinition);
    }

    const patternDefinition: PatternPropertyDefinition | undefined =
      objectPath.get(
        this.clabSchema.definitions,
        schemaRootPath + '.patternProperties',
      );

    if (patternDefinition) {
      return this.getPatternPropertyType(patternDefinition);
    }

    return {type: 'string'};
  }

  /**
   * Returns the property type of a regular property (i.e. no pattern properties).
   *
   * @param propertyDefinition The schema definition of the property.
   */
  private getRegularPropertyType(
    propertyDefinition: PropertySchema,
  ): PropertyDefinition {
    return this.getMostSignificantType(
      propertyDefinition.anyOf ?? [propertyDefinition],
    );
  }

  /**
   * Returns the property type of a pattern property.
   *
   * @param patternPropertyDefinition The schema definition of the property.
   */
  private getPatternPropertyType(
    patternPropertyDefinition: PatternPropertyDefinition,
  ): PropertyDefinition {
    const typeArray =
      patternPropertyDefinition['.*']?.oneOf ??
      patternPropertyDefinition['.+']?.anyOf;
    return this.getMostSignificantType(typeArray ?? []);
  }

  /**
   * Returns the current node in the given topology. A new node is added to the
   * topology with an empty definition, so properties can be set on it.
   */
  private editingNodeIn(topology: TopologyDefinition): TopologyNode {
    const node = topology.nodes.get(this.editingNode);
    if (node) return node;

    return topology
      .addNodes([{name: this.editingNode, definition: {}}], [], new Map())
      .nodes.get(this.editingNode)!;
  }

  // The value the current node itself set in the original topology
  private originalValue(objectRootPath: string, propertyKey: string): unknown {
    return this.originalTopology.nodes
      .get(this.originalNode)
      ?.own(this.propertyPath(objectRootPath, propertyKey));
  }

  /**
   * Returns the most significant type of a list of property definitions.
   * Returns string as default, if the type could not be found.
   *
   * Order: array -> string -> number -> boolean
   * Fallback: string
   *
   * @param propertyList The list of properties.
   */
  private getMostSignificantType(
    propertyList: PropertySchema[],
  ): PropertyDefinition {
    const availableTypes = new Map(
      propertyList.map(entry => [entry.type, entry]),
    );

    if (availableTypes.has('object')) return {type: 'object'};

    if (availableTypes.has('array')) {
      const type = availableTypes.get('array')!;
      return {
        type: 'string',
        isArray: true,
        availableValues: filterSchemaEnum(type.enum),
        description: type.description,
        minItems: type.minItems,
        uniqueItems: type.uniqueItems,
      };
    }

    const type: PropertyType = 'string';

    if (availableTypes.has('string')) {
      const type = availableTypes.get('string')!;
      return {
        type: 'string',
        description: type.description,
        availableValues: filterSchemaEnum(type?.enum),
      };
    } else if (availableTypes.has('number')) {
      const type = availableTypes.get('number')!;
      return {
        type: 'number',
        description: type.description,
        availableValues: filterSchemaEnum(type?.enum),
      };
    } else if (availableTypes.has('integer')) {
      const type = availableTypes.get('integer')!;
      return {
        type: 'number',
        description: type.description,
        availableValues: filterSchemaEnum(type?.enum),
      };
    } else if (availableTypes.has('boolean')) {
      const type = availableTypes.get('boolean')!;
      return {
        type: 'boolean',
        description: type.description,
        availableValues: filterSchemaEnum(type?.enum),
      };
    }

    return {type};
  }

  /**
   * Validates and replaces the current topology with the updated one if the
   * validation was successful. Returns an error message and shows a
   * notification to the user if the validation was not successful.
   *
   * @param topology The updated topology
   * @param customErrorMessage An optional custom error message to show to the user.
   * @private
   */
  private validateAndSetTopology(
    topology: TopologyDefinition,
    customErrorMessage: string | null = null,
  ): string | null {
    const errorMessage = this.format.validate(topology);

    if (errorMessage === null) {
      this.editingTopology = topology;
      this.onEdit.update(topology);
      return null;
    }

    console.error(
      `[YAML] Failed to apply node edit: ${errorMessage}`,
      topology,
    );
    this.statusMessageStore.error(
      customErrorMessage ?? errorMessage,
      'YAML Schema Error',
    );
    return errorMessage;
  }

  /**
   * Combines the root path and key of a property to a path in the node.
   *
   * @param root The path to the root of the object.
   * @param key The path to the property.
   */
  private propertyPath(root?: string, ...key: string[]): string[] {
    return [...objectPathOf(root), ...key.flatMap(objectPathOf)];
  }
}

function asObject(value: unknown): object {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

// The keys of a dotted path, an empty path is the node itself
function objectPathOf(path?: string): string[] {
  return path ? path.split('.') : [];
}

// These properties are ignored in the generic property list due to being covered individually
const IgnoredGenericProperties = new Set([
  'kind',
  'env',
  'labels',
  'dns',
  'certificate',
  'extras',
  'healthcheck',

  /*
   * We also ignore 'type' as it's currently broken due to schema complications. Has something to do with a schema rule
   * that is not present directly in 'ndoe-config' definition.
   */
  'type',
]);

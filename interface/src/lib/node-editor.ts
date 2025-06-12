import _, {isEqual} from 'lodash';
import {validate} from 'jsonschema';
import objectPath from 'object-path';
import {YAMLMap, YAMLSeq} from 'yaml';

import {
  ClabSchema,
  PatternPropertyDefinition,
  PropertySchema,
  PropertyType,
} from '@sb/types/domain/schema';
import {
  NodeConnection,
  TopologyDefinition,
  TopologyNode,
} from '@sb/types/domain/topology';
import {Binding} from '@sb/lib/utils/binding';
import {FieldType, YAMLDocument} from '@sb/types/types';
import {arrayOf, filterSchemaEnum} from '@sb/lib/utils/utils';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';

/*
 * Object used by the view to communicate with the Node Editor.
 */
export type PropertyIO = PropertyDefinition & {
  key: string;
  value: FieldType;
  wasEdited: boolean;
  wasAdded: boolean;

  onReset: () => void;
  onDelete: () => void;
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
  private readonly originalTopology: YAMLDocument<TopologyDefinition>;
  private readonly statusMessageStore: StatusMessageStore;
  public readonly clabSchema: ClabSchema;

  public readonly onEdit: Binding<YAMLDocument<TopologyDefinition>> =
    new Binding();

  private editingNode: string;
  private editingTopology: YAMLDocument<TopologyDefinition>;

  private hasChangedName: boolean = false;

  constructor(
    clabSchema: ClabSchema,
    editingNode: string,
    originalTopology: YAMLDocument<TopologyDefinition>,
    statusMessageStore: StatusMessageStore,
  ) {
    this.clabSchema = clabSchema;
    this.editingNode = editingNode;
    this.statusMessageStore = statusMessageStore;
    this.originalTopology = originalTopology;
    this.editingTopology = originalTopology.clone();

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

    if (this.editingTopology.getIn(['topology', 'nodes', value])) {
      return 'A node with that name already exists';
    }

    this.editingTopology.setIn(
      ['topology', 'nodes', value],
      this.editingTopology.getIn(['topology', 'nodes', this.editingNode]),
    );

    this.originalTopology.setIn(
      ['topology', 'nodes', value],
      this.originalTopology.getIn(['topology', 'nodes', this.editingNode]),
    );

    this.editingTopology.deleteIn(['topology', 'nodes', this.editingNode]);
    this.originalTopology.deleteIn(['topology', 'nodes', this.editingNode]);

    this.editingNode = value;
    this.hasChangedName = true;

    // Update links to still connect with the renamed node
    const linksObj = this.editingTopology.getIn([
      'topology',
      'links',
    ]) as YAMLSeq;

    if (!linksObj) {
      return null;
    }

    const links = linksObj.toJS(this.editingTopology) as {
      endpoints: string[];
    }[];

    for (const [index, link] of links.entries()) {
      const endpoint1 = link.endpoints[0].split(':');
      const endpoint2 = link.endpoints[1].split(':');

      if (endpoint1[0] === oldName) {
        this.editingTopology.setIn(
          ['topology', 'links', index, 'endpoints', 0],
          `${value}:${endpoint1[1]}`,
        );
      }

      if (endpoint2[0] === oldName) {
        this.editingTopology.setIn(
          ['topology', 'links', index, 'endpoints', 1],
          `${value}:${endpoint2[1]}`,
        );
      }
    }

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
    const properties: PropertyIO[] = [];

    const obj = objectPath.get(
      this.editingTopology.toJS().topology.nodes[this.editingNode],
      objectKey,
    );

    if (!obj) return [];

    for (const [propertyKey, value] of Object.entries(obj)) {
      if (IgnoredGenericProperties.has(propertyKey)) continue;

      const propertyType = this.getPropertyType(propertyKey, schemaKey);

      // Skip object properties as they are handled manually.
      if (propertyType.type === 'object') continue;

      properties.push({
        key: propertyKey,
        value: value as FieldType,
        wasEdited: this.wasPropertyEdited(propertyKey, objectKey, schemaKey),
        wasAdded: this.wasPropertyAdded(propertyKey, objectKey),
        ...propertyType,
        onReset: () => {
          this.setPropertyDefault(propertyKey, objectKey, schemaKey);
        },
        onDelete: () => {
          this.deleteProperty(propertyKey, objectKey);
        },
        onUpdateValue: value => {
          return this.updatePropertyValue(propertyKey, objectKey, value);
        },
        onUpdateKey: value => {
          return this.updatePropertyKey(propertyKey, objectKey, value);
        },
      });
    }

    return properties;
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

    const setProperties = objectPath.get(
      this.editingTopology.toJS().topology.nodes[this.editingNode],
      objectKey,
    );
    if (!setProperties) return [...schemaPropertyKeys];

    const setPropertyKeys = new Set(Object.keys(setProperties));

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
    return this.setPropertyDefault(
      propertyKey,
      objectRootPath,
      schemaRootPath,
      false,
    );
  }

  /**
   * Returns the current topology.
   */
  public getTopology(): YAMLDocument<TopologyDefinition> {
    return this.editingTopology;
  }

  /**
   * Returns the current node.
   */
  public getNode(): TopologyNode | undefined {
    return this.editingTopology.toJS().topology.nodes[this.editingNode];
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
    const updatedTopology = this.editingTopology.clone();

    this.ensureBaseNodeExists(updatedTopology);

    updatedTopology.setIn(
      this.propertyPath(objectRootPath, propertyKey),
      value,
    );

    return this.validateAndSetTopology(
      updatedTopology,
      `Invalid value for property '${objectRootPath}/${propertyKey}'`,
    );
  }

  public onUpdateIcon(icon: string): string | null {
    const updatedTopology = this.editingTopology.clone();

    updatedTopology.setIn(this.propertyPath('labels', 'graph-icon'), icon);

    return this.validateAndSetTopology(updatedTopology, "Invalid icon'");
  }

  /**
   * Returns whether the current object has been edited.
   */
  public hasEdits(): boolean {
    return (
      !isEqual(this.originalTopology.toJS(), this.editingTopology.toJS()) ||
      this.hasChangedName
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
    const updatedTopology = this.editingTopology.clone();

    updatedTopology.setIn(
      this.propertyPath(objectRootPath, newKey),
      this.editingTopology.getIn(
        this.propertyPath(objectRootPath, propertyKey),
      ),
    );

    updatedTopology.deleteIn(this.propertyPath(objectRootPath, propertyKey));

    return this.validateAndSetTopology(
      updatedTopology,
      `Invalid value for property '${objectRootPath}/${propertyKey}'`,
    );
  }

  /**
   * Deletes a property of an object of the current node.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   */
  private deleteProperty(propertyKey: string, objectRootPath: string) {
    const updatedTopology = this.editingTopology.clone();

    updatedTopology.deleteIn(this.propertyPath(objectRootPath, propertyKey));

    /*
     * Remove the object if it's now empty. Note that this only works on
     * child objects and not the node itself, as the objectRootPath is empty
     * for the node object.
     */
    const obj = objectPath.get(
      updatedTopology.toJS().topology.nodes[this.editingNode],
      objectRootPath,
    );

    if (_.isEmpty(obj)) {
      updatedTopology.deleteIn(this.propertyPath(objectRootPath));
    }

    return this.validateAndSetTopology(
      updatedTopology,
      'Unable to remove property.',
    );
  }

  /**
   * Adds a new or resets an existing property to an object of the current node.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   * @param schemaRootPath The key path of the property's parent in the schema.
   * @param searchOriginal Whether to look in the original object for a default value first.
   */
  private setPropertyDefault(
    propertyKey: string,
    objectRootPath: string,
    schemaRootPath: string,
    searchOriginal: boolean = true,
  ) {
    const updatedTopology = this.editingTopology.clone();

    this.ensureBaseNodeExists(updatedTopology);

    updatedTopology.setIn(
      this.propertyPath(objectRootPath, propertyKey),
      this.getPropertyDefault(
        propertyKey,
        objectRootPath,
        schemaRootPath,
        searchOriginal,
      ),
    );

    return this.validateAndSetTopology(
      updatedTopology,
      `Failed to add property '${propertyKey}'.`,
    );
  }

  /**
   * Checks whether a property has been added.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   */
  private wasPropertyAdded(
    propertyKey: string,
    objectRootPath: string,
  ): boolean {
    return (
      this.originalTopology.getIn(
        this.propertyPath(objectRootPath, propertyKey),
      ) === undefined
    );
  }

  /**
   * Checks whether the value of an existing property was changed.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   * @param schemaRootPath The key path of the property's parent in the schema.
   */
  private wasPropertyEdited(
    propertyKey: string,
    objectRootPath: string,
    schemaRootPath: string,
  ): boolean {
    const currentValue = this.editingTopology.getIn(
      this.propertyPath(objectRootPath, propertyKey),
    );

    const originalValue =
      this.originalTopology.getIn(
        this.propertyPath(objectRootPath, propertyKey),
      ) ?? this.getPropertyDefault(propertyKey, objectRootPath, schemaRootPath);

    return !_.isEqual(currentValue, originalValue);
  }

  /**
   * Returns the default value of a property. If searchOriginal is set to true,
   * for existing properties, this is the original property value.
   * Otheriwse and for newly added properties, this is either
   * the first value of their enum or their type's default value.
   *
   * @param propertyKey The key of the property.
   * @param objectRootPath The key path of the property's parent.
   * @param schemaRootPath The key path of the property's parent in the schema.
   * @param searchOriginal Whether to look in the original object for a default value first.
   * @private
   */
  private getPropertyDefault(
    propertyKey: string,
    objectRootPath: string,
    schemaRootPath: string,
    searchOriginal: boolean = true,
  ) {
    if (searchOriginal) {
      const originalValue = this.originalTopology.getIn(
        this.propertyPath(objectRootPath, propertyKey),
      );

      if (originalValue) return originalValue;
    }

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
   * Ensures that the YAMLMap object for the whole node exists.
   *
   * This is important when adding properties to a blank object.
   * @param topology The topology to check the node in.
   * @private
   */
  private ensureBaseNodeExists(topology: YAMLDocument<TopologyDefinition>) {
    const nodeObjectPath = ['topology', 'nodes', this.editingNode];
    if (!topology.getIn(nodeObjectPath)) {
      topology.setIn(nodeObjectPath, new YAMLMap());
    }
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

  public modifyConnection(updatedConnection: NodeConnection) {
    if (!this.editingTopology) return;

    const updatedTopology = this.editingTopology.clone();

    const links = updatedTopology.getIn(['topology', 'links']) as YAMLSeq;

    const updatedHostInterface =
      updatedConnection.hostInterfaceConfig.interfacePattern.replaceAll(
        '$',
        String(updatedConnection.hostInterfaceIndex),
      );

    const updatedTargetInterface =
      updatedConnection.targetInterfaceConfig.interfacePattern.replaceAll(
        '$',
        String(updatedConnection.targetInterfaceIndex),
      );

    links.set(updatedConnection.index, {
      endpoints: [
        `${updatedConnection.hostNode}:${updatedHostInterface}`,
        `${updatedConnection.targetNode}:${updatedTargetInterface}`,
      ],
    });

    this.validateAndSetTopology(
      updatedTopology,
      'Failed to update connection.',
    );
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
    topology: YAMLDocument<TopologyDefinition>,
    customErrorMessage: string | null = null,
  ): string | null {
    const validation = validate(topology.toJS(), this.clabSchema);

    if (validation.errors.length < 1) {
      this.editingTopology = topology;
      this.onEdit.update(topology);
      return null;
    } else {
      console.error(
        `[YAML] Failed to apply node edit: ${validation}`,
        topology,
      );
      this.statusMessageStore.error(
        customErrorMessage ?? validation.errors[0].message,
        'YAML Schema Error',
      );
      return validation.errors[0].message;
    }
  }

  /**
   * Combines the root path and key of a property to a path.
   *
   * If the root path is empty, only the key will be returned. This is needed
   * because objectPath doesn't skip empty values and will instead create
   * a new object with an empty key.
   *
   * @param root The path to the root of the object.
   * @param key The path to the property.
   */
  private propertyPath(root?: string, ...key: string[]): string[] {
    const prefix = 'topology.nodes.' + this.editingNode + '.';
    if (!root) return (prefix + key.join('.')).split('.');

    return (prefix + root + '.' + key.join('.')).split('.');
  }
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

export interface ClabSchema {
  definitions: {
    'node-config': {
      properties: {
        [key: string]: PropertySchema;
      };
    };
  };
}

export interface PropertySchema {
  type?: PropertyType;
  enum?: string[];
  minItems?: number;
  items?: PropertySchema;
  description: string;
  uniqueItems?: boolean;
  anyOf?: PropertySchema[];
}

export interface PatternPropertyDefinition {
  '.*'?: {
    oneOf: PropertySchema[];
  };

  '.+'?: {
    anyOf: PropertySchema[];
  };
}

export type PropertyType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object';

import {
  BorderStyle,
  FreeShapeAnnotation,
  FreeTextAnnotation,
  GroupStyleAnnotation,
} from '@sb/types/domain/topology';

/**
 * The style of a group or shape as it is edited in the graph. Groups and shapes
 * store it in fields with different names and scales.
 */
export interface AnnotationStyle {
  fillColor: string;

  // Opacity of the fill color from 0 to 100
  fillOpacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: BorderStyle;
  cornerRadius: number;
  lineStartArrow: boolean;
  lineEndArrow: boolean;
}

// Stored as the color of a fill or border that isn't drawn
export const NO_COLOR = 'transparent';

// Used for the fields a group doesn't set, matching the accent color of the app
export const DEFAULT_GROUP_COLOR = '#3fcfad';

const DEFAULT_GROUP_STYLE: AnnotationStyle = {
  fillColor: DEFAULT_GROUP_COLOR,
  fillOpacity: 5,
  // The accent color at 40% opacity
  borderColor: `${DEFAULT_GROUP_COLOR}66`,
  borderWidth: 1,
  borderStyle: 'solid',
  cornerRadius: 12,
  lineStartArrow: false,
  lineEndArrow: false,
};

export const DEFAULT_TEXT_STYLE = {
  fontColor: '#ffffff',
  backgroundColor: NO_COLOR,
  fontSize: 14,
  textAlign: 'left' as const,
};

const DEFAULT_SHAPE_COLOR = '#5b8def';
const DEFAULT_LINE_COLOR = '#c7c8cc';

/**
 * The style of new shapes. It is written to the annotation, so the shapes look
 * the same in other editors.
 */
export function newShapeStyle(
  shapeType: FreeShapeAnnotation['shapeType'],
): Partial<FreeShapeAnnotation> {
  if (shapeType === 'line') {
    return {
      borderColor: DEFAULT_LINE_COLOR,
      borderWidth: 1.5,
      borderStyle: 'solid',
      lineStartArrow: false,
      lineEndArrow: true,
    };
  }

  return {
    fillColor: DEFAULT_SHAPE_COLOR,
    fillOpacity: 0.12,
    borderColor: DEFAULT_SHAPE_COLOR,
    borderWidth: 1.5,
    borderStyle: 'solid',
    ...(shapeType === 'rectangle' ? {cornerRadius: 8} : {}),
  };
}

export function groupStyle(
  annotation: GroupStyleAnnotation | null,
): AnnotationStyle {
  if (!annotation) return DEFAULT_GROUP_STYLE;

  return {
    ...DEFAULT_GROUP_STYLE,
    fillColor: annotation.backgroundColor ?? DEFAULT_GROUP_STYLE.fillColor,
    fillOpacity:
      annotation.backgroundOpacity ?? DEFAULT_GROUP_STYLE.fillOpacity,
    borderColor: annotation.borderColor ?? DEFAULT_GROUP_STYLE.borderColor,
    borderWidth: annotation.borderWidth ?? DEFAULT_GROUP_STYLE.borderWidth,
    borderStyle: annotation.borderStyle ?? DEFAULT_GROUP_STYLE.borderStyle,
    cornerRadius: annotation.borderRadius ?? DEFAULT_GROUP_STYLE.cornerRadius,
  };
}

export function shapeStyle(annotation: FreeShapeAnnotation): AnnotationStyle {
  return {
    fillColor: annotation.fillColor ?? NO_COLOR,
    fillOpacity: Math.round((annotation.fillOpacity ?? 1) * 100),
    borderColor: annotation.borderColor ?? DEFAULT_LINE_COLOR,
    borderWidth: annotation.borderWidth ?? 1,
    borderStyle: annotation.borderStyle ?? 'solid',
    cornerRadius: annotation.cornerRadius ?? 0,
    lineStartArrow: annotation.lineStartArrow ?? false,
    lineEndArrow: annotation.lineEndArrow ?? false,
  };
}

/**
 * Returns the style a group or shape has when none of its fields are set. Shapes
 * get the style they are drawn with.
 */
export function defaultStyle(
  shapeType?: FreeShapeAnnotation['shapeType'],
): AnnotationStyle {
  if (!shapeType) return DEFAULT_GROUP_STYLE;

  return shapeStyle({
    id: '',
    shapeType,
    position: {x: 0, y: 0},
    ...newShapeStyle(shapeType),
  });
}

// The fields of a group annotation that store the style
const GROUP_STYLE_FIELDS: Partial<
  Record<keyof AnnotationStyle, keyof GroupStyleAnnotation>
> = {
  fillColor: 'backgroundColor',
  fillOpacity: 'backgroundOpacity',
  borderColor: 'borderColor',
  borderWidth: 'borderWidth',
  borderStyle: 'borderStyle',
  cornerRadius: 'borderRadius',
};

export function groupStyleUpdate(
  style: Partial<AnnotationStyle>,
): Partial<GroupStyleAnnotation> {
  return Object.fromEntries(
    Object.entries(style)
      .filter(
        ([field, value]) =>
          value !== undefined &&
          GROUP_STYLE_FIELDS[field as keyof AnnotationStyle],
      )
      .map(([field, value]) => [
        GROUP_STYLE_FIELDS[field as keyof AnnotationStyle],
        value,
      ]),
  );
}

/**
 * Returns the update that removes the given style fields from a group, so the
 * group falls back to the default style.
 */
export function groupStyleReset(
  fields: (keyof AnnotationStyle)[],
): Partial<GroupStyleAnnotation> {
  return Object.fromEntries(
    fields
      .filter(field => GROUP_STYLE_FIELDS[field])
      .map(field => [GROUP_STYLE_FIELDS[field], undefined]),
  );
}

export function shapeStyleUpdate(
  style: Partial<AnnotationStyle>,
): Partial<FreeShapeAnnotation> {
  return withoutUndefined({
    fillColor: style.fillColor,
    fillOpacity:
      style.fillOpacity !== undefined ? style.fillOpacity / 100 : undefined,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderStyle: style.borderStyle === 'double' ? 'solid' : style.borderStyle,
    cornerRadius: style.cornerRadius,
    lineStartArrow: style.lineStartArrow,
    lineEndArrow: style.lineEndArrow,
  });
}

/**
 * Returns the CSS color of a fill with the given opacity.
 */
export function fillColor(color: string, opacity: number) {
  return `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
}

/**
 * The style of a text with defaults for the fields it doesn't set.
 */
export function textStyle(
  annotation: FreeTextAnnotation,
): Required<
  Pick<
    FreeTextAnnotation,
    'fontColor' | 'backgroundColor' | 'fontSize' | 'textAlign'
  >
> {
  return {
    fontColor: annotation.fontColor ?? DEFAULT_TEXT_STYLE.fontColor,
    backgroundColor:
      annotation.backgroundColor ?? DEFAULT_TEXT_STYLE.backgroundColor,
    fontSize: annotation.fontSize ?? DEFAULT_TEXT_STYLE.fontSize,
    textAlign: annotation.textAlign ?? DEFAULT_TEXT_STYLE.textAlign,
  };
}

// Undefined fields would remove the field from the annotation when merged
function withoutUndefined<T extends object>(update: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

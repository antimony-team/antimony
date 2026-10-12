import React, {CSSProperties, useId} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {
  Box,
  DrawnShape,
  GraphGroup,
  GraphShape,
  groupLabelInset,
  LayerItem,
  shapeBox,
  ShapeGeometry,
  shapeGeometry,
} from '@sb/lib/graph/annotation-geometry';
import {
  AnnotationStyle,
  DEFAULT_GROUP_COLOR,
  defaultStyle,
  fillColor,
  groupStyle,
  NO_COLOR,
  shapeStyle,
} from '@sb/lib/graph/annotation-style';
import {If} from '@sb/types/control';
import {BorderStyle} from '@sb/types/domain/topology';

import './annotation-layer.sass';

const DEFAULT_ARROW_SIZE = 10;

// Position of the label in the top left corner of a group, without rounded corners
const GROUP_LABEL_LEFT = 12;
const GROUP_LABEL_TOP = 6;

/**
 * The state of the groups and shapes in an editable graph. It is read in this
 * component, so a change of the selection only renders the annotations again.
 */
export interface AnnotationLayerState {
  groupIds: string[];
  shapeIds: string[];

  // This group or shape shows handles instead of the selection outline
  transformTargetId: string | null;

  dropTargetId: string | null;

  // The label of this group is hidden while it is renamed
  renamingGroupId: string | null;

  // Geometry and styles that replace the stored ones while they are changed
  groupPreviews: Map<string, Box>;
  shapePreviews: Map<string, ShapeGeometry>;
  stylePreviews: Map<string, Partial<AnnotationStyle>>;

  drawPreview: DrawnShape | null;
}

interface AnnotationLayerProps {
  items: LayerItem[];
  state?: AnnotationLayerState;
}

const AnnotationLayer = (props: AnnotationLayerProps) => {
  return (
    <>
      {props.items.map(item => (
        <LayerItemView key={item.id} item={item} state={props.state} />
      ))}
      <If condition={props.state}>
        <DrawPreview state={props.state!} />
      </If>
    </>
  );
};

interface LayerItemViewProps {
  item: LayerItem;
  state?: AnnotationLayerState;
}

const LayerItemView = ({item, state}: LayerItemViewProps) => {
  if (item.kind === 'group')
    return <GroupBox group={item.group} state={state} />;

  return <ShapeView shape={item.shape} state={state} />;
};

interface GroupBoxProps {
  group: GraphGroup;
  state?: AnnotationLayerState;
}

// Each annotation reads the state on its own, so only the ones that change render again
const GroupBox = observer(({group, state}: GroupBoxProps) => {
  const box = state?.groupPreviews.get(group.id) ?? group;
  const style = {
    ...groupStyle(group.annotation),
    ...state?.stylePreviews.get(group.id),
  };
  const labelInset = groupLabelInset(box, style.cornerRadius);

  return (
    <div
      data-layer-id={group.id}
      className={classNames('sb-graph-group', {
        selected:
          state?.groupIds.includes(group.id) &&
          state.transformTargetId !== group.id,
        'drop-target': state?.dropTargetId === group.id,
      })}
      style={{
        ...boxStyle(box, style),
        color:
          group.annotation?.labelColor ??
          (group.annotation?.color as string | undefined) ??
          DEFAULT_GROUP_COLOR,
      }}
    >
      <span
        className={classNames('sb-graph-group-label', {
          hidden: state?.renamingGroupId === group.id,
        })}
        style={{
          left: GROUP_LABEL_LEFT + labelInset,
          top: GROUP_LABEL_TOP + labelInset,
          maxWidth: `calc(100% - ${GROUP_LABEL_LEFT * 2 + labelInset * 2}px)`,
        }}
      >
        {group.name}
      </span>
    </div>
  );
});

interface ShapeViewProps {
  shape: GraphShape;
  state?: AnnotationLayerState;
}

const ShapeView = observer(({shape, state}: ShapeViewProps) => {
  const geometry =
    state?.shapePreviews.get(shape.id) ?? shapeGeometry(shape.annotation);
  const style = {
    ...shapeStyle(shape.annotation),
    ...state?.stylePreviews.get(shape.id),
  };
  const isSelected = !!state?.shapeIds.includes(shape.id);

  if (shape.annotation.shapeType === 'line') {
    return (
      <LineView
        id={shape.id}
        geometry={geometry}
        style={style}
        arrowSize={shape.annotation.lineArrowSize ?? DEFAULT_ARROW_SIZE}
        isSelected={isSelected}
      />
    );
  }

  return (
    <div
      data-layer-id={shape.id}
      className={classNames('sb-graph-shape', {
        selected: isSelected && state?.transformTargetId !== shape.id,
      })}
      style={{
        ...boxStyle(shapeBox(geometry), style),
        borderRadius:
          shape.annotation.shapeType === 'circle' ? '50%' : style.cornerRadius,
      }}
    />
  );
});

interface LineViewProps {
  id?: string;
  geometry: ShapeGeometry;
  style: AnnotationStyle;
  arrowSize: number;
  isSelected?: boolean;
}

/**
 * A line in an SVG of its own that is just large enough for the line and its
 * arrows, so it is drawn in order with the other annotations.
 */
const LineView = (props: LineViewProps) => {
  const markerId = useId();

  const start = props.geometry.position;
  const end = props.geometry.endPosition ?? start;
  const padding = props.arrowSize + props.style.borderWidth + 8;
  const box = shapeBox(props.geometry);
  const left = box.x - padding;
  const top = box.y - padding;
  const marker = `url(#${CSS.escape(markerId)})`;

  return (
    <svg
      data-layer-id={props.id}
      className="sb-graph-line"
      style={{
        left,
        top,
        width: box.width + padding * 2,
        height: box.height + padding * 2,
      }}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth={props.arrowSize}
          markerHeight={props.arrowSize}
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill={props.style.borderColor} />
        </marker>
      </defs>
      <If condition={props.isSelected}>
        <line
          className="sb-graph-line-selection"
          x1={start.x - left}
          y1={start.y - top}
          x2={end.x - left}
          y2={end.y - top}
          strokeWidth={props.style.borderWidth + 8}
        />
      </If>
      <line
        x1={start.x - left}
        y1={start.y - top}
        x2={end.x - left}
        y2={end.y - top}
        stroke={props.style.borderColor}
        strokeWidth={props.style.borderWidth}
        strokeDasharray={dashArray(
          props.style.borderStyle,
          props.style.borderWidth,
        )}
        strokeLinecap="round"
        markerStart={props.style.lineStartArrow ? marker : undefined}
        markerEnd={props.style.lineEndArrow ? marker : undefined}
      />
    </svg>
  );
};

// The shape that is drawn with a drawing tool, in the style it gets once it is drawn
const DrawPreview = observer(({state}: {state: AnnotationLayerState}) => {
  const preview = state.drawPreview;
  if (!preview) return null;

  // A text has no outline, so only the box it is drawn in is shown
  if (preview.kind === 'text') {
    const box = shapeBox(preview.geometry);
    return (
      <div
        className="sb-graph-draw-preview"
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
        }}
      />
    );
  }

  const style = defaultStyle(preview.kind);

  if (preview.kind === 'line') {
    return (
      <LineView
        geometry={preview.geometry}
        style={style}
        arrowSize={DEFAULT_ARROW_SIZE}
      />
    );
  }

  return (
    <div
      className="sb-graph-shape"
      style={{
        ...boxStyle(shapeBox(preview.geometry), style),
        borderRadius: preview.kind === 'circle' ? '50%' : style.cornerRadius,
      }}
    />
  );
});

function boxStyle(box: Box, style: AnnotationStyle): CSSProperties {
  return {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    backgroundColor:
      style.fillColor === NO_COLOR
        ? 'transparent'
        : fillColor(style.fillColor, style.fillOpacity),
    borderColor: style.borderColor,
    borderWidth: style.borderColor === NO_COLOR ? 0 : style.borderWidth,
    borderStyle: style.borderStyle,
    borderRadius: style.cornerRadius,
  };
}

function dashArray(borderStyle: BorderStyle, width: number) {
  switch (borderStyle) {
    case 'dashed':
      return `${width * 4} ${width * 3}`;
    case 'dotted':
      return `0 ${width * 2.5}`;
    default:
      return undefined;
  }
}

export default AnnotationLayer;

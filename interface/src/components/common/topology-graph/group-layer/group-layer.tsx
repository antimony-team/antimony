import React, {CSSProperties} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {Box, GraphGroup} from '@sb/lib/graph/annotation-geometry';

import './group-layer.sass';

// Used for the fields a group doesn't set, matching the accent color of the app
const DEFAULT_COLOR = '#3fcfad';
const DEFAULT_BACKGROUND_OPACITY = 5;
const DEFAULT_BORDER_WIDTH = 1;
const DEFAULT_BORDER_RADIUS = 12;

/**
 * The state of the groups in an editable graph. It is read in this component,
 * so a change of the selection only renders the groups again.
 */
export interface GroupLayerState {
  groupIds: string[];

  // This group shows resize handles instead of the selection outline
  resizableGroupId: string | null;

  dropTargetId: string | null;

  // The label of this group is hidden while it is renamed
  renamingGroupId: string | null;

  // Boxes that replace the stored box of a group while it is changed
  groupPreviews: Map<string, Box>;
}

interface GroupLayerProps {
  groups: GraphGroup[];
  state?: GroupLayerState;
}

const GroupLayer = (props: GroupLayerProps) => {
  return (
    <>
      {props.groups.map(group => (
        <GroupBox key={group.id} group={group} state={props.state} />
      ))}
    </>
  );
};

interface GroupBoxProps {
  group: GraphGroup;
  state?: GroupLayerState;
}

// Each group reads the state on its own, so only the groups that change render again
const GroupBox = observer(({group, state}: GroupBoxProps) => {
  return (
    <div
      data-group-id={group.id}
      className={classNames('sb-graph-group', {
        selected:
          state?.groupIds.includes(group.id) &&
          state.resizableGroupId !== group.id,
        'drop-target': state?.dropTargetId === group.id,
      })}
      style={groupStyle(group, state?.groupPreviews.get(group.id))}
    >
      <span
        className={classNames('sb-graph-group-label', {
          hidden: state?.renamingGroupId === group.id,
        })}
      >
        {group.name}
      </span>
    </div>
  );
});

function groupStyle(group: GraphGroup, preview?: Box): CSSProperties {
  const box = preview ?? group;
  const annotation = group.annotation;
  const background = annotation?.backgroundColor ?? DEFAULT_COLOR;
  const backgroundOpacity =
    annotation?.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY;
  const borderColor =
    annotation?.borderColor ??
    `color-mix(in srgb, ${DEFAULT_COLOR} 40%, transparent)`;

  return {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    backgroundColor: `color-mix(in srgb, ${background} ${backgroundOpacity}%, transparent)`,
    borderColor,
    borderWidth: annotation?.borderWidth ?? DEFAULT_BORDER_WIDTH,
    borderStyle: annotation?.borderStyle ?? 'solid',
    borderRadius: annotation?.borderRadius ?? DEFAULT_BORDER_RADIUS,
    color:
      annotation?.labelColor ??
      (annotation?.color as string | undefined) ??
      DEFAULT_COLOR,
  };
}

export default GroupLayer;

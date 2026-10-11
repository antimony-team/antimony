import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';

import cytoscape from 'cytoscape';
import {reaction} from 'mobx';
import {observer} from 'mobx-react-lite';
import Moveable from 'react-moveable';

import SelectionBar from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-bar';
import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {
  Box,
  GraphGroup,
  groupBoxAround,
  unionBox,
} from '@sb/lib/graph/annotation-geometry';
import {toRenderedBox} from '@sb/lib/graph/cytoscape-utils';
import {useStableCallbacks} from '@sb/lib/utils/hooks';
import {If} from '@sb/types/control';
import {BorderStyle} from '@sb/types/domain/topology';

import './selection-overlay.sass';

interface SelectionOverlayProps {
  getCy: () => cytoscape.Core | null;
  groups: GraphGroup[];

  onGroup: () => void;
  onBorderStyle: (groupId: string, borderStyle: BorderStyle) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  onResizeGroup: (groupId: string, box: Box) => void;
}

/**
 * The selection box, the bar below the selection and the handles of a selected
 * group. They follow the selection and the viewport, so they are a component of
 * their own that renders without the rest of the editor.
 */
const SelectionOverlay = observer((props: SelectionOverlayProps) => {
  const graphSelection = useGraphSelection();

  const [groupTarget, setGroupTarget] = useState<HTMLElement | null>(null);
  const moveableRef = useRef<Moveable>(null);
  const resizeStartBox = useRef<Box | null>(null);

  const cy = props.getCy();

  // Only followed while something is selected, so panning an empty selection renders nothing
  const viewportVersion =
    graphSelection.count > 0 ? graphSelection.viewportVersion : 0;
  const selectedGroups = props.groups.filter(group =>
    graphSelection.groupIds.includes(group.id),
  );
  const resizableGroup =
    props.groups.find(group => group.id === graphSelection.resizableGroupId) ??
    null;

  useLayoutEffect(() => {
    setGroupTarget(
      resizableGroup
        ? (cy
            ?.container()
            ?.parentElement?.querySelector<HTMLElement>(
              `[data-group-id="${CSS.escape(resizableGroup.id)}"]`,
            ) ?? null)
        : null,
    );
  }, [resizableGroup?.id, props.groups]);

  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [viewportVersion, props.groups]);

  // The handles follow a selected group while it moves or grows
  useEffect(
    () =>
      reaction(
        () => [...graphSelection.groupPreviews.values()],
        () => requestAnimationFrame(() => moveableRef.current?.updateRect()),
      ),
    [],
  );

  function boxOf(group: GraphGroup): Box {
    return graphSelection.groupPreviews.get(group.id) ?? group;
  }

  function barBox(): Box | null {
    if (!cy) return null;

    const boxes = selectedGroups.map(boxOf);
    const selected = cy.$(':selected');

    if (selected.nonempty()) {
      const bounds = selected.boundingBox({});
      boxes.push({
        x: bounds.x1,
        y: bounds.y1,
        width: bounds.w,
        height: bounds.h,
      });
    }

    const box = unionBox(boxes);
    return box ? toRenderedBox(cy, box) : null;
  }

  /**
   * The box around the members of the resized group in coordinates of the
   * container. The group can't be resized past it.
   */
  function innerBounds() {
    if (!cy || !resizableGroup) return null;

    const box = groupBoxAround(
      resizableGroup.memberIds.map(nodeId =>
        cy.getElementById(nodeId).position(),
      ),
    );
    if (!box) return null;

    const rendered = toRenderedBox(cy, box);
    return {
      left: rendered.x,
      top: rendered.y,
      width: rendered.width,
      height: rendered.height,
    };
  }

  const callbacks = useStableCallbacks({
    onBorderStyle: (borderStyle: BorderStyle) =>
      props.onBorderStyle(selectedGroups[0].id, borderStyle),
  });

  const isGroupAlone =
    graphSelection.count === 1 && selectedGroups.length === 1;
  const showBar =
    !graphSelection.isContextMenuOpen &&
    !graphSelection.isPointerDown &&
    !graphSelection.isInteracting &&
    !graphSelection.isHandActive &&
    !graphSelection.renamingGroupId &&
    (graphSelection.count > 1 || isGroupAlone);
  const box = showBar ? barBox() : null;

  const selectionBox = graphSelection.selectionBox;

  return (
    <>
      <If condition={selectionBox}>
        <div
          className="sb-selection-overlay-box"
          style={{
            left: selectionBox!.x,
            top: selectionBox!.y,
            width: selectionBox!.width,
            height: selectionBox!.height,
          }}
        />
      </If>
      <SelectionBar
        box={box}
        group={isGroupAlone ? selectedGroups[0] : null}
        canGroup={graphSelection.nodeIds.length > 0}
        canReorder={selectedGroups.length > 0}
        onGroup={props.onGroup}
        onBorderStyle={callbacks.onBorderStyle}
        onBringToFront={props.onBringToFront}
        onSendToBack={props.onSendToBack}
        onUngroup={props.onUngroup}
        onDelete={props.onDelete}
      />
      {/*
       * Mounted for as long as the editor is, without a target while no group can
       * be resized. Mounting adds the stylesheet of Moveable to the page and
       * unmounting removes it, which recalculates the styles of the whole page.
       */}
      <Moveable
        ref={moveableRef}
        className="sb-selection-overlay-moveable"
        target={groupTarget}
        resizable
        snappable
        innerBounds={innerBounds()}
        keepRatio={false}
        origin={false}
        renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
        onResizeStart={() => {
          resizeStartBox.current = resizableGroup
            ? boxOf(resizableGroup)
            : null;
          graphSelection.setInteracting(true);
        }}
        onResize={event => {
          event.target.style.width = `${event.width}px`;
          event.target.style.height = `${event.height}px`;
          event.target.style.transform = event.drag.transform;
        }}
        onResizeEnd={event => {
          graphSelection.setInteracting(false);
          event.target.style.transform = '';

          const start = resizeStartBox.current;
          const last = event.lastEvent;
          if (!start || !last || !resizableGroup) return;

          const [dx, dy] = last.drag.beforeTranslate;
          props.onResizeGroup(resizableGroup.id, {
            x: start.x + dx,
            y: start.y + dy,
            width: last.width,
            height: last.height,
          });
        }}
      />
    </>
  );
});

export default SelectionOverlay;

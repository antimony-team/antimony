import React from 'react';

import classNames from 'classnames';
import cytoscape from 'cytoscape';
import {observer} from 'mobx-react-lite';

import SelectionBar from '@sb/components/editor-page/topology-editor/node-editor/selection-bar/selection-bar';
import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {AnnotationItem, Box, unionBox} from '@sb/lib/graph/annotation-geometry';
import {AnnotationStyle} from '@sb/lib/graph/annotation-style';
import {FreeTextAnnotation} from '@sb/types/domain/topology';

import './selection-overlay.sass';

interface SelectionOverlayProps {
  getCy: () => cytoscape.Core | null;

  // The groups, shapes and texts of the graph
  items: AnnotationItem[];

  onGroup: () => void;
  onStyle: (style: Partial<AnnotationStyle>) => void;
  onStylePreview: (style: Partial<AnnotationStyle> | null) => void;
  onResetStyle: (fields: (keyof AnnotationStyle)[]) => void;
  onTextStyle: (update: Partial<FreeTextAnnotation>) => void;
  onTextStylePreview: (update: Partial<FreeTextAnnotation> | null) => void;
  onBringToFront: () => void;
  onBringForward: () => void;
  onBringBackward: () => void;
  onSendToBack: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}

/**
 * The bar below the selection. It is placed in the overlay of the graph in
 * graph coordinates, so it moves with the graph and doesn't render again when
 * it is panned or zoomed. It follows the selection, so it is a component of its
 * own that renders without the rest of the editor.
 */
const SelectionOverlay = observer((props: SelectionOverlayProps) => {
  const graphSelection = useGraphSelection();

  const cy = props.getCy();

  const selectedItems = props.items.filter(item =>
    graphSelection.annotationIds.includes(item.id),
  );

  function barBox(): Box | null {
    if (!cy) return null;

    const boxes = selectedItems
      .map(item => graphSelection.annotationBox(item))
      .filter(box => box !== null);
    const nodeIds = new Set(graphSelection.nodeIds);
    const selected = cy
      .nodes('.topology-node')
      .filter(node => nodeIds.has(node.id()));

    if (selected.nonempty()) {
      const bounds = selected.boundingBox({});
      boxes.push({
        x: bounds.x1,
        y: bounds.y1,
        width: bounds.w,
        height: bounds.h,
      });
    }

    return unionBox(boxes);
  }

  const itemAlone =
    graphSelection.count === 1 && selectedItems.length === 1
      ? selectedItems[0]
      : null;
  const hasBar = graphSelection.count > 1 || !!itemAlone;

  // Hidden on the wrapper while the graph is used, so the bar itself doesn't render again
  const isHidden =
    graphSelection.isContextMenuOpen ||
    graphSelection.isInteracting ||
    graphSelection.isHandActive ||
    !!graphSelection.renamingGroupId;
  const box = hasBar && !isHidden ? barBox() : null;

  return (
    <>
      {/* Placed at the bottom center of the selection, keeping its size on screen */}
      <div
        className={classNames('sb-selection-overlay-bar', {hidden: !box})}
        style={
          box
            ? {left: box.x + box.width / 2, top: box.y + box.height}
            : undefined
        }
      >
        <SelectionBar
          isVisible={hasBar}
          item={itemAlone?.kind !== 'text' ? itemAlone : null}
          text={itemAlone?.kind === 'text' ? itemAlone.text : null}
          isEditingText={!!graphSelection.editingTextId}
          canGroup={graphSelection.count > 0}
          canReorder={selectedItems.some(item => item.kind !== 'text')}
          onGroup={props.onGroup}
          onStyle={props.onStyle}
          onStylePreview={props.onStylePreview}
          onResetStyle={props.onResetStyle}
          onTextStyle={props.onTextStyle}
          onTextStylePreview={props.onTextStylePreview}
          onBringToFront={props.onBringToFront}
          onBringForward={props.onBringForward}
          onBringBackward={props.onBringBackward}
          onSendToBack={props.onSendToBack}
          onUngroup={props.onUngroup}
          onDelete={props.onDelete}
        />
      </div>
    </>
  );
});

export default SelectionOverlay;

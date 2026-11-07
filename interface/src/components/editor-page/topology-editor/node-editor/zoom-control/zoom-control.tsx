import React from 'react';

import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';

import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';

import './zoom-control.sass';

interface ZoomControlProps {
  onZoomIn: () => void;
  onZoomOut: () => void;

  // Called when the shown zoom level is clicked
  onReset: () => void;
}

const ZoomControl = observer((props: ZoomControlProps) => {
  const graphSelection = useGraphSelection();

  return (
    <div className="sb-zoom-control">
      <Button
        icon="pi pi-minus"
        text
        onClick={props.onZoomOut}
        tooltip="Zoom out"
        tooltipOptions={{position: 'top'}}
        aria-label="Zoom out"
      />
      <Button
        className="sb-zoom-control-level"
        label={`${Math.round(graphSelection.zoom * 100)}%`}
        text
        onClick={props.onReset}
        tooltip="Reset zoom"
        tooltipOptions={{position: 'top'}}
        aria-label={`Reset zoom (${Math.round(graphSelection.zoom * 100)}%)`}
      />
      <Button
        icon="pi pi-plus"
        text
        onClick={props.onZoomIn}
        tooltip="Zoom in"
        tooltipOptions={{position: 'top'}}
        aria-label="Zoom in"
      />
    </div>
  );
});

export default ZoomControl;

import React from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {Divider} from 'primereact/divider';

import {useTopologyStore} from '@sb/lib/stores/root-store';
import {useSimulationConfig} from '../state/simulation-config';

import './node-toolbar.sass';

interface NodeToolbarProps {
  onAddNode: () => void;
  onFitGraph: () => void;
  onDrawGroup: () => void;
  onToggleStabilization: () => void;
}

const NodeToolbar = observer((props: NodeToolbarProps) => {
  const topologyStore = useTopologyStore();
  const simulationConfig = useSimulationConfig();

  return (
    <div className="sb-node-editor-toolbar">
      <Button
        icon="pi pi-plus"
        text
        tooltip="Add node"
        onClick={props.onAddNode}
        aria-label="Add node"
      />
      <Button
        icon={<span className="material-symbols-outlined">select</span>}
        text
        onClick={props.onDrawGroup}
        tooltip="Create group"
        aria-label="Create group"
      />
      <Button
        icon={<span className="material-symbols-outlined">fit_screen</span>}
        text
        tooltip="Fit graph"
        onClick={props.onFitGraph}
        aria-label="Fit graph"
      />
      <Button
        icon="pi pi-trash"
        text
        onClick={topologyStore.manager.clear}
        tooltip="Clear graph"
        aria-label="Clear graph"
      />
      <Divider />
      <Button
        icon="pi pi-cog"
        text
        tooltip="Graph Stabilization"
        className={classNames({toggled: simulationConfig.panelOpen})}
        onClick={props.onToggleStabilization}
        aria-label="Graph Stabilization"
      />
    </div>
  );
});

export default NodeToolbar;

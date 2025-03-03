import React from 'react';

import classNames from 'classnames';
import {ExpandLines} from 'iconoir-react';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {Divider} from 'primereact/divider';

import {useTopologyStore} from '@sb/lib/stores/root-store';
import {useSimulationConfig} from '../state/simulation-config';

import './node-toolbar.sass';

interface NodeToolbarProps {
  onAddNode: () => void;
  onFitGraph: () => void;
  onSaveGraph: () => void;
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
        tooltip="Add Node"
        onClick={props.onAddNode}
        aria-label="Add Node"
      />
      <Button
        icon="pi pi-trash"
        text
        onClick={topologyStore.manager.clear}
        tooltip="Clear Network"
        aria-label="Clear Network"
      />
      <Button
        icon="pi pi-save"
        text
        tooltip="Save Layout"
        onClick={props.onSaveGraph}
        aria-label="Save Layout"
      />
      <Button
        className="sb-iconoir-button"
        icon={
          <ExpandLines
            style={{transform: 'rotate(90deg)'}}
            width={24}
            height={24}
          />
        }
        text
        tooltip="Fit Graph"
        onClick={props.onFitGraph}
        aria-label="Fit Graph"
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

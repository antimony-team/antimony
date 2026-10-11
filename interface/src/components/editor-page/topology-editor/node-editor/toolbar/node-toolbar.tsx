import React from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';
import {Divider} from 'primereact/divider';

import {
  GraphTool,
  useGraphSelection,
} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {useSimulationConfig} from '@sb/components/editor-page/topology-editor/node-editor/state/simulation-config';
import {GraphAction, keybindLabel} from '@sb/lib/graph/graph-keybinds';
import {useTopologyStore} from '@sb/lib/stores/root-store';

import './node-toolbar.sass';

interface NodeToolbarProps {
  onAddNode: () => void;
  onFitGraph: () => void;
  onGroupSelection: () => void;
  onToggleStabilization: () => void;
}

const NodeToolbar = observer((props: NodeToolbarProps) => {
  const topologyStore = useTopologyStore();
  const simulationConfig = useSimulationConfig();
  const graphSelection = useGraphSelection();

  return (
    <div className="sb-node-editor-toolbar">
      <Button
        icon={
          <span className="material-symbols-outlined">arrow_selector_tool</span>
        }
        text
        tooltip={`Select (${keybindLabel(GraphAction.SelectTool)})`}
        className={classNames({
          toggled: graphSelection.tool === GraphTool.Select,
        })}
        onClick={() => graphSelection.setTool(GraphTool.Select)}
        aria-label="Select"
      />
      <Button
        icon={<span className="material-symbols-outlined">pan_tool</span>}
        text
        tooltip={`Hand (${keybindLabel(GraphAction.HandTool)})`}
        className={classNames({
          toggled: graphSelection.tool === GraphTool.Hand,
        })}
        onClick={() => graphSelection.setTool(GraphTool.Hand)}
        aria-label="Hand"
      />
      <Divider />
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
        disabled={graphSelection.nodeIds.length === 0}
        onClick={props.onGroupSelection}
        tooltip={`Group selection (${keybindLabel(GraphAction.Group)})`}
        tooltipOptions={{showOnDisabled: true}}
        aria-label="Group selection"
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

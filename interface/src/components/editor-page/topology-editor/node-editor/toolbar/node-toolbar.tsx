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

interface ToolButton {
  tool: GraphTool;
  icon: string;
  label: string;
  action: GraphAction;
}

const POINTER_TOOLS: ToolButton[] = [
  {
    tool: GraphTool.Select,
    icon: 'arrow_selector_tool',
    label: 'Select',
    action: GraphAction.SelectTool,
  },
  {
    tool: GraphTool.Hand,
    icon: 'pan_tool',
    label: 'Hand',
    action: GraphAction.HandTool,
  },
];

const SHAPE_TOOLS: ToolButton[] = [
  {
    tool: GraphTool.Rectangle,
    icon: 'rectangle',
    label: 'Rectangle',
    action: GraphAction.RectangleTool,
  },
  {
    tool: GraphTool.Ellipse,
    icon: 'circle',
    label: 'Ellipse',
    action: GraphAction.EllipseTool,
  },
  {
    tool: GraphTool.Line,
    icon: 'north_east',
    label: 'Line',
    action: GraphAction.LineTool,
  },
  {
    tool: GraphTool.Text,
    icon: 'text_fields',
    label: 'Text',
    action: GraphAction.TextTool,
  },
  {
    tool: GraphTool.Group,
    icon: 'select',
    label: 'Group',
    action: GraphAction.GroupTool,
  },
];

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

  const toolButton = (tool: ToolButton) => (
    <Button
      key={tool.tool}
      icon={<span className="material-symbols-outlined">{tool.icon}</span>}
      text
      tooltip={`${tool.label} (${keybindLabel(tool.action)})`}
      className={classNames({toggled: graphSelection.tool === tool.tool})}
      onClick={() => graphSelection.setTool(tool.tool)}
      aria-label={tool.label}
    />
  );

  return (
    <div className="sb-node-editor-toolbar">
      {POINTER_TOOLS.map(toolButton)}
      <Divider />
      <Button
        icon="pi pi-plus"
        text
        tooltip="Add node"
        onClick={props.onAddNode}
        aria-label="Add node"
      />
      <Divider />
      {SHAPE_TOOLS.map(toolButton)}
      <Divider />
      <Button
        icon={<span className="material-symbols-outlined">select</span>}
        text
        disabled={graphSelection.count === 0}
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

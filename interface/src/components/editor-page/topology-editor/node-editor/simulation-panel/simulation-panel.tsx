import React from 'react';

import classNames from 'classnames';
import {Button} from 'primereact/button';
import {Slider} from 'primereact/slider';
import {observer} from 'mobx-react-lite';
import {Divider} from 'primereact/divider';

import {
  SimulationConfig,
  useSimulationConfig,
} from '../state/simulation-config';

import './simulation-panel.sass';

interface SimulationPanelProps {
  onStabilizeGraph: () => void;
}

const SimulationPanel = observer((props: SimulationPanelProps) => {
  const simulationConfig = useSimulationConfig();

  return (
    <div
      className={classNames(
        'sb-node-editor-simulation-panel sb-animated-overlay',
        {
          visible: simulationConfig.panelOpen,
        },
      )}
    >
      <span className="simulation-panel-title">Graph Stabilization</span>
      <ConfigSlider
        header="Edge Elasticity"
        minValue={0.01}
        maxValue={0.2}
        step={0.01}
        value={simulationConfig.edgeElasticity}
        onChange={simulationConfig.setSpringConstant}
        defaultValue={SimulationConfig.DefaultPhysics.edgeElasticity}
      />
      <ConfigSlider
        header="Edge Length"
        minValue={10}
        maxValue={300}
        value={simulationConfig.idealEdgeLength}
        onChange={simulationConfig.setSpringLength}
        defaultValue={SimulationConfig.DefaultPhysics.idealEdgeLength}
      />
      <ConfigSlider
        header="Node Repulsion"
        minValue={1}
        maxValue={100}
        multiplier={1000}
        value={simulationConfig.nodeRepulsion}
        onChange={simulationConfig.setNodeRepulsion}
        defaultValue={SimulationConfig.DefaultPhysics.nodeRepulsion}
      />
      <Divider />
      <Button
        className="simulation-panel-stabilize"
        outlined
        icon={
          simulationConfig.isStabilizing
            ? 'pi pi-spin pi-spinner'
            : 'pi pi-sparkles'
        }
        label="Stabilize Graph"
        disabled={
          simulationConfig.liveSimulation || simulationConfig.isStabilizing
        }
        onClick={props.onStabilizeGraph}
        aria-label="Stabilize Graph"
      />
    </div>
  );
});

interface ConfigSliderProps {
  header: string;

  minValue: number;
  maxValue: number;
  multiplier?: number;

  value: number;
  defaultValue: number;
  onChange: (value: number) => void;

  step?: number;
}

const ConfigSlider = (props: ConfigSliderProps) => (
  <>
    <span className="simulation-panel-heading">{props.header}</span>
    <div className="flex simulation-panel-group">
      <span className="simulation-panel-value">{props.minValue}</span>
      <Slider
        min={props.minValue}
        max={props.maxValue}
        value={props.value / (props.multiplier ?? 1)} // normalize for slider
        step={props.step}
        onChange={e => {
          const scaled = (e.value as number) * (props.multiplier ?? 1);
          props.onChange(scaled);
        }}
      />
      <span className="simulation-panel-value">{props.maxValue}</span>
      <Button
        className="simulation-panel-reset"
        icon="pi pi-undo"
        outlined
        text
        onClick={() => props.onChange(props.defaultValue)}
        aria-label="Reset"
      />
    </div>
  </>
);

export default SimulationPanel;

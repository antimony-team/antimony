import React from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';
import {Slider} from 'primereact/slider';

import {
  SimulationConfig,
  useSimulationConfig,
} from '@sb/components/editor-page/topology-editor/node-editor/state/simulation-config';
import {If} from '@sb/types/control';

import './simulation-panel.sass';

interface SimulationPanelProps {
  onStabilizeGraph: () => void;
}

const SimulationPanel = observer((props: SimulationPanelProps) => {
  const simulationConfig = useSimulationConfig();
  const defaults = SimulationConfig.DefaultPhysics;

  const isDefault =
    simulationConfig.edgeElasticity === defaults.edgeElasticity &&
    simulationConfig.idealEdgeLength === defaults.idealEdgeLength &&
    simulationConfig.nodeRepulsion === defaults.nodeRepulsion;

  function onResetAll() {
    simulationConfig.setSpringConstant(defaults.edgeElasticity);
    simulationConfig.setSpringLength(defaults.idealEdgeLength);
    simulationConfig.setNodeRepulsion(defaults.nodeRepulsion);
  }

  return (
    <div
      className={classNames(
        'sb-node-editor-simulation-panel sb-animated-overlay',
        {
          visible: simulationConfig.panelOpen,
        },
      )}
    >
      <div className="simulation-panel-header">
        <span className="simulation-panel-title">Graph stabilization</span>
        <Button
          text
          className="simulation-panel-reset-all"
          label="Reset"
          disabled={isDefault || simulationConfig.isStabilizing}
          onClick={onResetAll}
        />
      </div>
      <div className="simulation-panel-content">
        <ConfigSlider
          header="Edge elasticity"
          minValue={0.01}
          maxValue={0.2}
          step={0.01}
          value={simulationConfig.edgeElasticity}
          onChange={simulationConfig.setSpringConstant}
          defaultValue={defaults.edgeElasticity}
          disabled={simulationConfig.isStabilizing}
        />
        <ConfigSlider
          header="Edge length"
          minValue={10}
          maxValue={300}
          value={simulationConfig.idealEdgeLength}
          onChange={simulationConfig.setSpringLength}
          defaultValue={defaults.idealEdgeLength}
          disabled={simulationConfig.isStabilizing}
        />
        <ConfigSlider
          header="Node repulsion"
          minValue={1}
          maxValue={100}
          multiplier={1000}
          value={simulationConfig.nodeRepulsion}
          onChange={simulationConfig.setNodeRepulsion}
          defaultValue={defaults.nodeRepulsion}
          disabled={simulationConfig.isStabilizing}
        />
      </div>
      <div className="simulation-panel-footer">
        <Button
          className="simulation-panel-stabilize"
          outlined
          icon={
            simulationConfig.isStabilizing
              ? 'pi pi-spin pi-spinner'
              : 'pi pi-sparkles'
          }
          label={simulationConfig.isStabilizing ? 'Stabilizing…' : 'Stabilize'}
          disabled={
            simulationConfig.liveSimulation || simulationConfig.isStabilizing
          }
          onClick={props.onStabilizeGraph}
          aria-label="Stabilize graph"
        />
      </div>
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
  disabled?: boolean;
}

const ConfigSlider = (props: ConfigSliderProps) => {
  const normalized = props.value / (props.multiplier ?? 1); // normalize for slider
  const isModified = props.value !== props.defaultValue;

  return (
    <div className="simulation-panel-slider">
      <div className="simulation-panel-heading">
        <span className="simulation-panel-label">{props.header}</span>
        <If condition={isModified}>
          <Button
            className="simulation-panel-reset"
            icon="pi pi-undo"
            text
            disabled={props.disabled}
            onClick={() => props.onChange(props.defaultValue)}
            aria-label="Reset to default"
          />
        </If>
        <span
          className={classNames('simulation-panel-value', {
            modified: isModified,
          })}
        >
          {Number(normalized.toFixed(2))}
        </span>
      </div>
      <Slider
        min={props.minValue}
        max={props.maxValue}
        value={normalized}
        step={props.step}
        disabled={props.disabled}
        onChange={e => {
          const scaled = (e.value as number) * (props.multiplier ?? 1);
          props.onChange(scaled);
        }}
      />
      <div className="simulation-panel-range">
        <span>{props.minValue}</span>
        <span>{props.maxValue}</span>
      </div>
    </div>
  );
};

export default SimulationPanel;

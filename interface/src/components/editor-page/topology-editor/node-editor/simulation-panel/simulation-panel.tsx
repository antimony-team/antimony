import React from 'react';

import classNames from 'classnames';
import {Button} from 'primereact/button';
import {Slider} from 'primereact/slider';
import {observer} from 'mobx-react-lite';
import {Divider} from 'primereact/divider';
import {Checkbox} from 'primereact/checkbox';

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
        }
      )}
    >
      <span className="simulation-panel-title">Graph Stabilization</span>
      <ConfigSlider
        header="Link Stiffness"
        minValue={0}
        maxValue={1}
        multiplier={0.01}
        value={simulationConfig.springConstant}
        onChange={simulationConfig.setSpringConstant}
        defaultValue={SimulationConfig.DefaultSpringConstant}
      />
      <ConfigSlider
        header="Link Length"
        minValue={0}
        maxValue={200}
        value={simulationConfig.springLength}
        onChange={simulationConfig.setSpringLength}
        defaultValue={SimulationConfig.DefaultSpringLength}
      />
      <ConfigSlider
        header="Central Gravity"
        minValue={0}
        maxValue={0.05}
        multiplier={0.001}
        value={simulationConfig.centralGravity}
        onChange={simulationConfig.setCentralGravity}
        defaultValue={SimulationConfig.DefaultCentralGravity}
      />
      <Divider />
      <div className="flex align-items-center gap-2 mt-2 mb-2">
        <Checkbox
          inputId="simulation-panel-simulation"
          disabled={simulationConfig.isStabilizing}
          checked={simulationConfig.liveSimulation}
          onChange={e => simulationConfig.setLiveSimulation(e.checked ?? false)}
        />
        <label htmlFor="simulation-panel-simulation">Live Updates</label>
      </div>
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
        min={props.minValue / (props.multiplier ?? 1)}
        max={props.maxValue / (props.multiplier ?? 1)}
        value={props.value / (props.multiplier ?? 1)}
        step={props.step}
        onChange={e =>
          props.onChange((e.value as number) * (props.multiplier ?? 1))
        }
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

import './lab-details-overlay.sass';
import {If} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';

import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {TooltipOptions} from 'primereact/tooltip/tooltipoptions';
import React, {useMemo} from 'react';
import {Tooltip, TooltipRefProps} from 'react-tooltip';
import {Tooltip as PrimeTooltip} from 'primereact/tooltip';

interface LabDetailsOverlayProps {
  overlayRef: React.RefObject<TooltipRefProps>;

  lab: Lab | null;
  nodeId: string | null;

  onOpenTerminal: () => void;
  onOpenLogs: () => void;

  onNodeStart: () => void;
  onNodeStop: () => void;
  onNodeRestart: () => void;
}

const buttonTooltipOptions: TooltipOptions = {
  position: 'bottom',
  showDelay: 200,
  showOnDisabled: true,
};

const LabDetailsOverlay = observer((props: LabDetailsOverlayProps) => {
  const node = useMemo(() => {
    if (
      !props.nodeId ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.get(props.nodeId)
    ) {
      return null;
    }

    return props.lab.instance.nodeMap.get(props.nodeId)!;
  }, [props.nodeId, props.lab]);

  const isNodeRunning = node?.state === 'running';
  const nodeTitle = isNodeRunning ? `🟢 ${node?.name}` : `🔴 ${node?.name}`;

  const CopyableProperty = ({value}: {value: string}) => (
    <span
      className="property-value copyable"
      data-pr-tooltip="Copy to clipboard"
      data-pr-position="right"
      data-pr-my="left+10 center"
      onClick={() => {
        void navigator.clipboard.writeText(value);
      }}
    >
      {value}
    </span>
  );

  return (
    <Tooltip
      ref={props.overlayRef}
      className="lab-details"
      place="right"
      imperativeModeOnly={true}
      border="1px solid var(--primary-color-border)"
    >
      <If condition={node !== null}>
        <div className="flex flex-column gap-1">
          <div className="lab-details-title">{nodeTitle}</div>
          <div className="flex gap-1">
            <span className="property-title">Container ID:</span>
            <CopyableProperty value={node!.containerId} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">Container Name:</span>
            <CopyableProperty value={node!.containerName} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">IPv4:</span>
            <CopyableProperty value={node!.ipv4} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">IPv6:</span>
            <CopyableProperty value={node!.ipv6} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">State:</span>
            <span className="property-value node-dVetails-target">
              {node!.state}
            </span>
          </div>
        </div>
        <div className="button-container">
          <Button
            icon={
              <span className="material-symbols-outlined">
                quick_reference_all
              </span>
            }
            outlined
            onClick={props.onOpenLogs}
            tooltip="Show Logs"
            tooltipOptions={buttonTooltipOptions}
          />
          <Button
            icon={<span className="material-symbols-outlined">terminal</span>}
            outlined
            onClick={props.onOpenTerminal}
            disabled={!isNodeRunning}
            tooltip="Open Terminal"
            tooltipOptions={buttonTooltipOptions}
          />
          <div className="flex-grow-1"></div>
          <Button
            icon="pi pi-play"
            severity="success"
            outlined
            onClick={props.onNodeStart}
            disabled={isNodeRunning}
            tooltip="Start Node"
            tooltipOptions={buttonTooltipOptions}
          />
          <Button
            icon="pi pi-sync"
            severity="warning"
            outlined
            onClick={props.onNodeRestart}
            disabled={!isNodeRunning}
            tooltip="Restart Node"
            tooltipOptions={buttonTooltipOptions}
          />
          <Button
            icon="pi pi-power-off"
            severity="danger"
            outlined
            onClick={props.onNodeStop}
            disabled={!isNodeRunning}
            tooltip="Stop Node"
            tooltipOptions={buttonTooltipOptions}
          />
        </div>
      </If>
      <PrimeTooltip target=".property-value" />
    </Tooltip>
  );
});

export default LabDetailsOverlay;

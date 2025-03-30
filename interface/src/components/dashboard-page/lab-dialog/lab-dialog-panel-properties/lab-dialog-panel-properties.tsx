import {useCollectionStore, useTopologyStore} from '@sb/lib/stores/root-store';
import {If} from '@sb/types/control';
import dayjs from 'dayjs';
import React from 'react';

import {Button} from 'primereact/button';

import './lab-dialog-panel-properties.sass';
import {InstanceState, Lab} from '@sb/types/domain/lab';
import {useNavigate} from 'react-router';
import {Tooltip} from 'primereact/tooltip';

interface LabDialogPanelProps {
  lab: Lab;
}

const LabDialogPanelProperties = (props: LabDialogPanelProps) => {
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();

  const topology = topologyStore.lookup.get(props.lab.topologyId);
  const collection = collectionStore.lookup.get(props.lab.collectionId);

  const navigate = useNavigate();

  function onGotoTopology() {
    navigate(`/editor?t=${topology?.id}`);
  }

  return (
    <>
      <div className="sb-lab-dialog-panel sb-lab-dialog-panel-properties">
        <span className="sb-lab-dialog-panel-title">Properties</span>
        <div className="flex align-items-center gap-1">
          <span className="property-title">ID:</span>
          <span
            id="property-lab-id"
            className="property-value property-id"
            data-pr-tooltip="Copy to clipboard"
            data-pr-position="right"
            data-pr-my="left+10 center"
            onClick={() => {
              void navigator.clipboard.writeText(props.lab.id);
            }}
          >
            {props.lab.id}
          </span>
        </div>
        <div className="flex align-items-center gap-1">
          <span className="property-title">Collection:</span>
          <span className="property-value">{collection?.name}</span>
        </div>
        <div className="flex align-items-center gap-1">
          <span className="property-title">Deployer:</span>
          <span className="property-value">{props.lab.creator.name}</span>
        </div>
        <If condition={props.lab.instance}>
          <div className="flex align-items-center gap-1">
            <span className="property-title">Deployed:</span>
            <span className="property-value">
              {dayjs(props.lab.instance!.deployed).format('DD/MM/YYYY HH:mm')}
            </span>
          </div>
        </If>
        <div className="flex align-items-center gap-1">
          <span className="property-title">State:</span>
          <span className="property-value">
            {InstanceState[props.lab.instance?.state ?? -1]}
          </span>
        </div>
        <div className="flex align-items-center gap-1">
          <span className="property-title">Topology:</span>
          <span className="property-value">{topology?.name}</span>
          <Button
            className="topology-reference"
            icon="pi pi-external-link"
            tooltip="Go to topology"
            onClick={onGotoTopology}
          />
        </div>
      </div>
      <Tooltip target="#property-lab-id" />
    </>
  );
};

export default LabDialogPanelProperties;

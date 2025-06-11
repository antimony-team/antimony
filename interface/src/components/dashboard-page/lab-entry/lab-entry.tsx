import StateIndicator from '@sb/components/dashboard-page/state-indicator/state-indicator';
import {
  useCollectionStore,
  useLabStore,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {Choose, If, When} from '@sb/types/control';
import {InstanceState, Lab} from '@sb/types/domain/lab';
import {Button, ButtonProps} from 'primereact/button';
import React from 'react';

import './lab-entry.sass';

interface LabEntryProps {
  lab: Lab;

  onOpenLab: () => void;
  onRescheduleLab: () => void;

  onDestroyLabRequest: () => void;
}

const defaultLabButtonProps: ButtonProps = {
  rounded: true,
  text: true,
  size: 'large',
  tooltipOptions: {
    position: 'bottom',
    showDelay: 200,
  },
};

const LabEntry = (props: LabEntryProps) => {
  const labStore = useLabStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  function generateDisplayDate(lab: Lab): string {
    switch (lab.state) {
      case InstanceState.Scheduled:
        return lab.startTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      case InstanceState.Deploying:
      case InstanceState.Running:
        return lab.startTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      case InstanceState.Inactive:
      case InstanceState.Stopping:
      case InstanceState.Failed:
        return lab.startTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      default:
        return '';
    }
  }

  function onDeleteScheduledLab() {
    notificationStore.confirm({
      message: 'This action cannot be undone.',
      header: `Delete Lab '${props.lab.name}'?`,
      icon: 'pi pi-trash',
      severity: 'danger',
      onAccept: () => labStore.delete(props.lab.id),
    });
  }

  function onEditLab(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    props.onRescheduleLab();
  }

  const showButtons = props.lab.state !== InstanceState.Stopping;

  return (
    <div className="lab-item-card">
      <div className="lab-group sb-corner-tab" onClick={props.onOpenLab}>
        <span>
          {collectionStore.lookup.get(props.lab.collectionId)?.name ??
            'unknown'}
        </span>
      </div>
      <div className="lab-name" onClick={() => props.onOpenLab()}>
        <span>{props.lab.name}</span>
      </div>
      <div className="lab-state">
        <If condition={showButtons}>
          <div className="lab-state-buttons">
            <Choose>
              <When condition={props.lab.state === InstanceState.Scheduled}>
                <Button
                  severity="info"
                  icon="pi pi-pen-to-square"
                  tooltip="Edit"
                  aria-label="Edit Lab"
                  onClick={onEditLab}
                  {...defaultLabButtonProps}
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  tooltip="Delete"
                  aria-label="Delete Lab"
                  onClick={onDeleteScheduledLab}
                  {...defaultLabButtonProps}
                />
              </When>
              <When condition={props.lab.state === InstanceState.Inactive}>
                <Button
                  icon="pi pi-play"
                  severity="success"
                  tooltip="Deploy Now"
                  aria-label="Deploy Lab Now"
                  onClick={() => labStore.deployLab(props.lab)}
                  {...defaultLabButtonProps}
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  tooltip="Delete"
                  aria-label="Delete Lab"
                  onClick={() => labStore.delete(props.lab.id)}
                  {...defaultLabButtonProps}
                />
              </When>
              <When condition={props.lab.state === InstanceState.Deploying}>
                <Button
                  icon="pi pi-power-off"
                  severity="danger"
                  aria-label="Destroy Lab"
                  onClick={() => props.onDestroyLabRequest()}
                  {...defaultLabButtonProps}
                />
              </When>
              <When condition={props.lab.state === InstanceState.Failed}>
                <Button
                  icon="pi pi-sync"
                  severity="warning"
                  tooltip="Redeploy"
                  aria-label="Redeploy Lab"
                  onClick={() => labStore.deployLab(props.lab)}
                  {...defaultLabButtonProps}
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  tooltip="Delete"
                  aria-label="Delete Lab"
                  onClick={() => labStore.delete(props.lab.id)}
                  {...defaultLabButtonProps}
                />
              </When>
              <When condition={props.lab.state === InstanceState.Running}>
                <Button
                  icon="pi pi-sync"
                  severity="warning"
                  tooltip="Redeploy"
                  aria-label="Redeploy Lab"
                  onClick={() => labStore.deployLab(props.lab)}
                  {...defaultLabButtonProps}
                />
                <Button
                  icon="pi pi-power-off"
                  severity="danger"
                  tooltip="Destroy"
                  aria-label="Destroy Lab"
                  onClick={() => props.onDestroyLabRequest()}
                  {...defaultLabButtonProps}
                />
              </When>
            </Choose>
          </div>
        </If>
        <span className="lab-state-label">
          <StateIndicator lab={props.lab} showText={true} />
          <div className="lab-state-date">
            <i className="pi pi-clock"></i>
            <span>{generateDisplayDate(props.lab)}</span>
          </div>
        </span>
      </div>
    </div>
  );
};

export default LabEntry;

import {useLabStore} from '@sb/lib/stores/root-store';
import {Choose, Otherwise, When} from '@sb/types/control';
import {InstanceState, Lab} from '@sb/types/domain/lab';

import {Button} from 'primereact/button';

import './lab-dialog-panel-admin.sass';
import {Checkbox} from 'primereact/checkbox';
import {Divider} from 'primereact/divider';
import React from 'react';

interface LabDialogPanelProps {
  lab: Lab;

  hostsHidden: boolean;
  setHostsHidden: (visible: boolean) => void;

  onShowLogs: () => void;
  onDestroyLabRequest: () => void;
}

const LabDialogPanelAdmin = (props: LabDialogPanelProps) => {
  const labStore = useLabStore();

  return (
    <div className="sb-lab-dialog-panel sb-lab-dialog-panel-admin">
      <span className="sb-lab-dialog-panel-title">Control</span>
      <div className="flex align-items-center gap-2 mt-2 mb-2">
        <Checkbox
          inputId="hostsVisibleCheckbox"
          checked={props.hostsHidden}
          onChange={e => props.setHostsHidden(e.checked!)}
        />
        <label htmlFor="hostsVisibleCheckbox">Hide hosts</label>
      </div>
      <Button
        outlined
        icon={<span className="material-symbols-outlined">find_in_page</span>}
        label="Show Logs"
        aria-label="Show Logs"
        onClick={props.onShowLogs}
        disabled={!props.lab.instance}
      />
      {/*<If condition={props.lab.instance?.edgesharkLink}>*/}
      <Button
        outlined
        icon={<span className="material-symbols-outlined">sailing</span>}
        label="Open EdgeShark"
        onClick={() => window.open(props.lab.instance!.edgesharkLink, '_blank')}
        aria-label="Open EdgeShark"
      />
      {/*</If>*/}
      <Divider />
      <Choose>
        <When condition={!props.lab.instance}>
          <Button
            outlined
            icon="pi pi-play"
            label="Deploy Now"
            aria-label="Deploy Now"
            onClick={() => labStore.deployLab(props.lab)}
          />
        </When>
        <Otherwise>
          <Button
            outlined
            icon={
              props.lab.state === InstanceState.Deploying
                ? 'pi pi-sync pi-spin'
                : 'pi pi-sync'
            }
            label="Redeploy Lab"
            aria-label="Redeploy Lab"
            onClick={() => labStore.deployLab(props.lab)}
            disabled={props.lab.state === InstanceState.Deploying}
            tooltip={
              props.lab.state === InstanceState.Deploying
                ? 'Lab is already being deployed.'
                : ''
            }
            tooltipOptions={{
              showOnDisabled: true,
            }}
          />
        </Otherwise>
      </Choose>
      <Button
        outlined
        icon="pi pi-power-off"
        label={
          props.lab.state === InstanceState.Scheduled
            ? 'Delete Lab'
            : 'Destroy Lab'
        }
        aria-label={
          props.lab.state === InstanceState.Scheduled
            ? 'Delete Lab'
            : 'Destroy Lab'
        }
        severity="danger"
        onClick={props.onDestroyLabRequest}
        disabled={
          props.lab.state === InstanceState.Inactive ||
          props.lab.state === InstanceState.Deploying
        }
      />
    </div>
  );
};

export default LabDialogPanelAdmin;

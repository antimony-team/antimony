import {Choose, Otherwise, When} from '@sb/types/control';
import {Checkbox} from 'primereact/checkbox';
import {Divider} from 'primereact/divider';
import React from 'react';

import {Button} from 'primereact/button';

import './lab-dialog-panel-admin.sass';
import {Lab} from '@sb/types/domain/lab';

interface LabDialogPanelProps {
  lab: Lab;

  hostsHidden: boolean;
  setHostsHidden: (visible: boolean) => void;

  onShowLogs: () => void;
}

const LabDialogPanelAdmin = (props: LabDialogPanelProps) => {
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
          />
        </When>
        <Otherwise>
          <Button
            outlined
            icon="pi pi-sync"
            label="Redeploy Lab"
            aria-label="Redeploy Lab"
          />
        </Otherwise>
      </Choose>
      <Button
        outlined
        icon="pi pi-save"
        label="Save Lab"
        aria-label="Save Lab"
      />
      <Button
        outlined
        icon="pi pi-power-off"
        label="Destroy Lab"
        aria-label="Destroy Lab"
        severity="danger"
      />
    </div>
  );
};

export default LabDialogPanelAdmin;

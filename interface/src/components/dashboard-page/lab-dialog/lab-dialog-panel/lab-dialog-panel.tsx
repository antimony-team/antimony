import React from 'react';

import {Button} from 'primereact/button';
import {Checkbox} from 'primereact/checkbox';

import './lab-dialog-panel.sass';
import {Lab} from '@sb/types/domain/lab';

interface LabDialogPanelProps {
  lab: Lab;

  hostsHidden: boolean;
  setHostsHidden: (visible: boolean) => void;
}

const LabDialogPanel = (props: LabDialogPanelProps) => {
  return (
    <div className="sb-lab-dialog-panel">
      <span className="sb-lab-dialog-panel-title">Properties</span>
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
        icon={<span className="material-symbols-outlined">sailing</span>}
        label="Open EdgeShark"
        onClick={() => window.open(props.lab.edgesharkLink, '_blank')}
        aria-label="Open EdgeShark"
      />
    </div>
  );
};

export default LabDialogPanel;

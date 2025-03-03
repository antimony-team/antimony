import React, {useState} from 'react';

import {Calendar} from 'primereact/calendar';
import {InputText} from 'primereact/inputtext';
import {Nullable} from 'primereact/ts-helpers';

import {Lab} from '@sb/types/domain/lab';
import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {useLabStore, useStatusMessages} from '@sb/lib/stores/root-store';

import './reservation-dialog.sass';

interface ReservationDialogProps {
  lab: Lab;
  onClose: () => void;
}

const ReservationDialog: React.FC<ReservationDialogProps> = (
  props: ReservationDialogProps
) => {
  const labStore = useLabStore();
  const notificationStore = useStatusMessages();
  const initialStartDate = new Date(props.lab.startDate!);
  const initialEndDate = new Date(props.lab.endDate!);
  const [deployingLab] = useState<Lab>(props.lab);
  const [startDate, setStartDate] = useState<Nullable<Date>>(initialStartDate);
  const [endDate, setEndDate] = useState<Nullable<Date>>(initialEndDate);

  function onDeploy() {
    if (!deployingLab || !startDate || !endDate) return;

    const updatedLab = {
      ...deployingLab,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };

    labStore.update(updatedLab.id, updatedLab).then(result => {
      if (result.isErr()) {
        notificationStore.error(
          result.error.message,
          'Failed to deploy topology'
        );
      } else {
        notificationStore.success('Deployment has been scheduled.');
        props.onClose();
      }
    });
  }

  return (
    <SBDialog
      isOpen={props.lab !== null}
      onClose={props.onClose}
      headerTitle="Rescheduling Dialog"
      className="dialog-lab-reservation"
      onSubmit={() => {
        onDeploy();
      }}
      onCancel={() => props.onClose()}
    >
      <div className="update-reservation-container">
        <div className="form-field">
          <span>Lab Name:</span>
          <InputText className="input-field" value={props.lab.name} readOnly />
        </div>
        <div className="date-time-form">
          <span>Start Date</span>
          <Calendar
            id="deploy-date-start"
            className="w-full"
            value={startDate}
            onChange={e => setStartDate(e.value as Nullable<Date | null>)}
            selectionMode="single"
            placeholder="Start Time"
            showIcon
            showTime
            showButtonBar
          />
          <div className="flex-auto">
            <label htmlFor="deploy-date-end" className="font-bold block mb-2">
              End Time
            </label>
            <Calendar
              id="deploy-date-end"
              className="w-full"
              value={endDate}
              onChange={e => setEndDate(e.value as Nullable<Date | null>)}
              selectionMode="single"
              placeholder="End Time"
              showIcon
              showTime
              showButtonBar
            />
          </div>
        </div>
      </div>
    </SBDialog>
  );
};

export default ReservationDialog;

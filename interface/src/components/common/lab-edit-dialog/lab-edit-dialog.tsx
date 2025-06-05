import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';

import './lab-edit-dialog.sass';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';

import {
  useLabStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {Lab, LabIn} from '@sb/types/domain/lab';
import dayjs from 'dayjs';
import {isEqual} from 'lodash';
import {observer, useLocalObservable} from 'mobx-react-lite';

import {Calendar} from 'primereact/calendar';
import {SelectItem} from 'primereact/selectitem';
import {Nullable} from 'primereact/ts-helpers';
import React, {useEffect, useMemo, useRef, useState} from 'react';

export interface LabEditDialogState {
  // Set to null if the dialog is meant to add a new lab
  editingLab: Lab | null;

  topologyId: string;
  action: DialogAction;
}

interface LabEditDialogProps {
  dialogState: DialogState<LabEditDialogState>;
}

/**
 * Object that holds all editable properties of a lab (via dialog).
 */
interface LabEdit {
  name: string;
  topologyId: string;
  startTime: Date;
  endTime: Date;
}

const LabEditDialog = observer((props: LabEditDialogProps) => {
  const editingLab = useLocalObservable<LabEdit>(() => ({
    name: '',
    topologyId: '',
    startTime: new Date(),
    endTime: dayjs(new Date()).add(2, 'hour').toDate(),
  }));

  const [originalLab, setOriginalLab] = useState<LabEdit>({
    name: props.dialogState.state?.editingLab?.name ?? '',
    topologyId: props.dialogState.state?.topologyId ?? '',
    startTime: props.dialogState.state?.editingLab?.startTime ?? new Date(),
    endTime:
      props.dialogState.state?.editingLab?.endTime ??
      dayjs(new Date()).add(2, 'hour').toDate(),
  });

  function onNameChange(name: string, isImplicit: boolean) {
    editingLab.name = name;
    if (!isImplicit) void onSubmit();
  }

  async function onSubmit() {
    if (!props.dialogState.state) return;

    if (editingLab.name === '') {
      labNameRef.current?.setValidationError("Name can't be empty");
      return;
    }

    if (props.dialogState.state.action === DialogAction.Edit) {
      if (isEqual(originalLab, editingLab)) {
        props.dialogState.close();
        return;
      }

      const result = await labStore.update(
        props.dialogState.state.editingLab!.id,
        {
          name: editingLab.name,
          topologyId: editingLab.topologyId,
          startTime: editingLab.startTime.toISOString(),
          endTime: editingLab.endTime.toISOString(),
        }
      );
      if (result.isErr()) {
        notificationStore.error(
          result.error.message,
          'Failed to edit topology'
        );
      } else {
        notificationStore.success('Lab has been udpated successfully.');
        props.dialogState.close();
      }
    } else if (props.dialogState.state.action === DialogAction.Add) {
      const newLab: LabIn = {
        name: editingLab.name,
        topologyId: editingLab.topologyId,
        startTime: editingLab.startTime.toISOString(),
        endTime: editingLab.endTime.toISOString(),
      };
      labStore.add<string>(newLab).then(result => {
        if (result.isErr()) {
          notificationStore.error(result.error.message, 'Failed to update lab');
        } else {
          notificationStore.success('Lab has been created successfully.');
          props.dialogState.close();
        }
      });
    }
  }

  const labNameRef = useRef<SBInputRef>(null);

  const labStore = useLabStore();
  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  // Reset editing object when the dialog is opened
  useEffect(() => {
    if (props.dialogState.isOpen && props.dialogState.state) {
      const editLab = {
        name: props.dialogState.state.editingLab?.name ?? '',
        topologyId: props.dialogState.state.topologyId ?? '',
        startTime: props.dialogState.state.editingLab?.startTime ?? new Date(),
        endTime:
          props.dialogState.state.editingLab?.endTime ??
          dayjs(new Date()).add(2, 'hour').toDate(),
      };
      setOriginalLab(editLab);

      editingLab.name = editLab.name;
      editingLab.topologyId = editLab.topologyId;
      editingLab.startTime = editLab.startTime;
      editingLab.endTime = editLab.endTime;
    }
  }, [props.dialogState.isOpen]);

  const topologyOptions: SelectItem[] = useMemo(() => {
    return topologyStore.data.map(topology => ({
      label: topology.name as string,
      value: topology.id,
    }));
  }, [topologyStore.data]);

  function getDialogHeader(): string {
    if (!props.dialogState.state) return '';

    switch (props.dialogState.state.action) {
      case DialogAction.Add:
        return 'Deploy Topology';
      case DialogAction.Edit:
        return 'Edit Lab';
      case DialogAction.Duplicate:
        return 'Redeploy Lab';
    }
  }

  return (
    <SBDialog
      onClose={props.dialogState.close}
      isOpen={props.dialogState.isOpen}
      headerTitle={getDialogHeader()}
      className="sb-lab-edit-dialog"
      submitLabel="Deploy"
      onSubmit={onSubmit}
      onShow={() => labNameRef.current?.input.current?.focus()}
    >
      <div className="flex gap-2 flex-column">
        <div className="mb-3">
          <SBInput
            ref={labNameRef}
            onValueSubmit={onNameChange}
            defaultValue={editingLab.name}
            placeholder="e.g. OSPF Lab"
            id="lab-edit-name"
            label="Lab Name"
          />
        </div>
        <div className="mb-3">
          <SBDropdown
            id="edit-lab-topology"
            label="Topology"
            icon={<span className="material-symbols-outlined">lan</span>}
            hasFilter={true}
            useSelectTemplate={true}
            useItemTemplate={true}
            value={editingLab.topologyId}
            options={topologyOptions}
            emptyMessage="No topologies found"
            onValueSubmit={topologyId => (editingLab.topologyId = topologyId)}
          />
        </div>
        <div className="flex-auto">
          <label htmlFor="deploy-date-start" className="font-bold block mb-2">
            Start Time
          </label>
          <Calendar
            id="edit-lab-date-start"
            className="w-full"
            value={editingLab.startTime}
            onChange={e => {
              const date = e.value as Nullable<Date | null>;
              if (date) editingLab.startTime = date;
            }}
            selectionMode="single"
            placeholder="Start Time"
            formatDateTime={date => {
              return dayjs(date).format('YYYY-MM-DD hh:mm:ss');
            }}
            showIcon
            showTime
          />
        </div>
        <div className="flex-auto">
          <label htmlFor="deploy-date-end" className="font-bold block mb-2">
            End Time
          </label>
          <Calendar
            id="edit-lab-date-end"
            className="w-full"
            value={editingLab.endTime}
            onChange={e => {
              const date = e.value as Nullable<Date | null>;
              if (date) editingLab.endTime = date;
            }}
            selectionMode="single"
            placeholder="End Time"
            formatDateTime={date => {
              return dayjs(date).format('YYYY-MM-DD hh:mm:ss');
            }}
            showIcon
            showTime
          />
        </div>
      </div>
    </SBDialog>
  );
});

export default LabEditDialog;

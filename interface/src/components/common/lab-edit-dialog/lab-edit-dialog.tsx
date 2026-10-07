import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBDropdown, {
  SBDropdownRef,
} from '@sb/components/common/sb-dropdown/sb-dropdown';

import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';

import {
  useCollectionStore,
  useLabStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {Lab, LabIn} from '@sb/types/domain/lab';
import classNames from 'classnames';
import dayjs from 'dayjs';
import {isEqual} from 'lodash';
import {runInAction} from 'mobx';
import {observer, useLocalObservable} from 'mobx-react-lite';

import {Calendar} from 'primereact/calendar';
import {InputNumber} from 'primereact/inputnumber';
import {SelectButton} from 'primereact/selectbutton';
import {Nullable} from 'primereact/ts-helpers';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {If} from '@sb/types/control';
import {ErrorCodes} from '@sb/types/error-codes';

import './lab-edit-dialog.sass';

const MinInstances = 2;
const MaxInstances = 50;

const DeployModes = [
  {label: 'Single lab', value: 'single'},
  {label: 'Multiple labs', value: 'multiple'},
];

export interface LabEditDialogState {
  // Set to null if the dialog is meant to add a new lab
  editingLab: Lab | null;

  topologyId?: string;
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

  const [isMultiple, setIsMultiple] = useState(false);
  const [instanceCount, setInstanceCount] = useState(MinInstances);
  const [customNames, setCustomNames] = useState<string[]>([]);

  const labNameRef = useRef<SBInputRef>(null);
  const topologyDropdownRef = useRef<SBDropdownRef>(null);

  const labStore = useLabStore();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const [originalLab, setOriginalLab] = useState<LabEdit>({
    name: props.dialogState.state?.editingLab?.name ?? '',
    topologyId: props.dialogState.state?.topologyId ?? '',
    startTime: props.dialogState.state?.editingLab?.startTime ?? new Date(),
    endTime:
      props.dialogState.state?.editingLab?.endTime ??
      dayjs(new Date()).add(2, 'hour').toDate(),
  });

  const isAdd = props.dialogState.state?.action === DialogAction.Add;
  const isBatch = isAdd && isMultiple;

  const defaultName = (index: number) =>
    `${editingLab.name || 'Lab'} ${index + 1}`;
  const instanceNames = Array.from(
    {length: instanceCount},
    (_, i) => customNames[i]?.trim() || defaultName(i),
  );
  const renamedCount = customNames
    .slice(0, instanceCount)
    .filter(name => name?.trim()).length;

  function onNameChange(name: string, isImplicit: boolean) {
    runInAction(() => (editingLab.name = name));
    if (!isImplicit) void onSubmit();
  }

  function onCustomNameChange(index: number, name: string) {
    setCustomNames(names => {
      const updated = [...names];
      updated[index] = name;
      return updated;
    });
  }

  function onCustomNamePaste(
    index: number,
    event: React.ClipboardEvent<HTMLInputElement>,
  ) {
    const lines = event.clipboardData
      .getData('text')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return;

    event.preventDefault();
    setCustomNames(names => {
      const updated = [...names];
      lines.forEach((line, i) => (updated[index + i] = line));
      return updated;
    });
    setInstanceCount(count =>
      Math.min(MaxInstances, Math.max(count, index + lines.length)),
    );
  }

  async function onSubmit() {
    if (!props.dialogState.state) return;

    if (editingLab.name.includes('/')) {
      labNameRef.current?.setValidationError(
        "Lab names can't contain slashes. ",
      );
      return;
    }

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
          startTime: editingLab.startTime.toISOString(),
          endTime: editingLab.endTime.toISOString(),
        },
      );
      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorLabNameExists) {
          labNameRef.current?.setValidationError(
            'A lab with that name already exists.',
          );
        } else {
          notificationStore.error(result.error.message, 'Failed to edit lab');
        }
      } else {
        notificationStore.success('Lab has been updated successfully.');
        props.dialogState.close();
      }
    } else if (props.dialogState.state.action === DialogAction.Add) {
      if (editingLab.topologyId === '') {
        topologyDropdownRef.current?.setValidationError(
          "You didn't select a topology",
        );
        return;
      }

      const newLab: LabIn = {
        name: editingLab.name,
        topologyId: editingLab.topologyId,
        startTime: editingLab.startTime.toISOString(),
        endTime: editingLab.endTime.toISOString(),
      };

      if (isBatch) {
        void deployBatch(newLab);
        return;
      }

      void labStore.add<string>(newLab).then(result => {
        if (result.isErr()) {
          if (result.error.code === ErrorCodes.ErrorLabNameExists) {
            labNameRef.current?.setValidationError(
              'A lab with that name already exists',
            );
          } else {
            notificationStore.error(
              result.error.message,
              'Failed to update lab',
            );
          }
        } else {
          notificationStore.success('Lab has been created successfully.');
          props.dialogState.close();
        }
      });
    }
  }

  async function deployBatch(newLab: LabIn) {
    if (instanceNames.some(name => name.includes('/'))) {
      notificationStore.error(
        "Lab names can't contain slashes.",
        'Invalid lab name',
      );
      return;
    }

    if (new Set(instanceNames).size !== instanceNames.length) {
      notificationStore.error(
        'Every lab needs a different name.',
        'Duplicate lab names',
      );
      return;
    }

    const results = await Promise.all(
      instanceNames.map(name => labStore.add<string>({...newLab, name})),
    );
    const failed = instanceNames.filter((_, i) => results[i].isErr());

    if (failed.length === 0) {
      notificationStore.success(
        `${instanceNames.length} labs have been created successfully.`,
      );
      props.dialogState.close();
      return;
    }

    notificationStore.error(
      `Couldn't create ${failed.join(', ')}.`,
      `Failed to deploy ${failed.length} of ${instanceNames.length} labs`,
    );
    if (failed.length < instanceNames.length) props.dialogState.close();
  }

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

      runInAction(() => {
        editingLab.name = editLab.name;
        editingLab.topologyId = editLab.topologyId;
        editingLab.startTime = editLab.startTime;
        editingLab.endTime = editLab.endTime;
      });

      setIsMultiple(false);
      setInstanceCount(MinInstances);
      setCustomNames([]);
    }
  }, [props.dialogState.isOpen]);

  function getDialogHeader(): string {
    if (!props.dialogState.state) return '';

    switch (props.dialogState.state.action) {
      case DialogAction.Add:
        return 'Deploy topology';
      case DialogAction.Edit:
        return 'Edit lab';
      case DialogAction.Duplicate:
        return 'Redeploy lab';
    }
  }

  const submitButtonLabel = isAdd
    ? isBatch
      ? `Deploy ${instanceCount} labs`
      : 'Deploy'
    : 'Submit';

  const topologyGroups = useMemo(
    () =>
      collectionStore.data
        .map(collection => ({
          label: collection.name,
          items: topologyStore.data
            .filter(t => t.collectionId === collection.id)
            .map(topology => ({
              label: topology.name,
              value: topology.id,
              prefix: collection.name,
            })),
        }))
        .filter(group => group.items.length > 0),
    [collectionStore.data, topologyStore.data],
  );

  return (
    <SBDialog
      onClose={props.dialogState.close}
      isOpen={props.dialogState.isOpen}
      headerTitle={getDialogHeader()}
      className={classNames('sb-edit-dialog', {
        'sb-lab-edit-batch': isBatch,
      })}
      submitLabel={submitButtonLabel}
      onSubmit={onSubmit}
      onShow={() => labNameRef.current?.input.current?.focus()}
    >
      <div className="sb-lab-edit-body">
        <div className="sb-lab-edit-form flex gap-4 flex-column">
          <If condition={isAdd}>
            <SelectButton
              className="sb-lab-edit-mode"
              value={isMultiple ? 'multiple' : 'single'}
              options={DeployModes}
              onChange={e => setIsMultiple(e.value === 'multiple')}
              allowEmpty={false}
            />
          </If>
          <div className="flex gap-3">
            <div className="flex-grow-1">
              <SBInput
                ref={labNameRef}
                onValueSubmit={onNameChange}
                defaultValue={editingLab.name}
                placeholder="e.g. OSPF Lab"
                id="lab-edit-name"
                label={isBatch ? 'Base name' : 'Lab name'}
              />
            </div>
            <If condition={isBatch}>
              <div className="flex flex-column gap-2">
                <label htmlFor="lab-edit-instances" className="sb-input-label">
                  Instances
                </label>
                <InputNumber
                  inputId="lab-edit-instances"
                  className="sb-lab-edit-instances"
                  value={instanceCount}
                  onValueChange={e => setInstanceCount(e.value ?? MinInstances)}
                  min={MinInstances}
                  max={MaxInstances}
                  showButtons
                  buttonLayout="horizontal"
                  incrementButtonIcon="pi pi-plus"
                  decrementButtonIcon="pi pi-minus"
                />
              </div>
            </If>
          </div>
          <If condition={isAdd}>
            <SBDropdown
              ref={topologyDropdownRef}
              id="edit-lab-topology"
              label="Topology"
              icon={
                <span className="material-symbols-outlined">network_node</span>
              }
              options={topologyGroups}
              optionGroupLabel="label"
              optionGroupChildren="items"
              hasFilter={true}
              useSelectTemplate={true}
              useItemTemplate={true}
              value={editingLab.topologyId}
              emptyMessage="No topologies found"
              placeholder="Select a topology"
              onValueSubmit={topologyId => (editingLab.topologyId = topologyId)}
            />
          </If>
          <div className="flex gap-3">
            <div className="flex flex-column gap-2">
              <label htmlFor="deploy-date-start" className="sb-input-label">
                Start time
              </label>
              <Calendar
                id="edit-lab-date-start"
                inputId="deploy-date-start"
                className="w-full"
                value={editingLab.startTime}
                onChange={e => {
                  const date = e.value as Nullable<Date | null>;
                  if (date) runInAction(() => (editingLab.startTime = date));
                }}
                selectionMode="single"
                formatDateTime={date => {
                  return dayjs(date).format('YYYY-MM-DD hh:mm:ss');
                }}
                showIcon
                showTime
                showSeconds
              />
            </div>
            <div className="flex flex-column gap-2">
              <label htmlFor="deploy-date-end" className="sb-input-label">
                End time
              </label>
              <Calendar
                id="edit-lab-date-end"
                inputId="deploy-date-end"
                className="w-full"
                value={editingLab.endTime}
                onChange={e => {
                  const date = e.value as Nullable<Date | null>;
                  if (date) runInAction(() => (editingLab.endTime = date));
                }}
                selectionMode="single"
                formatDateTime={date => {
                  return dayjs(date).format('YYYY-MM-DD hh:mm:ss');
                }}
                showIcon
                showTime
                showSeconds
              />
            </div>
          </div>
        </div>
        <If condition={isAdd}>
          <div
            className={classNames('sb-lab-edit-names', {
              'sb-lab-edit-names-open': isBatch,
            })}
          >
            <div className="sb-lab-edit-names-label">
              <span className="sb-input-label">Names</span>
              <span>
                {renamedCount} of {instanceCount} changed
              </span>
            </div>
            <div className="sb-lab-edit-names-list">
              {instanceNames.map((_, index) => (
                <label key={index} className="sb-lab-edit-names-row">
                  <span>{index + 1}</span>
                  <input
                    value={customNames[index] ?? ''}
                    placeholder={defaultName(index)}
                    onChange={e => onCustomNameChange(index, e.target.value)}
                    onPaste={e => onCustomNamePaste(index, e)}
                  />
                </label>
              ))}
            </div>
          </div>
        </If>
      </div>
    </SBDialog>
  );
});

export default LabEditDialog;

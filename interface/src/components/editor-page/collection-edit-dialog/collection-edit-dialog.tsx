import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {useCollectionStore, useStatusMessages} from '@sb/lib/stores/root-store';

import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {Collection, CollectionIn} from '@sb/types/domain/collection';
import {ErrorCodes} from '@sb/types/error-codes';

import {isEqual} from 'lodash';
import {runInAction} from 'mobx';
import {observer, useLocalObservable} from 'mobx-react-lite';
import {InputSwitch} from 'primereact/inputswitch';
import React, {useEffect, useRef, useState} from 'react';

import './collection-edit-dialog.sass';

export interface CollectionEditDialogState {
  // Set to null if the dialog is meant to add a new collection
  editingCollection: Collection | null;
  action: DialogAction;
}

interface CollectionEditDialogProps {
  dialogState: DialogState<CollectionEditDialogState>;
}

interface PermissionRowProps {
  id: string;
  icon: string;
  title: string;
  text: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

// The whole row is a label, so clicking anywhere on it toggles the switch
const PermissionRow = (props: PermissionRowProps) => (
  <label className="sb-collection-permission" htmlFor={props.id}>
    <span className="sb-collection-permission-icon">
      <span className="material-symbols-outlined">{props.icon}</span>
    </span>
    <span className="sb-collection-permission-text">
      <span className="sb-collection-permission-title">{props.title}</span>
      <span>{props.text}</span>
    </span>
    <InputSwitch
      inputId={props.id}
      checked={props.checked}
      onChange={e => props.onChange(e.value)}
    />
  </label>
);

const CollectionEditDialog = observer((props: CollectionEditDialogProps) => {
  const collectionNameRef = useRef<SBInputRef>(null);

  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const editingCollection = useLocalObservable<CollectionIn>(() => ({
    name: props.dialogState.state?.editingCollection?.name ?? '',
    publicDeploy:
      props.dialogState.state?.editingCollection?.publicDeploy ?? false,
    publicWrite:
      props.dialogState.state?.editingCollection?.publicWrite ?? false,
  }));

  const [originalCollection, setOriginalCollection] = useState<CollectionIn>({
    name: props.dialogState.state?.editingCollection?.name ?? '',
    publicWrite:
      props.dialogState.state?.editingCollection?.publicWrite ?? false,
    publicDeploy:
      props.dialogState.state?.editingCollection?.publicDeploy ?? false,
  });

  // Reset editing object when the dialog is opened
  useEffect(() => {
    if (props.dialogState.isOpen && props.dialogState.state) {
      const editCollection = {
        name: props.dialogState.state.editingCollection?.name ?? '',
        publicWrite:
          props.dialogState.state.editingCollection?.publicWrite ?? false,
        publicDeploy:
          props.dialogState.state.editingCollection?.publicDeploy ?? false,
      };
      setOriginalCollection(editCollection);

      runInAction(() => {
        editingCollection.name = editCollection.name;
        editingCollection.publicWrite = editCollection.publicWrite;
        editingCollection.publicDeploy = editCollection.publicDeploy;
      });
    }
  }, [props.dialogState.isOpen]);

  async function onNameChange(name: string, isImplicit: boolean) {
    runInAction(() => (editingCollection.name = name));
    if (!isImplicit) void onSubmit();
  }

  async function onSubmit() {
    if (!props.dialogState.state) return;

    if (editingCollection.name === '') {
      collectionNameRef.current?.setValidationError("Name can't be empty");
      return;
    }

    if (props.dialogState.state.action === DialogAction.Edit) {
      if (isEqual(editingCollection, originalCollection)) {
        props.dialogState.close();
        return;
      }

      const result = await collectionStore.update(
        props.dialogState.state.editingCollection!.id,
        editingCollection,
      );
      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorCollectionExists) {
          collectionNameRef.current?.setValidationError(
            'A collection with that name already exists.',
          );
        } else {
          notificationStore.error(
            result.error.message,
            'Failed to update collection',
          );
        }
      } else {
        notificationStore.success('Collection has been updated successfully.');
        props.dialogState.close();
      }
    } else if (props.dialogState.state.action === DialogAction.Add) {
      const result = await collectionStore.add(editingCollection);
      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorCollectionExists) {
          collectionNameRef.current?.setValidationError(
            'A collection with that name already exists.',
          );
        } else {
          notificationStore.error(
            result.error.message,
            'Failed to create collection',
          );
        }
      } else {
        notificationStore.success('Collection has been created successfully.');
        props.dialogState.close();
      }
    }
  }

  function getDialogHeader(): string {
    if (!props.dialogState.state) return '';

    switch (props.dialogState.state.action) {
      case DialogAction.Add:
        return 'New collection';
      case DialogAction.Edit:
        return 'Edit collection';
      case DialogAction.Duplicate:
        return 'Duplicate collection';
    }
  }

  const submitLabel =
    props.dialogState.state?.action === DialogAction.Edit ? 'Save' : 'Create';

  return (
    <SBDialog
      onClose={props.dialogState.close}
      isOpen={props.dialogState.isOpen}
      headerTitle={getDialogHeader()}
      className="sb-edit-dialog"
      submitLabel={submitLabel}
      onSubmit={onSubmit}
      onShow={() => collectionNameRef.current?.input.current?.focus()}
    >
      <div className="sb-form">
        <SBInput
          ref={collectionNameRef}
          onValueSubmit={onNameChange}
          placeholder="e.g. CN2"
          id="collection-edit-name"
          defaultValue={editingCollection.name}
          label="Name"
        />
        <div className="sb-form-field">
          <span className="sb-input-label">Permissions</span>
          <div className="sb-collection-permissions">
            <PermissionRow
              id="collection-edit-publicdeploy"
              icon="play_arrow"
              title="Anyone can deploy"
              text="Everyone can start labs from this collection's topologies."
              checked={editingCollection.publicDeploy}
              onChange={checked =>
                runInAction(() => (editingCollection.publicDeploy = checked))
              }
            />
            <PermissionRow
              id="collection-edit-publicwrite"
              icon="edit"
              title="Anyone can edit"
              text="Everyone can add, change and delete topologies here."
              checked={editingCollection.publicWrite}
              onChange={checked =>
                runInAction(() => (editingCollection.publicWrite = checked))
              }
            />
          </div>
        </div>
      </div>
    </SBDialog>
  );
});

export default CollectionEditDialog;

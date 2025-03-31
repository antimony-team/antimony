import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {useCollectionStore, useStatusMessages} from '@sb/lib/stores/root-store';

import './collection-edit-dialog.sass';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {Collection, CollectionIn} from '@sb/types/domain/collection';
import {ErrorCodes} from '@sb/types/error-codes';

import {isEqual} from 'lodash';
import {observer, useLocalObservable} from 'mobx-react-lite';
import {Checkbox} from 'primereact/checkbox';
import React, {useEffect, useRef, useState} from 'react';

export interface CollectionEditDialogState {
  // Set to null if the dialog is meant to add a new collection
  editingCollection: Collection | null;
  action: DialogAction;
}

interface CollectionEditDialogProps {
  dialogState: DialogState<CollectionEditDialogState>;
}

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

  // Reset editing object when dialog is opened
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

      editingCollection.name = editCollection.name;
      editingCollection.publicWrite = editCollection.publicWrite;
      editingCollection.publicDeploy = editCollection.publicDeploy;
    }
  }, [props.dialogState.isOpen]);

  async function onNameChange(name: string, isImplicit: boolean) {
    editingCollection.name = name;
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
        editingCollection
      );
      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorCollectionExists) {
          collectionNameRef.current?.setValidationError(
            'A collection with that name already exists.'
          );
        } else {
          notificationStore.error(
            result.error.message,
            'Failed to update collection'
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
            'A collection with that name already exists.'
          );
        } else {
          notificationStore.error(
            result.error.message,
            'Failed to create collection'
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
        return 'Add Collection';
      case DialogAction.Edit:
        return 'Edit Collection';
      case DialogAction.Duplicate:
        return 'Duplicate Collection';
    }
  }

  return (
    <SBDialog
      onClose={props.dialogState.close}
      isOpen={props.dialogState.isOpen}
      headerTitle={getDialogHeader()}
      className="sb-collection-edit-dialog"
      submitLabel="Apply"
      onSubmit={onSubmit}
      onShow={() => collectionNameRef.current?.input?.focus()}
    >
      <div className="flex gap-4 flex-column">
        <SBInput
          ref={collectionNameRef}
          onValueSubmit={onNameChange}
          placeholder="e.g. CN2"
          id="collection-edit-name"
          defaultValue={editingCollection.name}
          label="Collection Name"
        />
        <div className="flex align-items-center">
          <Checkbox
            inputId="collection-edit-candeploy"
            onChange={e => (editingCollection.publicDeploy = e.checked!)}
            checked={editingCollection.publicDeploy}
          />
          <label htmlFor="collection-edit-candeploy" className="ml-2">
            Public Deploy
          </label>
        </div>
        <div className="flex align-items-center">
          <Checkbox
            inputId="collection-edit-publicwrite"
            onChange={e => (editingCollection.publicWrite = e.checked!)}
            checked={editingCollection.publicWrite}
          />
          <label htmlFor="collection-edit-publicwrite" className="ml-2">
            Public Write
          </label>
        </div>
      </div>
    </SBDialog>
  );
});

export default CollectionEditDialog;

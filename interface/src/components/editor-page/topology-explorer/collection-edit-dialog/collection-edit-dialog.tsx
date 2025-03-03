import React, {useEffect, useRef, useState} from 'react';

import {isEqual} from 'lodash-es';
import {Checkbox} from 'primereact/checkbox';

import SBInput from '@sb/components/common/sb-input/sb-input';
import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {useCollectionStore, useStatusMessages} from '@sb/lib/stores/root-store';

import './collection-edit-dialog.sass';
import {Collection, CollectionIn} from '@sb/types/domain/collection';

interface CollectionEditDialogProps {
  // Set to null if the dialog is meant to add a new collection
  editingCollection: Collection | null;

  isOpen: boolean;
  onClose: () => void;
}

const CollectionEditDialog = (props: CollectionEditDialogProps) => {
  const collectionNameRef = useRef<HTMLInputElement>(null);

  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const [updatedCollection, setUpdatedCollection] = useState<CollectionIn>({
    name: props.editingCollection?.name ?? '',
    publicDeploy: props.editingCollection?.publicDeploy ?? false,
    publicWrite: props.editingCollection?.publicWrite ?? false,
  });

  useEffect(() => {
    if (props.isOpen) {
      setUpdatedCollection({
        name: props.editingCollection?.name ?? '',
        publicDeploy: props.editingCollection?.publicDeploy ?? false,
        publicWrite: props.editingCollection?.publicWrite ?? false,
      });
    }
  }, [props.isOpen]);

  function onNameSubmit(name: string, isImplicit: boolean) {
    if (isImplicit) {
      setUpdatedCollection({
        ...updatedCollection,
        name,
      });
    } else {
      void onSubmit({
        ...updatedCollection,
        name,
      });
    }
  }

  async function onSubmit(collection?: CollectionIn) {
    collection ??= updatedCollection;

    if (!props.editingCollection) {
      collectionStore.add(collection).then(result => {
        if (result.isErr()) {
          notificationStore.error(
            result.error.message,
            'Failed to create collection'
          );
        } else {
          notificationStore.success(
            'Collection has been created successfully.'
          );
          props.onClose();
        }
      });
      return;
    }

    if (
      isEqual(collection, {
        name: props.editingCollection.name,
        publicDeploy: props.editingCollection.publicDeploy,
        publicWrite: props.editingCollection.publicWrite,
      })
    ) {
      props.onClose();
      return;
    }

    collectionStore
      .update(props.editingCollection.id, collection)
      .then(result => {
        if (result.isErr()) {
          notificationStore.error(
            result.error.message,
            'Failed to edit collection'
          );
        } else {
          notificationStore.success('Collection has been edited successfully.');
          props.onClose();
        }
      });
  }

  return (
    <SBDialog
      onClose={props.onClose}
      isOpen={props.isOpen}
      headerTitle={
        props.editingCollection ? 'Edit Collection' : 'Add Collection'
      }
      className="sb-collection-edit-dialog"
      submitLabel="Apply"
      onSubmit={onSubmit}
      onCancel={props.onClose}
      onShow={() => collectionNameRef.current?.focus()}
    >
      <div className="flex gap-4 flex-column">
        <SBInput
          ref={collectionNameRef}
          onValueSubmit={onNameSubmit}
          placeholder="e.g. CN2"
          id="collection-edit-name"
          defaultValue={updatedCollection.name}
          label="Collection Name"
        />
        <div className="flex align-items-center">
          <Checkbox
            inputId="collection-edit-candeploy"
            onChange={e =>
              setUpdatedCollection({
                ...updatedCollection,
                publicDeploy: e.checked!,
              })
            }
            checked={updatedCollection.publicDeploy}
          />
          <label htmlFor="collection-edit-candeploy" className="ml-2">
            Public Deploy
          </label>
        </div>
        <div className="flex align-items-center">
          <Checkbox
            inputId="collection-edit-publicwrite"
            onChange={e =>
              setUpdatedCollection({
                ...updatedCollection,
                publicWrite: e.checked!,
              })
            }
            checked={updatedCollection.publicWrite}
          />
          <label htmlFor="collection-edit-publicwrite" className="ml-2">
            Public Write
          </label>
        </div>
      </div>
    </SBDialog>
  );
};

export default CollectionEditDialog;

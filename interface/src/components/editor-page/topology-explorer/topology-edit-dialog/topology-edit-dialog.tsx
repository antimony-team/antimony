import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {
  useAuthUser,
  useCollectionStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {Topology, TopologyIn} from '@sb/types/domain/topology';
import {ErrorCodes} from '@sb/types/error-codes';
import {isEqual} from 'lodash';
import {runInAction} from 'mobx';
import {observer, useLocalObservable} from 'mobx-react-lite';
import {SelectItem} from 'primereact/selectitem';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import YAML from 'yaml';

export interface TopologyEditDialogState {
  // Set to null if the dialog is meant to add a new topology
  editingTopology: Topology | null;

  collectionId: string;
  action: DialogAction;
}

interface TopologyEditDialogProps {
  dialogState: DialogState<TopologyEditDialogState>;

  onCreated: (topologyId: string) => void;
}

/**
 * Object that holds all editable properties of a topology (via dialog).
 */
interface TopologyEdit {
  name: string;
  collectionId: string;
}

const TopologyEditDialog = observer((props: TopologyEditDialogProps) => {
  const editingTopology = useLocalObservable<TopologyEdit>(() => ({
    name: '',
    collectionId: '',
  }));

  const [originalTopology, setOriginalTopology] = useState<TopologyEdit>({
    name: props.dialogState.state?.editingTopology?.name ?? '',
    collectionId: props.dialogState.state?.collectionId ?? '',
  });

  const authUser = useAuthUser();

  const topologyNameRef = useRef<SBInputRef>(null);

  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  // Reset editing object when the dialog is opened
  useEffect(() => {
    if (props.dialogState.isOpen && props.dialogState.state) {
      const editTopology = {
        name: props.dialogState.state.editingTopology?.name ?? '',
        collectionId: props.dialogState.state.collectionId ?? '',
      };
      setOriginalTopology(editTopology);

      runInAction(() => {
        editingTopology.name = editTopology.name;
        editingTopology.collectionId = editTopology.collectionId;
      });
    }
  }, [props.dialogState.isOpen]);

  function onNameChange(name: string, isImplicit: boolean) {
    runInAction(() => (editingTopology.name = name));
    if (!isImplicit) void onSubmit();
  }

  async function onSubmit() {
    if (!props.dialogState.state) return;

    if (editingTopology.name === '') {
      topologyNameRef.current?.setValidationError("Name can't be empty");
      return;
    }

    if (props.dialogState.state.action === DialogAction.Edit) {
      if (isEqual(originalTopology, editingTopology)) {
        props.dialogState.close();
        return;
      }

      props.dialogState.state.editingTopology!.definition.set(
        'name',
        editingTopology.name
      );
      const result = await topologyStore.update(
        props.dialogState.state.editingTopology!.id,
        {
          definition: TopologyManager.serializeTopology(
            props.dialogState.state.editingTopology!.definition
          ),
          syncUrl: props.dialogState.state.editingTopology!.syncUrl,
          collectionId: editingTopology.collectionId,
        }
      );
      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorTopologyExists) {
          topologyNameRef.current?.setValidationError(
            'A topology with that name already exists.'
          );
        } else {
          notificationStore.error(
            result.error.message,
            'Failed to edit topology'
          );
        }
      } else {
        notificationStore.success('Topology has been updated successfully.');
        props.dialogState.close();
      }
    } else if (props.dialogState.state.action === DialogAction.Add) {
      const newTopology: TopologyIn = {
        collectionId: editingTopology.collectionId,
        definition: YAML.stringify({
          name: editingTopology.name,
          topology: {nodes: {}},
        }),
        syncUrl: '',
      };
      topologyStore.add<string>(newTopology).then(result => {
        if (result.isErr()) {
          if (result.error.code === ErrorCodes.ErrorTopologyExists) {
            topologyNameRef.current?.setValidationError(
              'A topology with that name already exists in this collection.'
            );
          } else {
            notificationStore.error(
              result.error.message,
              'Failed to update topology'
            );
          }
        } else {
          notificationStore.success('Topology has been created successfully.');
          props.onCreated(result.data.payload);
          props.dialogState.close();
        }
      });
    }
  }

  const collectionOptions: SelectItem[] = useMemo(() => {
    return collectionStore.data
      .filter(
        collection =>
          collection.publicWrite ||
          authUser.isAdmin ||
          collection.id === props.dialogState.state?.collectionId
      )
      .map(collection => ({
        label: collection.name,
        value: collection.id,
      }));
  }, [topologyStore.data, collectionStore.data]);

  function getDialogHeader(): string {
    if (!props.dialogState.state) return '';

    switch (props.dialogState.state.action) {
      case DialogAction.Add:
        return 'Add Topology';
      case DialogAction.Edit:
        return 'Edit Topology';
      case DialogAction.Duplicate:
        return 'Duplicate Topology';
    }
  }

  return (
    <SBDialog
      onClose={props.dialogState.close}
      isOpen={props.dialogState.isOpen}
      headerTitle={getDialogHeader()}
      className="sb-edit-dialog"
      submitLabel="Apply"
      onSubmit={onSubmit}
      onShow={() => topologyNameRef.current?.input.current?.focus()}
    >
      <div className="mb-3">
        <SBInput
          ref={topologyNameRef}
          onValueSubmit={onNameChange}
          defaultValue={
            (props.dialogState.state?.editingTopology?.definition.get(
              'name'
            ) as string) ?? ''
          }
          placeholder="e.g. OSPF Lab"
          id="topology-edit-name"
          label="Topology Name"
        />
      </div>
      <SBDropdown
        id="edit-topology-collection"
        label="Collection"
        icon={<span className="material-symbols-outlined">folder</span>}
        hasFilter={false}
        useSelectTemplate={true}
        useItemTemplate={true}
        value={editingTopology.collectionId}
        options={collectionOptions}
        emptyMessage="No collections found"
        onValueSubmit={collectionId =>
          (editingTopology.collectionId = collectionId)
        }
      />
    </SBDialog>
  );
});

export default TopologyEditDialog;

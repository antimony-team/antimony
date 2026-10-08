import React, {useMemo, useRef} from 'react';

import {runInAction} from 'mobx';
import {observer, useLocalObservable} from 'mobx-react-lite';
import YAML from 'yaml';

import {SelectItem} from 'primereact/selectitem';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBDropdown, {
  SBDropdownRef,
} from '@sb/components/common/sb-dropdown/sb-dropdown';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {
  useAuthUser,
  useCollectionStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {TopologyManager} from '@sb/lib/topology-manager';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {fetchSyncUrl} from '@sb/lib/utils/utils';
import {Topology, TopologyIn} from '@sb/types/domain/topology';
import {ErrorCodes} from '@sb/types/error-codes';

export interface TopologyEditDialogState {
  // Set to null if the dialog is meant to add a new topology
  editingTopology: Topology | null;

  collectionId: string | null;
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
  syncUrl: string;
  collectionId: string;
}

const TopologyEditDialog = observer((props: TopologyEditDialogProps) => {
  const editingTopology = useLocalObservable<TopologyEdit>(() => ({
    name: props.dialogState.state?.editingTopology?.name ?? '',
    syncUrl: props.dialogState.state?.editingTopology?.syncUrl ?? '',
    collectionId: props.dialogState.state?.collectionId ?? '',
  }));

  const authUser = useAuthUser();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const topologyNameRef = useRef<SBInputRef>(null);
  const topologySyncUrlRef = useRef<SBInputRef>(null);
  const collectionDropdownRef = useRef<SBDropdownRef>(null);

  function onShow() {
    runInAction(() => {
      editingTopology.name =
        props.dialogState.state?.editingTopology?.name ?? '';
      editingTopology.syncUrl =
        props.dialogState.state?.editingTopology?.syncUrl ?? '';
      editingTopology.collectionId =
        props.dialogState.state?.collectionId ?? '';
    });

    topologyNameRef.current?.input.current?.focus();
  }

  function onNameChange(_: string, isImplicit: boolean) {
    if (!isImplicit) void onSubmit();
  }

  function onSyncUrlChange(_: string, isImplicit: boolean) {
    if (!isImplicit) void onSubmit();
  }

  function hasChanges() {
    return (
      props.dialogState.state?.editingTopology?.name !== editingTopology.name ||
      props.dialogState.state?.editingTopology?.syncUrl !==
        editingTopology.syncUrl ||
      props.dialogState.state?.collectionId !== editingTopology.collectionId
    );
  }

  async function onSubmit() {
    if (!props.dialogState.state) return;

    runInAction(() => {
      editingTopology.name = topologyNameRef.current!.input.current!.value;
      editingTopology.syncUrl =
        topologySyncUrlRef.current!.input.current!.value;
    });

    if (editingTopology.name === '') {
      topologyNameRef.current?.setValidationError("Name can't be empty");
      return;
    }

    if (editingTopology.collectionId === '') {
      collectionDropdownRef.current?.setValidationError(
        "You didn't select a collection",
      );
      return;
    }

    if (props.dialogState.state.action === DialogAction.Edit) {
      if (!hasChanges()) {
        props.dialogState.close();
        return;
      }

      if (
        editingTopology.syncUrl &&
        editingTopology.syncUrl !==
          props.dialogState.state.editingTopology?.syncUrl
      ) {
        const [validationError] = await fetchSyncUrl(editingTopology.syncUrl);
        if (validationError !== null) {
          topologySyncUrlRef.current?.setValidationError(validationError);
          return;
        }
      }

      const newDefinition =
        props.dialogState.state.editingTopology!.definition.clone();
      newDefinition.set('name', editingTopology.name);

      const result = await topologyStore.update(
        props.dialogState.state.editingTopology!.id,
        {
          definition: TopologyManager.serializeTopology(newDefinition),
          syncUrl: editingTopology.syncUrl,
          collectionId: editingTopology.collectionId,
        },
      );
      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorTopologyExists) {
          topologyNameRef.current?.setValidationError(
            'A topology with that name already exists.',
          );
        } else {
          notificationStore.error(
            result.error.message,
            'Failed to edit topology',
          );
        }
      } else {
        if (
          topologyStore.manager.topology?.id ===
          props.dialogState.state.editingTopology!.id
        ) {
          topologyStore.manager.replaceTopology(
            topologyStore.lookup.get(
              props.dialogState.state.editingTopology!.id,
            )!,
          );
        }

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
      void topologyStore.add<string>(newTopology).then(result => {
        if (result.isErr()) {
          if (result.error.code === ErrorCodes.ErrorTopologyExists) {
            topologyNameRef.current?.setValidationError(
              'A topology with that name already exists in this collection.',
            );
          } else {
            notificationStore.error(
              result.error.message,
              'Failed to update topology',
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
          collection.id === props.dialogState.state?.collectionId,
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
        return 'Add topology';
      case DialogAction.Edit:
        return 'Edit topology';
      case DialogAction.Duplicate:
        return 'Duplicate topology';
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
      onShow={onShow}
    >
      <div className="flex flex-column gap-4">
        <SBInput
          ref={topologyNameRef}
          onValueSubmit={onNameChange}
          defaultValue={props.dialogState.state?.editingTopology?.name ?? ''}
          placeholder="e.g. OSPF Lab"
          id="topology-edit-name"
          label="Name"
        />
        <SBInput
          ref={topologySyncUrlRef}
          onValueSubmit={onSyncUrlChange}
          defaultValue={props.dialogState.state?.editingTopology?.syncUrl ?? ''}
          placeholder="e.g. https://example.com/topology.yaml"
          id="topology-edit-syncurl"
          label="Sync URL"
        />

        <SBDropdown
          ref={collectionDropdownRef}
          id="edit-topology-collection"
          label="Collection"
          placeholder="Select a collection"
          icon={<span className="material-symbols-outlined">inventory_2</span>}
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
      </div>
    </SBDialog>
  );
});

export default TopologyEditDialog;

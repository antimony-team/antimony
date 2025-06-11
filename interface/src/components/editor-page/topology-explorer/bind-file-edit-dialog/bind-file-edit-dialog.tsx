import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBDropdown from '@sb/components/common/sb-dropdown/sb-dropdown';

import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {
  useAuthUser,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {BindFile} from '@sb/types/domain/topology';
import {ErrorCodes} from '@sb/types/error-codes';

import {isEqual} from 'lodash-es';
import {runInAction} from 'mobx';
import {observer, useLocalObservable} from 'mobx-react-lite';
import {SelectItem} from 'primereact/selectitem';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import './bind-file-edit-dialog.sass';

export interface BindFileEditDialogState {
  // Set to null if the dialog is meant to add a new collection
  editingBindingFile: BindFile | null;

  owningTopologyId: string;
  action: DialogAction;
}

interface BindFileEditDialogProps {
  dialogState: DialogState<BindFileEditDialogState>;
}

/**
 * Object that holds all editable properties of a topology (via dialog).
 */
interface BindFileEdit {
  filePath: string;
  topologyId: string;
}

const BindFileEditDialog = observer((props: BindFileEditDialogProps) => {
  const editingBindFile = useLocalObservable<BindFileEdit>(() => ({
    filePath: '',
    topologyId: '',
  }));

  const [originalBindFile, setOriginalBindFile] = useState<BindFileEdit>({
    filePath: props.dialogState.state?.editingBindingFile?.filePath ?? '',
    topologyId: props.dialogState.state?.owningTopologyId ?? '',
  });

  const authUser = useAuthUser();

  const bindFileNameRef = useRef<SBInputRef>(null);

  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  useEffect(() => {
    if (props.dialogState.isOpen && props.dialogState.state) {
      const editBindFile = {
        filePath: props.dialogState.state.editingBindingFile?.filePath ?? '',
        topologyId: props.dialogState.state.owningTopologyId ?? '',
      };
      setOriginalBindFile(editBindFile);

      runInAction(() => {
        editingBindFile.filePath = editBindFile.filePath;
        editingBindFile.topologyId = editBindFile.topologyId;
      });
    }
  }, [props.dialogState.isOpen]);

  const topologyOptions: SelectItem[] = useMemo(() => {
    return topologyStore.data
      .filter(
        topology => authUser.isAdmin || topology.creator.id === authUser.id
      )
      .map(topology => ({
        label: (topology.definition.get('name') as string) ?? '',
        value: topology.id,
      }));
  }, [topologyStore.data]);

  async function onFilePathSubmit(filePath: string, isImplicit: boolean) {
    editingBindFile.filePath = filePath;
    if (!isImplicit) void onSubmit();
  }

  async function moveBindFile(
    originalBindFile: BindFile,
    editingBindFile: BindFileEdit
  ) {
    const deleteResult = await topologyStore.deleteBindFile(
      originalBindFile.topologyId,
      originalBindFile.id
    );

    if (deleteResult.isErr()) {
      notificationStore.error(
        deleteResult.error.message,
        'Failed to move bind file'
      );
      return;
    }

    const addResult = await topologyStore.addBindFile(
      editingBindFile.topologyId,
      {
        filePath: editingBindFile.filePath,
        content: '',
      }
    );

    if (addResult.isErr()) {
      if (addResult.error.code === ErrorCodes.ErrorBindFileExists) {
        bindFileNameRef.current?.setValidationError(
          'A file with that name already exists in that topology.'
        );
      } else {
        notificationStore.error(addResult.error.message, 'Failed to move file');
      }
    } else {
      notificationStore.success('File has been moved successfully.');
      props.dialogState.close();
    }
  }

  async function onSubmit() {
    if (!props.dialogState.state) return;

    if (editingBindFile.filePath === '') {
      bindFileNameRef.current?.setValidationError("Name can't be empty");
      return;
    }

    if (props.dialogState.state.action === DialogAction.Edit) {
      if (isEqual(originalBindFile, editingBindFile)) {
        props.dialogState.close();
        return;
      }

      // If topology ID has changed, delete old file and create new with same content
      if (originalBindFile.topologyId !== editingBindFile.topologyId) {
        void moveBindFile(
          props.dialogState.state.editingBindingFile!,
          editingBindFile
        );
        return;
      }

      const result = await topologyStore.updateBindFile(
        props.dialogState.state.owningTopologyId,
        props.dialogState.state.editingBindingFile!.id,
        {
          filePath: editingBindFile.filePath,
          content: props.dialogState.state.editingBindingFile!.content ?? '',
        }
      );
      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorBindFileExists) {
          bindFileNameRef.current?.setValidationError(
            'A file with that path already exists for the current topology.'
          );
        } else {
          notificationStore.error(result.error.message, 'Failed to edit file');
        }
      } else {
        notificationStore.success('File has been edited successfully.');
        props.dialogState.close();
      }
    } else if (props.dialogState.state.action === DialogAction.Add) {
      const result = await topologyStore.addBindFile(
        props.dialogState.state.owningTopologyId,
        {
          filePath: editingBindFile.filePath,
          content: '',
        }
      );

      if (result.isErr()) {
        if (result.error.code === ErrorCodes.ErrorBindFileExists) {
          bindFileNameRef.current?.setValidationError(
            'A file with that path already exists for the current topology.'
          );
        } else {
          notificationStore.error(
            result.error.message,
            'Failed to create file'
          );
        }
      } else {
        notificationStore.success('File has been created successfully.');
        props.dialogState.close();
      }
    }
  }

  function getDialogHeader(): string {
    if (!props.dialogState.state) return '';

    switch (props.dialogState.state.action) {
      case DialogAction.Add:
        return 'Add File';
      case DialogAction.Edit:
        return 'Edit File';
      case DialogAction.Duplicate:
        return 'Duplicate File';
    }
  }

  return (
    <SBDialog
      onClose={props.dialogState.close}
      isOpen={props.dialogState.isOpen}
      headerTitle={getDialogHeader()}
      className="sb-bind-file-edit-dialog"
      submitLabel="Apply"
      onSubmit={onSubmit}
      onShow={() => bindFileNameRef.current?.input.current?.focus()}
    >
      <div className="mb-3">
        <SBInput
          ref={bindFileNameRef}
          onValueSubmit={onFilePathSubmit}
          placeholder="e.g. node01/interfaces"
          id="bind-file-path"
          defaultValue={editingBindFile.filePath}
          label="File Path"
        />
      </div>
      <SBDropdown
        id="edit-topology-file"
        label="Topology"
        icon={<span className="material-symbols-outlined">lan</span>}
        hasFilter={false}
        useSelectTemplate={true}
        useItemTemplate={true}
        value={editingBindFile.topologyId}
        options={topologyOptions}
        emptyMessage="No topologies found"
        onValueSubmit={collectionId =>
          (editingBindFile.topologyId = collectionId)
        }
      />
    </SBDialog>
  );
});

export default BindFileEditDialog;

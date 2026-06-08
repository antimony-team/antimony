import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {useStatusMessages, useTopologyStore} from '@sb/lib/stores/root-store';
import {DialogState} from '@sb/lib/utils/hooks';

import {observer} from 'mobx-react-lite';
import React, {useEffect, useRef, useState} from 'react';

import {Topology} from '@sb/types/domain/topology';
import './bind-file-directory-edit-dialog.sass';

export interface BindFileDirectoryEditDialogState {
  topology: Topology;
  filePath: string;
}

interface BindFileDirectoryEditDialogProps {
  dialogState: DialogState<BindFileDirectoryEditDialogState>;
}

const BindFileDirectoryEditDialog = observer(
  (props: BindFileDirectoryEditDialogProps) => {
    const [editingFilePath, setEditingFilePath] = useState<string>('');

    const topologyStore = useTopologyStore();
    const notificationStore = useStatusMessages();

    const filePathInputRef = useRef<SBInputRef>(null);

    useEffect(() => {
      if (props.dialogState.isOpen && props.dialogState.state) {
        setEditingFilePath(props.dialogState.state.filePath);
      }
    }, [props.dialogState.isOpen]);

    function onFilePathSubmit(filePath: string, isImplicit: boolean) {
      setEditingFilePath(filePath);
      if (!isImplicit) void onSubmit(filePath);
    }

    async function onSubmit(filePath?: string) {
      if (!props.dialogState.state) return;

      console.log('Submitting file directory edit dialog');

      filePath = filePath ?? editingFilePath;

      const oldFilePath = props.dialogState.state.filePath;
      const topology = props.dialogState.state.topology;

      const filesToEdit = topology.bindFiles.filter(file =>
        file.filePath.startsWith(oldFilePath),
      );

      for (const bindFile of filesToEdit) {
        const result = await topologyStore.updateBindFile(
          topology.id,
          bindFile.id,
          {
            content: bindFile.content,
            filePath: bindFile.filePath.replace(oldFilePath, filePath),
          },
          true,
        );

        if (result.isErr()) {
          notificationStore.error(
            result.error.message,
            'Failed to rename directory',
          );
          return;
        }
      }

      await topologyStore.fetchSingle(topology.id);
      props.dialogState.close();
    }

    return (
      <SBDialog
        onClose={props.dialogState.close}
        isOpen={props.dialogState.isOpen}
        headerTitle="Rename Directory"
        className="sb-bind-file-directory-edit-dialog"
        submitLabel="Apply"
        onSubmit={onSubmit}
        onShow={() => filePathInputRef.current?.input.current?.focus()}
      >
        <div className="mb-3">
          <SBInput
            ref={filePathInputRef}
            onValueSubmit={onFilePathSubmit}
            placeholder="e.g. node01/interfaces"
            id="bind-file-path"
            defaultValue={editingFilePath}
            label="Directory Name"
          />
        </div>
      </SBDialog>
    );
  },
);

export default BindFileDirectoryEditDialog;

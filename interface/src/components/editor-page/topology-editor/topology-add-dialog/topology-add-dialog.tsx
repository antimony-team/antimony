import React, {useRef, useState} from 'react';

import YAML from 'yaml';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {useStatusMessages, useTopologyStore} from '@sb/lib/stores/root-store';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import './topology-add-dialog.sass';

interface TopologyAddDialogProps {
  collectionId: string | null;

  onClose: () => void;
  onCreated: (topologyId: string) => void;
}

const TopologyAddDialog = (props: TopologyAddDialogProps) => {
  const [topologyName, setTopologyName] = useState<string>('');

  const topologyNameRef = useRef<SBInputRef>(null);

  const topologyStore = useTopologyStore();
  const notificationStore = useStatusMessages();

  function onNameSubmit(name: string, isImplicit: boolean) {
    if (isImplicit) {
      setTopologyName(name);
    } else {
      void onSubmit(name);
    }
  }

  async function onSubmit(name?: string) {
    if (!props.collectionId) return;

    const newTopology = {
      collectionId: props.collectionId,
      definition: YAML.stringify({
        name: name ?? topologyName,
        topology: {nodes: {}},
      }),
      metadata: '',
      gitSourceUrl: '',
    };
    topologyStore.add<string>(newTopology).then(result => {
      if (result.isErr()) {
        notificationStore.error(
          result.error.message,
          'Failed to create topology'
        );
      } else {
        notificationStore.success('Topology has been created successfully.');
        props.onCreated(result.data.payload);
        props.onClose();
      }
    });
  }

  return (
    <SBDialog
      onClose={props.onClose}
      isOpen={props.collectionId !== null}
      headerTitle={'Create Topology'}
      className="sb-topology-add-dialog"
      submitLabel="Apply"
      onSubmit={onSubmit}
      onCancel={props.onClose}
      onShow={() => topologyNameRef.current?.input?.focus()}
    >
      <SBInput
        ref={topologyNameRef}
        onValueSubmit={onNameSubmit}
        placeholder="e.g. OSPF Lab"
        id="topology-add-name"
        label="Topology Name"
      />
    </SBDialog>
  );
};

export default TopologyAddDialog;

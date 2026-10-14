import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import objectPath from 'object-path';

import {Accordion, AccordionTab} from 'primereact/accordion';
import {Image} from 'primereact/image';
import {OverlayPanel} from 'primereact/overlaypanel';

import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import SBDropdown, {
  SBDropdownRef,
} from '@sb/components/common/sb-dropdown/sb-dropdown';
import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {updateNodeAnnotations} from '@sb/lib/graph/topology-annotations';
import {NodeEditor} from '@sb/lib/node-editor';
import {
  useDeviceStore,
  useSchemaStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {TopologyEditSource} from '@sb/lib/topology-manager';
import {If} from '@sb/types/control';
import {TopologyAnnotations} from '@sb/types/domain/topology';
import {TopologyDefinition} from '@sb/types/domain/topology-definition';
import {Position} from '@sb/types/types';

import NodeConnectionTable from './node-connection-table/node-connection-table';
import NodePropertyTable from './node-property-table/node-property-table';

import './node-edit-dialog.sass';

interface NodeEditDialogProps {
  editingTopology: TopologyDefinition | null;
  editingAnnotations: TopologyAnnotations | null;

  // Set to null if the dialog is creating a new node
  editingNode: string | null;

  // Position in the graph where a new node is placed
  newNodePosition: Position | null;
  isOpen: boolean;

  onClose: () => void;
}

const NodeEditDialog = (props: NodeEditDialogProps) => {
  const [nodeKind, setNodeKind] = useState<string | null>(null);
  const [inheritedKind, setInheritedKind] = useState<string | null>(null);
  const nameFieldRef = useRef<SBInputRef>(null);
  const kindDropdownRef = useRef<SBDropdownRef>(null);
  const iconSelectorOverlay = useRef<OverlayPanel>(null);
  const iconSelectorAnchor = useRef<HTMLDivElement>(null);

  const [nodeIcon, setNodeIcon] = useState<string>('');

  const topologyStore = useTopologyStore();
  const schemaStore = useSchemaStore();
  const deviceStore = useDeviceStore();
  const notificationStore = useStatusMessages();

  const kindList = useMemo(() => {
    if (!schemaStore.clabSchema) return [];

    const possibleKinds = objectPath.get(schemaStore.clabSchema, [
      'definitions',
      'node-config',
      'properties',
      'kind',
      'enum',
    ]) as string[];

    return !possibleKinds ? [] : possibleKinds.map(kind => ({value: kind}));
  }, [schemaStore.clabSchema]);

  const nodeEditor = useMemo(() => {
    if (
      !props.editingTopology ||
      !props.editingAnnotations ||
      !schemaStore.clabSchema ||
      !schemaStore.clabValidator
    ) {
      return null;
    }

    return new NodeEditor(
      schemaStore.clabSchema,
      topologyStore.format,
      props.editingNode ?? '',
      props.editingTopology,
      props.editingAnnotations,
      notificationStore,
    );
  }, [
    schemaStore.clabSchema,
    topologyStore.format,
    props.editingNode,
    props.editingTopology,
    props.editingAnnotations,
    notificationStore,
    props.isOpen,
  ]);

  const onTopologyUpdate = useCallback(() => {
    if (!nodeEditor || !nodeEditor.getNode()) return;

    // The kind the node sets itself, an inherited kind is shown as the placeholder
    const node = nodeEditor.getNode();
    setNodeKind((node?.own(['kind']) as string | undefined) ?? null);
    setInheritedKind((node?.inherited(['kind']) as string | undefined) ?? null);
  }, [nodeEditor]);

  useEffect(() => {
    if (!nodeEditor) return;

    nodeEditor.onEdit.register(onTopologyUpdate);
    onTopologyUpdate();

    setNodeIcon(deviceStore.getNodeIcon(nodeEditor.getNodeIcon()));

    return () => nodeEditor.onEdit.unregister(onTopologyUpdate);
  }, [nodeEditor, onTopologyUpdate]);

  function onCloseRequest() {
    if (!nodeEditor) return;

    if (nodeEditor.hasEdits()) {
      notificationStore.confirm({
        message: 'Discard unsaved changes?',
        header: 'Unsaved Changes',
        icon: 'pi pi-info-circle',
        severity: 'warning',
        onAccept: onClose,
      });
    } else {
      onClose();
    }
  }

  function onClose() {
    setNodeKind(null);
    setInheritedKind(null);
    props.onClose();
  }

  function onSave() {
    if (!nodeEditor?.getNodeName()) {
      nameFieldRef.current?.setValidationError("Name can't be empty");
      return;
    }

    // We want every node to require a kind. Even though the topolody schema allows
    // empty nodes, it doesn't make a lot of sense to have them.
    if (!nodeEditor!.getNode()?.device) {
      kindDropdownRef.current?.setValidationError('The node needs a kind');
      return;
    }

    if (nodeEditor) {
      let annotations = nodeEditor.getAnnotations();

      // If the dialog is adding a new node and a position has been supplied,
      // set that position in the annotations.
      if (!props.editingNode && props.newNodePosition) {
        annotations = updateNodeAnnotations(
          annotations,
          new Map([
            [nodeEditor.getNodeName(), {position: props.newNodePosition}],
          ]),
        );
      }

      topologyStore.manager.editTopology(
        nodeEditor.getTopology(),
        TopologyEditSource.NodeEditor,
        annotations,
      );
    }

    onClose();
  }

  function onShow() {
    // Don't focus input field if the dialog was open to edit
    if (props.editingNode) return;

    nameFieldRef.current?.input.current?.focus();
  }

  function onOpenIconSelector(event: React.MouseEvent<HTMLDivElement>) {
    iconSelectorOverlay.current?.toggle(event, iconSelectorAnchor.current!);
  }

  function onSelectIcon(icon: string) {
    if (!nodeEditor) return;

    nodeEditor.onUpdateIcon(icon);
    setNodeIcon(deviceStore.getNodeIcon(nodeEditor.getNodeIcon()));
    iconSelectorOverlay.current?.hide();
  }

  return (
    <SBDialog
      isOpen={props.isOpen}
      headerTitle={!props.editingNode ? 'Add Node' : 'Edit Node'}
      className="sb-node-edit-dialog"
      submitLabel="Save"
      onSubmit={onSave}
      onClose={onCloseRequest}
      onCancel={onCloseRequest}
      onShow={onShow}
    >
      <If condition={nodeEditor !== null}>
        <div className="flex flex-row gap-3">
          <div
            className="sb-node-edit-dialog-icon-container"
            ref={iconSelectorAnchor}
            onClick={onOpenIconSelector}
          >
            <Image src={nodeIcon} />
          </div>

          <div className="flex flex-column gap-2 flex-grow-1">
            <SBInput
              id="sb-node-name"
              ref={nameFieldRef}
              label="Name"
              defaultValue={props.editingNode}
              placeholder="e.g. Arista cEOS"
              onValueSubmit={nodeEditor!.onUpdateName}
            />
            <SBDropdown
              id="node-editor-kind"
              ref={kindDropdownRef}
              label="Kind"
              hasFilter={true}
              value={nodeKind}
              options={kindList}
              icon="pi-cog"
              useItemTemplate={true}
              useSelectTemplate={true}
              optionLabel="value"
              placeholder={
                inheritedKind ? `${inheritedKind} (inherited)` : 'Select a Kind'
              }
              onValueSubmit={value =>
                nodeEditor!.updatePropertyValue('kind', '', value)
              }
            />
          </div>
        </div>
        <div className="sb-node-edit-dialog-header">Node Properties</div>
        <NodePropertyTable
          nodeEditor={nodeEditor!}
          objectKey=""
          schemaKey="node-config"
        />
        <div className="sb-node-edit-dialog-header">Connections</div>
        <NodeConnectionTable nodeEditor={nodeEditor!} />
        <Accordion multiple>
          <AccordionTab header="Environment Variables">
            <NodePropertyTable
              keyHeader="Key"
              hideType={true}
              isKeyEditable={true}
              addText="Add Variable"
              nodeEditor={nodeEditor!}
              objectKey="env"
              schemaKey="node-config.env"
            />
          </AccordionTab>
          <AccordionTab header="Certificates">
            <NodePropertyTable
              isKeyEditable={true}
              nodeEditor={nodeEditor!}
              objectKey="certificate"
              schemaKey="certificate-config"
            />
          </AccordionTab>
          <AccordionTab header="Healthcheck">
            <NodePropertyTable
              isKeyEditable={true}
              nodeEditor={nodeEditor!}
              objectKey="healthcheck"
              schemaKey="healthcheck-config"
            />
          </AccordionTab>
          <AccordionTab header="DNS Configuration">
            <NodePropertyTable
              isKeyEditable={true}
              nodeEditor={nodeEditor!}
              objectKey="dns"
              schemaKey="dns-config"
            />
          </AccordionTab>
          <AccordionTab header="Labels">
            <NodePropertyTable
              keyHeader="Label"
              valueHeader="Value"
              addText="Add Label"
              hideType={true}
              isKeyEditable={true}
              nodeEditor={nodeEditor!}
              objectKey="labels"
              schemaKey="node-config.labels"
            />
          </AccordionTab>
        </Accordion>
      </If>
      <OverlayPanel
        ref={iconSelectorOverlay}
        className="sb-icon-selector-panel"
      >
        <div className="sb-icon-selector-container">
          {deviceStore.getAllIcons().map(([icon, path], index) => (
            <div key={index} className="sb-icon-selector-entry">
              <Image src={path} onClick={() => onSelectIcon(icon)} />
              <span>{icon}</span>
            </div>
          ))}
        </div>
      </OverlayPanel>
    </SBDialog>
  );
};

export default NodeEditDialog;

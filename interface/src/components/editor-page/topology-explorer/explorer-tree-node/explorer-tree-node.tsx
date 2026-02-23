import {
  useAuthUser,
  useCollectionStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {SBTooltipOptions} from '@sb/lib/utils/utils';
import {Choose, If, When} from '@sb/types/control';

import {uuid4} from '@sb/types/types';

import {Button} from 'primereact/button';
import {Tooltip} from 'primereact/tooltip';
import {TreeNode} from 'primereact/treenode';
import React, {MouseEvent, useMemo} from 'react';

import './explorer-tree-node.sass';

interface ExplorerTreeNodeProps {
  node: ExplorerTreeNodeData;

  // Collection functions
  onEditCollection: (id: uuid4) => void;
  onDeleteCollection: (id: uuid4) => void;
  onAddTopology: (collectionId: uuid4) => void;

  // Topology functions
  onEditTopology: (id: uuid4) => void;
  onDuplicateTopology: (id: uuid4) => void;
  onDeployTopology: (id: uuid4) => void;
  onDeleteTopology: (id: uuid4) => void;
  onAddBindFile: (topologyId: uuid4) => void;

  // Bind file functions
  onEditBindFile: (bindFileId: uuid4) => void;
  onDeleteBindFile: (bindFileId: uuid4) => void;
}

export interface ExplorerTreeNodeData extends TreeNode {
  type: ExplorerTreeNodeType;
}

export enum ExplorerTreeNodeType {
  Collection,
  Topology,
  BindFile,
}

const NodeButtonProps = {
  text: true,
  rounded: true,
  tooltipOptions: SBTooltipOptions,
};

const ExplorerTreeNode = (props: ExplorerTreeNodeProps) => {
  const authUser = useAuthUser();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();

  const isCollectionWritable = useMemo(() => {
    if (props.node.type !== ExplorerTreeNodeType.Topology) {
      return false;
    }

    if (authUser.isAdmin) return true;

    const topology = topologyStore.lookup.get(props.node.key as string);
    if (!topology) return false;

    const collection = collectionStore.lookup.get(topology.collectionId);
    if (!collection) return false;

    return collection.publicWrite;
  }, [authUser, collectionStore.data, topologyStore.data]);

  const isWritable = useMemo(() => {
    if (authUser.isAdmin) return true;

    if (props.node.type === ExplorerTreeNodeType.Collection) {
      return collectionStore.lookup.get(props.node.key as string)?.publicWrite;
    } else if (props.node.type === ExplorerTreeNodeType.Topology) {
      const creator = topologyStore.lookup.get(
        props.node.key as string,
      )?.creator;
      return creator?.id === authUser.id;
    } else if (props.node.type === ExplorerTreeNodeType.BindFile) {
      const topologyId = topologyStore.bindFileLookup.get(
        props.node.key as string,
      )!.topologyId;
      const creator = topologyStore.lookup.get(topologyId)?.creator;
      return creator && creator.id === authUser.id;
    }
    return false;
  }, [authUser, collectionStore.data, topologyStore.data]);

  const isDeployable = useMemo(() => {
    if (props.node.type !== ExplorerTreeNodeType.Topology) {
      return false;
    }

    const topology = topologyStore.lookup.get(props.node.key as string);
    if (!topology) return false;

    const publicDeploy =
      collectionStore.lookup.get(topology.collectionId)?.publicDeploy ?? false;
    return authUser.isAdmin || publicDeploy;
  }, [authUser, collectionStore.lookup, topologyStore.lookup]);

  function onEditCollection(event: MouseEvent<HTMLButtonElement>) {
    props.onEditCollection(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onDeleteCollection(event: MouseEvent<HTMLButtonElement>) {
    props.onDeleteCollection(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onAddTopology(event: MouseEvent<HTMLButtonElement>) {
    props.onAddTopology(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onEditTopology(event: MouseEvent<HTMLButtonElement>) {
    props.onEditTopology(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onDuplicateTopology(event: MouseEvent<HTMLButtonElement>) {
    props.onDuplicateTopology(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onDeployTopology(event: MouseEvent<HTMLButtonElement>) {
    props.onDeployTopology(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onDeleteTopology(event: MouseEvent<HTMLButtonElement>) {
    props.onDeleteTopology(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onAddBindFile(event: MouseEvent<HTMLButtonElement>) {
    props.onAddBindFile(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onEditBindFile(event: MouseEvent<HTMLButtonElement>) {
    props.onEditBindFile(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onDeleteBindFile(event: MouseEvent<HTMLButtonElement>) {
    props.onDeleteBindFile(props.node.key as uuid4);
    event.stopPropagation();
  }

  return (
    <div className="sb-explorer-node">
      <Tooltip target=".tree-node" />
      <span
        className="tree-node p-treenode-label"
        data-pr-position="right"
        data-pr-my="left+10 center"
        data-pr-showdelay={500}
        data-pr-tooltip={props.node.label}
      >
        {props.node.label}
      </span>
      <div className="sb-explorer-node-buttons">
        <Choose>
          {/* Collection */}
          <When condition={props.node.type === ExplorerTreeNodeType.Collection}>
            <If condition={authUser.isAdmin}>
              <Button
                icon="pi pi-pen-to-square"
                severity="secondary"
                tooltip="Edit Collection"
                onClick={onEditCollection}
                aria-label="Edit Collection"
                {...NodeButtonProps}
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                tooltip="Delete Collection"
                onClick={onDeleteCollection}
                aria-label="Delete Collection"
                {...NodeButtonProps}
              />
            </If>
            <Button
              icon="pi pi-plus"
              severity="success"
              tooltip={
                !isWritable
                  ? 'No permission to add topology to collection'
                  : 'Add Topology'
              }
              onClick={onAddTopology}
              aria-label="Add Topology"
              disabled={!isWritable}
              {...NodeButtonProps}
            />
          </When>
          {/* Topology */}
          <When condition={props.node.type === ExplorerTreeNodeType.Topology}>
            <Button
              icon="pi pi-plus"
              severity="success"
              tooltip={
                !isWritable
                  ? 'No permission to add file to topology'
                  : 'Add File'
              }
              onClick={onAddBindFile}
              aria-label="Add File"
              disabled={!isWritable}
              {...NodeButtonProps}
            />
            <Button
              icon="pi pi-pen-to-square"
              severity="secondary"
              tooltip={
                !isWritable
                  ? 'No permissions to edit topology'
                  : 'Edit Topology'
              }
              onClick={onEditTopology}
              aria-label="Edit Topology"
              disabled={!isWritable}
              {...NodeButtonProps}
            />
            <Button
              icon="pi pi-clone"
              severity="secondary"
              tooltip={
                !isWritable
                  ? 'No permissions to duplicate topology'
                  : 'Duplicate Topology'
              }
              onClick={onDuplicateTopology}
              aria-label="Duplicate Topology"
              disabled={!isCollectionWritable}
              {...NodeButtonProps}
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              onClick={onDeleteTopology}
              tooltip={
                !isWritable
                  ? 'No permissions to delete topology'
                  : 'Delete Topology'
              }
              aria-label="Delete Topology"
              disabled={!isWritable}
              {...NodeButtonProps}
            />
            <Button
              icon="pi pi-play"
              severity="success"
              tooltip={
                !isDeployable
                  ? 'No permissions to deploy topology'
                  : 'Deploy Topology'
              }
              onClick={onDeployTopology}
              aria-label="Deploy Topology"
              disabled={!isDeployable}
              {...NodeButtonProps}
            />
          </When>
          {/* Bind File */}
          <When condition={props.node.type === ExplorerTreeNodeType.BindFile}>
            <Button
              icon="pi pi-pen-to-square"
              severity="secondary"
              tooltip={
                !isWritable ? 'No permissions to edit file' : 'Edit File'
              }
              onClick={onEditBindFile}
              aria-label="Edit File"
              // disabled={!isWritable}
              {...NodeButtonProps}
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              tooltip={
                !isWritable ? 'No permissions to delete file' : 'Delete File'
              }
              onClick={onDeleteBindFile}
              aria-label="Delete File"
              // disabled={!isWritable}
              {...NodeButtonProps}
            />
          </When>
        </Choose>
      </div>
    </div>
  );
};

export default ExplorerTreeNode;

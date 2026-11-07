import React, {useEffect, useMemo} from 'react';

import {Button} from 'primereact/button';
import {TreeNode} from 'primereact/treenode';

import {
  useAuthUser,
  useCollectionStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {Choose, If, When} from '@sb/types/control';
import {uuid4} from '@sb/types/types';

import './explorer-tree-node.sass';

interface ExplorerTreeNodeProps {
  node: ExplorerTreeNodeData;

  onOpenMenu: (e: React.SyntheticEvent, node: ExplorerTreeNodeData) => void;
  onAddTopology: (collectionId: uuid4) => void;
  onDeployTopology: (topologyId: uuid4) => void;
}

export interface ExplorerTreeNodeData extends TreeNode {
  type: ExplorerTreeNodeType;
  children?: ExplorerTreeNodeData[];
}

export enum ExplorerTreeNodeType {
  Collection,
  Topology,
  BindFile,
  BindFileDirectory,
}

/**
 * Convention for explorer tree node keys:
 *
 * Collection: collectionId
 * Topology: topologyId
 * BindFile: bindFileId
 * BindFileDirectory: topologyId-path/to/bind.file
 */

const ExplorerTreeNode = (props: ExplorerTreeNodeProps) => {
  const authUser = useAuthUser();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();

  const isDeployable = useMemo(() => {
    const topology = topologyStore.lookup.get(props.node.key as string);
    return !!topology && collectionStore.canDeployIn(topology.collectionId);
  }, [authUser, collectionStore.data, topologyStore.data]);

  const isCollectionWritable = useMemo(
    () =>
      props.node.type === ExplorerTreeNodeType.Collection &&
      collectionStore.canWriteIn(props.node.key as string),
    [authUser, collectionStore.data],
  );

  const isWritable = useMemo(() => {
    if (authUser.isAdmin) return true;

    if (props.node.type === ExplorerTreeNodeType.Collection) {
      return collectionStore.lookup.get(props.node.key as string)?.publicWrite;
    } else if (props.node.type === ExplorerTreeNodeType.Topology) {
      const topologyId = props.node.key as string;
      const creator = topologyStore.lookup.get(topologyId)!.creator;

      return creator.id === authUser.id;
    } else if (props.node.type === ExplorerTreeNodeType.BindFile) {
      const topologyId = topologyStore.bindFileLookup.get(
        props.node.key as uuid4,
      )!.topologyId;
      const creator = topologyStore.lookup.get(topologyId)!.creator;

      return creator.id === authUser.id;
    } else if (props.node.type === ExplorerTreeNodeType.BindFileDirectory) {
      const topologyId = (props.node.key as string).slice(0, 36);

      const creator = topologyStore.lookup.get(topologyId)!.creator;
      return creator.id === authUser.id;
    }
    return false;
  }, [authUser, collectionStore.data, topologyStore.data]);

  // Make sure that if the node is not writable, it cannot be dragged
  useEffect(() => {
    props.node.draggable = isWritable;
  }, [isWritable, props.node]);

  function onOpenMenu(e: React.SyntheticEvent) {
    e.stopPropagation();
    props.onOpenMenu(e, props.node);
  }

  return (
    <div className="sb-explorer-node">
      <span className="tree-node p-treenode-label">{props.node.label}</span>
      <div className="sb-explorer-node-buttons">
        <Choose>
          {/* Collection */}
          <When condition={props.node.type === ExplorerTreeNodeType.Collection}>
            <If condition={isCollectionWritable}>
              <Button
                text
                icon="pi pi-plus"
                severity="secondary"
                onClick={e => {
                  e.stopPropagation();
                  props.onAddTopology(props.node.key as uuid4);
                }}
                aria-label="Add topology"
              />
              <Button
                text
                icon={
                  <span className="material-symbols-outlined">more_horiz</span>
                }
                onClick={onOpenMenu}
                aria-label="More options"
              />
            </If>
          </When>

          {/* Topology */}
          <When condition={props.node.type === ExplorerTreeNodeType.Topology}>
            <If condition={isDeployable}>
              <Button
                text
                icon="pi pi-play"
                onClick={e => {
                  e.stopPropagation();
                  props.onDeployTopology(props.node.key as uuid4);
                }}
                aria-label="Deploy topology"
                className="sb-button-green"
              />
            </If>
            <Button
              text
              icon={
                <span className="material-symbols-outlined">more_horiz</span>
              }
              onClick={onOpenMenu}
              aria-label="More options"
            />
          </When>

          {/* Bind File */}
          <When condition={props.node.type === ExplorerTreeNodeType.BindFile}>
            <Button
              text
              icon={
                <span className="material-symbols-outlined">more_horiz</span>
              }
              onClick={onOpenMenu}
              aria-label="More options"
            />
          </When>
          <When
            condition={
              props.node.type === ExplorerTreeNodeType.BindFileDirectory
            }
          >
            <Button
              text
              icon={
                <span className="material-symbols-outlined">more_horiz</span>
              }
              onClick={onOpenMenu}
              aria-label="More options"
            />
          </When>
        </Choose>
      </div>
    </div>
  );
};

export default ExplorerTreeNode;

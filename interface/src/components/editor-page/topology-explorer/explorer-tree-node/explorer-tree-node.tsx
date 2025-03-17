import {
  useAuthUser,
  useCollectionStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {SBTooltipOptions} from '@sb/lib/utils/utils';
import {Choose, Otherwise, When} from '@sb/types/control';

import {uuid4} from '@sb/types/types';

import {Button} from 'primereact/button';
import {TreeNode} from 'primereact/treenode';
import React, {MouseEvent, useMemo} from 'react';

interface ExplorerTreeNodeProps {
  node: TreeNode;

  onEditCollection: (id: uuid4) => void;
  onDeleteCollection: (id: uuid4) => void;

  onAddTopology: (collectionId: uuid4) => void;
  onDeployTopology: (id: uuid4) => void;
  onDeleteTopology: (id: uuid4) => void;
}

const ExplorerTreeNode: React.FC<ExplorerTreeNodeProps> = (
  props: ExplorerTreeNodeProps
) => {
  const authUser = useAuthUser();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();

  const isTopologyNode = props.node.leaf;

  const isEditable = useMemo(() => {
    if (isTopologyNode) {
      const creator = topologyStore.lookup.get(
        props.node.key as string
      )?.creator;
      return authUser.isAdmin || (creator && creator.id === authUser.id);
    } else {
      const publicWrite = collectionStore.lookup.get(
        props.node.key as string
      )?.publicWrite;
      return authUser.isAdmin || publicWrite;
    }
  }, [authUser, collectionStore.lookup, topologyStore.lookup]);

  const isDeployable = useMemo(() => {
    if (!isTopologyNode || process.env.IS_OFFLINE) return false;

    const publicDeploy = collectionStore.lookup.get(
      props.node.key as string
    )?.publicDeploy;
    return authUser.isAdmin || publicDeploy;
  }, [authUser, collectionStore.lookup]);

  function onAddTopology(event: MouseEvent<HTMLButtonElement>) {
    props.onAddTopology(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onEditCollection(event: MouseEvent<HTMLButtonElement>) {
    props.onEditCollection(props.node.key as uuid4);
    event.stopPropagation();
  }

  function onDeleteCollection(event: MouseEvent<HTMLButtonElement>) {
    props.onDeleteCollection(props.node.key as uuid4);
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

  return (
    <div className="flex align-self-stretch w-full align-items-center justify-content-between">
      <Choose>
        <When condition={isTopologyNode}>
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
            <Button
              icon="pi pi-trash"
              severity="danger"
              rounded
              text
              onClick={onDeleteTopology}
              tooltipOptions={SBTooltipOptions}
              tooltip={
                !isEditable
                  ? 'No permissions to delete topology'
                  : 'Delete Topology'
              }
              aria-label="Delete Topology"
              disabled={!isEditable}
            />
            <Button
              icon="pi pi-play"
              severity="success"
              rounded
              text
              tooltipOptions={SBTooltipOptions}
              tooltip={
                process.env.IS_OFFLINE
                  ? 'Deploying not available in offline build.'
                  : !isDeployable
                    ? 'No permissions to deploy topology'
                    : 'Deploy Topology'
              }
              onClick={onDeployTopology}
              aria-label="Deploy Topology"
              disabled={!isDeployable}
            />
          </div>
        </When>
        <Otherwise>
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
            <Button
              icon="pi pi-pen-to-square"
              severity="secondary"
              rounded
              text
              tooltipOptions={SBTooltipOptions}
              tooltip={
                !isEditable
                  ? 'No permissions to edit collection'
                  : 'Edit Collection'
              }
              onClick={onEditCollection}
              aria-label="Edit Collection"
              disabled={!isEditable}
            />
            <Button
              icon="pi pi-trash"
              severity="danger"
              rounded
              text
              tooltipOptions={SBTooltipOptions}
              tooltip={
                !isEditable
                  ? 'No permissions to delete collection'
                  : 'Delete Collection'
              }
              onClick={onDeleteCollection}
              aria-label="Delete Collection"
              disabled={!isEditable}
            />
            <Button
              icon="pi pi-plus"
              severity="success"
              rounded
              text
              tooltipOptions={SBTooltipOptions}
              tooltip={
                !isEditable
                  ? 'No permissions to add collection'
                  : 'Add Collection'
              }
              onClick={onAddTopology}
              aria-label="Add Topology"
              disabled={!isEditable}
            />
          </div>
        </Otherwise>
      </Choose>
    </div>
  );
};

export default ExplorerTreeNode;

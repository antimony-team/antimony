import React, {MouseEvent, useEffect, useMemo, useRef, useState} from 'react';

import {
  Tree,
  TreeEventNodeEvent,
  TreeExpandedKeysType,
  TreeSelectionEvent,
} from 'primereact/tree';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {Message} from 'primereact/message';
import {Tooltip} from 'primereact/tooltip';
import {TreeNode} from 'primereact/treenode';
import {MenuItem} from 'primereact/menuitem';
import {ContextMenu} from 'primereact/contextmenu';

import {
  useCollectionStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {uuid4} from '@sb/types/types';
import {Choose, Otherwise, When} from '@sb/types/control';
import SBConfirm from '@sb/components/common/sb-confirm/sb-confirm';
import CollectionEditDialog from '@sb/components/editor-page/topology-explorer/collection-edit-dialog/collection-edit-dialog';
import ExplorerTreeNode from './explorer-tree-node/explorer-tree-node';
import TopologyAddDialog from '@sb/components/editor-page/topology-editor/topology-add-dialog/topology-add-dialog';

import './topology-explorer.sass';
import {Image} from 'primereact/image';
import {Collection} from '@sb/types/domain/collection';
import {Topology} from '@sb/types/domain/topology';

interface TopologyBrowserProps {
  selectedTopologyId?: string | null;

  onTopologySelect: (id: uuid4) => void;
  onTopologyDeploy: (id: uuid4) => void;
}

const TopologyExplorer = observer((props: TopologyBrowserProps) => {
  const [expandedKeys, setExpandedKeys] = useState<TreeExpandedKeysType>({});

  const [editingCollection, setEditingCollection] = useState<Collection | null>(
    null
  );
  const [isEditCollectionOpen, setEditCollectionOpen] =
    useState<boolean>(false);
  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[]>();

  // Set to non-null value if the create topology dialog is shown.
  const [createTopologyCollection, setCreateTopologCollection] = useState<
    string | null
  >(null);

  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const contextMenuRef = useRef<ContextMenu | null>(null);
  const contextMenuTarget = useRef<string | null>(null);

  const topologyTree = useMemo(() => {
    const topologyTree: TreeNode[] = [];
    const topologiesByCollection = new Map<string, Topology[]>();

    for (const topology of topologyStore.data) {
      if (topologiesByCollection.has(topology.collectionId)) {
        topologiesByCollection.get(topology.collectionId)!.push(topology);
      } else {
        topologiesByCollection.set(topology.collectionId, [topology]);
      }
    }

    for (const collection of collectionStore.data) {
      topologyTree.push({
        key: collection.id,
        label: collection.name,
        icon: 'pi pi-folder',
        selectable: false,
        leaf: false,
        children: topologiesByCollection.get(collection.id)?.map(topology => ({
          key: topology.id,
          label: topology.definition.getIn(['name']) as string,
          icon: <span className="material-symbols-outlined">lan</span>,
          leaf: true,
          selectable: true,
        })),
      });
    }

    return topologyTree;
  }, [collectionStore.data, topologyStore.data]);

  useEffect(() => {
    setExpandedKeys(
      Object.fromEntries(topologyTree.map(collection => [collection.key, true]))
    );
  }, [topologyTree]);

  function onSelectionChange(e: TreeSelectionEvent) {
    if (e.value === null) return;

    props.onTopologySelect(e.value as string);
  }

  function onDeleteCollection(id: string) {
    collectionStore.delete(id).then(result => {
      if (result.isErr()) {
        notificationStore.error(
          result.error.message,
          'Failed to delete collection'
        );
      } else {
        notificationStore.success('Collection has been deleted.');
      }
    });
  }

  function onDeleteTopology(id: string) {
    topologyStore.delete(id).then(result => {
      if (result.isErr()) {
        notificationStore.error(
          result.error.message,
          'Failed to delete topology'
        );
      } else {
        notificationStore.success('Topology has been deleted.');
      }
    });
  }

  function onAddCollection() {
    setEditingCollection(null);
    setEditCollectionOpen(true);
  }

  function onEditCollection(id: string) {
    if (!collectionStore.lookup.has(id)) return;

    setEditingCollection(collectionStore.lookup.get(id)!);
    setEditCollectionOpen(true);
  }

  async function onAddTopology(collectionId: uuid4 | null) {
    setCreateTopologCollection(collectionId);
  }

  function onDeleteCollectionRequest(id: string) {
    if (!collectionStore.lookup.has(id)) return;

    const childTopologies = topologyStore.data.filter(
      topology => topology.collectionId === id
    );

    notificationStore.confirm({
      header: `Delete Collection "${collectionStore.lookup.get(id)!.name}"?`,
      content: (
        <Choose>
          <When condition={childTopologies.length > 0}>
            <div className="sb-confirm-list">
              <span>The following topologies will be deleted as well</span>
              <ul>
                {childTopologies.map(topology => (
                  <li>{topology.definition.get('name') as string}</li>
                ))}
              </ul>
              <Message severity="warn" text="This action cannot be undone!" />
            </div>
          </When>
          <Otherwise>{'This action cannot be undone!'}</Otherwise>
        </Choose>
      ),
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
      onAccept: () => onDeleteCollection(id),
    });
  }

  function onDeleteTopologyRequest(id: string) {
    if (!topologyStore.lookup.has(id)) return;

    notificationStore.confirm({
      header: `Delete Topology "${topologyStore.lookup
        .get(id)!
        .definition.get('name')}"?`,
      message: 'This action cannot be undone!',
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
      onAccept: () => onDeleteTopology(id),
    });
  }

  function onTopologyAdded(topologyId: string) {
    props.onTopologySelect(topologyId);
    setCreateTopologCollection(null);
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    setContextMenuModel(containerContextMenu);
    contextMenuRef!.current!.show(e);
  }

  function onContextMenuTree(e: TreeEventNodeEvent) {
    if (e.node.leaf) {
      setContextMenuModel(topologyContextMenu);
    } else {
      setContextMenuModel(collectionContextMenu);
    }

    contextMenuTarget.current = e.node.key as string;
    contextMenuRef!.current!.show(e.originalEvent);
  }

  const onEditCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onEditCollection(contextMenuTarget.current ?? undefined);
  };

  const onDeleteCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteCollectionRequest(contextMenuTarget.current);
  };

  const onAddTopologyContext = () => {
    if (
      !contextMenuTarget.current ||
      !topologyStore.lookup.has(contextMenuTarget.current)
    ) {
      return;
    }

    void onAddTopology(
      topologyStore.lookup.get(contextMenuTarget.current)!.collectionId
    );
  };

  const onDeployTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    props.onTopologyDeploy(contextMenuTarget.current);
  };

  const onDeleteTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteTopologyRequest(contextMenuTarget.current);
  };

  const containerContextMenu = [
    {
      id: 'create',
      label: 'Add Collection',
      icon: 'pi pi-plus',
      command: onAddCollection,
    },
  ];

  const collectionContextMenu = [
    {
      id: 'create',
      label: 'Add Topology',
      icon: 'pi pi-plus',
      command: () => onAddTopology(contextMenuTarget.current),
    },
    {
      id: 'edit',
      label: 'Edit Collection',
      icon: 'pi pi-file-edit',
      command: onEditCollectionContext,
    },
    {
      id: 'delete',
      label: 'Delete Collection',
      icon: 'pi pi-trash',
      command: onDeleteCollectionContext,
    },
  ];

  const topologyContextMenu = [
    {
      id: 'create',
      label: 'Deploy Lab',
      icon: 'pi pi-play',
      command: onDeployTopologyContext,
    },
    {
      id: 'create',
      label: 'Add Topology',
      icon: 'pi pi-plus',
      command: onAddTopologyContext,
    },
    {
      id: 'delete',
      label: 'Delete Topology',
      icon: 'pi pi-trash',
      command: onDeleteTopologyContext,
    },
  ];

  return (
    <div className="sb-topology-explorer" onContextMenu={onContextMenu}>
      <Tooltip target=".tree-node" />
      <Tree
        filter
        filterMode="lenient"
        filterPlaceholder="Search"
        value={topologyTree}
        className="w-full"
        emptyMessage={
          <div className="sb-topology-explorer-empty">
            <Image src="/assets/icons/no-results.png" width="100px" />
            <span>No topologies found :(</span>
          </div>
        }
        pt={{
          toggler: {
            'aria-label': 'Expand Node',
          },
        }}
        expandedKeys={expandedKeys}
        selectionMode="single"
        selectionKeys={props.selectedTopologyId}
        nodeTemplate={node => (
          <ExplorerTreeNode
            node={node}
            onEditCollection={onEditCollection}
            onDeleteCollection={onDeleteCollectionRequest}
            onAddTopology={onAddTopology}
            onDeployTopology={props.onTopologyDeploy}
            onDeleteTopology={onDeleteTopologyRequest}
          />
        )}
        onContextMenu={e => onContextMenuTree(e)}
        onSelectionChange={onSelectionChange}
        onToggle={e => setExpandedKeys(e.value)}
      />
      <TopologyAddDialog
        collectionId={createTopologyCollection}
        onCreated={onTopologyAdded}
        onClose={() => setCreateTopologCollection(null)}
      />
      <CollectionEditDialog
        key={editingCollection?.id}
        editingCollection={editingCollection}
        isOpen={isEditCollectionOpen}
        onClose={() => setEditCollectionOpen(false)}
      />
      <SBConfirm />
      <ContextMenu model={contextMenuModel} ref={contextMenuRef} />
      <Button
        className="sb-topology-explorer-add-group"
        icon="pi pi-plus"
        onClick={onAddCollection}
        aria-label="Add Group"
      />
    </div>
  );
});

export default TopologyExplorer;

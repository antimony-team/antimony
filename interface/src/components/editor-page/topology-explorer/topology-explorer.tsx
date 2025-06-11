import SBConfirm from '@sb/components/common/sb-confirm/sb-confirm';
import BindFileEditDialog, {
  BindFileEditDialogState,
} from '@sb/components/editor-page/topology-explorer/bind-file-edit-dialog/bind-file-edit-dialog';
import CollectionEditDialog, {
  CollectionEditDialogState,
} from '@sb/components/editor-page/topology-explorer/collection-edit-dialog/collection-edit-dialog';
import TopologyEditDialog, {
  TopologyEditDialogState,
} from '@sb/components/editor-page/topology-explorer/topology-edit-dialog/topology-edit-dialog';

import './topology-explorer.sass';

import {
  useAuthUser,
  useCollectionStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {Topology} from '@sb/types/domain/topology';
import {uuid4} from '@sb/types/types';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {ContextMenu} from 'primereact/contextmenu';
import {Image} from 'primereact/image';
import {MenuItem} from 'primereact/menuitem';
import {Message} from 'primereact/message';
import {Tooltip} from 'primereact/tooltip';

import {
  Tree,
  TreeDragDropEvent,
  TreeEventNodeEvent,
  TreeExpandedKeysType,
  TreeSelectionEvent,
} from 'primereact/tree';
import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ExplorerTreeNode, {
  ExplorerTreeNodeData,
  ExplorerTreeNodeType,
} from './explorer-tree-node/explorer-tree-node';

interface TopologyBrowserProps {
  selectedTopologyId?: string | null;

  onTopologySelect: (id: uuid4) => void;
  onTopologyDeploy: (id: uuid4) => void;
}

const TopologyExplorer = observer((props: TopologyBrowserProps) => {
  const [expandedKeys, setExpandedKeys] = useState<TreeExpandedKeysType>({});

  const editBindFileState = useDialogState<BindFileEditDialogState>(null);
  const editCollectionState = useDialogState<CollectionEditDialogState>(null);
  const editTopologyState = useDialogState<TopologyEditDialogState>(null);

  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[]>();

  const authUser = useAuthUser();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const contextMenuRef = useRef<ContextMenu | null>(null);
  const contextMenuTarget = useRef<string | null>(null);

  const topologyTree = useMemo(() => {
    const topologyTree: ExplorerTreeNodeData[] = [];
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
        icon: (
          <span className="material-symbols-outlined">
            {authUser.isAdmin || collection.publicWrite
              ? 'bookmark_manager'
              : 'folder_eye'}
          </span>
        ),
        selectable: false,
        leaf: false,
        draggable: false,
        type: ExplorerTreeNodeType.Collection,
        children: topologiesByCollection.get(collection.id)?.map(topology => ({
          key: topology.id,
          label: topology.definition.getIn(['name']) as string,
          icon: <span className="material-symbols-outlined">lan</span>,
          // Set topology as leaf if it doesn't have any bind files
          leaf: topology.bindFiles.length === 0,
          selectable: true,
          type: ExplorerTreeNodeType.Topology,
          children: topology.bindFiles.map(bindFile => ({
            key: bindFile.id,
            label: bindFile.filePath,
            icon: (
              <span className="material-symbols-outlined">description</span>
            ),
            droppable: false,
            leaf: true,
            selectable: true,
            type: ExplorerTreeNodeType.BindFile,
          })),
        })),
      });
    }

    return topologyTree;
  }, [collectionStore.data, topologyStore.data]);

  useEffect(() => {
    saveNodeExpandKeys();
  }, [topologyTree]);

  function onNodeExpand(e: TreeEventNodeEvent) {
    setNodeExpanded(e.node.key as string, true);
  }

  function onNodeCollapse(e: TreeEventNodeEvent) {
    setNodeExpanded(e.node.key as string, false);
  }

  function setNodeExpanded(nodeKey: string, expanded: boolean) {
    const expandedNodes = (
      localStorage.getItem('explorerExpandedNodes') ?? ''
    ).split(';');

    if (expanded && expandedNodes.indexOf(nodeKey) < 0) {
      expandedNodes.push(nodeKey);
    } else if (!expanded && expandedNodes.indexOf(nodeKey) >= 0) {
      expandedNodes.splice(expandedNodes.indexOf(nodeKey), 1);
    }

    localStorage.setItem('explorerExpandedNodes', expandedNodes.join(';'));
  }

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

  function onDeleteBindFile(id: string, topologyId: string) {
    topologyStore.deleteBindFile(topologyId, id).then(result => {
      if (result.isErr()) {
        notificationStore.error(result.error.message, 'Failed to delete file');
      } else {
        notificationStore.success('File has been deleted.');
      }
    });
  }

  function onAddBindFile(topologyId: string) {
    editBindFileState.openWith({
      editingBindingFile: null,
      owningTopologyId: topologyId,
      action: DialogAction.Add,
    });
  }

  function onEditBindFile(id: string) {
    if (!topologyStore.bindFileLookup.has(id)) return;

    const bindFile = topologyStore.bindFileLookup.get(id)!;
    editBindFileState.openWith({
      editingBindingFile: bindFile,
      owningTopologyId: bindFile.topologyId,
      action: DialogAction.Edit,
    });
  }

  function onAddCollection() {
    editCollectionState.openWith({
      editingCollection: null,
      action: DialogAction.Add,
    });
  }

  function onEditCollection(id: uuid4) {
    if (!collectionStore.lookup.has(id)) return;

    editCollectionState.openWith({
      editingCollection: collectionStore.lookup.get(id)!,
      action: DialogAction.Edit,
    });
  }

  function onAddTopology(collectionId: uuid4 | null) {
    if (!collectionId || !collectionStore.lookup.has(collectionId)) return;

    editTopologyState.openWith({
      editingTopology: null,
      collectionId: collectionId,
      action: DialogAction.Add,
    });
  }

  function onEditTopology(topologyId: string) {
    if (!topologyStore.lookup.has(topologyId)) return;

    const topology = topologyStore.lookup.get(topologyId)!;
    editTopologyState.openWith({
      editingTopology: topology,
      collectionId: topology.collectionId,
      action: DialogAction.Edit,
    });
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
    const topology = topologyStore.lookup.get(id)!;
    notificationStore.confirm({
      header: `Delete Topology "${topology.definition.get('name')}"?`,
      message: 'This action cannot be undone!',
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
      onAccept: () => onDeleteTopology(id),
    });
  }

  function onDeleteBindFileRequest(id: string) {
    const bindFile = topologyStore.bindFileLookup.get(id)!;

    notificationStore.confirm({
      header: `Delete File "${bindFile.filePath}"?`,
      message: 'This action cannot be undone!',
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
      onAccept: () => onDeleteBindFile(id, bindFile.topologyId),
    });
  }

  function onTopologyAdded(topologyId: string) {
    if (!topologyStore.lookup.has(topologyId)) return;

    props.onTopologySelect(topologyId);

    // Expand the newly created topology's collection node
    setNodeExpanded(topologyStore.lookup.get(topologyId)!.collectionId, true);
    saveNodeExpandKeys();
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();

    const menu = getContainerContextMenu();

    if (menu.length > 0) {
      setContextMenuModel(menu);
      contextMenuRef!.current!.show(e);
    }
  }

  function saveNodeExpandKeys() {
    const expandedNodes = (
      localStorage.getItem('explorerExpandedNodes') ?? ''
    ).split(';');
    setExpandedKeys(
      Object.fromEntries(expandedNodes.map(node => [node, true]))
    );
  }

  function onContextMenuTree(e: TreeEventNodeEvent) {
    e.originalEvent.preventDefault();

    const nodeType = (e.node as ExplorerTreeNodeData).type;
    let contextMenuEntries: MenuItem[] = [];

    if (nodeType === ExplorerTreeNodeType.Topology) {
      contextMenuEntries = getTopologyContextMenu(e.node.key as string);
    } else if (nodeType === ExplorerTreeNodeType.Collection) {
      contextMenuEntries = getCollectionContextMenu(e.node.key as string);
    } else {
      return;
    }

    if (contextMenuEntries.length > 0) {
      setContextMenuModel(contextMenuEntries);
      contextMenuTarget.current = e.node.key as string;
      contextMenuRef!.current!.show(e.originalEvent);
    }
  }

  const onEditTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onEditTopology(contextMenuTarget.current ?? undefined);
  };

  const onEditCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onEditCollection(contextMenuTarget.current ?? undefined);
  };

  const onDeleteCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteCollectionRequest(contextMenuTarget.current);
  };

  const onAddTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    void onAddTopology(contextMenuTarget.current);
  };

  const onDeployTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    props.onTopologyDeploy(contextMenuTarget.current);
  };

  const onDeleteTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteTopologyRequest(contextMenuTarget.current);
  };

  const getContainerContextMenu = useCallback(() => {
    if (authUser.isAdmin) {
      return [
        {
          id: 'create',
          label: 'Add Collection',
          icon: 'pi pi-plus',
          command: onAddCollection,
        },
      ];
    }

    return [];
  }, [authUser]);

  const getCollectionContextMenu = useCallback(
    (collectionId: string) => {
      const collection = collectionStore.lookup.get(collectionId);
      if (!collection) return [];

      const isWritable = authUser.isAdmin;

      const entries = [];

      if (collection.publicWrite) {
        entries.push({
          id: 'create',
          label: 'Add Topology',
          icon: 'pi pi-plus',
          command: onAddTopologyContext,
        });
      }

      if (authUser.isAdmin) {
        entries.push(
          {
            id: 'edit',
            label: 'Edit Collection',
            icon: 'pi pi-file-edit',
            disabled: !isWritable,
            command: onEditCollectionContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete Collection',
            icon: 'pi pi-trash',
            disabled: !isWritable,
            command: onDeleteCollectionContext,
          }
        );
      }

      return entries;
    },
    [authUser, collectionStore.lookup]
  );

  const getTopologyContextMenu = useCallback(
    (topologyId: string) => {
      const topology = topologyStore.lookup.get(topologyId);
      if (!topology) return [];

      const collection = collectionStore.lookup.get(topology.collectionId);
      if (!collection) return [];

      const entries = [];

      if (authUser.isAdmin || collection.publicDeploy) {
        entries.push({
          id: 'create',
          label: 'Deploy',
          icon: 'pi pi-play',
          command: onDeployTopologyContext,
        });
      }

      if (authUser.isAdmin || topology.creator.id === authUser.id) {
        entries.push(
          {
            id: 'create',
            label: 'Edit Topology',
            icon: 'pi pi-file-edit',
            command: onEditTopologyContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete Topology',
            icon: 'pi pi-trash',
            command: onDeleteTopologyContext,
          }
        );
      }

      return entries;
    },
    [authUser, collectionStore.lookup, topologyStore.lookup]
  );

  async function moveTopologyToCollection(
    topologyId: string,
    collectionId: string
  ) {
    const topology = topologyStore.lookup.get(topologyId);
    if (!authUser.isAdmin && topology?.creator.id !== authUser.id) {
      notificationStore.error(
        'You do not have permissions to move this topology',
        'Failed to move topology'
      );
      return;
    }

    if (
      topologyStore.manager.editingTopologyId === topologyId &&
      topologyStore.manager.hasEdits()
    ) {
      notificationStore.confirm({
        message: 'Discard unsaved changes?',
        header: 'Unsaved Changes',
        icon: 'pi pi-info-circle',
        severity: 'warning',
        onAccept: () =>
          moveTopologyToCollectionConfirm(topologyId, collectionId),
      });
    } else {
      void moveTopologyToCollectionConfirm(topologyId, collectionId);
    }
  }

  async function moveTopologyToCollectionConfirm(
    topologyId: string,
    collectionId: string
  ) {
    const topology = topologyStore.lookup.get(topologyId)!;
    const result = await topologyStore.update(topology.id, {
      collectionId: collectionId,
    });

    if (result.isErr()) {
      notificationStore.error(result.error.message, 'Failed to move topology');
    } else {
      // If the move was successful, expand the target collection node
      setNodeExpanded(collectionId, true);
      saveNodeExpandKeys();

      if (topologyStore.manager.editingTopologyId === topologyId) {
        topologyStore.manager.discardEdits();
      }
    }
  }

  function moveBindFileToTopology(bindFileId: string, topologyId: string) {}

  function onNodeDrop(e: TreeDragDropEvent) {
    if (e.dropNode === null || e.dragNode === null) return;

    const dragNode = e.dragNode as ExplorerTreeNodeData;
    const dropNode = e.dropNode as ExplorerTreeNodeData;
    if (dragNode.type === ExplorerTreeNodeType.Topology) {
      if (dropNode.type === ExplorerTreeNodeType.Collection) {
        void moveTopologyToCollection(
          dragNode.key as string,
          dropNode.key as string
        );
      }
    } else if (dragNode.type === ExplorerTreeNodeType.BindFile) {
      if (dropNode.type === ExplorerTreeNodeType.Topology) {
      }
    }
  }

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
            <Image src="/icons/no-results.png" width="100px" />
            <span>No topologies found :(</span>
          </div>
        }
        pt={{
          toggler: {
            'aria-label': 'Expand Node',
          },
        }}
        dragdropScope="test"
        onDragDrop={onNodeDrop}
        expandedKeys={expandedKeys}
        selectionMode="single"
        onExpand={onNodeExpand}
        onCollapse={onNodeCollapse}
        selectionKeys={props.selectedTopologyId}
        nodeTemplate={node => (
          <ExplorerTreeNode
            node={node as ExplorerTreeNodeData}
            onEditCollection={onEditCollection}
            onDeleteCollection={onDeleteCollectionRequest}
            onAddTopology={onAddTopology}
            onEditTopology={onEditTopology}
            onDeployTopology={props.onTopologyDeploy}
            onDeleteTopology={onDeleteTopologyRequest}
            onAddBindFile={onAddBindFile}
            onEditBindFile={onEditBindFile}
            onDeleteBindFile={onDeleteBindFileRequest}
          />
        )}
        onContextMenu={onContextMenuTree}
        onSelectionChange={onSelectionChange}
        onToggle={e => setExpandedKeys(e.value)}
      />
      <TopologyEditDialog
        key={editTopologyState.state?.editingTopology?.id}
        dialogState={editTopologyState}
        onCreated={onTopologyAdded}
      />
      <CollectionEditDialog
        key={editCollectionState.state?.editingCollection?.id}
        dialogState={editCollectionState}
      />
      <BindFileEditDialog
        key={editBindFileState.state?.editingBindingFile?.id}
        dialogState={editBindFileState}
      />
      <SBConfirm />
      <ContextMenu model={contextMenuModel} ref={contextMenuRef} />
      <If condition={authUser.isAdmin}>
        <Button
          className="sb-topology-explorer-add-group"
          icon="pi pi-plus"
          onClick={onAddCollection}
          aria-label="Add Group"
        />
      </If>
    </div>
  );
});

export default TopologyExplorer;

import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {observer} from 'mobx-react-lite';

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

import SBConfirm, {
  SBConfirmDeletePreset,
} from '@sb/components/common/sb-confirm/sb-confirm';
import {ArchiveUploadDialogState} from '@sb/components/editor-page/archive-upload-dialog/archive-upload-dialog';
import {BindFileEditDialogState} from '@sb/components/editor-page/bind-file-edit-dialog/bind-file-edit-dialog';
import {BindFileDirectoryEditDialogState} from '@sb/components/editor-page/bind-file-edit-directory-dialog/bind-file-directory-edit-dialog';
import {CollectionEditDialogState} from '@sb/components/editor-page/collection-edit-dialog/collection-edit-dialog';
import {TopologyEditDialogState} from '@sb/components/editor-page/topology-edit-dialog/topology-edit-dialog';
import {
  useAuthUser,
  useCollectionStore,
  useStatusMessages,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {TopologyEditSource} from '@sb/lib/topology-manager';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {
  isString,
  setOf,
  usePersistentState,
} from '@sb/lib/utils/persistent-state';
import {If} from '@sb/types/control';
import {BindFile, Topology} from '@sb/types/domain/topology';
import {FetchState, uuid4} from '@sb/types/types';

import ExplorerTreeNode, {
  ExplorerTreeNodeData,
  ExplorerTreeNodeType,
} from './explorer-tree-node/explorer-tree-node';

import './topology-explorer.sass';

interface TopologyBrowserProps {
  selectedId?: string | null;

  onTopologyDeploy: (id: uuid4) => void;

  onOpenFile: (id: string) => void;

  editCollectionState: DialogState<CollectionEditDialogState>;
  editTopologyState: DialogState<TopologyEditDialogState>;
  archiveUploadState: DialogState<ArchiveUploadDialogState>;
  editBindFileState: DialogState<BindFileEditDialogState>;
  editBindFileDirectoryState: DialogState<BindFileDirectoryEditDialogState>;
}

const TopologyExplorer = observer((props: TopologyBrowserProps) => {
  // const [expandedKeys, setExpandedKeys] = useState<TreeExpandedKeysType>({});

  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[]>();

  const authUser = useAuthUser();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const contextMenuRef = useRef<ContextMenu | null>(null);
  const contextMenuTarget = useRef<string | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);

  const topologyTree = useMemo(() => {
    if (collectionStore.data.length === 0) return [];

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
        className: 'sb-explorer-collection-node',
        icon: <span className="material-symbols-outlined">inventory_2</span>,
        selectable: true,
        leaf: false,
        draggable: false,
        type: ExplorerTreeNodeType.Collection,
        children: topologiesByCollection.get(collection.id)?.map(topology => ({
          key: topology.id,
          label: topology.name,
          className: 'sb-explorer-topology-node',
          icon: <span className="material-symbols-outlined">network_node</span>,
          // Set topology as leaf if it doesn't have any bind files
          leaf: topology.bindFiles.length === 0,
          selectable: true,
          type: ExplorerTreeNodeType.Topology,
          children: generateTreeForBindFiles(topology),
        })),
      });
    }

    return topologyTree;
  }, [collectionStore.data, topologyStore.data]);

  function generateTreeForBindFiles(topology: Topology) {
    const bindFileNode: Partial<ExplorerTreeNodeData> = {children: []};

    for (const bindFile of topology.bindFiles) {
      const partParts = bindFile.filePath.split('/').filter(Boolean);
      let current = bindFileNode;

      partParts.forEach((part, i) => {
        const isFile = i === partParts.length - 1;
        let child = current.children!.find(c => c.label === part);

        if (!child) {
          if (isFile) {
            child = {
              key: bindFile.id,
              label: part,
              className: 'sb-explorer-bindfile-node',
              icon: (
                <span className="material-symbols-outlined">description</span>
              ),
              droppable: false,
              leaf: true,
              selectable: true,
              type: ExplorerTreeNodeType.BindFile,
            };
          } else {
            child = {
              key: `${topology.id}-${partParts.slice(0, i + 1).join('/')}`,
              label: part,
              className: 'sb-explorer-bindfile-directory-node',
              icon: <span className="material-symbols-outlined">folder</span>,
              droppable: true,
              leaf: false,
              selectable: true,
              type: ExplorerTreeNodeType.BindFileDirectory,
              children: [],
            };
          }

          current.children!.push(child!);
        }

        if (!isFile) current = child!;
      });
    }

    sortBindFileTree(bindFileNode);
    return bindFileNode.children;
  }

  function sortBindFileTree(node: Partial<ExplorerTreeNodeData>) {
    if (!node.children) return;

    node.children.sort((a, b) => {
      if (a.children && !b.children) {
        return -1;
      } else if (b.children && !a.children) {
        return 1;
      } else {
        return a.label!.localeCompare(b.label!);
      }
    });

    for (const child of node.children) {
      sortBindFileTree(child);
    }
  }

  // We want to remove any keys from the expanded set that are no longer in the tree
  useEffect(() => {
    if (topologyTree.length === 0) return;

    const existingKeys = new Set<string>();
    const collectKeys = (nodes?: ExplorerTreeNodeData[]) => {
      for (const node of nodes ?? []) {
        existingKeys.add(node.key as string);
        collectKeys(node.children);
      }
    };
    collectKeys(topologyTree);

    const pruned = new Set(
      [...expandedNodes].filter(key => existingKeys.has(key)),
    );

    // Only update if something was removed to avoid a render loop
    if (pruned.size !== expandedNodes.size) {
      setExpandedNodes(pruned);
    }
  }, [topologyTree]);

  function expandNode(nodeId: string) {
    expandedNodes.add(nodeId);
    setExpandedNodes(new Set(expandedNodes));
  }

  function collapseNode(nodeId: string) {
    expandedNodes.delete(nodeId);
    setExpandedNodes(new Set(expandedNodes));
  }

  function onNodeExpand(e: TreeEventNodeEvent) {
    expandNode(e.node.key as string);
    // setNodeExpanded(e.node.key as string, true);
  }

  function onNodeCollapse(e: TreeEventNodeEvent) {
    collapseNode(e.node.key as string);
    // setNodeExpanded(e.node.key as string, false);
  }

  const [expandedNodes, setExpandedNodes] = usePersistentState(
    'explorer-expanded-nodes',
    new Set<string>(),
    setOf(isString),
  );

  const expandedKeys = useMemo<TreeExpandedKeysType>(
    () => Object.fromEntries([...expandedNodes].map(key => [key, true])),
    [expandedNodes],
  );

  // function setNodeExpanded(nodeKey: string, expanded: boolean) {
  //   const expandedNodes = (
  //     localStorage.getItem('explorerExpandedNodes') ?? ''
  //   ).split(';');
  //
  //   if (expanded && expandedNodes.indexOf(nodeKey) < 0) {
  //     expandedNodes.push(nodeKey);
  //   } else if (!expanded && expandedNodes.indexOf(nodeKey) >= 0) {
  //     expandedNodes.splice(expandedNodes.indexOf(nodeKey), 1);
  //   }
  //
  //   localStorage.setItem('explorerExpandedNodes', expandedNodes.join(';'));
  // }

  function onSelectionChange(e: TreeSelectionEvent) {
    if (e.value === null) return;

    if (
      collectionStore.lookup.get(e.value as string) ||
      (e.value as string).split('-').length === 6
    ) {
      // If the node is a collection or a bind file directory treat the click as expanded toggle
      if (expandedNodes.has(e.value as string)) {
        collapseNode(e.value as string);
      } else {
        expandNode(e.value as string);
      }
    } else {
      // If the node is a topology or a bind file, open the topology / bind file
      executeEditDiscardingAction(() => props.onOpenFile(e.value as string));
    }
  }

  function onAddBindFile(topologyId: string) {
    props.editBindFileState.openWith({
      editingBindingFile: null,
      owningTopologyId: topologyId,
      action: DialogAction.Add,
    });
  }

  function onEditBindFile(bindFileId: uuid4) {
    if (!topologyStore.bindFileLookup.has(bindFileId)) return;

    const bindFile = topologyStore.bindFileLookup.get(bindFileId)!;
    props.editBindFileState.openWith({
      editingBindingFile: bindFile,
      owningTopologyId: bindFile.topologyId,
      action: DialogAction.Edit,
    });
  }

  function onEditBindFileDirectory(topologyId: uuid4, filePath: string) {
    const topology = topologyStore.lookup.get(topologyId)!;

    props.editBindFileDirectoryState.openWith({
      topology: topology,
      filePath: filePath,
    });
  }

  function onDeleteBindFileDirectory(topologyId: uuid4, filePath: string) {
    const topology = topologyStore.lookup.get(topologyId)!;

    const filesToDelete = topology.bindFiles.filter(file =>
      file.filePath.startsWith(filePath),
    );

    notificationStore.confirm({
      header: `Delete directory "./${filePath}"?`,
      content: (
        <div className="sb-confirm-list">
          <span>The following files will be deleted as well:</span>
          <ul>
            {filesToDelete.map(file => (
              <li>{file.filePath}</li>
            ))}
          </ul>
          <Message severity="warn" text="This action cannot be undone!" />
        </div>
      ),
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
      onAccept: () => {
        void onDeleteBindFileDirectoryConfirm(topology, filesToDelete);
      },
    });
  }

  async function onDeleteBindFileDirectoryConfirm(
    topology: Topology,
    bindFiles: BindFile[],
  ) {
    for (const bindFile of bindFiles) {
      const result = await topologyStore.deleteBindFile(
        topology.id,
        bindFile.id,
        true,
      );

      if (result.isErr()) {
        notificationStore.error(result.error.message, 'Failed to delete file');
        return;
      }
    }

    await topologyStore.fetchSingle(topology.id);
  }

  function onAddCollection() {
    props.editCollectionState.openWith({
      editingCollection: null,
      action: DialogAction.Add,
    });
  }

  function onEditCollection(id: uuid4) {
    if (!collectionStore.lookup.has(id)) return;

    props.editCollectionState.openWith({
      editingCollection: collectionStore.lookup.get(id)!,
      action: DialogAction.Edit,
    });
  }

  function onDeleteCollection(collectionId: string) {
    if (!collectionStore.lookup.has(collectionId)) return;

    const childTopologies = topologyStore.data.filter(
      topology => topology.collectionId === collectionId,
    );

    notificationStore.confirm({
      header: `Delete Collection "${collectionStore.lookup.get(collectionId)!.name}"?`,
      content: (
        <If condition={childTopologies.length > 0}>
          <div className="sb-confirm-list">
            <span>The following topologies will be deleted:</span>
            <ul>
              {childTopologies.map(topology => (
                <li>{topology.definition.get('name') as string}</li>
              ))}
            </ul>
            <Message severity="warn" text="This action cannot be undone!" />
          </div>
        </If>
      ),
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
      onAccept: () => onDeleteCollectionConfirm(collectionId),
    });
  }

  async function onDeleteCollectionConfirm(collectionId: string) {
    const result = await collectionStore.delete(collectionId);

    if (result.isErr()) {
      notificationStore.error(
        result.error.message,
        'Failed to delete collection',
      );
    } else {
      notificationStore.success('Collection has been deleted.');

      // Close editor if topology in collection or bind file belonging to topology in collection is currently being edited
      if (
        topologyStore.manager.topology?.collectionId === collectionId ||
        (topologyStore.manager.bindFile &&
          topologyStore.lookup.get(topologyStore.manager.bindFile.topologyId)
            ?.collectionId === collectionId)
      ) {
        topologyStore.manager.close();
      }
    }
  }

  function onAddTopology(collectionId: uuid4 | null) {
    if (!collectionId || !collectionStore.lookup.has(collectionId)) return;

    executeEditDiscardingAction(() => {
      props.editTopologyState.openWith({
        editingTopology: null,
        collectionId: collectionId,
        action: DialogAction.Add,
      });
    });
  }

  function onEditTopology(topologyId: string) {
    if (!topologyStore.lookup.has(topologyId)) return;

    executeEditDiscardingAction(() => {
      const topology = topologyStore.lookup.get(topologyId)!;
      props.editTopologyState.openWith({
        editingTopology: topology,
        collectionId: topology.collectionId,
        action: DialogAction.Edit,
      });
    });
  }

  function onDuplicateTopology(topologyId: string) {
    executeEditDiscardingAction(() => {
      const topology = topologyStore.lookup.get(topologyId)!;
      props.editTopologyState.openWith({
        editingTopology: topology,
        collectionId: topology.collectionId,
        action: DialogAction.Duplicate,
      });
    });
  }

  function executeEditDiscardingAction(action: () => void) {
    if (topologyStore.manager.hasEdits()) {
      notificationStore.confirm({
        header: 'Discard unsaved changes?',
        message: `Your changes to "${topologyStore.manager.topology?.name}" haven't been saved.`,
        severity: 'warning',
        acceptText: 'Discard changes',
        rejectText: 'Keep editing',
        onAccept: () => {
          topologyStore.manager.discardEdits();
          action();
        },
      });
    } else {
      action();
    }
  }

  function onDuplicateTopologyConfirm(topologyId: string) {
    if (!topologyStore.lookup.has(topologyId)) return;

    const topology = topologyStore.lookup.get(topologyId)!;
    const definitionClone = topology.definition.clone();
    definitionClone.set('name', `${definitionClone.get('name')} (clone)`);

    void topologyStore
      .add<string>({
        definition: definitionClone.toString(),
        collectionId: topology.collectionId,
        syncUrl: topology.syncUrl,
      })
      .then(result => {
        if (result.isErr()) {
          notificationStore.error(
            result.error.message,
            'Failed to update topology',
          );
        } else {
          notificationStore.success(
            'Topology has been duplicated successfully.',
          );

          if (topologyStore.lookup.has(result.data.payload)) {
            const topology = topologyStore.lookup.get(result.data.payload)!;
            topologyStore.manager.openTopology(topology);
          }
        }
      });
  }

  function onDeleteTopology(id: string) {
    const topology = topologyStore.lookup.get(id)!;
    const topologyName = topology.definition.get('name') as string;

    notificationStore.confirm({
      ...SBConfirmDeletePreset('topology'),
      message: `Are you sure you want to delete the topology "${topologyName}"?`,
      content: (
        <>
          <span>{topologyName}</span>
          <div className="sb-confirm-list">
            <If condition={topology.bindFiles.length > 0}>
              <span>The following files will be deleted as well:</span>
              <ul>
                {topology.bindFiles.map(bindFile => (
                  <li>{bindFile.filePath}</li>
                ))}
              </ul>
              <Message severity="warn" text="This action cannot be undone!" />
            </If>
          </div>
        </>
      ),
      onAccept: () => onDeleteTopologyConfirm(id),
    });
  }

  async function onDeleteTopologyConfirm(topologyId: string) {
    const result = await topologyStore.delete(topologyId);

    if (result.isErr()) {
      notificationStore.error(
        result.error.message,
        'Failed to delete topology',
      );
    } else {
      notificationStore.success('Topology has been deleted.');

      // Close editor if topology or bind file belonging to topology is currently being edited
      if (
        topologyStore.manager.editingFileId === topologyId ||
        topologyStore.manager.bindFile?.topologyId === topologyId
      ) {
        topologyStore.manager.close();
      }
    }
  }

  function onTopologyAdded(topologyId: string) {
    if (!topologyStore.lookup.has(topologyId)) return;

    executeEditDiscardingAction(() => props.onOpenFile(topologyId));

    // Expand the newly created topology's collection node
    expandNode(topologyStore.lookup.get(topologyId)!.collectionId);
    // setNodeExpanded(topologyStore.lookup.get(topologyId)!.collectionId, true);
    // saveNodeExpandKeys();
  }

  function onDeleteBindFile(bindFileId: string) {
    const bindFile = topologyStore.bindFileLookup.get(bindFileId)!;

    notificationStore.confirm({
      ...SBConfirmDeletePreset('file'),
      confirmText: bindFile.filePath,
      message: `Are you sure you want to delete the file "${bindFile.filePath}"?`,
      onAccept: () => onDeleteBindFileConfirm(bindFileId, bindFile.topologyId),
    });
  }

  async function onDeleteBindFileConfirm(
    bindFileId: string,
    topologyId: string,
  ) {
    const result = await topologyStore.deleteBindFile(topologyId, bindFileId);

    if (result.isErr()) {
      notificationStore.error(result.error.message, 'Failed to delete file');
    } else {
      notificationStore.success('File has been deleted.');
    }

    if (topologyStore.manager.editingFileId === bindFileId) {
      topologyStore.manager.close();
    }
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();

    const menu = getContainerContextMenu();

    if (menu.length > 0) {
      setContextMenuModel(menu);
      contextMenuRef!.current!.show(e);
    }
  }

  // function saveNodeExpandKeys() {
  //   const expandedNodes = (
  //     localStorage.getItem('explorerExpandedNodes') ?? ''
  //   ).split(';');
  //   setExpandedKeys(
  //     Object.fromEntries(expandedNodes.map(node => [node, true])),
  //   );
  // }

  function openPopupMenu(e: React.SyntheticEvent, node: ExplorerTreeNodeData) {
    let contextMenuEntries: MenuItem[] = [];

    if (node.type === ExplorerTreeNodeType.Topology) {
      contextMenuEntries = getTopologyContextMenu(node.key as string);
    } else if (node.type === ExplorerTreeNodeType.Collection) {
      contextMenuEntries = getCollectionContextMenu(node.key as string);
    } else if (node.type === ExplorerTreeNodeType.BindFile) {
      contextMenuEntries = getBindFileContextMenu(node.key as string);
    } else if (node.type === ExplorerTreeNodeType.BindFileDirectory) {
      contextMenuEntries = getBindFileDirectoryContextMenu(node.key as string);
    } else {
      e.stopPropagation();
      return;
    }

    if (contextMenuEntries.length > 0) {
      setContextMenuModel(contextMenuEntries);
      contextMenuTarget.current = node.key as string;
      contextMenuRef!.current!.show(e);
    }
  }

  function onContextMenuTree(e: TreeEventNodeEvent) {
    e.originalEvent.preventDefault();

    openPopupMenu(e.originalEvent, e.node as ExplorerTreeNodeData);
  }

  const onEditCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onEditCollection(contextMenuTarget.current);
  };

  const onDeleteCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteCollection(contextMenuTarget.current);
  };

  const onAddTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    void onAddTopology(contextMenuTarget.current);
  };

  const onAddBindFileContext = () => {
    if (!contextMenuTarget.current) return;
    onAddBindFile(contextMenuTarget.current);
  };

  const onUploadBindFileArchiveContext = () => {
    if (!contextMenuTarget.current) return;
    onUploadBindFileArchive();
  };

  const onEditTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onEditTopology(contextMenuTarget.current);
  };

  const onDuplicateTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onDuplicateTopology(contextMenuTarget.current);
  };

  const onDownloadTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    // onDuplicateTopology(contextMenuTarget.current);
  };

  const onDeployTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    props.onTopologyDeploy(contextMenuTarget.current);
  };

  const onDeleteTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteTopology(contextMenuTarget.current);
  };

  const onEditBindFileContext = () => {
    if (!contextMenuTarget.current) return;
    onEditBindFile(contextMenuTarget.current);
  };

  const onDeleteBindFileContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteBindFile(contextMenuTarget.current);
  };

  const onEditBindFileDirectoryContext = () => {
    if (!contextMenuTarget.current) return;
    const topologyId = contextMenuTarget.current.slice(0, 36);
    const filePath = contextMenuTarget.current.slice(37);
    onEditBindFileDirectory(topologyId, filePath);
  };

  const onDeleteBindFileDirectoryContext = () => {
    if (!contextMenuTarget.current) return;
    const topologyId = contextMenuTarget.current.slice(0, 36);
    const filePath = contextMenuTarget.current.slice(37);
    onDeleteBindFileDirectory(topologyId, filePath);
  };

  const getContainerContextMenu = useCallback(() => {
    if (authUser.isAdmin) {
      return [
        {
          id: 'create',
          label: 'New collection',
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

      if (!collection.publicWrite && !authUser.isAdmin) return [];

      const entries = [];

      entries.push({
        id: 'create',
        label: 'New topology',
        icon: 'pi pi-plus',
        command: onAddTopologyContext,
      });

      if (authUser.isAdmin) {
        entries.push(
          {
            id: 'edit',
            label: 'Edit',
            icon: (
              <span className="material-symbols-outlined">edit_square</span>
            ),
            command: onEditCollectionContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'pi pi-trash',
            className: 'sb-menuitem-danger',
            command: onDeleteCollectionContext,
          },
        );
      }

      return entries;
    },
    [authUser, collectionStore.lookup],
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
          id: 'deploy',
          label: 'Deploy',
          icon: 'pi pi-play',
          className: 'sb-menuitem-success',
          command: onDeployTopologyContext,
        });
      }

      if (authUser.isAdmin || topology.creator.id === authUser.id) {
        entries.push(
          {
            id: 'new-file',
            label: 'New file',
            icon: <span className="material-symbols-outlined">note_add</span>,
            command: onAddBindFileContext,
          },
          {
            id: 'new-file',
            label: 'Upload files',
            icon: 'pi pi-upload',
            command: onUploadBindFileArchiveContext,
          },
          {
            separator: true,
          },
          {
            id: 'edit',
            label: 'Edit',
            icon: (
              <span className="material-symbols-outlined">edit_square</span>
            ),
            command: onEditTopologyContext,
          },
          {
            id: 'duplicate',
            label: 'Duplicate',
            icon: 'pi pi-clone',
            command: onDuplicateTopologyContext,
          },
          {
            id: 'download',
            label: 'Download YAML',
            icon: 'pi pi-download',
            command: onDownloadTopologyContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'pi pi-trash',
            className: 'sb-menuitem-danger',
            command: onDeleteTopologyContext,
          },
        );
      }

      return entries;
    },
    [authUser, collectionStore.lookup, topologyStore.lookup],
  );

  const getBindFileContextMenu = useCallback(
    (bindFileId: string) => {
      const bindFile = topologyStore.bindFileLookup.get(bindFileId)!;
      const topology = topologyStore.lookup.get(bindFile.topologyId)!;

      const entries = [];

      if (authUser.isAdmin || topology.creator.id === authUser.id) {
        entries.push(
          {
            id: 'edit',
            label: 'Edit',
            icon: (
              <span className="material-symbols-outlined">edit_square</span>
            ),
            command: onEditBindFileContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'pi pi-trash',
            className: 'sb-menuitem-danger',
            command: onDeleteBindFileContext,
          },
        );
      }

      return entries;
    },
    [authUser, collectionStore.lookup, topologyStore.lookup],
  );

  const getBindFileDirectoryContextMenu = useCallback(
    (bindFileDirectoryKey: string) => {
      const topologyId = bindFileDirectoryKey.slice(0, 36);
      const topology = topologyStore.lookup.get(topologyId)!;

      const entries = [];

      if (authUser.isAdmin || topology.creator.id === authUser.id) {
        entries.push(
          {
            id: 'edit',
            label: 'Edit',
            icon: (
              <span className="material-symbols-outlined">edit_square</span>
            ),
            command: onEditBindFileDirectoryContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'pi pi-trash',
            className: 'sb-menuitem-danger',
            command: onDeleteBindFileDirectoryContext,
          },
        );
      }

      return entries;
    },
    [authUser, collectionStore.lookup, topologyStore.lookup],
  );

  async function moveTopologyToCollection(
    topologyId: string,
    collectionId: string,
  ) {
    const topology = topologyStore.lookup.get(topologyId)!;
    if (!authUser.isAdmin && topology?.creator.id !== authUser.id) {
      notificationStore.error(
        'You do not have permissions to move this topology',
        'Failed to move topology',
      );
      return;
    }

    // We need to make a backup of the topology before moving it and restore
    // it afterward, as the update and single fetch will overwrite it.
    const topologyBackup = topology.definition;

    const result = await topologyStore.update(topology.id, {
      collectionId: collectionId,
    });

    if (result.isErr()) {
      notificationStore.error(result.error.message, 'Failed to move topology');
    } else {
      topologyStore.manager.editTopology(
        topologyBackup,
        TopologyEditSource.System,
      );

      // If the move was successful, expand the target collection node
      expandNode(collectionId);
      // setNodeExpanded(collectionId, true);
      // saveNodeExpandKeys();
    }
  }

  /**
   * Moves a bind file to the root of a specified topology.
   *
   * If the bind file moves to a new topology and the bind file is currently
   * being edited, a dialog will appear.
   */
  function moveBindFileToTopology(bindFileId: uuid4, topologyId: string) {
    const bindFile = topologyStore.bindFileLookup.get(bindFileId)!;
    const targetTopology = topologyStore.lookup.get(topologyId)!;

    // Ignore when bind file is already at the root of the target topology
    if (
      bindFile.topologyId === topologyId &&
      !bindFile.filePath.includes('/')
    ) {
      return;
    }

    if (!authUser.isAdmin && targetTopology.creator.id !== authUser.id) {
      notificationStore.error(
        `You do not have permissions to move a file to '${targetTopology.name}'`,
        'Unable to move file',
      );
      return;
    }

    // We have to check whether the bind file already exists in the target topology's root
    const bindFileName = bindFile.filePath.split('/').pop()!;
    if (targetTopology.bindFiles.find(file => file.filePath === bindFileName)) {
      notificationStore.error(
        `A file with that name already exists in '${targetTopology.name}'`,
        'Unable to move file',
      );
      return;
    }

    if (
      bindFile.topologyId !== topologyId &&
      topologyStore.manager.editingFileId === bindFileId &&
      topologyStore.manager.hasEdits()
    ) {
      notificationStore.confirm({
        message: 'Discard unsaved changes?',
        header: 'Unsaved Changes',
        icon: 'pi pi-info-circle',
        severity: 'warning',
        onAccept: () => moveBindFileToTopologyConfirm(bindFile, targetTopology),
      });
    } else {
      void moveBindFileToTopologyConfirm(bindFile, targetTopology);
    }
  }

  async function moveBindFileToTopologyConfirm(
    bindFile: BindFile,
    topology: Topology,
    placeAtRoot: boolean = true,
  ) {
    let fileName = bindFile.filePath;

    if (placeAtRoot) {
      // We have to strip all parent directories from the file's path to place the file at the root of the topology
      fileName = bindFile.filePath.split('/').slice(-1).join('/');
    }

    // If the bind file is already in the target topology, we can just edit the contents
    if (bindFile.topologyId === topology.id) {
      const result = await topologyStore.updateBindFile(
        topology.id,
        bindFile.id,
        {
          content: bindFile.content,
          filePath: fileName,
        },
      );

      if (result.isErr()) {
        notificationStore.error(result.error.message, 'Failed to move file');
      }

      return;
    }

    // Discard edits before we move the file to a new topology
    topologyStore.manager.discardEdits();

    // Add bind file to target topology
    const addResult = await topologyStore.addBindFile(
      topology.id,
      {
        content: bindFile.content,
        filePath: fileName,
      },
      true,
    );

    if (addResult.isErr()) {
      notificationStore.error(addResult.error.message, 'Failed to move file');
      return;
    }

    // Remove bind file from current topology
    const deleteResult = await topologyStore.deleteBindFile(
      bindFile.topologyId,
      bindFile.id,
    );

    await topologyStore.fetchSingle(topology.id);

    if (deleteResult.isErr()) {
      notificationStore.error(
        deleteResult.error.message,
        'Failed to move file',
      );
      return;
    }

    // Open moved bind file in topology editor
    topologyStore.manager.openBindFile(
      topologyStore.bindFileLookup.get(addResult.data.payload)!,
    );
  }

  /**
   * Moves a bind file to a new directory in the same topology.
   */
  async function moveBindFileToDirectory(
    bindFileId: uuid4,
    targetDirectory: string,
  ) {
    const sourceBindFile = topologyStore.bindFileLookup.get(bindFileId)!;

    const targetTopologyId = targetDirectory.slice(0, 36);
    const targetTopology = topologyStore.lookup.get(targetTopologyId)!;
    const targetFilePath = targetDirectory.slice(37);

    const newFilePath = `${targetFilePath}/${sourceBindFile.filePath.split('/').slice(-1)}`;

    if (targetTopologyId === sourceBindFile.topologyId) {
      const result = await topologyStore.updateBindFile(
        sourceBindFile.topologyId,
        sourceBindFile.id,
        {
          content: sourceBindFile.content,
          filePath: newFilePath,
        },
      );

      if (result.isErr()) {
        notificationStore.error(result.error.message, 'Failed to move file');
      }

      return;
    }

    if (
      topologyStore.manager.editingFileId === bindFileId &&
      topologyStore.manager.hasEdits()
    ) {
      notificationStore.confirm({
        message: 'Discard unsaved changes?',
        header: 'Unsaved Changes',
        icon: 'pi pi-info-circle',
        severity: 'warning',
        onAccept: () => {
          // We need to discard edits here already because we are creating a new object
          topologyStore.manager.discardEdits();

          void moveBindFileToTopologyConfirm(
            {...sourceBindFile, filePath: newFilePath},
            targetTopology,
            false,
          );
        },
      });
    } else {
      void moveBindFileToTopologyConfirm(
        {...sourceBindFile, filePath: newFilePath},
        targetTopology,
        false,
      );
    }
  }

  function onNodeDrop(e: TreeDragDropEvent) {
    if (e.dropNode === null || e.dragNode === null) return;

    const dragNode = e.dragNode as ExplorerTreeNodeData;
    const dropNode = e.dropNode as ExplorerTreeNodeData;
    if (dragNode.type === ExplorerTreeNodeType.Topology) {
      if (dropNode.type === ExplorerTreeNodeType.Collection) {
        void moveTopologyToCollection(
          dragNode.key as string,
          dropNode.key as string,
        );
      }
    } else if (dragNode.type === ExplorerTreeNodeType.BindFile) {
      if (dropNode.type === ExplorerTreeNodeType.Topology) {
        moveBindFileToTopology(dragNode.key as uuid4, dropNode.key as uuid4);
      } else if (dropNode.type === ExplorerTreeNodeType.BindFileDirectory) {
        void moveBindFileToDirectory(
          dragNode.key as uuid4,
          dropNode.key as string,
        );
      }
    }
  }

  function onUploadBindFileArchive() {
    if (!fileUploadInputRef.current) return;

    fileUploadInputRef.current.value = '';
    fileUploadInputRef.current.click();
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !contextMenuTarget.current) return;

    const topology = topologyStore.lookup.get(contextMenuTarget.current)!;

    props.archiveUploadState.openWith({
      topology,
      file,
    });
  }

  if (topologyStore.fetchReport.state === FetchState.Pending) {
    return <></>;
  }

  return (
    <div className="sb-topology-explorer" onContextMenu={onContextMenu}>
      <Tooltip target=".tree-node" />
      <Tree
        filter
        filterMode="lenient"
        filterPlaceholder="Search Topologies"
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
        selectionKeys={props.selectedId}
        nodeTemplate={node => (
          <ExplorerTreeNode
            node={node as ExplorerTreeNodeData}
            onOpenMenu={openPopupMenu}
            onAddTopology={onAddTopology}
            onDeployTopology={props.onTopologyDeploy}
          />
        )}
        onContextMenu={onContextMenuTree}
        onSelectionChange={onSelectionChange}
        onToggle={e =>
          setExpandedNodes(
            new Set(Object.keys(e.value).filter(key => e.value[key])),
          )
        }
      />
      <SBConfirm />
      <ContextMenu model={contextMenuModel} ref={contextMenuRef} />
      <input
        ref={fileUploadInputRef}
        type="file"
        accept=".zip,.tar,.gz,.tgz,.7z,.rar,.bz2"
        style={{display: 'none'}}
        // onInput={handleFile}
        onChange={handleFile}
      />
    </div>
  );
});

export default TopologyExplorer;

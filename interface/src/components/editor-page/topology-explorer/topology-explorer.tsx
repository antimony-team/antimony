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
import {If} from '@sb/types/control';
import {BindFile, Topology} from '@sb/types/domain/topology';
import {FetchState, uuid4} from '@sb/types/types';
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
import ArchiveUploadDialog, {
  ArchiveUploadDialogState,
  ArchiveUploadFile,
} from '@sb/components/editor-page/topology-explorer/archive-upload-dialog/archive-upload-dialog';
import {TopologyEditSource} from '@sb/lib/topology-manager';
import BindFileDirectoryEditDialog, {
  BindFileDirectoryEditDialogState,
} from '@sb/components/editor-page/topology-explorer/bind-file-edit-directory-dialog/bind-file-directory-edit-dialog';

interface TopologyBrowserProps {
  selectedId?: string | null;

  onFileSelect: (id: uuid4) => void;
  onTopologyDeploy: (id: uuid4) => void;
}

const TopologyExplorer = observer((props: TopologyBrowserProps) => {
  const [expandedKeys, setExpandedKeys] = useState<TreeExpandedKeysType>({});

  const editCollectionState = useDialogState<CollectionEditDialogState>(null);
  const editTopologyState = useDialogState<TopologyEditDialogState>(null);
  const archiveUploadState = useDialogState<ArchiveUploadDialogState>(null);
  const editBindFileState = useDialogState<BindFileEditDialogState>(null);
  const editBindFileDirectoryState =
    useDialogState<BindFileDirectoryEditDialogState>(null);

  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[]>();

  const authUser = useAuthUser();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const contextMenuRef = useRef<ContextMenu | null>(null);
  const contextMenuTarget = useRef<string | null>(null);

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
              selectable: false,
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

    props.onFileSelect(e.value as string);
  }

  function onAddBindFile(topologyId: string) {
    editBindFileState.openWith({
      editingBindingFile: null,
      owningTopologyId: topologyId,
      action: DialogAction.Add,
    });
  }

  function onEditBindFile(bindFileId: uuid4) {
    if (!topologyStore.bindFileLookup.has(bindFileId)) return;

    const bindFile = topologyStore.bindFileLookup.get(bindFileId)!;
    editBindFileState.openWith({
      editingBindingFile: bindFile,
      owningTopologyId: bindFile.topologyId,
      action: DialogAction.Edit,
    });
  }

  function onEditBindFileDirectory(topologyId: uuid4, filePath: string) {
    const topology = topologyStore.lookup.get(topologyId)!;

    editBindFileDirectoryState.openWith({
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

  function onDuplicateTopology(topologyId: string) {
    if (topologyStore.manager.hasEdits()) {
      notificationStore.confirm({
        message: 'Discard unsaved changes?',
        header: 'Unsaved Changes',
        icon: 'pi pi-info-circle',
        severity: 'warning',
        onAccept: () => onDuplicateTopologyConfirm(topologyId),
      });
    } else {
      onDuplicateTopologyConfirm(topologyId);
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
    notificationStore.confirm({
      header: `Delete Topology "${topology.definition.get('name')}"?`,
      content: (
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
      ),
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
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

    props.onFileSelect(topologyId);

    // Expand the newly created topology's collection node
    setNodeExpanded(topologyStore.lookup.get(topologyId)!.collectionId, true);
    saveNodeExpandKeys();
  }

  function onDeleteBindFile(bindFileId: string) {
    const bindFile = topologyStore.bindFileLookup.get(bindFileId)!;

    notificationStore.confirm({
      header: `Delete File "${bindFile.filePath}"?`,
      icon: 'pi pi-exclamation-triangle',
      severity: 'danger',
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

  function saveNodeExpandKeys() {
    const expandedNodes = (
      localStorage.getItem('explorerExpandedNodes') ?? ''
    ).split(';');
    setExpandedKeys(
      Object.fromEntries(expandedNodes.map(node => [node, true])),
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
    } else if (nodeType === ExplorerTreeNodeType.BindFile) {
      contextMenuEntries = getBindFileContextMenu(e.node.key as string);
    } else if (nodeType === ExplorerTreeNodeType.BindFileDirectory) {
      contextMenuEntries = getBindFileDirectoryContextMenu(
        e.node.key as string,
      );
    } else {
      e.originalEvent.stopPropagation();
      return;
    }

    if (contextMenuEntries.length > 0) {
      setContextMenuModel(contextMenuEntries);
      contextMenuTarget.current = e.node.key as string;
      contextMenuRef!.current!.show(e.originalEvent);
    }
  }

  const onEditCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onEditCollection(contextMenuTarget.current ?? undefined);
  };

  const onDeleteCollectionContext = () => {
    if (!contextMenuTarget.current) return;
    onDeleteCollection(contextMenuTarget.current);
  };

  const onAddTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    void onAddTopology(contextMenuTarget.current);
  };

  const onEditTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onEditTopology(contextMenuTarget.current ?? undefined);
  };

  const onDuplicateTopologyContext = () => {
    if (!contextMenuTarget.current) return;
    onDuplicateTopology(contextMenuTarget.current ?? undefined);
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
    onEditBindFile(contextMenuTarget.current ?? undefined);
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

      if (collection.publicWrite || authUser.isAdmin) {
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
          id: 'create',
          label: 'Deploy',
          icon: 'pi pi-play',
          className: 'sb-menuitem-success',
          command: onDeployTopologyContext,
        });
      }

      if (authUser.isAdmin || topology.creator.id === authUser.id) {
        entries.push(
          {
            id: 'edit',
            label: 'Edit Topology',
            icon: 'pi pi-file-edit',
            command: onEditTopologyContext,
          },
          {
            id: 'duplicate',
            label: 'Duplicate Topology',
            icon: 'pi pi-clone',
            command: onDuplicateTopologyContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete Topology',
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
            label: 'Edit File',
            icon: 'pi pi-file-edit',
            command: onEditBindFileContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete File',
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
            label: 'Edit Directory',
            icon: 'pi pi-file-edit',
            command: onEditBindFileDirectoryContext,
          },
          {
            separator: true,
          },
          {
            id: 'delete',
            label: 'Delete Directory',
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
      setNodeExpanded(collectionId, true);
      saveNodeExpandKeys();
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

  async function onArchiveUpload(topologyId: uuid4, file: File) {
    const topology = topologyStore.lookup.get(topologyId)!;

    archiveUploadState.openWith({
      topology,
      file,
    });
  }

  function onArchiveUploadConfirm(
    topology: Topology,
    files: ArchiveUploadFile[],
  ) {
    console.log(
      'UPLOADING FILES:',
      files.map(file => {
        if (file.filePath.startsWith(`${topology.name}/`)) {
          file.filePath = file.filePath.substring(topology.name.length + 1);
        }
        return file;
      }),
    );

    const bindFiles = files.map(file => {
      if (file.filePath.startsWith(`${topology.name}/`)) {
        file.filePath = file.filePath.substring(topology.name.length + 1);
      }
      return file;
    });

    void topologyStore.uploadArchiveFiles(topology.id, bindFiles);
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
        selectionKeys={props.selectedId}
        nodeTemplate={node => (
          <ExplorerTreeNode
            node={node as ExplorerTreeNodeData}
            onEditCollection={onEditCollection}
            onDeleteCollection={onDeleteCollection}
            onAddTopology={onAddTopology}
            onEditTopology={onEditTopology}
            onDuplicateTopology={onDuplicateTopology}
            onDeployTopology={props.onTopologyDeploy}
            onDeleteTopology={onDeleteTopology}
            onAddBindFile={onAddBindFile}
            onEditBindFile={onEditBindFile}
            onEditBindFileDirectory={onEditBindFileDirectory}
            onDeleteBindFileDirectory={onDeleteBindFileDirectory}
            onDeleteBindFile={onDeleteBindFile}
            onArchiveUpload={onArchiveUpload}
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
      <BindFileDirectoryEditDialog
        key={editBindFileDirectoryState.state?.filePath}
        dialogState={editBindFileDirectoryState}
      />
      <ArchiveUploadDialog
        dialogState={archiveUploadState}
        onApply={onArchiveUploadConfirm}
      />
      <SBConfirm />
      <ContextMenu model={contextMenuModel} ref={contextMenuRef} />
      <If condition={authUser.isAdmin}>
        <Button
          outlined
          rounded
          className="sb-topology-explorer-add-collection"
          icon="pi pi-plus"
          onClick={onAddCollection}
          aria-label="Add Group"
        />
      </If>
    </div>
  );
});

export default TopologyExplorer;

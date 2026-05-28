import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';

import {DialogState} from '@sb/lib/utils/hooks';

import {observer} from 'mobx-react-lite';
import React, {useEffect, useState} from 'react';
import {Topology} from '@sb/types/domain/topology';
import {ToggleSet} from '@sb/lib/utils/toggle-set';
import {Choose, If, Otherwise, When} from '@sb/types/control';

import './archive-upload-dialog.sass';
import {Checkbox} from 'primereact/checkbox';

import {ArchiveReader, libarchiveWasm} from 'libarchive-wasm';
import wasmUrl from 'libarchive-wasm/dist/libarchive.wasm?url';
import {ProgressSpinner} from 'primereact/progressspinner';
import {formatBytes} from '@sb/lib/utils/utils';
import {Message} from 'primereact/message';

export interface ArchiveUploadDialogState {
  topology: Topology;
  file: File;
}

interface ArchiveUploadDialogProps {
  dialogState: DialogState<ArchiveUploadDialogState>;
  onApply: (topology: Topology, files: ArchiveUploadFile[]) => void;
}

export interface ArchiveUploadFile {
  filePath: string;
  size: number;
  content: string;
  exists: boolean;
}

export interface ArchiveUploadFileNode {
  file?: ArchiveUploadFile;
  label: string;
  fullPath: string;
  children?: ArchiveUploadFileNode[];
  icon: string;
}

interface FileTreeNodeProps {
  key: number;
  topology: Topology;
  node: ArchiveUploadFileNode;
  level: number;
}

const ArchiveUploadDialog = observer((props: ArchiveUploadDialogProps) => {
  const [isDoneLoading, setDoneLoading] = useState<boolean>(false);
  const [archiveName, setArchiveName] = useState<string>('');
  const [fileNodes, setFileNodes] = useState<ArchiveUploadFileNode[]>([]);

  const [selectedFiles, setSelectedFiles] = useState<
    ToggleSet<ArchiveUploadFile>
  >(new ToggleSet());

  function onSubmit() {
    if (!props.dialogState.state) return;

    props.onApply(props.dialogState.state.topology, [...selectedFiles]);
  }

  useEffect(() => {
    if (!props.dialogState.isOpen) return;
    setDoneLoading(false);
    void readArchive().then(() => setDoneLoading(true));
  }, [props.dialogState.isOpen]);

  async function readArchive() {
    if (!props.dialogState.state) return;

    let reader: ArchiveReader;
    const files: ArchiveUploadFile[] = [];

    try {
      const data = new Int8Array(
        await props.dialogState.state.file.arrayBuffer(),
      );
      const wasmBinary = await fetch(wasmUrl).then(r => r.arrayBuffer());
      const mod = await libarchiveWasm({wasmBinary});
      reader = new ArchiveReader(mod, data);

      for (const entry of reader.entries()) {
        if (entry.getFiletype() !== 'File') continue;
        const pathname = entry.getPathname();

        let actualPath = pathname;
        let exists = false;
        if (
          actualPath.startsWith(`${props.dialogState.state!.topology.name}/`)
        ) {
          actualPath = actualPath.substring(
            props.dialogState.state!.topology.name.length + 1,
          );
        }

        if (
          props.dialogState.state!.topology.bindFiles.find(
            file => file.filePath === actualPath,
          )
        ) {
          exists = true;
        }

        // if (pathname.startsWith(`${props.dialogState.state.topology.name}/`)) {
        //   pathname = pathname.substring(
        //     props.dialogState.state.topology.name.length + 1,
        //   );
        // }
        // const size = entry.getSize();
        // read text contents during iteration — see note below
        // const isText = /\.(txt|md|json|csv|js|ts|html|xml)$/i.test(pathname);

        files.push({
          filePath: pathname,
          size: entry.getSize(),
          content: new TextDecoder().decode(entry.readData()),
          exists: exists,
        });
      }
    } catch (err) {
      console.error('Error reading archive file:', err);
      return;
    }

    const fileNodes = generateFileTree(files);
    setArchiveName(props.dialogState.state.file.name);
    setFileNodes(fileNodes);
    setSelectedFiles(new ToggleSet(files));
  }

  function toggleFileNode(node: ArchiveUploadFileNode, isSelected: boolean) {
    if (node.file) {
      setSelectedFiles(
        selectedFiles =>
          new ToggleSet([
            ...selectedFiles.toggleExplicit(node.file!, isSelected),
          ]),
      );
    } else {
      for (const childNode of node.children!) {
        toggleFileNode(childNode, isSelected);
      }
    }
  }

  function isFileNodeChecked(node: ArchiveUploadFileNode): boolean {
    if (node.file) return selectedFiles.has(node.file);

    for (const childNode of node.children!) {
      if (!isFileNodeChecked(childNode)) return false;
    }

    return true;
  }

  function generateFileTree(
    files: ArchiveUploadFile[],
  ): ArchiveUploadFileNode[] {
    const fileNode: Partial<ArchiveUploadFileNode> = {children: []};

    for (const file of files) {
      const partParts = file.filePath.split('/').filter(Boolean);
      let current = fileNode;

      partParts.forEach((part, i) => {
        const isFile = i === partParts.length - 1;
        let child = current.children!.find(c => c.label === part);

        if (!child) {
          if (isFile) {
            child = {
              icon: 'pi pi-file',
              label: part,
              file: file,
              fullPath: file.filePath,
            };
          } else {
            child = {
              icon: 'pi pi-folder',
              label: part,
              fullPath: file.filePath,
              children: [],
            };
          }

          current.children!.push(child!);
        }

        if (!isFile) current = child!;
      });
    }

    // If there is only one root directory, and it's called like the same as
    // the topology, we want to treat that directory as root.
    if (
      fileNode.children?.length === 1 &&
      fileNode.children[0].fullPath.startsWith(
        `${props.dialogState.state!.topology.name}/`,
      )
    ) {
      return fileNode.children[0].children!;
    }

    return fileNode.children!;
  }

  function getDirectorySize(node: ArchiveUploadFileNode): number {
    if (!node.children) return 0;
    return (
      node.children.length +
      node.children.reduce((acc, child) => acc + getDirectorySize(child), 0)
    );
  }

  function FileTreeNode(props: FileTreeNodeProps) {
    return (
      <div className="sb-archive-upload-dialog-file">
        <div
          className="sb-archive-upload-dialog-file-content"
          style={{marginLeft: `${props.level * 24}px`}}
          onClick={() =>
            toggleFileNode(props.node, !isFileNodeChecked(props.node))
          }
        >
          <Checkbox
            onChange={e => toggleFileNode(props.node, e.target.checked!)}
            checked={isFileNodeChecked(props.node)}
          />
          <i className={props.node.icon} />
          <Choose>
            <When
              condition={
                props.node.fullPath.startsWith(`${props.topology.name}/`) &&
                props.level === 0
              }
            >
              <div>
                <span className="sb-archive-upload-dialog-file-label-prefix">
                  {props.topology.name}/
                </span>
                <span>{props.node.label}</span>
              </div>
            </When>
            <Otherwise>
              <span>{props.node.label}</span>
            </Otherwise>
          </Choose>
          <If condition={props.node.file?.exists}>
            <Message
              className="sb-mini-message"
              severity="error"
              text="File exists"
            />
          </If>
          <div className="flex-grow-1"></div>
          <Choose>
            <When condition={props.node.children?.length}>
              <span>{`${getDirectorySize(props.node)} items`}</span>
            </When>
            <Otherwise>
              <span>{formatBytes(props.node.file!.size)}</span>
            </Otherwise>
          </Choose>
        </div>
        <div className="flex flex-column">
          <If condition={props.node.children}>
            {props.node.children!.map((node, i) => (
              <FileTreeNode
                key={i}
                node={node}
                level={props.level + 1}
                topology={props.topology}
              />
            ))}
          </If>
        </div>
      </div>
    );
  }

  return (
    <SBDialog
      onClose={props.dialogState.close}
      isOpen={props.dialogState.isOpen}
      headerTitle="Upload Bind Files"
      className="sb-archive-upload-dialog"
      submitLabel="Upload"
      headerIcon={<i className="pi pi-upload" />}
      onSubmit={onSubmit}
      canSubmit={selectedFiles.size > 0}
    >
      <If condition={props.dialogState.state}>
        <div className="sb-archive-upload-dialog-title">
          <span>Archive Name:</span>
          <span>{archiveName}</span>
        </div>
        <Choose>
          <When condition={fileNodes.length > 0}>
            <div className="sb-archive-upload-dialog-files">
              {fileNodes.map((node, i) => (
                <FileTreeNode
                  key={i}
                  node={node}
                  level={0}
                  topology={props.dialogState.state!.topology}
                />
              ))}
            </div>
          </When>
          <When condition={!isDoneLoading}>
            <div className="sb-archive-upload-loader">
              <span>Reading Archive...</span>
              <ProgressSpinner />
            </div>
          </When>
          <Otherwise>
            <div className="sb-archive-upload-empty">Archive is empty</div>
          </Otherwise>
        </Choose>
      </If>
    </SBDialog>
  );
});

export default ArchiveUploadDialog;

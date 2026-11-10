import React, {useRef, useState} from 'react';

import {OverlayPanel} from 'primereact/overlaypanel';

import {DocumentFile} from '@sb/lib/editor/document/editor-document';
import {useReturnFocus} from '@sb/lib/utils/hooks';
import {If} from '@sb/types/control';

import './topology-file-switch.sass';

interface TopologyFileSwitchProps {
  // The files of the open document
  files: readonly DocumentFile[];

  // The ID of the shown file
  value: string;
  onChange: (fileId: string) => void;
}

const TopologyFileSwitch = (props: TopologyFileSwitchProps) => {
  const overlayRef = useRef<OverlayPanel>(null);
  const returnFocus = useReturnFocus();
  const [isOpen, setOpen] = useState(false);

  const files = props.files.map(file => ({
    value: file.id,
    label: file.label,
    icon: file.icon,
    fileName: file.fileName,
  }));

  const selectedFile =
    files.find(file => file.value === props.value) ?? files[0];

  function onSelect(file: string) {
    overlayRef.current?.hide();
    props.onChange(file);
  }

  return (
    <>
      <button
        className="sb-topology-file-switch"
        onClick={e => overlayRef.current?.toggle(e)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`${selectedFile.label} file`}
      >
        <span
          className="material-symbols-outlined sb-topology-file-switch-icon"
          aria-hidden="true"
        >
          {selectedFile.icon}
        </span>
        {selectedFile.label}
        <span className="material-symbols-outlined" aria-hidden="true">
          expand_more
        </span>
      </button>
      <OverlayPanel
        ref={overlayRef}
        className="sb-topology-file-switch-panel"
        onShow={() => {
          setOpen(true);
          returnFocus.onShow();
          overlayRef.current
            ?.getElement()
            ?.querySelector<HTMLElement>('[aria-selected="true"]')
            ?.focus();
        }}
        onHide={() => {
          setOpen(false);
          returnFocus.onHide(overlayRef.current?.getElement());
        }}
      >
        <div role="listbox" aria-label="Files">
          {files.map((file, i) => (
            <button
              key={i}
              role="option"
              aria-selected={file.value === props.value}
              className="sb-topology-file-switch-option"
              onClick={() => onSelect(file.value)}
            >
              <span
                className="material-symbols-outlined sb-topology-file-switch-icon"
                aria-hidden="true"
              >
                {file.icon}
              </span>
              <div className="sb-topology-file-switch-option-text">
                <span className="sb-topology-file-switch-option-label">
                  {file.label}
                </span>
                <span className="sb-topology-file-switch-option-file">
                  {file.fileName}
                </span>
              </div>
              <If condition={file.value === props.value}>
                <span
                  className="material-symbols-outlined sb-topology-file-switch-check"
                  aria-hidden="true"
                >
                  check
                </span>
              </If>
            </button>
          ))}
        </div>
      </OverlayPanel>
    </>
  );
};

export default TopologyFileSwitch;

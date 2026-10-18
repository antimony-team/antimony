import React, {useRef, useState} from 'react';

import {OverlayPanel} from 'primereact/overlaypanel';

import {If} from '@sb/types/control';
import {TopologyFileType} from '@sb/types/domain/topology';

import './topology-file-switch.sass';

interface TopologyFileSwitchProps {
  value: TopologyFileType;
  topologyName: string;
  onChange: (file: TopologyFileType) => void;
}

const TopologyFileSwitch = (props: TopologyFileSwitchProps) => {
  const overlayRef = useRef<OverlayPanel>(null);
  const [isOpen, setOpen] = useState(false);

  const files: {
    value: TopologyFileType;
    label: string;
    icon: string;
    fileName: string;
  }[] = [
    {
      value: TopologyFileType.Definition,
      label: 'Topology',
      icon: 'notes',
      fileName: `${props.topologyName}.clab.yml`,
    },
    {
      value: TopologyFileType.Annotations,
      label: 'Annotations',
      icon: 'data_object',
      fileName: `${props.topologyName}.clab.yml.annotations.json`,
    },
  ];

  const selectedFile = files.find(file => file.value === props.value)!;

  function onSelect(file: TopologyFileType) {
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
        aria-label="Open file"
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
          overlayRef.current
            ?.getElement()
            ?.querySelector<HTMLElement>('[aria-selected="true"]')
            ?.focus();
        }}
        onHide={() => setOpen(false)}
      >
        <div role="listbox" aria-label="Topology files">
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

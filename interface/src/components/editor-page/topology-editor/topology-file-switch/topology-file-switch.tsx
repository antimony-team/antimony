import React, {useRef} from 'react';

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
        aria-label="Open file"
      >
        <span className="material-symbols-outlined sb-topology-file-switch-icon">
          {selectedFile.icon}
        </span>
        {selectedFile.label}
        <span className="material-symbols-outlined">expand_more</span>
      </button>
      <OverlayPanel ref={overlayRef} className="sb-topology-file-switch-panel">
        <div role="listbox" aria-label="Topology files">
          {files.map(file => (
            <button
              key={file.value}
              role="option"
              aria-selected={file.value === props.value}
              className="sb-topology-file-switch-option"
              onClick={() => onSelect(file.value)}
            >
              <span className="material-symbols-outlined sb-topology-file-switch-icon">
                {file.icon}
              </span>
              <div className="sb-topology-file-switch-option-text">
                <span>{file.label}</span>
                <span className="sb-topology-file-switch-option-file">
                  {file.fileName}
                </span>
              </div>
              <If condition={file.value === props.value}>
                <span className="material-symbols-outlined sb-topology-file-switch-check">
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

export const topologyStyle = [
  {
    selector: '.topology-node, .drawn-shape', // Group shared styles
    style: {
      'font-family': 'Figtree',
      color: '#42b5ac',
      'text-valign': 'bottom',
      'text-halign': 'center',
    },
  },
  {
    selector: '.topology-node',
    style: {
      height: 64,
      width: 64,
      shape: 'data(shape)',
      'background-opacity': 1,
      'background-clip': 'none',
      'background-image': 'data(image)',
      'background-fit': 'contain',
      'background-color': 'transparent',
      label: 'data(label)',
      'font-size': 12,
      'text-margin-y': 4,
      'text-margin-x': 32,
    },
  },
  {
    selector: '.drawn-shape',
    style: {
      shape: 'roundrectangle',
      'background-opacity': 0,
      'border-color': '#00bcd4',
      'border-width': 2,
      'border-opacity': 1,
      padding: 20,
    },
  },
  {
    selector: '.drawn-shape[label]',
    style: {
      label: 'data(label)',
      'z-index': 9999,
    },
  },
  {
    selector: '.ghost-node',
    style: {
      width: 1,
      height: 1,
      'background-opacity': 0,
      'border-opacity': 0,
      label: '',
      opacity: 0,
      events: 'no',
    },
  },
  {
    selector: '.ghost-edge',
    style: {
      'line-style': 'dashed',
      'line-color': '#aaa',
      width: 2,
    },
  },
  {
    selector: 'edge',
    style: {
      'line-color': '#888',
      'target-arrow-color': '#888',
      'curve-style': 'bezier',
      'control-point-step-size': 40,
      width: 3,
      //interfaces
      'source-label': 'data(sourceLabel)',
      'target-label': 'data(targetLabel)',
      'source-text-rotation': 'autorotate',
      'target-text-rotation': 'autorotate',

      'source-text-offset': 14,
      'target-text-offset': 14,
      'font-family': 'Figtree',
      'font-size': 12,
      color: '#42b5ac',
      'text-outline-width': 0.8,

      'text-background-color': '#888',
      'text-background-opacity': 1,
      'text-background-shape': 'roundrectangle',
      'text-background-padding': 2,
    },
  },
  {
    selector: 'node.compound-close-btn',
    style: {
      shape: 'ellipse',
      width: 20,
      height: 20,
      label: '×',
      'font-size': 14,
      'text-valign': 'center',
      'text-halign': 'center',
      'background-color': '#d9534f',
      color: '#fff',
      'overlay-padding': 0,
      visibility: 'hidden',
      zIndex: 9999,
    },
  },
];

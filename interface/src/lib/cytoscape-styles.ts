export const topologyStyle = [
  // shared label style
  {
    selector: '.topology-node, .drawn-shape',
    style: {
      'font-family': 'Figtree',
      color: '#e0e0e1',
      'text-valign': 'bottom',
      'text-halign': 'center',
    },
  },

  // nodes
  {
    selector: '.topology-node',
    style: {
      height: 64,
      width: 64,
      shape: 'data(shape)',
      'underlay-shape': 'ellipse',
      'underlay-padding': 2,
      'underlay-opacity': 0,
      'underlay-color': '#d8a657',
      'transition-property': 'opacity',
      'transition-duration': '250ms',
      'background-clip': 'none',
      'background-image': 'data(image)',
      'background-fit': 'contain',
      'background-color': '#000000',
      'background-opacity': 0,
      label: 'data(label)',
      'font-size': 12,
      'text-margin-y': 4,
      'text-margin-x': 32,
      'z-index': 0,
      'z-index-compare': 'manual',
    },
  },
  {
    selector: '.topology-node.ready',
    style: {
      'underlay-color': '#80e163',
      'underlay-padding': 6,
      'underlay-opacity': 0.5,
    },
  },

  // groups
  {
    selector: '.drawn-shape',
    style: {
      shape: 'round-rectangle',
      'background-color': '#ffffff',
      'background-opacity': 0.03,
      'border-color': '#ffffff',
      'border-opacity': 0.22,
      'border-width': 1,
      padding: 24,
      color: '#9e9ea0',
      'font-weight': 'bold',
      'font-size': 12,
      'text-margin-y': 8,
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
    selector: '.drawn-shape:selected',
    style: {
      'border-color': '#3fcfad',
      'border-opacity': 1,
      color: '#e0e0e1',
    },
  },

  // helpers
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
      'line-color': '#ffffff',
      'line-opacity': 0.3,
      width: 2,
    },
  },

  // edges
  {
    selector: 'edge',
    style: {
      'line-color': '#ffffff',
      'line-opacity': 0.45,
      'target-arrow-color': '#ffffff',
      'curve-style': 'bezier',
      'control-point-step-size': 40,
      width: 2,
      'source-label': 'data(sourceLabel)',
      'target-label': 'data(targetLabel)',
      'source-text-offset': 14,
      'target-text-offset': 14,
      'z-index': 999999,
      'z-index-compare': 'manual',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': 10,
      color: '#e0e0e1',
      'text-background-color': '#141519',
      'text-background-opacity': 1,
      'text-background-shape': 'round-rectangle',
      'text-background-padding': 3,
      'text-border-width': 1,
      'text-border-color': '#ffffff',
      'text-border-opacity': 0.22,
    },
  },

  // group close button
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
      'background-color': '#ff5c6c',
      color: '#1a0a0c',
      'overlay-padding': 0,
      visibility: 'hidden',
      'z-index': 9999,
    },
  },
];

export const topologyStyle = [
  {
    selector: '.topology-node',
    style: {
      height: 60,
      width: 64,
      shape: 'hexagon',
      'background-fit': 'cover',
      'background-opacity': 1,
      'background-image': 'data(image)',
      'background-color': 'transparent',
      label: 'data(label)',
      font: 'Figtree',
      color: '#42b5ac',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'font-size': 12,
      'text-margin-y': 4,
      'text-margin-x': 32,
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
];

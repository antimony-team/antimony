const GRAPH_BG = '#17171a';

const svgUri = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const STATUS_NONE = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
);

const STATUS_READY = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    `<circle cx="12" cy="12" r="8.5" fill="${GRAPH_BG}"/>` +
    '<circle cx="12" cy="12" r="6" fill="#80e163"/>' +
    '</svg>',
);

const STATUS_PENDING = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="12" fill="#d8a657" fill-opacity="0.25"/>' +
    `<circle cx="12" cy="12" r="8.5" fill="${GRAPH_BG}"/>` +
    '<circle cx="12" cy="12" r="6" fill="#d8a657"/>' +
    '</svg>',
);

function nodeImage(ele: cytoscape.NodeSingular): string {
  const image: string | undefined = ele.data('image');
  if (!image) return STATUS_NONE;
  return ele.hasClass('stopped')
    ? image.replace(/\.svg$/, '-stopped.svg')
    : image;
}

function statusImage(ele: cytoscape.NodeSingular): string {
  if (ele.hasClass('ready')) return STATUS_READY;
  if (
    ele.hasClass('starting') ||
    ele.hasClass('stopping') ||
    ele.hasClass('settling')
  ) {
    return STATUS_PENDING;
  }
  return STATUS_NONE;
}

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
      'transition-property': 'opacity',
      'transition-duration': '250ms',
      'background-opacity': 0,
      'background-color': '#000000',
      'background-clip': ['none', 'none'],
      'background-image': (ele: cytoscape.NodeSingular) => [
        nodeImage(ele),
        statusImage(ele),
      ],
      'background-fit': ['contain', 'none'],
      'background-width': ['auto', 28],
      'background-height': ['auto', 28],
      'background-position-x': ['50%', '100%'],
      'background-position-y': ['50%', '0%'],
      'background-offset-x': [0, 5],
      'background-offset-y': [0, -5],
      'background-image-containment': ['inside', 'over'],
      'background-image-opacity': [1, 1],
      label: 'data(label)',
      'font-size': 12,
      'text-margin-y': 4,
      'text-margin-x': 32,
      'z-index': 0,
      'z-index-compare': 'manual',
    },
  },
  {
    selector: '.topology-node.stopped',
    style: {
      color: '#9e9ea0',
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
      'source-text-offset': 22,
      'target-text-offset': 22,
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

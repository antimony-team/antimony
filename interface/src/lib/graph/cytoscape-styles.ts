import cytoscape from 'cytoscape';

import {ColorScheme} from '@sb/lib/stores/theme-store';

// The colors of the graph for each color scheme. The background is the graph's own, behind the status dots.
const COLORS = {
  dark: {
    background: '#17171a',
    label: '#e0e0e1',
    labelStopped: '#9e9ea0',
    edge: '#ffffff',
    edgeLabel: 'rgba(255, 255, 255, 0.6)',
  },
  light: {
    background: '#c7cbd2',
    label: '#1d1e22',
    labelStopped: '#6b6d72',
    edge: '#000000',
    edgeLabel: 'rgba(0, 0, 0, 0.6)',
  },
};

const svgUri = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const STATUS_NONE = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
);

const statusReady = (background: string) =>
  svgUri(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      `<circle cx="12" cy="12" r="8.5" fill="${background}"/>` +
      '<circle cx="12" cy="12" r="6" fill="#80e163"/>' +
      '</svg>',
  );

const statusPending = (background: string) =>
  svgUri(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="12" fill="#d8a657" fill-opacity="0.25"/>' +
      `<circle cx="12" cy="12" r="8.5" fill="${background}"/>` +
      '<circle cx="12" cy="12" r="6" fill="#d8a657"/>' +
      '</svg>',
  );

const labelOffset = (text?: string) => 12 + (text?.length ?? 0) * 3;

// The margins are set from the angle of a link once it is drawn, see bindEdgeLabelUpdates
const labelMarginX = (ele: cytoscape.EdgeSingular) =>
  ele.data('labelMarginX') ?? 0;
const labelMarginY = (ele: cytoscape.EdgeSingular) =>
  ele.data('labelMarginY') ?? 0;

function nodeImage(ele: cytoscape.NodeSingular): string {
  const image: string | undefined = ele.data('image');
  if (!image) return STATUS_NONE;
  return ele.hasClass('stopped')
    ? image.replace(/\.svg$/, '-stopped.svg')
    : image;
}

function statusImage(
  ele: cytoscape.NodeSingular,
  ready: string,
  pending: string,
): string {
  if (ele.hasClass('ready')) return ready;
  if (
    ele.hasClass('starting') ||
    ele.hasClass('stopping') ||
    ele.hasClass('settling')
  ) {
    return pending;
  }
  return STATUS_NONE;
}

function createTopologyStyle(colors: (typeof COLORS)[ColorScheme]) {
  const ready = statusReady(colors.background);
  const pending = statusPending(colors.background);

  return [
    // shared label style
    {
      selector: '.topology-node',
      style: {
        'font-family': 'Figtree Variable, sans-serif',
        color: colors.label,
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
          statusImage(ele, ready, pending),
        ],
        'background-fit': ['contain', 'none'],
        'background-width': ['auto', 28],
        'background-height': ['auto', 28],
        'background-position-x': ['50%', '100%'],
        'background-position-y': ['50%', '0%'],
        'background-offset-x': [0, 5],
        'background-offset-y': [0, -5],
        'background-image-containment': ['inside', 'over'],
        'bounds-expansion': 6,
        'background-image-opacity': [1, 1],
        label: 'data(label)',
        'text-events': 'yes',
        'font-size': 12,
        // Below the outline of the selection
        'text-margin-y': 9,
        'text-margin-x': 32,
        'z-index': 0,
        'z-index-compare': 'manual',
      },
    },
    // The label is hidden while it is edited in place
    {
      selector: '.topology-node.renaming',
      style: {
        'text-opacity': 0,
      },
    },
    {
      selector: '.topology-node.stopped',
      style: {
        color: colors.labelStopped,
      },
    },

    // No shade while an element is pressed, like the annotations
    {
      selector: ':active',
      style: {
        'overlay-opacity': 0,
      },
    },

    // edges
    {
      selector: 'edge',
      style: {
        'line-color': colors.edge,
        'line-opacity': 0.45,
        'target-arrow-color': colors.edge,
        'curve-style': 'bezier',
        'control-point-step-size': 40,
        width: 2,
        'source-label': 'data(sourceLabel)',
        'target-label': 'data(targetLabel)',
        'text-events': 'yes',
        'source-text-offset': (ele: cytoscape.EdgeSingular) =>
          labelOffset(ele.data('sourceLabel')),
        'target-text-offset': (ele: cytoscape.EdgeSingular) =>
          labelOffset(ele.data('targetLabel')),
        'source-text-rotation': 'autorotate',
        'target-text-rotation': 'autorotate',
        'source-text-margin-x': labelMarginX,
        'source-text-margin-y': labelMarginY,
        'target-text-margin-x': labelMarginX,
        'target-text-margin-y': labelMarginY,
        'font-family': 'JetBrains Mono Variable, monospace',
        'font-size': 10,
        color: colors.edgeLabel,
        'text-background-opacity': 0,
        'text-border-width': 0,
      },
    },
    {
      selector: 'edge.renaming-source',
      style: {
        'source-label': '',
      },
    },
    {
      selector: 'edge.renaming-target',
      style: {
        'target-label': '',
      },
    },
    {
      selector: 'edge[state = "down"]',
      style: {
        'line-color': '#ff5c6c',
        'line-opacity': 0.8,
        'line-style': 'dashed',
        'line-dash-pattern': [6, 4],
        'text-border-color': '#ff5c6c',
        'text-border-opacity': 0.6,
      },
    },
    {
      selector: 'edge[state = "unknown"]',
      style: {
        'line-opacity': 0.2,
      },
    },
  ];
}

export const topologyStyles = {
  dark: createTopologyStyle(COLORS.dark),
  light: createTopologyStyle(COLORS.light),
};

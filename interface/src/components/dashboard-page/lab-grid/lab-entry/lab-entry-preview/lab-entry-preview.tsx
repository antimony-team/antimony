import React, {useMemo} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {readGraphNodes} from '@sb/lib/graph/topology-graph';
import {NodeConnection, RunTopology} from '@sb/types/domain/topology';

import './lab-entry-preview.sass';
import {Choose, Otherwise, When} from '@sb/types/control';

const PREVIEW_WIDTH = 280;
const PREVIEW_HEIGHT = 96;
const PREVIEW_PADDING = 18;

interface Point {
  x: number;
  y: number;
}

interface PreviewLayout {
  nodes: Point[];
  links: [Point, Point][];
  nodeSize: number;
  linkWidth: number;
  linkOpacity: number;
}

interface LabPreviewProps {
  topology: RunTopology;
  className?: string;
}

const LabEntryPreview = observer((props: LabPreviewProps) => {
  const layout = useMemo(() => {
    const positions = readPositions(props.topology);
    return positions
      ? buildLayout(positions, props.topology.connections)
      : null;
  }, [props.topology]);

  return (
    <div className={classNames('sb-lab-preview', props.className)}>
      <Choose>
        <When condition={layout}>
          <svg
            viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
            aria-hidden="true"
          >
            {layout!.links.map(([a, b], index) => (
              <line
                key={index}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={layout!.linkWidth}
                strokeOpacity={layout!.linkOpacity}
              />
            ))}
            {layout!.nodes.map((node, index) => (
              <rect
                key={index}
                x={node.x - layout!.nodeSize / 2}
                y={node.y - layout!.nodeSize / 2}
                width={layout!.nodeSize}
                height={layout!.nodeSize}
                rx={layout!.nodeSize * 0.3}
              />
            ))}
          </svg>
        </When>
        <Otherwise>
          <span className="sb-lab-preview-empty">
            <i className="pi pi-sitemap" />
            No layout saved yet
          </span>
        </Otherwise>
      </Choose>
    </div>
  );
});

function readPositions(topology: RunTopology): Map<string, Point> | null {
  const positions = new Map<string, Point>();

  for (const node of readGraphNodes(topology.definition)) {
    // A partial layout would look broken, so fall back to the placeholder
    if (!node.position) return null;

    positions.set(node.name, node.position);
  }

  return positions.size > 0 ? positions : null;
}

function buildLayout(
  positions: Map<string, Point>,
  connections: NodeConnection[],
): PreviewLayout {
  const points = [...positions.values()];
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const boundsWidth = Math.max(...xs) - minX || 1;
  const boundsHeight = Math.max(...ys) - minY || 1;

  const scale = Math.min(
    (PREVIEW_WIDTH - 2 * PREVIEW_PADDING) / boundsWidth,
    (PREVIEW_HEIGHT - 2 * PREVIEW_PADDING) / boundsHeight,
  );
  const offsetX = (PREVIEW_WIDTH - boundsWidth * scale) / 2 - minX * scale;
  const offsetY = (PREVIEW_HEIGHT - boundsHeight * scale) / 2 - minY * scale;

  const projected = new Map(
    [...positions].map(([name, p]) => [
      name,
      {x: p.x * scale + offsetX, y: p.y * scale + offsetY},
    ]),
  );
  const nodes = [...projected.values()];

  const links = connections.flatMap(connection => {
    const host = projected.get(connection.hostNode);
    const target = projected.get(connection.targetNode);
    return host && target ? [[host, target] as [Point, Point]] : [];
  });

  return {
    nodes,
    links,
    nodeSize: getNodeSize(nodes),
    linkWidth: nodes.length <= 20 ? 1.25 : nodes.length <= 50 ? 0.9 : 0.6,
    linkOpacity: nodes.length <= 20 ? 0.35 : nodes.length <= 50 ? 0.25 : 0.18,
  };
}

function getNodeSize(nodes: Point[]): number {
  if (nodes.length < 2) return 14;

  const nearest = nodes
    .map((a, i) =>
      Math.min(
        ...nodes
          .filter((_, j) => j !== i)
          .map(b => Math.hypot(a.x - b.x, a.y - b.y)),
      ),
    )
    .sort((a, b) => a - b);

  // 20th percentile so a single overlapping pair doesn't shrink everything
  const typical = nearest[Math.floor(nearest.length / 5)];
  return Math.min(14, Math.max(3, typical * 0.6));
}

export default LabEntryPreview;

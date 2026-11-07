import React from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {GraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {graphLinks} from '@sb/lib/graph/topology-graph';
import {pluralize} from '@sb/lib/utils/utils';
import {Choose, When} from '@sb/types/control';
import {Topology} from '@sb/types/domain/topology';

interface TopologyFooterStatsProps {
  topology: Topology | null;
  graphSelection: GraphSelection;
}

/**
 * The counts of the topology at the end of the editor's footer, replaced by a
 * hint while elements are dragged in the graph. It is a component of its own,
 * so a changing hint doesn't render the whole editor again.
 */
const TopologyFooterStats = observer((props: TopologyFooterStatsProps) => {
  return (
    <Choose>
      <When condition={props.graphSelection.dragHint}>
        <span className="sb-topology-editor-footer-hint">
          {props.graphSelection.dragHint?.map((part, index) => (
            <span
              key={index}
              className={classNames({
                'sb-topology-editor-footer-keyword': typeof part !== 'string',
              })}
            >
              {typeof part === 'string' ? part : part.keyword}
            </span>
          ))}
        </span>
      </When>
      <When condition={props.topology}>
        <div className="sb-dot-separated">
          <div>
            {pluralize(
              props.topology!.definition.nodeNames.length,
              'node',
              'nodes',
            )}
          </div>
          <div>
            {pluralize(
              graphLinks(props.topology!.definition).length,
              'link',
              'links',
            )}
          </div>
          <div>
            {pluralize(
              (props.topology!.annotations.freeShapeAnnotations?.length ?? 0) +
                (props.topology!.annotations.freeTextAnnotations?.length ?? 0),
              'annotation',
              'annotations',
            )}
          </div>
        </div>
      </When>
    </Choose>
  );
});

export default TopologyFooterStats;

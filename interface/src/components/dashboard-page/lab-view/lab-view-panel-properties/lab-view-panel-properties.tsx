import React, {useMemo} from 'react';

import dayjs from 'dayjs';
import {useNavigate} from 'react-router';
import {YAMLMap, YAMLSeq} from 'yaml';

import {Button} from 'primereact/button';
import {Tooltip} from 'primereact/tooltip';

import SBCopyableProperty from '@sb/components/common/sb-copyable-property/sb-copyable-property';
import {
  useCollectionStore,
  useServerConfig,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';

import './lab-view-panel-properties.sass';

interface LabDialogPanelProps {
  lab: Lab;
}

const LabViewPanelProperties = (props: LabDialogPanelProps) => {
  const serverConfig = useServerConfig();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();

  const collection = collectionStore.lookup.get(props.lab.collectionId)!;

  const navigate = useNavigate();

  const topologyExists = useMemo(() => {
    return topologyStore.lookup.get(props.lab.topologyId) !== undefined;
  }, [props.lab]);

  function onGotoTopology() {
    void navigate(`/editor?f=${props.lab.topologyId}`);
  }

  function copyLabLink() {
    void navigator.clipboard.writeText(location.href);
  }

  const topologyName = useMemo(() => {
    return props.lab.topologyDefinition.definition.get('name')! as string;
  }, [props.lab.topologyDefinition]);

  const [nodeCount, linkCount] = useMemo(() => {
    const nodes = props.lab.topologyDefinition.definition.getIn([
      'topology',
      'nodes',
    ]);
    const links = props.lab.topologyDefinition.definition.getIn([
      'topology',
      'links',
    ]);

    return [
      nodes instanceof YAMLMap ? nodes.items.length : 0,
      links instanceof YAMLSeq ? links.items.length : 0,
    ];
  }, [props.lab.topologyDefinition]);

  return (
    <>
      <div className="sb-lab-view-properties">
        <dl className="sb-lab-view-properties-table">
          <dt>ID</dt>
          <dd>
            {' '}
            <SBCopyableProperty value={props.lab.id} />
          </dd>

          <dt>Instance</dt>
          <dd>
            <Choose>
              <When condition={props.lab.instance}>
                <SBCopyableProperty value={props.lab.instance!.name} />
              </When>
              <Otherwise>N/A</Otherwise>
            </Choose>
          </dd>

          <dt>Collection</dt>
          <dd>{collection!.name}</dd>

          <dt>Deployed</dt>
          <dd>
            {dayjs(props.lab.instance?.deployed).format('D MMM YYYY, HH:mm')}
            <If condition={props.lab.instance?.isRecovered}>
              <span
                data-pr-tooltip="This instance has been recovered after Antimony was restarted"
                data-pr-position="right"
                data-pr-my="left+5data-bind center"
                className="lab-props-italic"
              >
                {' '}
                (Recovered)
              </span>
            </If>
          </dd>

          <dt>Running Until</dt>
          <dd>
            <Choose>
              <When condition={props.lab.endTime === null}>Indefinitely</When>
              <Otherwise>
                {dayjs(props.lab.endTime).format('D MMM YYYY, HH:mm')}
              </Otherwise>
            </Choose>
          </dd>

          <dt>Owner</dt>
          <dd>{props.lab.creator.name}</dd>

          <dt>Provider</dt>
          <dd>{serverConfig.deployment.provider}</dd>

          <dt>Topology</dt>
          <dd className="lab-props-facts">
            <a
              href={`/#/editor?f=${props.lab.topologyId}`}
              className="lab-props-link"
            >
              {topologyName}
            </a>
            <span>
              <i className="pi pi-circle" aria-hidden="true" />
              {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
            </span>
            <span>
              <i className="pi pi-arrows-h" aria-hidden="true" />
              {linkCount} {linkCount === 1 ? 'link' : 'links'}
            </span>
          </dd>
        </dl>
        <div className="sb-lab-view-properties-footer">
          <Button
            outlined
            icon="pi pi-copy"
            label="Copy Link"
            onClick={copyLabLink}
            aria-label="Copy Link"
            disabled={!topologyExists}
          />
          <Button
            outlined
            icon={
              <span className="material-symbols-outlined">network_node</span>
            }
            label="Open Topology"
            onClick={onGotoTopology}
            aria-label="Open Topology"
            disabled={!topologyExists}
          />
        </div>
      </div>
      <Tooltip target=".lab-dialog-tooltip-target" />
    </>
  );
};

export default LabViewPanelProperties;

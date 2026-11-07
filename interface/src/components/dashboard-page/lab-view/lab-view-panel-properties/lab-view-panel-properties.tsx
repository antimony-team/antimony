import React, {useMemo} from 'react';

import {useNavigate} from 'react-router';

import {Button} from 'primereact/button';
import {Tooltip} from 'primereact/tooltip';

import SBCopyableProperty from '@sb/components/common/sb-copyable-property/sb-copyable-property';
import {
  useCollectionStore,
  useDataBinder,
  useServerConfig,
} from '@sb/lib/stores/root-store';
import {formatDateTime} from '@sb/lib/utils/utils';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {Lab} from '@sb/types/domain/lab';

import './lab-view-panel-properties.sass';

interface LabDialogPanelProps {
  lab: Lab;
}

const LabViewPanelProperties = (props: LabDialogPanelProps) => {
  const serverConfig = useServerConfig();
  const collectionStore = useCollectionStore();
  const dataBinder = useDataBinder();

  const collection = collectionStore.lookup.get(props.lab.collectionId)!;

  const navigate = useNavigate();

  function onGotoTopology() {
    void navigate(`/editor?f=${props.lab.topologyId}`);
  }

  function copyLabLink() {
    void navigator.clipboard.writeText(location.href);
  }

  const topologyName = useMemo(() => {
    return props.lab.topologyDefinition.definition.name ?? '';
  }, [props.lab.topologyDefinition]);

  const [nodeCount, linkCount] = useMemo(() => {
    const {definition} = props.lab.topologyDefinition;
    return [definition.nodeNames.length, definition.links.length];
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
            <Choose>
              <When condition={props.lab.instance}>
                {formatDateTime(props.lab.instance!.deployed)}
              </When>
              <Otherwise>N/A</Otherwise>
            </Choose>
            <If condition={props.lab.instance?.isRecovered}>
              <span
                data-pr-tooltip="This instance has been recovered after Antimony was restarted"
                data-pr-position="right"
                data-pr-my="left+5 center"
                className="lab-props-italic lab-dialog-tooltip-target"
              >
                {' '}
                (Recovered)
              </span>
            </If>
          </dd>

          <dt>Running until</dt>
          <dd>
            <Choose>
              <When condition={props.lab.endTime === null}>Indefinitely</When>
              <Otherwise>{formatDateTime(props.lab.endTime!)}</Otherwise>
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
          {/* A link to the desktop app's local server can't be shared */}
          <If condition={!dataBinder.isDesktop}>
            <Button
              outlined
              icon="pi pi-copy"
              label="Copy link"
              onClick={copyLabLink}
              aria-label="Copy link"
              disabled={!props.lab.topologyId}
            />
          </If>
          <Button
            outlined
            icon={
              <span className="material-symbols-outlined">network_node</span>
            }
            label="Open topology"
            onClick={onGotoTopology}
            aria-label="Open topology"
            disabled={!props.lab.topologyId}
          />
        </div>
      </div>
      <Tooltip target=".lab-dialog-tooltip-target" />
    </>
  );
};

export default LabViewPanelProperties;

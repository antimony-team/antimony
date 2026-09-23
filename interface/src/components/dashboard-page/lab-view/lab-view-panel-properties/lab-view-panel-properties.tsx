import {
  useCollectionStore,
  useServerConfig,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {Lab} from '@sb/types/domain/lab';
import dayjs from 'dayjs';

import React, {useMemo} from 'react';
import {useNavigate} from 'react-router';
import './lab-view-panel-properties.sass';
import SBCopyableProperty from '@sb/components/common/sb-copyable-property/sb-copyable-property';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {Button} from 'primereact/button';
import {Tooltip} from 'primereact/tooltip';
import {YAMLMap, YAMLSeq} from 'yaml';

interface LabDialogPanelProps {
  lab: Lab;
}

const LabViewPanelProperties = (props: LabDialogPanelProps) => {
  const serverConfig = useServerConfig();
  const topologyStore = useTopologyStore();
  const collectionStore = useCollectionStore();

  const topology = topologyStore.lookup.get(props.lab.topologyId)!;
  const collection = collectionStore.lookup.get(props.lab.collectionId)!;

  const navigate = useNavigate();

  function onGotoTopology() {
    void navigate(`/editor?f=${topology?.id}`);
  }

  function copyLabLink() {
    void navigator.clipboard.writeText(location.href);
  }

  const [nodeCount, linkCount] = useMemo(() => {
    const nodes = topology.definition.getIn(['topology', 'nodes']);
    const links = topology.definition.getIn(['topology', 'links']);

    return [
      nodes instanceof YAMLMap ? nodes.items.length : 0,
      links instanceof YAMLSeq ? links.items.length : 0,
    ];
  }, [topology.definition]);

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
            <If condition={props.lab.instance!.isRecovered}>
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
              href={`/editor/${props.lab.topologyId}`}
              className="lab-props-link"
            >
              {topology?.name}
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
          />
          <Button
            outlined
            icon={
              <span className="material-symbols-outlined">network_node</span>
            }
            label="Open Topology"
            onClick={onGotoTopology}
            aria-label="Open Topology"
          />
        </div>
      </div>
      {/*  <div className="flex align-items-center gap-1">*/}
      {/*    <span className="property-title">ID:</span>*/}
      {/*    <span*/}
      {/*      className="property-value copyable lab-dialog-tooltip-target"*/}
      {/*      data-pr-tooltip="Copy to clipboard"*/}
      {/*      data-pr-position="right"*/}
      {/*      data-pr-my="left+10 center"*/}
      {/*      onClick={() => {*/}
      {/*        void navigator.clipboard.writeText(props.lab.id);*/}
      {/*      }}*/}
      {/*    >*/}
      {/*      {props.lab.id}*/}
      {/*    </span>*/}
      {/*  </div>*/}
      {/*  <If condition={props.lab.instance}>*/}
      {/*    <div className="flex align-items-center gap-1">*/}
      {/*      <span className="property-title">Instance:</span>*/}
      {/*      <span className="property-value">{props.lab.instance!.name}</span>*/}
      {/*    </div>*/}
      {/*  </If>*/}
      {/*  <div className="flex align-items-center gap-1">*/}
      {/*    <span className="property-title">Name:</span>*/}
      {/*    <span className="property-value">{props.lab.name}</span>*/}
      {/*  </div>*/}
      {/*  <div className="flex align-items-center gap-1">*/}
      {/*    <span className="property-title">Collection:</span>*/}
      {/*    <span className="property-value">{collection?.name}</span>*/}
      {/*  </div>*/}
      {/*  <div className="flex align-items-center gap-1">*/}
      {/*    <span className="property-title">Owner:</span>*/}
      {/*    <span className="property-value">{props.lab.creator.name}</span>*/}
      {/*  </div>*/}
      {/*  <If condition={props.lab.instance}>*/}
      {/*    <div className="flex align-items-center gap-1">*/}
      {/*      <span className="property-title">Deployed:</span>*/}
      {/*      <span className="property-value">*/}
      {/*        {dayjs(props.lab.instance!.deployed).format('DD/MM/YYYY HH:mm')}*/}
      {/*      </span>*/}
      {/*      <If condition={props.lab.instance!.isRecovered}>*/}
      {/*        <span*/}
      {/*          data-pr-tooltip="This instance has been recovered after Antimony was restarted"*/}
      {/*          data-pr-position="right"*/}
      {/*          data-pr-my="left+5data-bind center"*/}
      {/*          className="property-value lab-dialog-tooltip-target"*/}
      {/*        >*/}
      {/*          (Recovered)*/}
      {/*        </span>*/}
      {/*      </If>*/}
      {/*    </div>*/}
      {/*  </If>*/}
      {/*  <If condition={props.lab.instance}>*/}
      {/*    <div className="flex align-items-center gap-1">*/}
      {/*      <span className="property-title">Running Until:</span>*/}
      {/*      <span className="property-value">*/}
      {/*        <Choose>*/}
      {/*          <When condition={props.lab.endTime === null}>Indefinitely</When>*/}
      {/*          <Otherwise>*/}
      {/*            {dayjs(props.lab.endTime).format('DD/MM/YYYY HH:mm')}*/}
      {/*          </Otherwise>*/}
      {/*        </Choose>*/}
      {/*      </span>*/}
      {/*    </div>*/}
      {/*  </If>*/}
      {/*  <div className="flex align-items-center gap-1">*/}
      {/*    <span className="property-title">Topology:</span>*/}
      {/*    <span className="property-value">{topology?.name}</span>*/}
      {/*    <Button*/}
      {/*      text*/}
      {/*      className="topology-reference"*/}
      {/*      icon="pi pi-external-link"*/}
      {/*      tooltip="Go to topology"*/}
      {/*      onClick={onGotoTopology}*/}
      {/*    />*/}
      {/*  </div>*/}
      {/*</div>*/}
      <Tooltip target=".lab-dialog-tooltip-target" />
    </>
  );
};

export default LabViewPanelProperties;

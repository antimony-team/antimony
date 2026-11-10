import React from 'react';

import dayjs from 'dayjs';
import {observer} from 'mobx-react-lite';
import {useNavigate} from 'react-router';

import {Button} from 'primereact/button';

import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';
import LabEntryPreview from '@sb/components/dashboard-page/lab-grid/lab-entry/lab-entry-preview/lab-entry-preview';
import {
  useAuthUser,
  useClock,
  useCollectionStore,
  useEditorTabStore,
  useLabStore,
  useTopologyStore,
} from '@sb/lib/stores/root-store';
import {formatUptime} from '@sb/lib/utils/utils';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {Collection} from '@sb/types/domain/collection';
import {InstanceState, Lab} from '@sb/types/domain/lab';

import './collection-overview.sass';

interface CollectionOverviewProps {
  collectionId: string;

  onEdit: (collection: Collection) => void;
  onAddTopology: (collectionId: string) => void;
}

const CollectionOverview = observer((props: CollectionOverviewProps) => {
  const authUser = useAuthUser();
  const collectionStore = useCollectionStore();
  const topologyStore = useTopologyStore();
  const labStore = useLabStore();
  const tabStore = useEditorTabStore();
  const navigate = useNavigate();
  const clock = useClock();

  const collection = collectionStore.lookup.get(props.collectionId);
  if (!collection) return null;

  const topologies = topologyStore.data
    .filter(topology => topology.collectionId === collection.id)
    .sort((a, b) =>
      (a.definition.name ?? '').localeCompare(b.definition.name ?? ''),
    );
  const runningLabs = labStore.data.filter(
    lab =>
      lab.collectionId === collection.id && lab.state === InstanceState.Running,
  );

  const canAddTopology = collectionStore.canWriteIn(collection.id);

  function runningCount(topologyId: string) {
    return runningLabs.filter(lab => lab.topologyId === topologyId).length;
  }

  function role(): string {
    if (collection!.creator.id === authUser.id) return 'Owner';
    if (authUser.isAdmin) return 'Admin';
    if (collectionStore.canWriteIn(collection!.id)) return 'Can edit';
    if (collectionStore.canDeployIn(collection!.id)) return 'Can deploy';
    return 'Can view';
  }

  function showOnDashboard() {
    labStore.setCollectionFilter([collection!.id]);
    void navigate('/');
  }

  function openLab(lab: Lab) {
    void navigate(`/?l=${lab.id}`);
  }

  const addTopologyButton = (
    <Button
      icon="pi pi-plus"
      label="New topology"
      className="sb-button-accent"
      onClick={() => props.onAddTopology(collection.id)}
    />
  );

  return (
    <div className="sb-collection-overview">
      <header className="sb-collection-overview-header">
        <div className="sb-collection-overview-label">
          <span className="material-symbols-outlined" aria-hidden="true">
            inventory_2
          </span>
          <h1 className="sb-collection-overview-title">{collection.name}</h1>
          <span className="sb-collection-overview-subtitle">
            {topologies.length === 1
              ? '1 topology'
              : `${topologies.length} topologies`}
          </span>
          <span className="sb-collection-overview-count">{role()}</span>
        </div>
        <If condition={authUser.isAdmin}>
          <Button
            outlined
            icon="pi pi-pencil"
            label="Edit"
            onClick={() => props.onEdit(collection)}
          />
        </If>
        <If condition={canAddTopology}>{addTopologyButton}</If>
      </header>

      <div className="sb-collection-overview-body">
        <section aria-labelledby="sb-collection-topologies">
          <div className="sb-collection-overview-section-header">
            <h2 id="sb-collection-topologies">Topologies</h2>
            <span className="sb-collection-overview-count">
              {topologies.length}
            </span>
          </div>
          <Choose>
            <When condition={topologies.length > 0}>
              <ul className="sb-collection-overview-topologies">
                {topologies.map(topology => {
                  const running = runningCount(topology.id);
                  const nodes = topology.definition.nodeNames.length;
                  return (
                    <li key={topology.id}>
                      <button
                        className="sb-collection-overview-card"
                        onClick={() => tabStore.open(topology.id)}
                      >
                        <LabEntryPreview
                          topology={topology}
                          className={running > 0 ? 'running' : undefined}
                        />
                        <span className="sb-collection-overview-card-content">
                          <span className="sb-collection-overview-card-header">
                            <span className="sb-collection-overview-card-name">
                              {topology.definition.name}
                            </span>
                            <span className="sb-collection-overview-card-nodes">
                              {nodes === 1 ? '1 node' : `${nodes} nodes`}
                            </span>
                          </span>
                          <span className="sb-collection-overview-card-footer">
                            <Choose>
                              <When condition={running > 0}>
                                <span
                                  className="sb-collection-overview-dot"
                                  aria-hidden="true"
                                />
                                {running === 1
                                  ? '1 lab running'
                                  : `${running} labs running`}
                              </When>
                              <Otherwise>Not deployed</Otherwise>
                            </Choose>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </When>
            <Otherwise>
              <SBEmptyState
                title="No topologies yet"
                text={`Create the first topology in this collection. Everyone with access to ${collection.name} will see it.`}
                icon={
                  <span className="material-symbols-outlined">
                    network_node
                  </span>
                }
              >
                <If condition={canAddTopology}>{addTopologyButton}</If>
              </SBEmptyState>
            </Otherwise>
          </Choose>
        </section>

        <section aria-labelledby="sb-collection-labs">
          <div className="sb-collection-overview-section-header">
            <h2 id="sb-collection-labs">Running labs</h2>
            <span className="sb-collection-overview-count">
              {runningLabs.length}
            </span>
            <span className="sb-collection-overview-line" />
            <Button
              text
              size="small"
              label="View on dashboard"
              onClick={showOnDashboard}
            />
          </div>
          <Choose>
            <When condition={runningLabs.length > 0}>
              <ul className="sb-collection-overview-labs">
                {runningLabs.map(lab => (
                  <li key={lab.id}>
                    <button onClick={() => openLab(lab)}>
                      <span
                        className="sb-collection-overview-dot"
                        aria-hidden="true"
                      />
                      <span className="sb-collection-overview-lab">
                        <span>{lab.name}</span>
                        <span className="sb-collection-overview-lab-meta">
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                          >
                            network_node
                          </span>
                          {lab.topologyId
                            ? (topologyStore.lookup.get(lab.topologyId)
                                ?.definition.name ?? '')
                            : ''}
                          <i className="pi pi-user" aria-hidden="true" />
                          {lab.creator.name}
                        </span>
                      </span>
                      <If condition={lab.instance}>
                        <span className="sb-collection-overview-uptime">
                          up{' '}
                          {formatUptime(
                            lab.instance!.deployed,
                            dayjs(clock.now),
                          )}
                        </span>
                      </If>
                    </button>
                  </li>
                ))}
              </ul>
            </When>
            <Otherwise>
              <p className="sb-collection-overview-none">
                No labs of this collection are running.
              </p>
            </Otherwise>
          </Choose>
        </section>
      </div>
    </div>
  );
});

export default CollectionOverview;

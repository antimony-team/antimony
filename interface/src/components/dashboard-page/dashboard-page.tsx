import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import LabEntry from '@sb/components/dashboard-page/lab-entry/lab-entry';

import './dashboard-page.sass';

import {
  useCollectionStore,
  useLabStore,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {Choose, Otherwise, When} from '@sb/types/control';
import {InstanceState, InstanceStates, Lab} from '@sb/types/domain/lab';
import classNames from 'classnames';

import {observer} from 'mobx-react-lite';
import {IconField} from 'primereact/iconfield';
import {InputIcon} from 'primereact/inputicon';
import {InputText} from 'primereact/inputtext';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router';
import LabView from '@sb/components/dashboard-page/lab-view/lab-view';
import {Splitter, SplitterPanel} from 'primereact/splitter';
import {Button} from 'primereact/button';
import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';

const stateOrder: Record<InstanceState, number> = {
  [InstanceState.Running]: 0,
  [InstanceState.Deploying]: 1,
  [InstanceState.Stopping]: 2,
  [InstanceState.Scheduled]: 3,
  [InstanceState.Failed]: 4,
  [InstanceState.Inactive]: 5,
};

const labGroups = [
  {
    label: 'Active',
    icon: 'pi pi-wave-pulse',
    color: 'var(--success-color-text)',
    states: [
      InstanceState.Deploying,
      InstanceState.Running,
      InstanceState.Stopping,
      InstanceState.Failed,
    ],
  },
  {
    label: 'Scheduled',
    icon: 'pi pi-clock',
    color: 'var(--scheduled-color)',
    states: [InstanceState.Scheduled],
  },
  {
    label: 'Inactive',
    icon: 'pi pi-moon',
    color: 'var(--text-faint)',
    states: [InstanceState.Inactive],
  },
];

const DashboardPage = observer(() => {
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);

  const labEditDialogState = useDialogState<LabEditDialogState>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | undefined>(undefined);
  const searchQueryFieldRef = useRef<HTMLInputElement>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const [openLab, setOpenLab] = useState<Lab | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const labStore = useLabStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const navigate = useNavigate();

  useEffect(() => {
    if (searchQueryFieldRef.current && labStore.searchQuery === '') {
      searchQueryFieldRef.current.value = '';
    }
  }, [labStore.searchQuery]);

  useEffect(() => {
    if (searchParams.has('l') && labStore.lookup.has(searchParams.get('l')!)) {
      const openLab = labStore.lookup.get(searchParams.get('l')!)!;
      setOpenLab(openLab);
      document.title = `Antimony | ${openLab.name}`;
    } else {
      setOpenLab(null);
      document.title = 'Antimony | Dashboard';
    }
  }, [labStore.lookup, searchParams]);

  function handleSearchChange(value: string) {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      labStore.setSearchQuery(value);
    }, 100);
  }

  function onCloseLabView() {
    setSearchParams('');
  }

  function onOpenLabView(lab: Lab) {
    setSearchParams({l: lab.id});
  }

  function onDestroyLabRequest(lab: Lab) {
    notificationStore.confirm({
      header: `Destroy Lab '${lab.name}'?`,
      icon: 'pi pi-power-off',
      severity: 'danger',
      onAccept: () => labStore.destroyLab(lab),
    });
  }

  const [stateFilter, setStateFilter] = useState<Set<InstanceState>>(new Set());

  const filteredLabs = useMemo(() => {
    return labStore.data
      .filter(
        lab =>
          (collectionFilter === null ||
            lab.collectionId === collectionFilter) &&
          !stateFilter.has(lab.state),
      )
      .sort(
        (a, b) =>
          stateOrder[a.state] - stateOrder[b.state] ||
          a.name.localeCompare(b.name, undefined, {numeric: true}),
      );
  }, [collectionStore.data, labStore.data, collectionFilter, stateFilter]);

  const [collectionLabCounts, collectionLabStateCounts] = useMemo(() => {
    const labCounts: {[collectionId: string]: number} = {};
    const stateCounts: {[collectionId: string]: {[state: string]: number}} = {};

    labStore.data.forEach(lab => {
      if (lab.collectionId in labCounts) {
        labCounts[lab.collectionId]++;
      } else {
        labCounts[lab.collectionId] = 1;
      }

      if (!(lab.collectionId in stateCounts)) {
        stateCounts[lab.collectionId] = {};
      }

      const state = InstanceState[lab.state].toLowerCase();
      if (state in stateCounts[lab.collectionId]) {
        stateCounts[lab.collectionId][state]++;
      } else {
        stateCounts[lab.collectionId][state] = 1;
      }
    });
    return [labCounts, stateCounts];
  }, [labStore.data]);

  function toggleStateFilter(state: InstanceState) {
    if (stateFilter.has(state)) {
      stateFilter.delete(state);
    } else {
      stateFilter.add(state);
    }

    setStateFilter(new Set(stateFilter));
  }

  function toggleGroup(label: string) {
    if (collapsed.has(label)) {
      collapsed.delete(label);
    } else {
      collapsed.add(label);
    }
    setCollapsed(new Set(collapsed));
  }

  return (
    <div className="sb-dashboard">
      <Splitter>
        <SplitterPanel
          className="sb-dashboard-explorer sb-island"
          minSize={15}
          size={1}
        >
          <IconField iconPosition="left">
            <InputIcon className="pi pi-search" />
            <InputText
              ref={searchQueryFieldRef}
              className="width-100"
              placeholder="Search labs"
              onChange={e => handleSearchChange(e.target.value)}
            />
          </IconField>
          <a
            className={classNames('sb-dashboard-explorer-item', {
              selected: collectionFilter === null,
            })}
            onClick={() => setCollectionFilter(null)}
          >
            <span className="material-symbols-outlined">stacks</span>
            <span className="sb-explorer-item-label">All labs</span>
            <span className="sb-explorer-item-count">
              {collectionStore.data.length}
            </span>
          </a>
          <span className="sb-dashboard-explorer-title">Collections</span>
          {collectionStore.data.map((collection, i) => (
            <a
              key={i}
              className={classNames('sb-dashboard-explorer-item', {
                selected: collectionFilter === collection.id,
              })}
              onClick={() => setCollectionFilter(collection.id)}
            >
              <i className="pi pi-folder"></i>
              <span className="sb-explorer-item-label">{collection.name}</span>
              <div className="sb-explorer-item-count">
                <div className="sb-explorer-item-dots">
                  {Object.keys(
                    collectionLabStateCounts[collection.id] ?? {},
                  ).map((state, i) => (
                    <span key={i} className={`sb-explorer-item-dot ${state}`} />
                  ))}
                </div>
                <span className="sb-explorer-item-count">
                  {collectionLabCounts[collection.id] ?? 0}
                </span>
              </div>
            </a>
          ))}
        </SplitterPanel>
        <SplitterPanel
          className="sb-dashboard-container sb-island"
          minSize={60}
        >
          <div className="sb-dashboard-container-header">
            <div className="flex-grow-1">
              <span className="sb-dashboard-container-header-title">
                {collectionFilter
                  ? collectionStore.lookup.get(collectionFilter)!.name
                  : 'All labs'}
              </span>
              <span className="sb-dashboard-container-header-subtitle">
                {collectionFilter
                  ? collectionLabCounts[collectionFilter]
                  : labStore.data.length}
              </span>
            </div>
            <div className="sb-dashboard-filter-chips">
              {InstanceStates.map((state, i) => (
                <div
                  key={i}
                  className={classNames('sb-dashboard-filter-chip', {
                    selected: !stateFilter.has(state),
                  })}
                  onClick={() => toggleStateFilter(state)}
                >
                  <span
                    key={i}
                    className={`dot ${InstanceState[state].toLowerCase()}`}
                  />
                  {InstanceState[state]}
                </div>
              ))}
            </div>
            <Button
              className="sb-button-accent"
              icon="pi pi-plus"
              label="New lab"
              onClick={() =>
                labEditDialogState.openWith({
                  editingLab: null,
                  action: DialogAction.Add,
                })
              }
            />
          </div>
          <div className="sb-dashboard-container-content" ref={containerRef}>
            <Choose>
              <When condition={filteredLabs.length > 0}>
                <div className="sb-dashboard-lab-groups">
                  {labGroups.map(group => {
                    const labs = filteredLabs.filter(lab =>
                      group.states.includes(lab.state),
                    );
                    if (!labs.length) return null;

                    const isCollapsed = collapsed.has(group.label);

                    return (
                      <section
                        key={group.label}
                        className={classNames('sb-dashboard-lab-group', {
                          collapsed: isCollapsed,
                        })}
                      >
                        <button
                          className="sb-dashboard-lab-group-header"
                          aria-expanded={!isCollapsed}
                          onClick={() => toggleGroup(group.label)}
                        >
                          <i className="pi pi-chevron-down sb-dashboard-lab-group-chevron" />
                          <i
                            className={group.icon}
                            style={{color: group.color}}
                          />
                          <span>{group.label}</span>
                          <span className="sb-dashboard-lab-group-count">
                            {labs.length}
                          </span>
                        </button>
                        <div
                          className="sb-dashboard-lab-group-body"
                          inert={isCollapsed}
                        >
                          <div className="sb-dashboard-lab-group-inner">
                            <div className="sb-dashboard-lab-grid">
                              {labs.map(lab => (
                                <LabEntry
                                  key={lab.id}
                                  lab={lab}
                                  onOpenLab={() => onOpenLabView(lab)}
                                  onRescheduleLab={() =>
                                    labEditDialogState.openWith({
                                      editingLab: lab,
                                      action: DialogAction.Edit,
                                    })
                                  }
                                  onDestroyLabRequest={() =>
                                    onDestroyLabRequest(lab)
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </When>
              <Otherwise>
                <Choose>
                  <When condition={labStore.data.length === 0}>
                    <SBEmptyState
                      icon={
                        <span className="material-symbols-outlined">
                          network_node
                        </span>
                      }
                      accent
                      title="Deploy your first lab"
                      text="A lab is a running copy of a topology. Build one in the editor, then deploy it here."
                    >
                      <Button
                        outlined
                        label="Open topology editor"
                        onClick={() => navigate('/editor')}
                      />
                    </SBEmptyState>
                  </When>
                  <When
                    condition={
                      collectionFilter !== null &&
                      !collectionLabCounts[collectionFilter] &&
                      labStore.searchQuery === ''
                    }
                  >
                    <SBEmptyState
                      icon="pi pi-folder"
                      title={`No labs in ${collectionStore.lookup.get(collectionFilter!)?.name} yet`}
                      text="Deploy one of this collection's topologies to start a lab."
                    >
                      <Button
                        outlined
                        icon="pi pi-plus"
                        label="New lab"
                        onClick={() => {
                          labEditDialogState.openWith({
                            editingLab: null,
                            action: DialogAction.Add,
                          });
                        }}
                      />
                    </SBEmptyState>
                  </When>
                  <When condition={stateFilter.size > 0}>
                    <SBEmptyState
                      icon="pi pi-filter"
                      title="All labs are filtered out"
                      text="The state filters above hide every lab in this view."
                    >
                      <Button
                        outlined
                        label="Show all states"
                        onClick={() => setStateFilter(new Set())}
                      />
                    </SBEmptyState>
                  </When>
                  <Otherwise>
                    <SBEmptyState
                      icon="pi pi-search"
                      title={`No labs match "${labStore.searchQuery}"`}
                      text="Check the spelling or search for part of the name."
                    >
                      <Button
                        outlined
                        label="Clear search"
                        onClick={() => labStore.setSearchQuery('')}
                      />
                    </SBEmptyState>
                  </Otherwise>
                </Choose>
              </Otherwise>
            </Choose>
          </div>
        </SplitterPanel>
      </Splitter>
      <LabView
        lab={openLab}
        onClose={onCloseLabView}
        onDestroyLabRequest={onDestroyLabRequest}
      />
      <LabEditDialog dialogState={labEditDialogState} />
    </div>
  );
});

export default DashboardPage;

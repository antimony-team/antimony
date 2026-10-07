import React, {useMemo, useRef, useState} from 'react';
import {useCollectionStore, useLabStore} from '@sb/lib/stores/root-store';
import {InstanceState, InstanceStates, Lab} from '@sb/types/domain/lab';
import {oneOf, setOf, usePersistentState} from '@sb/lib/utils/persistent-state';
import {useNavigate, useSearchParams} from 'react-router';
import classNames from 'classnames';
import {Button} from 'primereact/button';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {LabEditDialogState} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import {Choose, Otherwise, When} from '@sb/types/control';
import LabEntry from '@sb/components/dashboard-page/lab-grid/lab-entry/lab-entry';
import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';

import './lab-grid.sass';

interface LabGridProps {
  collectionFilter: string | null;
  collectionLabCounts: Record<string, number>;

  labEditDialogState: DialogState<LabEditDialogState>;

  onDestroyLab: (lab: Lab) => void;
}

const LabGrid = (props: LabGridProps) => {
  const labStore = useLabStore();
  const collectionStore = useCollectionStore();

  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const [stateFilter, setStateFilter] = useState<Set<InstanceState>>(new Set());

  const [collapsed, setCollapsed] = usePersistentState<Set<string>>(
    'lab-grid-collapsed-groups',
    new Set(['Inactive']),
    setOf(oneOf('Active', 'Inactive', 'Archived')),
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const filteredLabs = useMemo(() => {
    return labStore.data
      .filter(
        lab =>
          (props.collectionFilter === null ||
            lab.collectionId === props.collectionFilter) &&
          !stateFilter.has(lab.state),
      )
      .sort(
        (a, b) =>
          stateOrder[a.state] - stateOrder[b.state] ||
          a.name.localeCompare(b.name, undefined, {numeric: true}),
      );
  }, [
    collectionStore.data,
    labStore.data,
    props.collectionFilter,
    stateFilter,
  ]);

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

  function onOpenLabView(lab: Lab) {
    setSearchParams({l: lab.id});
  }

  const EmptyStateNoCollections = () => (
    <SBEmptyState
      icon={<span className="material-symbols-outlined">network_node</span>}
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
  );

  const EmptyStateNoLabsInCollection = () => (
    <SBEmptyState
      icon="pi pi-folder"
      title={`No labs in ${collectionStore.lookup.get(props.collectionFilter!)?.name} yet`}
      text="Deploy one of this collection's topologies to start a lab."
    >
      <Button
        outlined
        icon="pi pi-plus"
        label="New lab"
        onClick={() => {
          props.labEditDialogState.openWith({
            editingLab: null,
            action: DialogAction.Add,
          });
        }}
      />
    </SBEmptyState>
  );

  const EmptyStateNoFilterResults = () => (
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
  );

  const EmptyStateNoSearchResults = () => (
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
  );

  return (
    <>
      <div className="sb-lab-grid-header">
        <div className="flex-grow-1 flex-shrink-0">
          <span className="sb-lab-grid-header-title">
            {props.collectionFilter
              ? collectionStore.lookup.get(props.collectionFilter)!.name
              : 'All labs'}
          </span>
          <span className="sb-lab-grid-header-subtitle">
            {props.collectionFilter
              ? props.collectionLabCounts[props.collectionFilter]
              : labStore.data.length}
          </span>
        </div>
        <div className="sb-lab-grid-filter-chips">
          {InstanceStates.map((state, i) => (
            <div
              key={i}
              className={classNames('sb-lab-grid-filter-chip', {
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
            props.labEditDialogState.openWith({
              editingLab: null,
              action: DialogAction.Add,
            })
          }
        />
      </div>
      <div className="sb-lab-grid-content" ref={containerRef}>
        <Choose>
          <When condition={filteredLabs.length > 0}>
            <div className="sb-lab-grid-groups">
              {labGroups.map(group => {
                const labs = filteredLabs.filter(lab =>
                  group.states.includes(lab.state),
                );
                if (!labs.length) return null;

                const isCollapsed = collapsed.has(group.label);

                return (
                  <section
                    key={group.label}
                    className={classNames('sb-lab-grid-group', {
                      collapsed: isCollapsed,
                    })}
                  >
                    <button
                      className="sb-lab-grid-group-header"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleGroup(group.label)}
                    >
                      <i className="pi pi-chevron-down sb-lab-grid-group-chevron" />
                      <i className={group.icon} style={{color: group.color}} />
                      <span>{group.label}</span>
                      <span className="sb-lab-grid-group-count">
                        {labs.length}
                      </span>
                    </button>
                    <div className="sb-lab-grid-group-body" inert={isCollapsed}>
                      <div className="sb-lab-grid-group-inner">
                        <div className="sb-lab-grid-grid">
                          {labs.map(lab => (
                            <LabEntry
                              key={lab.id}
                              lab={lab}
                              onOpenLab={() => onOpenLabView(lab)}
                              onRescheduleLab={() =>
                                props.labEditDialogState.openWith({
                                  editingLab: lab,
                                  action: DialogAction.Edit,
                                })
                              }
                              onDestroyLab={() => props.onDestroyLab(lab)}
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
                <EmptyStateNoCollections />
              </When>
              <When
                condition={
                  props.collectionFilter !== null &&
                  !props.collectionLabCounts[props.collectionFilter] &&
                  labStore.searchQuery === ''
                }
              >
                <EmptyStateNoLabsInCollection />
              </When>
              <When condition={stateFilter.size > 0}>
                <EmptyStateNoFilterResults />
              </When>
              <Otherwise>
                <EmptyStateNoSearchResults />
              </Otherwise>
            </Choose>
          </Otherwise>
        </Choose>
      </div>
    </>
  );
};

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

export default LabGrid;

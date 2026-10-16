import React, {MouseEvent, useMemo, useRef, useState} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {useNavigate, useSearchParams} from 'react-router';

import {Button} from 'primereact/button';
import {MenuItem} from 'primereact/menuitem';

import {LabEditDialogState} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import SBContextMenu, {
  SBContextMenuRef,
} from '@sb/components/common/sb-context-menu/sb-context-menu';
import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';
import LabEntry from '@sb/components/dashboard-page/lab-grid/lab-entry/lab-entry';
import {useCollectionStore, useLabStore} from '@sb/lib/stores/root-store';
import {DialogAction, DialogState} from '@sb/lib/utils/hooks';
import {oneOf, setOf, usePersistentState} from '@sb/lib/utils/persistent-state';
import {matchesSearch} from '@sb/lib/utils/utils';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {InstanceState, InstanceStates, Lab} from '@sb/types/domain/lab';

import './lab-grid.sass';

interface LabGridProps {
  collectionFilter: string | null;
  collectionLabCounts: Record<string, number>;

  labEditDialogState: DialogState<LabEditDialogState>;

  onDestroyLab: (lab: Lab) => void;
  onDeleteLab: (lab: Lab) => void;
}

const LabGrid = (props: LabGridProps) => {
  const labStore = useLabStore();
  const collectionStore = useCollectionStore();

  // In the selected collection, or in any collection when all labs are shown
  const canCreateLab = props.collectionFilter
    ? collectionStore.canDeployIn(props.collectionFilter)
    : collectionStore.hasDeployableCollections;

  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const [stateFilter, setStateFilter] = useState<Set<InstanceState>>(new Set());

  const [collapsed, setCollapsed] = usePersistentState<Set<string>>(
    'lab-grid-collapsed-groups',
    new Set(['Inactive']),
    setOf(oneOf('Active', 'Scheduled', 'Inactive')),
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const [contextMenuModel, setContextMenuModel] = useState<MenuItem[]>();
  const contextMenuRef = useRef<SBContextMenuRef | null>(null);
  const contextMenuTarget = useRef<string | null>(null);

  const filteredLabs = useMemo(() => {
    return labStore.data
      .filter(
        lab =>
          (props.collectionFilter === null ||
            lab.collectionId === props.collectionFilter) &&
          !stateFilter.has(lab.state) &&
          matchesLabSearch(lab, labStore.searchQuery),
      )
      .sort(
        (a, b) =>
          stateOrder[a.state] - stateOrder[b.state] ||
          a.name.localeCompare(b.name, undefined, {numeric: true}),
      );
  }, [
    collectionStore.data,
    labStore.data,
    labStore.searchQuery,
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

  function onEditLab(lab: Lab) {
    props.labEditDialogState.openWith({
      editingLab: lab,
      action: DialogAction.Edit,
    });
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>, lab: Lab) {
    e.preventDefault();

    const contextMenuEntries = getLabContextMenu(lab);

    if (contextMenuEntries.length > 0) {
      setContextMenuModel(contextMenuEntries);
      contextMenuTarget.current = lab.id;
      contextMenuRef!.current!.show(e);
    }
  }

  const onDeployLabContext = () => {
    if (!contextMenuTarget.current) return;
    void labStore.deployLab(labStore.lookup.get(contextMenuTarget.current)!);
  };

  const onDestroyLabContext = () => {
    if (!contextMenuTarget.current) return;
    props.onDestroyLab(labStore.lookup.get(contextMenuTarget.current)!);
  };

  const onEditLabContext = () => {
    if (!contextMenuTarget.current) return;
    onEditLab(labStore.lookup.get(contextMenuTarget.current)!);
  };

  const onDeleteLabContext = () => {
    if (!contextMenuTarget.current) return;
    props.onDeleteLab(labStore.lookup.get(contextMenuTarget.current)!);
  };

  function getLabContextMenu(lab: Lab) {
    if (!labStore.canControl(lab)) return [];

    const controlEntries: MenuItem[] = [];
    const editEntries: MenuItem[] = [];

    if (labStore.canDeploy(lab)) {
      controlEntries.push({
        id: 'deploy',
        label: 'Deploy',
        icon: 'pi pi-play',
        className: 'sb-menuitem-success',
        command: onDeployLabContext,
      });
    }

    if (labStore.canRedeploy(lab)) {
      controlEntries.push({
        id: 'redeploy',
        label: 'Redeploy',
        icon: 'pi pi-sync',
        command: onDeployLabContext,
      });
    }

    if (labStore.canDestroy(lab)) {
      controlEntries.push({
        id: 'destroy',
        label: 'Destroy',
        icon: 'pi pi-power-off',
        className: 'sb-menuitem-danger',
        command: onDestroyLabContext,
      });
    }

    if (labStore.canEdit(lab)) {
      editEntries.push({
        id: 'edit',
        label: 'Edit',
        icon: <span className="material-symbols-outlined">edit_square</span>,
        command: onEditLabContext,
      });
    }

    if (labStore.canDelete(lab)) {
      editEntries.push({
        id: 'delete',
        label: 'Delete',
        icon: 'pi pi-trash',
        className: 'sb-menuitem-danger',
        command: onDeleteLabContext,
      });
    }

    if (controlEntries.length > 0 && editEntries.length > 0) {
      return [...controlEntries, {separator: true}, ...editEntries];
    }

    return [...controlEntries, ...editEntries];
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
      <If condition={canCreateLab}>
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
      </If>
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
        <If condition={canCreateLab}>
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
        </If>
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
                        <div className="sb-lab-grid-container">
                          {labs.map(lab => (
                            <LabEntry
                              key={lab.id}
                              lab={lab}
                              onOpenLab={() => onOpenLabView(lab)}
                              onRescheduleLab={() => onEditLab(lab)}
                              onDestroyLab={() => props.onDestroyLab(lab)}
                              onDeleteLab={() => props.onDeleteLab(lab)}
                              onContextMenu={e => onContextMenu(e, lab)}
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
      <SBContextMenu model={contextMenuModel} ref={contextMenuRef} />
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

// The search finds labs by their name, their topology's name or their creator's name
function matchesLabSearch(lab: Lab, search: string) {
  return (
    search === '' ||
    [
      lab.name,
      lab.topologyDefinition.definition.name ?? '',
      lab.creator.name,
    ].some(value => matchesSearch(value, search))
  );
}

// An observer, so it updates while the user types into the search
export default observer(LabGrid);

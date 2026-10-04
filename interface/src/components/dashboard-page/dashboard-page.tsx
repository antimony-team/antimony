import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import LabEntry from '@sb/components/dashboard-page/lab-entry/lab-entry';
import LabFilterOverlay from '@sb/components/dashboard-page/lab-filter-overlay/lab-filter-overlay';

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
import {Chip} from 'primereact/chip';
import {IconField} from 'primereact/iconfield';
import {Image} from 'primereact/image';
import {InputIcon} from 'primereact/inputicon';
import {InputText} from 'primereact/inputtext';
import {OverlayPanel} from 'primereact/overlaypanel';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useSearchParams} from 'react-router';
import LabView from '@sb/components/dashboard-page/lab-view/lab-view';
import {Splitter, SplitterPanel} from 'primereact/splitter';

const DashboardPage = observer(() => {
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);

  const labEditDialogState = useDialogState<LabEditDialogState>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const labFilterOverlay = useRef<OverlayPanel>(null);
  const typingTimeoutRef = useRef<number | undefined>(undefined);
  const searchQueryFieldRef = useRef<HTMLInputElement>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const [openLab, setOpenLab] = useState<Lab | null>(null);

  const labStore = useLabStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

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

  const filteredCollections = useMemo(() => {
    return labStore.data.filter(
      lab => collectionFilter === null || lab.collectionId === collectionFilter,
    );
  }, [collectionStore.data, labStore.data, collectionFilter]);

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
  }, [filteredCollections]);

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
                  {Object.keys(collectionLabStateCounts[collection.id]).map(
                    (state, i) => (
                      <span
                        key={i}
                        className={`sb-explorer-item-dot ${state}`}
                      />
                    ),
                  )}
                </div>
                <span className="sb-explorer-item-count">
                  {collectionLabCounts[collection.id] ?? 0}
                </span>
              </div>
              {/*<span className="sb-explorer-item-count">*/}
              {/*  {collectionLabCounts[collection.id] ?? 0}*/}
              {/*</span>*/}
            </a>
          ))}
        </SplitterPanel>
        <SplitterPanel
          className="sb-dashboard-container sb-island"
          minSize={60}
        >
          <div className="sb-dashboard-filter">
            {/*<div style={{display: 'flex', margin: '0 16px', gap: '5px'}}>*/}
            <div className="sb-dashboard-filter-chips">
              {InstanceStates.map((state, i) => (
                <div
                  key={i}
                  className={classNames('fake-state-filter-chip', {
                    hidden: !labStore.stateFilter.includes(state),
                  })}
                >
                  {InstanceState[state]}
                  <i
                    className="pi pi-times-circle"
                    role="button"
                    aria-label={`Remove ${InstanceState[state]} Filter`}
                    onClick={() => labStore.toggleState(state)}
                  ></i>
                </div>
              ))}
              {labStore.collectionFilter.map((collectionId, i) => {
                return (
                  <Chip
                    key={i}
                    label={collectionStore.lookup.get(collectionId)!.name}
                    removable={true}
                    onRemove={() => {
                      labStore.toggleCollection(collectionId);
                      return true;
                    }}
                    className="state-filter-chip"
                  />
                );
              })}
            </div>
            <div className="sb-dashboard-filter-search">
              <IconField
                className="sb-dashboard-filter-search-field"
                iconPosition="right"
              >
                <InputText
                  ref={searchQueryFieldRef}
                  className="width-100"
                  placeholder="Search"
                  onChange={e => handleSearchChange(e.target.value)}
                />
                <InputIcon className="pi pi-search" />
              </IconField>
              <span
                className="search-bar-icon"
                role="button"
                aria-label="Filter Labs"
                onClick={e => labFilterOverlay.current?.toggle(e)}
              >
                <i className="pi pi-filter" />
              </span>
            </div>
          </div>
          <div className="sb-dashboard-content" ref={containerRef}>
            <Choose>
              <When condition={filteredCollections.length > 0}>
                {filteredCollections.map((lab, i) => (
                  <LabEntry
                    key={i}
                    lab={lab}
                    onOpenLab={() => onOpenLabView(lab)}
                    onRescheduleLab={() =>
                      labEditDialogState.openWith({
                        editingLab: lab,
                        action: DialogAction.Edit,
                      })
                    }
                    onDestroyLabRequest={() => onDestroyLabRequest(lab)}
                  />
                ))}
              </When>
              <Otherwise>
                <div className="sb-dashboard-empty">
                  <Image src="/icons/no-results.png" width="200px" />
                  <span>No labs found :(</span>
                </div>
              </Otherwise>
            </Choose>
          </div>
        </SplitterPanel>
      </Splitter>
      <LabView
        lab={openLab}
        onClose={onCloseLabView}
        // dialogState={onCloseLabView}
        onDestroyLabRequest={onDestroyLabRequest}
      />
      <LabFilterOverlay popOverRef={labFilterOverlay} />
      <LabEditDialog dialogState={labEditDialogState} />
    </div>
  );
});

export default DashboardPage;

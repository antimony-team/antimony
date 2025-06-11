import useResizeObserver from '@react-hook/resize-observer';
import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import LabDialog from '@sb/components/dashboard-page/lab-dialog/lab-dialog';
import LabEntry from '@sb/components/dashboard-page/lab-entry/lab-entry';
import LabFilterOverlay from '@sb/components/dashboard-page/lab-filter-overlay/lab-filter-overlay';

import './dashboard-page.sass';

import {
  useCollectionStore,
  useLabStore,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {DialogAction, useDialogState} from '@sb/lib/utils/hooks';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {InstanceState, InstanceStates, Lab} from '@sb/types/domain/lab';
import {FetchState} from '@sb/types/types';
import classNames from 'classnames';

import {observer} from 'mobx-react-lite';
import {Chip} from 'primereact/chip';
import {IconField} from 'primereact/iconfield';
import {Image} from 'primereact/image';
import {InputIcon} from 'primereact/inputicon';
import {InputText} from 'primereact/inputtext';
import {OverlayPanel} from 'primereact/overlaypanel';
import {Paginator} from 'primereact/paginator';
import React, {
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {useSearchParams} from 'react-router';

const DashboardPage: React.FC = observer(() => {
  const [currentPage, setCurrentPage] = useState<number>(0);

  const labDialogState = useDialogState<Lab>(
    null,
    onCloseLabDialog,
    onOpenLabDialog
  );

  const labEditDialogState = useDialogState<LabEditDialogState>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const labFilterOverlay = useRef<OverlayPanel>(null);
  const typingTimeoutRef = useRef<number | undefined>(undefined);
  const searchQueryFieldRef = useRef<HTMLInputElement>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const labStore = useLabStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();
  const calculatePageSize = useCallback(() => {
    if (!containerRef.current) return;

    const {height} = containerRef.current.getBoundingClientRect();
    const adjustedHeight = height - 68;
    const pageSize = Math.floor(adjustedHeight / 80);
    labStore.setLimit(pageSize);
    labStore.setOffset(pageSize * currentPage);
  }, [currentPage, labStore]);

  useEffect(() => {
    if (searchQueryFieldRef.current && labStore.searchQuery === '') {
      searchQueryFieldRef.current.value = '';
    }
  }, [labStore.searchQuery]);

  useResizeObserver(containerRef, () => {
    calculatePageSize();
  });

  useEffect(() => {
    // If the lab dialog is open during refresh, refresh lab too
    if (labDialogState.state && labDialogState.isOpen) {
      if (labStore.lookup.has(labDialogState.state.id)) {
        labDialogState.openWith(labStore.lookup.get(labDialogState.state.id)!);
      }
    }
  }, [labStore.data]);

  useEffect(() => {
    calculatePageSize();
  }, [calculatePageSize, labStore.totalEntries]);

  useEffect(() => {
    if (
      labDialogState.state === null &&
      searchParams.has('l') &&
      labStore.lookup.has(searchParams.get('l')!)
    ) {
      labDialogState.openWith(labStore.lookup.get(searchParams.get('l')!)!);
    }
  }, [labStore.lookup, searchParams, setSearchParams]);

  function handleSearchChange(value: string) {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      labStore.setSearchQuery(value);
    }, 100);
  }

  function onCloseLabDialog() {
    setSearchParams('');
  }

  function onOpenLabDialog(lab: Lab | null) {
    if (!lab) return;
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

  if (labStore.fetchReport.state !== FetchState.Done) {
    return <></>;
  }

  return (
    <>
      <div className="height-100 width-100 sb-card overflow-y-hidden overflow-x-hidden sb-labs-container">
        <div className="sb-dashboard-search-bar sb-card">
          <IconField
            className="sb-dashboard-search-bar-input"
            iconPosition="right"
          >
            <InputText
              ref={searchQueryFieldRef as unknown as RefObject<InputText>}
              className="width-100"
              placeholder="Search"
              onChange={e => handleSearchChange(e.target.value)}
            />
            <InputIcon className="pi pi-search" />
          </IconField>
          <span
            className="search-bar-icon"
            onClick={e => labFilterOverlay.current?.toggle(e)}
          >
            <i className="pi pi-filter" />
          </span>
        </div>
        <div style={{display: 'flex', margin: '0 16px', gap: '5px'}}>
          {InstanceStates.map((state, i) => (
            <Chip
              key={i}
              label={InstanceState[state]}
              removable={true}
              onRemove={() => {
                labStore.toggleState(state);
                return true;
              }}
              className={classNames('active-filter-chip', 'state-filter-chip', {
                hidden: !labStore.stateFilter.includes(state),
              })}
            />
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

          <If condition={labStore.searchQuery !== ''}>
            <Chip
              label={`Query: ${labStore.searchQuery}`}
              removable={true}
              onRemove={() => {
                labStore.setSearchQuery('');
                return true;
              }}
              className="state-filter-chip"
            />
          </If>
        </div>
        <div className="sb-dashboard-content" ref={containerRef}>
          <Choose>
            <When condition={labStore.data!.length > 0}>
              {labStore.data!.map((lab, i) => (
                <LabEntry
                  key={i}
                  lab={lab}
                  onOpenLab={() => labDialogState.openWith(lab)}
                  onRescheduleLab={() =>
                    labEditDialogState.openWith({
                      editingLab: lab,
                      topologyId: lab.topologyId,
                      action: DialogAction.Edit,
                    })
                  }
                  onDestroyLabRequest={() => onDestroyLabRequest(lab)}
                />
              ))}
            </When>
            <Otherwise>
              <div className="sb-dashboard-empty">
                <Image src="/assets/icons/no-results.png" width="200px" />
                <span>No labs found :(</span>
              </div>
            </Otherwise>
          </Choose>
          <div className="sb-dashboard-pagination-controls">
            <Paginator
              first={currentPage * labStore.limit}
              rows={labStore.limit}
              totalRecords={labStore.totalEntries ?? 0}
              onPageChange={e => setCurrentPage(e.page)}
            />
          </div>
        </div>
      </div>
      <LabFilterOverlay popOverRef={labFilterOverlay} />
      <LabDialog
        dialogState={labDialogState}
        onDestroyLabRequest={onDestroyLabRequest}
      />
      <LabEditDialog dialogState={labEditDialogState} />
    </>
  );
});

export default DashboardPage;

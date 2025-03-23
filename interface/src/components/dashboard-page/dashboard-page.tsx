import useResizeObserver from '@react-hook/resize-observer';
import LabDialog from '@sb/components/dashboard-page/lab-dialog/lab-dialog';
import LabFilterDialog from '@sb/components/dashboard-page/lab-filter-dialog/lab-filter-dialog';
import ReservationDialog from '@sb/components/dashboard-page/reservation-dialog/reservation-dialog';

import './dashboard-page.sass';

import {
  useCollectionStore,
  useLabStore,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import {InstanceState, Lab} from '@sb/types/domain/lab';
import {FetchState} from '@sb/types/types';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {Chip} from 'primereact/chip';
import {IconField} from 'primereact/iconfield';
import {Image} from 'primereact/image';
import {InputIcon} from 'primereact/inputicon';
import {InputText} from 'primereact/inputtext';
import {OverlayPanel} from 'primereact/overlaypanel';
import {Paginator} from 'primereact/paginator';
import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {useSearchParams} from 'react-router';

const statusIcons: Record<InstanceState, string> = {
  [InstanceState.Scheduled]: 'pi pi-calendar',
  [InstanceState.Deploying]: 'pi pi-sync pi-spin',
  [InstanceState.Stopping]: 'pi pi-sync pi-times',
  [InstanceState.Running]: 'pi pi-check',
  [InstanceState.Failed]: 'pi pi-times',
  [InstanceState.Done]: 'pi pi-check',
};

const DashboardPage: React.FC = observer(() => {
  const [selectedLab, setSelectedLab] = useState<Lab | null>(null);
  const [isLabDialogOpen, setLabDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [reschedulingDialogLab, setReschedulingDialogLab] =
    useState<Lab | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const popOver = useRef<OverlayPanel>(null);
  const typingTimeoutRef = useRef<number | undefined>(undefined);

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

  useResizeObserver(containerRef, () => {
    calculatePageSize();
  });

  useEffect(() => {
    calculatePageSize();
  }, [calculatePageSize, labStore.totalEntries]);

  useEffect(() => {
    if (
      selectedLab === null &&
      searchParams.has('l') &&
      labStore.lookup.has(searchParams.get('l')!)
    ) {
      setSelectedLab(labStore.lookup.get(searchParams.get('l')!)!);
      setLabDialogOpen(true);
    }
  }, [labStore.lookup, searchParams, setSearchParams]);

  const handleSearchChange = (value: string) => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      labStore.setSearchQuery(value);
    }, 100);
  };

  function handleLabDate(lab: Lab): string {
    let timeString: Date;

    console.log('DATE: ', lab);

    if (lab.instance === null) {
      // timeString = new Date(lab.startDate);
      timeString = new Date();
      return timeString.toISOString().split('T')[0];
    }

    switch (lab.instance.state) {
      case InstanceState.Deploying:
      case InstanceState.Running:
        timeString = new Date(lab.startTime);
        return timeString.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      case InstanceState.Done:
      case InstanceState.Stopping:
      case InstanceState.Failed:
        timeString = new Date(lab.endTime);
        return timeString.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      default:
        return '';
    }
  }

  function onRescheduleLab(event: MouseEvent<HTMLButtonElement>, lab: Lab) {
    event.stopPropagation();
    setReschedulingDialogLab(lab);
  }

  function onStopLab(event: MouseEvent<HTMLButtonElement>, lab: Lab) {
    event.stopPropagation();
    notificationStore.confirm({
      message: 'This action cannot be undone.',
      header: `Stop Lab '${lab.name}'?`,
      icon: 'pi pi-stop',
      severity: 'danger',
      onAccept: onStopConfirm,
    });
  }

  function onStopConfirm() {}

  function closeDialog() {
    setSearchParams('');
    setLabDialogOpen(false);
  }

  function openLabDialog(lab: Lab) {
    setSelectedLab(lab);
    setLabDialogOpen(true);
    setSearchParams({l: lab.id});
  }

  function closeReschedulingDialog() {
    setReschedulingDialogLab(null);
  }

  if (labStore.fetchReport.state !== FetchState.Done) {
    return <></>;
  }

  const getStateClasses = (lab: Lab) => ({
    scheduled: lab.instance === null,
    running: lab.instance?.state === InstanceState.Running,
    deploying: lab.instance?.state === InstanceState.Deploying,
    done: lab.instance?.state === InstanceState.Done,
    failed: lab.instance?.state === InstanceState.Failed,
  });

  return (
    <div className="height-100 width-100 sb-card overflow-y-hidden overflow-x-hidden sb-labs-container">
      <div className="search-bar sb-card">
        <IconField className="search-bar-input" iconPosition="right">
          <InputText
            className="width-100"
            placeholder="Search"
            onChange={e => handleSearchChange(e.target.value)}
          />
          <InputIcon className="pi pi-search" />
        </IconField>
        <span
          className="search-bar-icon"
          onClick={e => popOver.current?.toggle(e)}
        >
          <i className="pi pi-filter" />
        </span>
        <LabFilterDialog popOverRef={popOver} />
      </div>
      <div style={{display: 'flex', margin: '0 16px', gap: '5px'}}>
        {labStore.stateFilter.map((state, index) => (
          <Chip
            key={index}
            label={InstanceState[state]}
            removable={true}
            onRemove={() => labStore.toggleStateFilter(state)}
            className="chip"
          />
        ))}
        {labStore.collectionFilter.map((groupId, index) => {
          return (
            <Chip
              key={index}
              label={collectionStore.lookup.get(groupId)?.name ?? 'unknown'}
              removable={true}
              onRemove={() => labStore.toggleGroupFilter(groupId)}
              className="chip"
            />
          );
        })}

        <If condition={labStore.searchQuery !== ''}>
          <Chip
            label={`Query: ${labStore.searchQuery}`}
            removable={true}
            onRemove={() => labStore.setSearchQuery('')}
            className="chip"
          />
        </If>
      </div>
      <div className="sb-labs-content" ref={containerRef}>
        <Choose>
          <When condition={labStore.data!.length > 0}>
            <div className="lab-explorer-container">
              {labStore.data!.map(lab => (
                <div
                  key={lab.id}
                  className="lab-item-card"
                  onClick={() => openLabDialog(lab)}
                >
                  <div
                    className="lab-group sb-corner-tab"
                    onClick={() => openLabDialog(lab)}
                  >
                    <span>
                      {collectionStore.lookup.get(lab.collectionId)?.name ??
                        'unknown'}
                    </span>
                  </div>
                  <div className="lab-name">
                    <span>{lab.name}</span>
                  </div>
                  <div
                    className={classNames('lab-state', getStateClasses(lab))}
                  >
                    <div className="lab-state-buttons">
                      <If condition={lab.instance === null}>
                        <Button
                          icon="pi pi-calendar"
                          severity="info"
                          rounded
                          text
                          size="large"
                          tooltip="Reschedule"
                          tooltipOptions={{
                            position: 'bottom',
                            showDelay: 200,
                          }}
                          onClick={e => onRescheduleLab(e, lab)}
                          aria-label="Reschedule"
                        />
                      </If>
                      <Button
                        icon="pi pi-stop"
                        severity="danger"
                        rounded
                        text
                        size="large"
                        tooltip="Stop"
                        tooltipOptions={{
                          position: 'bottom',
                          showDelay: 200,
                        }}
                        onClick={e => onStopLab(e, lab)}
                        aria-label="Stop Lab"
                      />
                    </div>
                    <span className="lab-state-label">
                      <div
                        className={classNames(
                          'lab-state-label-icon',
                          getStateClasses(lab)
                        )}
                      >
                        <i
                          className={
                            statusIcons[
                              lab.instance?.state ?? InstanceState.Scheduled
                            ]
                          }
                        ></i>
                        <span>{InstanceState[lab.instance?.state ?? -1]}</span>
                      </div>
                      <div className="lab-state-date">
                        <i className="pi pi-clock"></i>
                        <span>{handleLabDate(lab)}</span>
                      </div>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <If condition={reschedulingDialogLab !== null}>
              <ReservationDialog
                lab={reschedulingDialogLab!}
                onClose={closeReschedulingDialog}
              />
            </If>
            <LabDialog
              isOpen={isLabDialogOpen}
              lab={selectedLab}
              closeDialog={closeDialog}
            />
          </When>
          <Otherwise>
            <div className="sb-dashboard-empty">
              <Image src="/assets/icons/no-results.png" width="200px" />
              <span>No labs found :(</span>
            </div>
          </Otherwise>
        </Choose>
        <div className="pagination-controls">
          <Paginator
            first={currentPage * labStore.limit}
            rows={labStore.limit}
            totalRecords={labStore.totalEntries ?? 0}
            onPageChange={e => setCurrentPage(e.page)}
          />
        </div>
      </div>
    </div>
  );
});

export default DashboardPage;

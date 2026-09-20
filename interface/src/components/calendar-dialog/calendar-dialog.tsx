import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import {
  DialogAction,
  useDialogState,
  useScopedLabStore,
} from '@sb/lib/utils/hooks';

import {InstanceState, Lab} from '@sb/types/domain/lab';

import {uuid4} from '@sb/types/types';
import {observer} from 'mobx-react-lite';

import moment from 'moment';
import React, {useEffect, useMemo, useState} from 'react';
import {Calendar, momentLocalizer, View, Views} from 'react-big-calendar';
import './calendar-dialog.sass';

const localizer = momentLocalizer(moment);

interface CalendarDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const CalendarDialog = observer((props: CalendarDialogProps) => {
  const labEditDialogState = useDialogState<LabEditDialogState>(null);

  function onLabClick(lab: Lab) {
    labEditDialogState.openWith({
      editingLab: lab!,
      topologyId: lab!.topologyId,
      action: DialogAction.Edit,
    });
  }

  return (
    <SBDialog
      className="calender-dialog"
      headerTitle="Lab Schedule"
      isOpen={props.isOpen}
      onClose={props.onClose}
      hideButtons={true}
    >
      <CalendarDialogContent onLabClick={onLabClick} />
      <LabEditDialog dialogState={labEditDialogState} />
    </SBDialog>
  );
});

interface CalendarDialogContentProps {
  onLabClick: (lab: Lab) => void;
}

const CalendarDialogContent = observer((props: CalendarDialogContentProps) => {
  const [currentView, setCurrentView] = useState<View>('month');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  const labStore = useScopedLabStore();

  function CustomEvent({event}: CustomEventProps) {
    return (
      <div style={{display: 'flex', alignItems: 'center'}}>
        <span style={{flexGrow: 1}}>{event.title}</span>
        {event.state === InstanceState.Scheduled && (
          <i
            className="pi pi-pen-to-square"
            style={{marginLeft: '8px', color: 'white', cursor: 'pointer'}}
            title="Edit Event"
          />
        )}
      </div>
    );
  }

  const events = useMemo(
    () =>
      labStore.data
        .filter(lab => lab.endTime !== null)
        .map(lab => ({
          title: lab.name,
          id: lab.id,
          state: lab.instance?.state ?? InstanceState.Scheduled,
          start: new Date(lab.startTime),
          end: new Date(lab.endTime!),
        })),
    [labStore.data],
  );

  useEffect(() => {
    labStore.setDates(
      moment(currentDate).startOf('month').toISOString(),
      moment(currentDate).endOf('month').toISOString(),
    );
    labStore.setLimit(1000);
    labStore.setStateFilter([
      InstanceState.Deploying,
      InstanceState.Inactive,
      InstanceState.Failed,
      InstanceState.Running,
      InstanceState.Stopping,
      InstanceState.Scheduled,
    ]);
  }, []);

  function onRangeChange(range: Date[] | {start: Date; end: Date}) {
    if (Array.isArray(range)) {
      labStore.setDates(
        range[0].toISOString(),
        range[range.length - 1].toISOString(),
      );
    } else {
      labStore.setDates(range.start.toISOString(), range.end.toISOString());
    }
  }

  function onEventSelect(event: CalendarEvent) {
    if (event.state === InstanceState.Scheduled) {
      const lab: Lab | undefined = labStore.data.find(
        lab => lab.id === event.id,
      );
      props.onLabClick(lab!);
    } else {
      return;
    }
  }

  function eventStyleGenerator(event: CalendarEvent) {
    return {
      style: {
        backgroundColor: StateEventColors[event.state],
        borderRadius: '5px',
        color: 'white',
        border: 'none',
        display: 'block',
      },
    };
  }

  return (
    <div className="calendar-container">
      <Calendar
        popup
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        view={currentView}
        defaultView="month"
        views={[Views.MONTH, Views.WEEK, Views.AGENDA]}
        toolbar={true}
        date={currentDate}
        onView={view => setCurrentView(view)}
        onNavigate={date => setCurrentDate(date)}
        eventPropGetter={eventStyleGenerator}
        onRangeChange={onRangeChange}
        onSelectEvent={onEventSelect}
        onDrillDown={date => {
          setCurrentView('week');
          setCurrentDate(date);
        }}
        onShowMore={events => {
          setCurrentDate(events[0].start);
          setCurrentView('week');
        }}
        components={{
          event: CustomEvent,
        }}
      />
    </div>
  );
});

interface CalendarEvent {
  title: string;
  id: uuid4;
  state: InstanceState;
  start: Date;
  end: Date;
}

interface CustomEventProps {
  event: CalendarEvent;
}

const StateEventColors: {[key: number]: string} = {
  0: 'var(--info-color)',
  1: 'var(--warning-color)',
  2: 'var(--success-color)',
  3: 'var(--danger-color)',
  4: 'var(--neutral-color)',
};

export default CalendarDialog;

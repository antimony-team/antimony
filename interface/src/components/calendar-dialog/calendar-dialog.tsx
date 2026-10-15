import React, {useEffect, useMemo, useState} from 'react';

import {observer} from 'mobx-react-lite';
import moment from 'moment';
import {Calendar, momentLocalizer, View, Views} from 'react-big-calendar';

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
      action: DialogAction.Edit,
    });
  }

  return (
    <SBDialog
      className="calender-dialog"
      headerTitle="Lab Schedule"
      headerIcon={<i className="pi pi-calendar" />}
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

  const events = useMemo(() => {
    const now = new Date();

    return labStore.data
      .filter(lab => lab.endTime !== null)
      .map(lab => {
        const end = new Date(lab.endTime!);

        return {
          title: lab.name,
          id: lab.id,
          state:
            lab.instance?.state ??
            (end < now ? InstanceState.Inactive : InstanceState.Scheduled),
          start: new Date(lab.startTime),
          end,
        };
      });
  }, [labStore.data]);

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
        onRangeChange={onRangeChange}
        onSelectEvent={onEventSelect}
        eventPropGetter={event => ({
          className: InstanceState[event.state]?.toLowerCase(),
        })}
        messages={{
          today: 'Today',
          previous: <i className="pi pi-chevron-left" />,
          next: <i className="pi pi-chevron-right" />,
          month: 'Month',
          week: 'Week',
          agenda: 'Agenda',
          allDay: 'All day',
          event: 'Lab',
          showMore: total => `+${total} more`,
        }}
        formats={{
          timeGutterFormat: 'HH:mm',
          agendaTimeFormat: 'HH:mm',
          eventTimeRangeFormat: ({start, end}, culture, localizer) =>
            `${localizer!.format(start, 'HH:mm', culture)} – ${localizer!.format(end, 'HH:mm', culture)}`,
          agendaTimeRangeFormat: ({start, end}, culture, localizer) =>
            `${localizer!.format(start, 'HH:mm', culture)} – ${localizer!.format(end, 'HH:mm', culture)}`,
        }}
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

export default CalendarDialog;

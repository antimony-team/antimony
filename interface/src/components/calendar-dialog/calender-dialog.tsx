import React, {useEffect, useMemo, useState} from 'react';

import moment from 'moment';
import {observer} from 'mobx-react-lite';
import {Calendar, momentLocalizer, View, Views} from 'react-big-calendar';

import {uuid4} from '@sb/types/types';
import {useCalendarLabStore} from '@sb/lib/stores/root-store';
import SBDialog from '@sb/components/common/sb-dialog/sb-dialog';
import ReservationDialog from '@sb/components/dashboard-page/reservation-dialog/reservation-dialog';

import './calender-dialog.sass';
import {Lab, LabState} from '@sb/types/domain/lab';

const localizer = momentLocalizer(moment);

interface CalendarProps {
  isOpen: boolean;
  onClose: () => void;
}

const CalendarDialog: React.FC<CalendarProps> = observer(
  (props: CalendarProps) => {
    const [currentView, setCurrentView] = useState<View>('month');
    const [currentDate, setCurrentDate] = useState<Date>(new Date());
    const [selectedEvent, setSelectedEvent] = useState<Lab | null>(null);
    const [isReservationDialogOpen, setIsReservationDialogOpen] =
      useState(false);

    const calendarLabStore = useCalendarLabStore();

    function CustomEvent({event}: CustomEventProps) {
      return (
        <div style={{display: 'flex', alignItems: 'center'}}>
          <span style={{flexGrow: 1}}>{event.title}</span>
          {event.state === LabState.Scheduled && (
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
        calendarLabStore.data.map(lab => ({
          title: lab.name,
          id: lab.id,
          state: lab.state,
          start: new Date(lab.startDate),
          end: new Date(lab.endDate),
        })),
      [calendarLabStore.data]
    );

    useEffect(() => {
      calendarLabStore.setDates(
        moment(currentDate).startOf('month').toISOString(),
        moment(currentDate).endOf('month').toISOString()
      );
      calendarLabStore.setLimit(1000);
      calendarLabStore.setStateFilter([
        LabState.Deploying,
        LabState.Done,
        LabState.Failed,
        LabState.Running,
        LabState.Scheduled,
      ]);
    }, []);

    function onRangeChange(range: Date[] | {start: Date; end: Date}) {
      if (Array.isArray(range)) {
        calendarLabStore.setDates(
          range[0].toISOString(),
          range[range.length - 1].toISOString()
        );
      } else {
        calendarLabStore.setDates(
          range.start.toISOString(),
          range.end.toISOString()
        );
      }
    }

    function onEventSelect(event: CalendarEvent) {
      if (event.state === LabState.Scheduled) {
        const lab: Lab | undefined = calendarLabStore.data.find(
          lab => lab.id === event.id
        );
        setSelectedEvent(lab!);
        setIsReservationDialogOpen(true);
      } else {
        return;
      }
    }

    function onClose(): void {
      setIsReservationDialogOpen(false);
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
      <SBDialog
        className="calender-dialog"
        headerTitle="Calendar"
        isOpen={props.isOpen}
        onClose={props.onClose}
        hideButtons={true}
      >
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
        {isReservationDialogOpen && (
          <ReservationDialog lab={selectedEvent!} onClose={onClose} />
        )}
      </SBDialog>
    );
  }
);

interface CalendarEvent {
  title: string;
  id: uuid4;
  state: LabState;
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

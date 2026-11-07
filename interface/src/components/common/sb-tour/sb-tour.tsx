import React, {useEffect} from 'react';

import {useLocation} from 'react-router';

import {Button} from 'primereact/button';

import {useTopologyStore} from '@sb/lib/stores/root-store';
import {startTour} from '@sb/lib/tour/tour';
import {TourId, tourRoutes} from '@sb/lib/tour/tours';
import {
  arrayOf,
  oneOf,
  usePersistentState,
} from '@sb/lib/utils/persistent-state';

import './sb-tour.sass';

// Delay before the tour starts automatically, so the opened topology has been laid out
const AUTO_START_DELAY = 600;

const isTourId = oneOf(...Object.values(TourId));

/**
 * Button to replay the tour of the current page. Also starts the editor tour the
 * first time a topology is opened.
 */
const SBTour = () => {
  const {pathname} = useLocation();
  const topologyStore = useTopologyStore();

  const [completedTours, setCompletedTours] = usePersistentState<TourId[]>(
    'completed-tours',
    [],
    arrayOf(isTourId),
  );

  const tourId = tourRoutes[pathname] ?? null;

  function start(tourId: TourId) {
    startTour(tourId, () =>
      setCompletedTours(tours =>
        tours.includes(tourId) ? tours : [...tours, tourId],
      ),
    );
  }

  useEffect(() => {
    if (completedTours.includes(TourId.Editor)) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;

    const onTopologyOpen = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        // Don't cover a dialog that is still open
        if (document.querySelector('.p-dialog-mask')) return;

        start(TourId.Editor);
      }, AUTO_START_DELAY);
    };

    topologyStore.manager.onTopologyOpen.register(onTopologyOpen);

    return () => {
      clearTimeout(timeout);
      topologyStore.manager.onTopologyOpen.unregister(onTopologyOpen);
    };
  }, [completedTours]);

  if (tourId === null || topologyStore.data.length === 0) return null;

  return (
    <Button
      text
      icon="pi pi-question-circle"
      size="large"
      className="sb-tour-button"
      tooltip="Tour"
      tooltipOptions={{position: 'bottom', showDelay: 500}}
      onClick={() => start(tourId)}
      aria-label="Show tour"
    />
  );
};

export default SBTour;

import React, {useEffect} from 'react';

import {reaction} from 'mobx';
import {useLocation} from 'react-router';

import {Button} from 'primereact/button';

import {useEditorTabStore, useTopologyStore} from '@sb/lib/stores/root-store';
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
  const tabStore = useEditorTabStore();

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
    if (tourId !== TourId.Editor || completedTours.includes(TourId.Editor)) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;

    const onTopologyOpen = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        // Don't cover a dialog that is still open
        if (document.querySelector('.p-dialog-mask')) return;

        start(TourId.Editor);
      }, AUTO_START_DELAY);
    };

    // The editor tour starts once a topology is shown in the editor, also
    // if one is already shown when the editor is opened
    const disposeReaction = reaction(
      () => (tabStore.active?.graph ? tabStore.active.id : null),
      topologyId => {
        if (topologyId) onTopologyOpen();
      },
      {fireImmediately: true},
    );

    return () => {
      clearTimeout(timeout);
      disposeReaction();
    };
  }, [completedTours, tourId]);

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

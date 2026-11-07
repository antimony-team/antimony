import {Driver, driver, DriveStep} from 'driver.js';

import {TourId, tours, TourStep} from '@sb/lib/tour/tours';

import 'driver.js/dist/driver.css';

// Space between the highlighted element and the edge of the highlight
const STAGE_PADDING = 8;
const STAGE_RADIUS = 12;

// Duration of the move between two steps, the highlight frame uses the same in its transition
const MOVE_DURATION = 250;

let activeTour: Driver | null = null;

/**
 * Starts a tour, steps whose element is missing or hidden are left out. The given
 * callback is called once the tour is finished or closed.
 */
export function startTour(tourId: TourId, onEnd: () => void) {
  activeTour?.destroy();

  /*
   * driver.js only cuts the highlighted element out of its overlay. This frame is
   * drawn above the overlay, so its ring and shadow aren't dimmed.
   */
  const stage = document.createElement('div');
  stage.className = 'sb-tour-stage';
  document.body.append(stage);

  let stageElement: Element | undefined;
  const updateStage = () => positionStage(stage, stageElement);

  window.addEventListener('resize', updateStage);
  window.addEventListener('scroll', updateStage, true);

  const tour = driver({
    steps: tours[tourId].filter(isStepVisible).map(toDriveStep),
    popoverClass: 'sb-tour-popover',
    popoverOffset: 18,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    overlayColor: '#050609',
    overlayOpacity: 0.55,
    duration: MOVE_DURATION,
    stagePadding: STAGE_PADDING,
    stageRadius: STAGE_RADIUS,
    onHighlightStarted: element => {
      stageElement = element;
      updateStage();
    },
    onDestroyed: () => {
      window.removeEventListener('resize', updateStage);
      window.removeEventListener('scroll', updateStage, true);
      stage.remove();

      if (activeTour === tour) activeTour = null;
      onEnd();
    },
  });

  activeTour = tour;
  tour.drive();
}

function positionStage(stage: HTMLElement, element: Element | undefined) {
  // Steps without an element highlight a placeholder element of driver.js
  if (!element || element.id === 'driver-dummy-element') {
    stage.style.opacity = '0';
    return;
  }

  const rect = element.getBoundingClientRect();

  stage.style.opacity = '1';
  stage.style.top = `${rect.top - STAGE_PADDING}px`;
  stage.style.left = `${rect.left - STAGE_PADDING}px`;
  stage.style.width = `${rect.width + STAGE_PADDING * 2}px`;
  stage.style.height = `${rect.height + STAGE_PADDING * 2}px`;
  stage.style.borderRadius = `${STAGE_RADIUS}px`;
}

function isStepVisible(step: TourStep) {
  if (step.element === null) return true;

  const element = document.querySelector(step.element);
  return element !== null && element.getClientRects().length > 0;
}

function toDriveStep(step: TourStep): DriveStep {
  return {
    element: step.element ?? undefined,
    popover: {
      title: step.title,
      description: step.text,
      side: step.side,
      align: step.align,
    },
  };
}

import type {ISourceOptions} from '@tsparticles/engine';

import {ColorScheme} from '@sb/lib/stores/theme-store';

// The particles and their links are drawn in white, or in black on a light background
export const particlesOptions = (scheme: ColorScheme): ISourceOptions => ({
  fpsLimit: 120,
  interactivity: {
    events: {
      onClick: {
        enable: true,
        mode: 'push',
      },
      onHover: {
        enable: true,
        mode: 'repulse',
      },
    },
    modes: {
      push: {
        quantity: 4,
      },
      repulse: {
        distance: 200,
        duration: 0.4,
      },
    },
  },
  particles: {
    color: {
      value: scheme === 'light' ? '#000000' : '#ffffff',
    },
    links: {
      color: scheme === 'light' ? '#000000' : '#ffffff',
      distance: 200,
      enable: true,
      opacity: 0.2,
      width: 1,
    },
    move: {
      direction: 'none',
      enable: true,
      outModes: {
        default: 'bounce',
      },
      random: false,
      speed: 1.2,
    },
    number: {
      value: 120,
    },
    opacity: {
      value: 0.4,
    },
    shape: {
      type: 'circle',
    },
    size: {
      value: {min: 3, max: 7},
    },
  },
  detectRetina: true,
});

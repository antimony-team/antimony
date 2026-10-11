import {Alignment, Side} from 'driver.js';

export enum TourId {
  Editor = 'editor',
}

export interface TourStep {
  // Selector of the highlighted element, null for a centered popover
  element: string | null;
  title: string;
  text: string;
  side?: Side;
  align?: Alignment;
}

// The tour that is offered on each page
export const tourRoutes: Record<string, TourId> = {
  '/editor': TourId.Editor,
};

export const tours: Record<TourId, TourStep[]> = {
  [TourId.Editor]: [
    {
      element: null,
      title: 'Welcome to the topology editor',
      text: 'This is where you build and edit your lab topologies. Here is a quick look around.',
    },
    {
      element: '.sb-topology-explorer',
      title: 'Explorer',
      text: 'Your collections and their topologies. Click a topology to open it, right-click for actions like renaming, adding files or deploying.',
      side: 'right',
      align: 'start',
    },
    {
      element: '.sb-topology-editor-toolbar-left',
      title: 'Open file',
      text: 'Where the open topology lives. Switch between the topology definition and its annotations here, and undo or redo changes.',
      side: 'bottom',
      align: 'start',
    },
    {
      element: '.sb-monaco-wrapper',
      title: 'Topology definition',
      text: 'The containerlab topology as YAML. It is checked against the containerlab schema while you type, with autocomplete for every field.',
      side: 'right',
      align: 'center',
    },
    {
      element: '.sb-monaco-wrapper-error',
      title: 'Validation',
      text: 'Whether the open file is valid. Hover it to see the first error.',
      side: 'top',
      align: 'start',
    },
    {
      element: '.sb-node-editor',
      title: 'Graph',
      text: 'The same topology as a graph. Drag nodes to arrange them, click a node to connect, edit or delete it, and right-click anywhere for more options.',
      side: 'left',
      align: 'center',
    },
    {
      element: '.sb-node-editor-toolbar',
      title: 'Graph tools',
      text: 'Add nodes, draw groups around nodes, fit the graph to the screen, or let the layout stabilize itself.',
      side: 'left',
      align: 'start',
    },
    {
      element: '.sb-editor-view-switch',
      title: 'Views',
      text: 'Show only the code, only the graph, or both side by side.',
      side: 'bottom',
      align: 'center',
    },
    {
      element: '.sb-topology-editor-toolbar-right button[aria-label="Save"]',
      title: 'Saving',
      text: 'Changes are not saved automatically. A * next to the topology name means there are unsaved changes, save them here or with Ctrl+S.',
      side: 'bottom',
      align: 'end',
    },
    {
      element: '.sb-topology-editor-deploy-button',
      title: 'Deploy',
      text: 'Starts a lab from this topology. Once it is running, you can follow it and open shells to its nodes on the dashboard.',
      side: 'bottom',
      align: 'end',
    },
    {
      element: '.sb-tour-button',
      title: 'That is it!',
      text: 'You can take this tour again at any time from here.',
      side: 'bottom',
      align: 'end',
    },
  ],
};

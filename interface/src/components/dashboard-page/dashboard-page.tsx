import React, {useEffect, useMemo, useRef, useState} from 'react';

import {observer} from 'mobx-react-lite';
import {useSearchParams} from 'react-router';

import {
  Splitter,
  SplitterPanel,
  SplitterResizeEndEvent,
} from 'primereact/splitter';

import LabEditDialog, {
  LabEditDialogState,
} from '@sb/components/common/lab-edit-dialog/lab-edit-dialog';
import {SBConfirmDeletePreset} from '@sb/components/common/sb-confirm/sb-confirm';
import LabExplorer, {
  LabExplorerTopology,
} from '@sb/components/dashboard-page/lab-explorer/lab-explorer';
import LabGrid from '@sb/components/dashboard-page/lab-grid/lab-grid';
import LabView from '@sb/components/dashboard-page/lab-view/lab-view';
import {useLabStore, useStatusMessages} from '@sb/lib/stores/root-store';
import {useDialogState} from '@sb/lib/utils/hooks';
import {isNumber, usePersistentState} from '@sb/lib/utils/persistent-state';
import {InstanceState, Lab} from '@sb/types/domain/lab';

import './dashboard-page.sass';

const DashboardPage = observer(() => {
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [selectedTopology, setSelectedTopology] = useState<string | null>(null);

  const labEditDialogState = useDialogState<LabEditDialogState>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const [openLab, setOpenLab] = useState<Lab | null>(null);
  const labStore = useLabStore();
  const notificationStore = useStatusMessages();

  const [splitterPosition, setSplitterPosition] = usePersistentState<number>(
    'main-splitter',
    20,
    isNumber,
  );

  useEffect(() => {
    if (searchParams.has('l') && labStore.lookup.has(searchParams.get('l')!)) {
      const openLab = labStore.lookup.get(searchParams.get('l')!)!;
      setOpenLab(openLab);
      document.title = `Antimony | ${openLab.name}`;
    } else {
      setOpenLab(null);
      document.title = 'Antimony | Dashboard';
    }
  }, [labStore.lookup, searchParams]);

  // Once a lab is closed, its card gets the focus back if the focus was in the lab view
  const lastOpenLab = useRef<Lab | null>(null);
  useEffect(() => {
    const closedLab = lastOpenLab.current;
    lastOpenLab.current = openLab;
    if (openLab || !closedLab) return;

    const focused = document.activeElement;
    if (
      focused &&
      focused !== document.body &&
      !focused.closest('.sb-lab-view')
    ) {
      return;
    }

    document
      .querySelector<HTMLElement>(`[data-lab-id="${closedLab.id}"]`)
      ?.focus();
  }, [openLab]);

  function onCloseLabView() {
    setSearchParams('');
  }

  // The lab counts and the state counts by collection ID and by topology ID
  const [labCounts, labStateCounts, topologies] = useMemo(() => {
    const labCounts: {[id: string]: number} = {};
    const stateCounts: {[id: string]: {[state: string]: number}} = {};
    const topologies = new Map<string, LabExplorerTopology>();

    labStore.data.forEach(lab => {
      const state = InstanceState[lab.state].toLowerCase();

      // Labs of deleted topologies have no topology ID
      const ids = lab.topologyId
        ? [lab.collectionId, lab.topologyId]
        : [lab.collectionId];

      for (const id of ids) {
        labCounts[id] = (labCounts[id] ?? 0) + 1;
        stateCounts[id] ??= {};
        stateCounts[id][state] = (stateCounts[id][state] ?? 0) + 1;
      }

      if (!lab.topologyId) return;
      topologies.set(lab.topologyId, {
        id: lab.topologyId,
        name: lab.topologyDefinition.definition.name ?? '',
        collectionId: lab.collectionId,
      });
    });

    const sortedTopologies = [...topologies.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {numeric: true}),
    );
    return [labCounts, stateCounts, sortedTopologies];
  }, [labStore.data]);

  // A topology without labs isn't listed, so it isn't a filter anymore either
  const topologyFilter =
    selectedTopology && labCounts[selectedTopology] ? selectedTopology : null;

  // Only one filter at a time: all labs, a collection or a topology
  function onSetCollectionFilter(collectionId: string | null) {
    setCollectionFilter(collectionId);
    setSelectedTopology(null);
  }

  function onSetTopologyFilter(topologyId: string | null) {
    setSelectedTopology(topologyId);
    setCollectionFilter(null);
  }

  function onDestroyLab(lab: Lab) {
    notificationStore.confirm({
      header: `Destroy lab '${lab.name}'?`,
      icon: 'pi pi-power-off',
      severity: 'danger',
      onAccept: () => labStore.destroyLab(lab),
    });
  }

  function onDeleteLab(lab: Lab) {
    // Cleaning up inactive labs is part of the regular workflow
    if (lab.state === InstanceState.Inactive) {
      void onDeleteLabConfirm(lab);
      return;
    }

    notificationStore.confirm({
      ...SBConfirmDeletePreset('lab'),
      message: `Are you sure you want to delete the lab "${lab.name}"?`,
      onAccept: () => onDeleteLabConfirm(lab),
    });
  }

  async function onDeleteLabConfirm(lab: Lab) {
    const result = await labStore.delete(lab.id);

    if (result.isErr()) {
      notificationStore.error(result.error.message, 'Failed to delete lab');
    } else {
      notificationStore.success('Lab has been deleted.');

      if (openLab?.id === lab.id) onCloseLabView();
    }
  }

  return (
    <div className="sb-dashboard">
      <Splitter
        onResizeEnd={(e: SplitterResizeEndEvent) =>
          setSplitterPosition(e.sizes[0])
        }
        // An open lab covers the grid, which can't be reached with the keyboard then
        inert={openLab !== null}
      >
        <SplitterPanel
          className="sb-lab-explorer sb-island"
          size={splitterPosition}
        >
          <LabExplorer
            collectionFilter={collectionFilter}
            setCollectionFilter={onSetCollectionFilter}
            topologyFilter={topologyFilter}
            setTopologyFilter={onSetTopologyFilter}
            topologies={topologies}
            labStateCounts={labStateCounts}
            labCounts={labCounts}
            typeToSearch={openLab === null}
          />
        </SplitterPanel>
        <SplitterPanel
          className="sb-dashboard-container sb-island"
          size={100 - splitterPosition}
        >
          <LabGrid
            collectionFilter={collectionFilter}
            topologyFilter={topologyFilter}
            topologyName={topologies.find(t => t.id === topologyFilter)?.name}
            labCounts={labCounts}
            labEditDialogState={labEditDialogState}
            onDestroyLab={onDestroyLab}
            onDeleteLab={onDeleteLab}
          />
        </SplitterPanel>
      </Splitter>
      <LabView
        lab={openLab}
        onClose={onCloseLabView}
        onDestroyLabRequest={onDestroyLab}
      />
      <LabEditDialog dialogState={labEditDialogState} />
    </div>
  );
});

export default DashboardPage;

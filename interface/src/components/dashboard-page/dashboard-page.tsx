import React, {useEffect, useMemo, useState} from 'react';

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
import LabExplorer from '@sb/components/dashboard-page/lab-explorer/lab-explorer';
import LabGrid from '@sb/components/dashboard-page/lab-grid/lab-grid';
import LabView from '@sb/components/dashboard-page/lab-view/lab-view';
import {useLabStore, useStatusMessages} from '@sb/lib/stores/root-store';
import {useDialogState} from '@sb/lib/utils/hooks';
import {isNumber, usePersistentState} from '@sb/lib/utils/persistent-state';
import {InstanceState, Lab} from '@sb/types/domain/lab';

import './dashboard-page.sass';

const DashboardPage = observer(() => {
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);

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

  function onCloseLabView() {
    setSearchParams('');
  }

  const [collectionLabCounts, collectionLabStateCounts] = useMemo(() => {
    const labCounts: {[collectionId: string]: number} = {};
    const stateCounts: {[collectionId: string]: {[state: string]: number}} = {};

    labStore.data.forEach(lab => {
      if (lab.collectionId in labCounts) {
        labCounts[lab.collectionId]++;
      } else {
        labCounts[lab.collectionId] = 1;
      }

      if (!(lab.collectionId in stateCounts)) {
        stateCounts[lab.collectionId] = {};
      }

      const state = InstanceState[lab.state].toLowerCase();
      if (state in stateCounts[lab.collectionId]) {
        stateCounts[lab.collectionId][state]++;
      } else {
        stateCounts[lab.collectionId][state] = 1;
      }
    });
    return [labCounts, stateCounts];
  }, [labStore.data]);

  function onDestroyLab(lab: Lab) {
    notificationStore.confirm({
      header: `Destroy Lab '${lab.name}'?`,
      icon: 'pi pi-power-off',
      severity: 'danger',
      onAccept: () => labStore.destroyLab(lab),
    });
  }

  return (
    <div className="sb-dashboard">
      <Splitter
        onResizeEnd={(e: SplitterResizeEndEvent) =>
          setSplitterPosition(e.sizes[0])
        }
      >
        <SplitterPanel
          className="sb-lab-explorer sb-island"
          size={splitterPosition}
        >
          <LabExplorer
            collectionFilter={collectionFilter}
            setCollectionFilter={setCollectionFilter}
            collectionLabStateCounts={collectionLabStateCounts}
            collectionLabCounts={collectionLabCounts}
          />
        </SplitterPanel>
        <SplitterPanel
          className="sb-dashboard-container sb-island"
          size={100 - splitterPosition}
        >
          <LabGrid
            collectionFilter={collectionFilter}
            collectionLabCounts={collectionLabCounts}
            labEditDialogState={labEditDialogState}
            onDestroyLab={onDestroyLab}
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

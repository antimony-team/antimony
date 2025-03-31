import {InstanceState, InstanceStates} from '@sb/types/domain/lab';
import React from 'react';

import classNames from 'classnames';
import {Chip} from 'primereact/chip';
import {observer} from 'mobx-react-lite';
import {OverlayPanel} from 'primereact/overlaypanel';

import {useCollectionStore, useLabStore} from '@sb/lib/stores/root-store';

import './lab-filter-overlay.sass';

interface FilterDialogProps {
  popOverRef: React.RefObject<OverlayPanel>;
}
const LabFilterOverlay: React.FC<FilterDialogProps> = observer(
  (props: FilterDialogProps) => {
    const labStore = useLabStore();
    const collectionStore = useCollectionStore();

    return (
      <OverlayPanel ref={props.popOverRef} className="filter-overlay-panel">
        <div className="filters-container">
          <div className="filters-title">Instance States</div>
          <div className="filters-chips-container">
            {InstanceStates.map((state, i) => (
              <Chip
                key={i}
                label={InstanceState[state]}
                onClick={() => labStore.toggleState(state)}
                className={classNames('filter-chip', 'state-filter-chip', {
                  selected: labStore.stateFilter.includes(state),
                  unselected: !labStore.stateFilter.includes(state),
                  running: state === InstanceState.Running,
                  scheduled: state === InstanceState.Scheduled,
                  deploying: state === InstanceState.Deploying,
                  stopping: state === InstanceState.Stopping,
                  inactive: state === InstanceState.Inactive,
                  failed: state === InstanceState.Failed,
                })}
              />
            ))}
          </div>
          <div className="filters-title">Collections</div>
          <div className="filters-chips-container">
            {collectionStore.data.map((collection, i) => (
              <Chip
                key={i}
                label={collection.name}
                onClick={() => labStore.toggleCollection(collection.id)}
                className={classNames('filter-chip', 'collection-filter-chip', {
                  selected: labStore.collectionFilter.includes(collection.id),
                  unselected: !labStore.collectionFilter.includes(
                    collection.id
                  ),
                })}
              />
            ))}
          </div>
        </div>
      </OverlayPanel>
    );
  }
);

export default LabFilterOverlay;

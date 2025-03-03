import React from 'react';

import classNames from 'classnames';
import {Chip} from 'primereact/chip';
import {observer} from 'mobx-react-lite';
import {OverlayPanel} from 'primereact/overlaypanel';

import {useCollectionStore, useLabStore} from '@sb/lib/stores/root-store';

import './lab-filter-dialog.sass';
import {LabState} from '@sb/types/domain/lab';

interface FilterDialogProps {
  popOverRef: React.RefObject<OverlayPanel>;
}
const LabFilterDialog: React.FC<FilterDialogProps> = observer(
  (props: FilterDialogProps) => {
    const labStore = useLabStore();
    const collectionStore = useCollectionStore();

    const toggleStateFilter = (state: LabState) => {
      if (labStore.stateFilter.includes(state)) {
        labStore.setStateFilter(labStore.stateFilter.filter(s => s !== state));
      } else {
        labStore.setStateFilter([...labStore.stateFilter, state]);
      }
    };

    const toggleGroupFilter = (group: string) => {
      if (labStore.collectionFilter.includes(group)) {
        labStore.setGroupFilter(
          labStore.collectionFilter.filter(g => g !== group)
        );
      } else {
        labStore.setGroupFilter([...labStore.collectionFilter, group]);
      }
    };

    return (
      <OverlayPanel ref={props.popOverRef} className="filter-overlay-panel">
        <div className="filters-container">
          <div className="filters-title">States</div>
          <div className="filters-chips-container">
            {Object.values(LabState)
              .filter(value => typeof value === 'number') // Ensure only valid LabState values are used
              .map(option => (
                <Chip
                  key={option}
                  label={LabState[option]}
                  onClick={() => toggleStateFilter(option as LabState)}
                  className={classNames('filter-chip', {
                    active: labStore.stateFilter.includes(option as LabState),
                    inactive: !labStore.stateFilter.includes(
                      option as LabState
                    ),
                    running: option === LabState.Running,
                    scheduled: option === LabState.Scheduled,
                    deploying: option === LabState.Deploying,
                    done: option === LabState.Done,
                    failed: option === LabState.Failed,
                  })}
                />
              ))}
          </div>
          <div className="filters-title">Groups</div>
          <div className="filters-chips-container">
            {collectionStore.data.map(group => (
              <Chip
                key={group.id}
                label={group.name}
                onClick={() => toggleGroupFilter(group.id)}
                className={classNames('group-chip', {
                  active: labStore.collectionFilter.includes(group.id),
                  inactive: !labStore.collectionFilter.includes(group.id),
                })}
              />
            ))}
          </div>
          {/*<div className="Apply-Filters-Container">*/}
          {/*  <Button*/}
          {/*    label="Apply Filters"*/}
          {/*    onClick={() => {*/}
          {/*      props.setFilters(tempFilters);*/}
          {/*      props.setGroups(tempGroups);*/}
          {/*      props.PopOverVisible.current?.hide();*/}
          {/*    }}*/}
          {/*    className="filters-apply-button"*/}
          {/*  />*/}
          {/*</div>*/}
        </div>
      </OverlayPanel>
    );
  }
);

export default LabFilterDialog;

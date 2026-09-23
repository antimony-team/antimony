import {Button} from 'primereact/button';
import {Choose, If, Otherwise, When} from '@sb/types/control';
import StateIndicator from '@sb/components/dashboard-page/state-indicator/state-indicator';
import {InstanceState, Lab} from '@sb/types/domain/lab';
import React, {useMemo} from 'react';
import {
  useClock,
  useCollectionStore,
  useLabStore,
} from '@sb/lib/stores/root-store';

import './lab-view-header.sass';
import {formatUptime} from '@sb/lib/utils/utils';
import dayjs from 'dayjs';
import {observer} from 'mobx-react-lite';

export interface LabViewHeaderProps {
  lab: Lab;

  onClose: () => void;
  onOpenLabLogs: () => void;
  onDestroyLabRequest: (lab: Lab) => void;

  canDeployLab: () => boolean;
  canRedeployLab: () => boolean;
  canDestroyLab: () => boolean;
  canOpenLabLogs: () => boolean;
}

const LabViewHeader = observer((props: LabViewHeaderProps) => {
  const clock = useClock();

  const labStore = useLabStore();
  const collectionStore = useCollectionStore();

  const groupName = useMemo(() => {
    const collectionId = props.lab.collectionId;
    if (!collectionStore.lookup.has(collectionId)) return;

    return collectionStore.lookup.get(collectionId)!.name;
  }, [props.lab, collectionStore.lookup]);

  return (
    <div className="sb-lab-view-header">
      <div className="sb-lab-view-header-content">
        <Button
          text
          icon="pi pi-arrow-left"
          size="large"
          onClick={() => props.onClose()}
          tooltip="Back"
          tooltipOptions={{position: 'bottom', showDelay: 500}}
          aria-label="Download"
        />
        <If condition={props.lab}>
          <StateIndicator lab={props.lab!} showText={false} />
        </If>
        <div className="sb-lab-view-header-content-text">
          <div>
            <span className="header-group">{groupName + ' / '}</span>
            <span className="header-name">{props.lab.name}</span>
          </div>
          <If condition={props.lab.instance}>
            <div className="header-meta">
              <span>
                {InstanceState[props.lab.instance!.state].toLocaleLowerCase()}
              </span>
              <span>
                up{' '}
                <span className="highlight">
                  {formatUptime(props.lab.instance!.deployed, dayjs(clock.now))}
                </span>
              </span>
              <span>
                <Choose>
                  <When condition={props.lab.endTime === null}>
                    indefinitely
                  </When>
                  <Otherwise>
                    {dayjs(props.lab.endTime).format('DD/MM/YYYY HH:mm')}
                  </Otherwise>
                </Choose>
              </span>
              <span>{props.lab.creator.name}</span>
            </div>
          </If>
        </div>
      </div>
      <div className="sb-lab-view-header-buttons">
        <Button
          outlined
          icon={
            <span className="material-symbols-outlined">
              quick_reference_all
            </span>
          }
          label="View Logs"
          aria-label="View Logs"
          onClick={props.onOpenLabLogs}
          disabled={!props.canOpenLabLogs()}
        />
        <Choose>
          <When condition={props.canDeployLab()}>
            <Button
              outlined
              icon="pi pi-play"
              severity="success"
              onClick={() => labStore.deployLab(props.lab)}
            />
          </When>
          <Otherwise>
            <Button
              outlined
              icon={
                props.lab.state === InstanceState.Deploying
                  ? 'pi pi-sync pi-spin'
                  : 'pi pi-sync'
              }
              aria-label="Redeploy Lab"
              onClick={() => labStore.deployLab(props.lab)}
              disabled={!props.canRedeployLab()}
              tooltipOptions={{
                showOnDisabled: true,
              }}
            />
            <Button
              outlined
              icon="pi pi-power-off"
              aria-label={
                props.lab.state === InstanceState.Scheduled
                  ? 'Delete Lab'
                  : 'Destroy Lab'
              }
              severity="danger"
              onClick={() => props.onDestroyLabRequest(props.lab)}
              disabled={!props.canDestroyLab()}
            />
          </Otherwise>
        </Choose>
      </div>
    </div>
  );
});

export default LabViewHeader;

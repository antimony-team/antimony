import {
  useAuthUser,
  useClock,
  useCollectionStore,
  useLabStore,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {InstanceState, Lab} from '@sb/types/domain/lab';
import React, {useMemo} from 'react';

import './lab-entry.sass';
import {observer} from 'mobx-react-lite';
import {If} from '@sb/types/control';
import classNames from 'classnames';
import LabEntryPreview from '@sb/components/dashboard-page/lab-entry/lab-entry-preview/lab-entry-preview';
import {formatDuration} from '@sb/lib/utils/utils';

interface LabEntryProps {
  lab: Lab;

  onOpenLab: () => void;
  onRescheduleLab: () => void;

  onDestroyLabRequest: () => void;
}

const LabEntry = observer((props: LabEntryProps) => {
  const authUser = useAuthUser();
  const labStore = useLabStore();
  const collectionStore = useCollectionStore();
  const notificationStore = useStatusMessages();

  const clock = useClock();

  const isChangeable = useMemo(() => {
    return authUser.isAdmin || props.lab.creator.id === authUser.id;
  }, [authUser]);

  const [stateProgress, stateText] = useMemo((): [number, string] => {
    switch (props.lab.state) {
      case InstanceState.Running: {
        if (!props.lab.instance?.deployed) return [0, ''];

        const start = props.lab.instance.deployed.getTime();
        const end = props.lab.endTime?.getTime();
        const uptime = `up ${formatDuration(clock.now - start)}`;

        if (!end || clock.now >= end) return [1, uptime];

        const remaining = Math.min(
          1,
          Math.max(0, (end - clock.now) / (end - start)),
        );
        return [remaining, `${formatDuration(end - clock.now)} left`];
      }
      case InstanceState.Deploying: {
        const nodes = props.lab.instance?.nodes ?? [];
        if (!nodes.length) return [0, ''];

        const ready = nodes.filter(n => n.isReady).length;
        return [ready / nodes.length, `${ready} of ${nodes.length} ready`];
      }
      case InstanceState.Scheduled:
        return [0, `starts ${formatWhen(props.lab.startTime, clock.now)}`];
      case InstanceState.Failed:
        return props.lab.instance!.deployed
          ? [1, `failed ${formatWhen(props.lab.instance!.deployed, clock.now)}`]
          : [1, ''];
      default:
        return [0, ''];
    }
  }, [props.lab, clock.now]);

  const topologyName = useMemo(() => {
    const topologyName = props.lab.topologyDefinition.definition.getIn([
      'name',
    ]);
    const collectionName =
      collectionStore.lookup.get(props.lab.collectionId)?.name ?? 'unknown';
    return `${collectionName} / ${topologyName}`;
  }, [props.lab]);

  function onDeleteScheduledLab() {
    notificationStore.confirm({
      message: 'This action cannot be undone.',
      header: `Delete Lab '${props.lab.name}'?`,
      icon: 'pi pi-trash',
      severity: 'danger',
      onAccept: () => labStore.delete(props.lab.id),
    });
  }

  function onEditLab(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    props.onRescheduleLab();
  }

  const showButtons =
    props.lab.state !== InstanceState.Stopping && isChangeable;

  function formatWhen(date: Date, now: number): string {
    const time = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);

    if (days === 0) return time;
    if (days === 1) return `tomorrow ${time}`;
    if (days === -1) return `yesterday ${time}`;
    if (Math.abs(days) < 7) {
      return `${date.toLocaleDateString([], {weekday: 'short'})} ${time}`;
    }
    return `${date.toLocaleDateString([], {day: 'numeric', month: 'short'})} ${time}`;
  }

  return (
    <div
      className={classNames(
        'sb-dashboard-lab-card',
        InstanceState[props.lab.state].toLowerCase(),
      )}
      style={{'--progress': stateProgress} as React.CSSProperties}
      onClick={props.onOpenLab}
    >
      <div className="sb-dashboard-lab-card-band" onClick={props.onOpenLab}>
        <div className="dot" />
        <span className="sb-dashboard-lab-card-band-state">
          {InstanceState[props.lab.state]}
        </span>
        <span className="sb-dashboard-lab-card-band-time">{stateText}</span>
      </div>
      <LabEntryPreview
        topology={props.lab.topologyDefinition}
        className={InstanceState[props.lab.state]?.toLowerCase()}
      />
      <div className="sb-dashboard-lab-content">
        <div className="sb-dashboard-lab-card-header">
          <span>{props.lab.name}</span>
          <span className="sb-dashboard-lab-card-header-nodes">
            {props.lab.topologyDefinition.nodeCount} nodes
          </span>
        </div>
        <div className="sb-dashboard-lab-card-footer">
          <span className="material-symbols-outlined">network_node</span>
          <span>{topologyName}</span>
          <div className="sb-dashboard-lab-card-footer-owner">
            <i className="pi pi-user" />
            <span>{props.lab.creator.name}</span>
          </div>
        </div>
      </div>
      <div className="lab-state">
        <If condition={showButtons}>
          {/*<div className="lab-state-buttons">*/}
          {/*  <Choose>*/}
          {/*    <When condition={props.lab.state === InstanceState.Scheduled}>*/}
          {/*      <Button*/}
          {/*        severity="info"*/}
          {/*        icon="pi pi-pen-to-square"*/}
          {/*        tooltip="Edit"*/}
          {/*        aria-label="Edit Lab"*/}
          {/*        onClick={onEditLab}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*      <Button*/}
          {/*        icon="pi pi-trash"*/}
          {/*        severity="danger"*/}
          {/*        tooltip="Delete"*/}
          {/*        aria-label="Delete Lab"*/}
          {/*        onClick={onDeleteScheduledLab}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*    </When>*/}
          {/*    <When condition={props.lab.state === InstanceState.Inactive}>*/}
          {/*      <Button*/}
          {/*        icon="pi pi-play"*/}
          {/*        severity="success"*/}
          {/*        tooltip="Deploy Now"*/}
          {/*        aria-label="Deploy Lab Now"*/}
          {/*        onClick={() => labStore.deployLab(props.lab)}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*      <Button*/}
          {/*        icon="pi pi-trash"*/}
          {/*        severity="danger"*/}
          {/*        tooltip="Delete"*/}
          {/*        aria-label="Delete Lab"*/}
          {/*        onClick={() => labStore.delete(props.lab.id)}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*    </When>*/}
          {/*    <When condition={props.lab.state === InstanceState.Deploying}>*/}
          {/*      <Button*/}
          {/*        icon="pi pi-power-off"*/}
          {/*        severity="danger"*/}
          {/*        aria-label="Destroy Lab"*/}
          {/*        onClick={() => props.onDestroyLabRequest()}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*    </When>*/}
          {/*    <When condition={props.lab.state === InstanceState.Failed}>*/}
          {/*      <Button*/}
          {/*        icon="pi pi-sync"*/}
          {/*        severity="warning"*/}
          {/*        tooltip="Redeploy"*/}
          {/*        aria-label="Redeploy Lab"*/}
          {/*        onClick={() => labStore.deployLab(props.lab)}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*      <Button*/}
          {/*        icon="pi pi-trash"*/}
          {/*        severity="danger"*/}
          {/*        tooltip="Delete"*/}
          {/*        aria-label="Delete Lab"*/}
          {/*        onClick={() => labStore.delete(props.lab.id)}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*    </When>*/}
          {/*    <When condition={props.lab.state === InstanceState.Running}>*/}
          {/*      <Button*/}
          {/*        icon="pi pi-sync"*/}
          {/*        severity="warning"*/}
          {/*        tooltip="Redeploy"*/}
          {/*        aria-label="Redeploy Lab"*/}
          {/*        onClick={e => {*/}
          {/*          e.stopPropagation();*/}
          {/*          void labStore.deployLab(props.lab);*/}
          {/*        }}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*      <Button*/}
          {/*        icon="pi pi-power-off"*/}
          {/*        severity="danger"*/}
          {/*        tooltip="Destroy"*/}
          {/*        aria-label="Destroy Lab"*/}
          {/*        onClick={() => props.onDestroyLabRequest()}*/}
          {/*        {...defaultLabButtonProps}*/}
          {/*      />*/}
          {/*    </When>*/}
          {/*  </Choose>*/}
          {/*</div>*/}
        </If>
        {/*<span className="lab-state-label">*/}
        {/*  <StateIndicator lab={props.lab} showText={true} />*/}
        {/*  <div className="lab-state-date">*/}
        {/*    <i className="pi pi-clock"></i>*/}
        {/*    <span>{generateDisplayDate(props.lab)}</span>*/}
        {/*  </div>*/}
        {/*</span>*/}
      </div>
    </div>
  );
});

export default LabEntry;

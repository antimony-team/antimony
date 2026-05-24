import './lab-details-overlay.sass';
import {If} from '@sb/types/control';
import {InterfaceEventOut, Lab} from '@sb/types/domain/lab';

import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {TooltipOptions} from 'primereact/tooltip/tooltipoptions';
import React, {useCallback, useMemo, useRef} from 'react';
import {Tooltip, TooltipRefProps} from 'react-tooltip';
import {Tooltip as PrimeTooltip} from 'primereact/tooltip';
import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {getNodeDisplayName} from '@sb/lib/utils/utils';
import {useLabStore} from '@sb/lib/stores/root-store';

import UplotReact from 'uplot-react';
import uplot from 'uplot';

import 'uplot/dist/uPlot.min.css';

interface LabDetailsOverlayProps {
  overlayRef: React.RefObject<TooltipRefProps | null>;

  lab: Lab | null;
  nodeId: string | null;

  onOpenTerminal: () => void;
  onOpenLogs: () => void;

  onNodeStart: () => void;
  onNodeStop: () => void;
  onNodeRestart: () => void;
}

const buttonTooltipOptions: TooltipOptions = {
  position: 'bottom',
  showDelay: 200,
  showOnDisabled: true,
};

const LabDetailsOverlay = observer((props: LabDetailsOverlayProps) => {
  const labStore = useLabStore();

  const node = useMemo(() => {
    if (
      !props.nodeId ||
      !props.lab?.instance ||
      !props.lab.instance.nodeMap.get(props.nodeId)
    ) {
      return null;
    }

    return props.lab.instance.nodeMap.get(props.nodeId)!;
  }, [props.nodeId, props.lab]);

  const nodeActionChecker = useMemo(() => {
    return new NodeActionChecker(props.lab?.instance, node);
  }, [props.lab?.instance, node]);

  const nodeName = useMemo(() => {
    return getNodeDisplayName(node?.name ?? '', props.lab?.instance, node);
  }, [node]);

  const CopyableProperty = ({value}: {value: string}) => (
    <span
      className="property-value copyable"
      data-pr-tooltip="Copy to clipboard"
      data-pr-position="right"
      data-pr-my="left+10 center"
      onClick={() => {
        void navigator.clipboard.writeText(value);
      }}
    >
      {value}
    </span>
  );

  function onOpen() {
    if (!props.lab) return;

    // setStart(0);

    const now = Date.now() / 1000;
    bufferRef.current = [[], [], []];
    chartRef.current?.setData(bufferRef.current);
    // chartRef.current.setData([displayTs, displayVs]);

    labStore.subscribeInterfaceEvents(props.lab.id, handleData);
  }

  function onClose() {
    if (!props.lab) return;

    labStore.unsubscribeInterfaceEvents(props.lab.id, handleData);
  }

  const formatBps = v => {
    if (v == null) return '';
    const abs = Math.abs(v);
    const fmt = n => n.toFixed(1).replace(/\.0$/, '');
    if (abs >= 1e9) return fmt(v / 1e9) + ' Gbps';
    if (abs >= 1e6) return fmt(v / 1e6) + ' Mbps';
    if (abs >= 1e3) return fmt(v / 1e3) + ' Kbps';
    return v.toFixed(0) + ' bps';
  };

  const options: uplot.Options = {
    width: 800,
    height: 300,
    cursor: {
      drag: {
        x: false,
        y: false,
      },
      points: {show: false},
    },
    padding: [null, 40, null, null],
    scales: {
      x: {
        time: true,
        range: () => {
          const [ts] = bufferRef.current;
          const end = ts.length ? ts[ts.length - 1] : Date.now() / 1000;
          return [end - 20, end];
        },
      },
      y: {
        range: (_u, _min, max) => [0, max || 100],
      },
    },
    axes: [
      {
        stroke: '#cdcbcb',
        splits: (_u, _axisIdx, min, max) => [min, max],
        values: (_u, ticks) => {
          return ticks.map(t => new Date(t * 1000).toLocaleTimeString());
        },
      },
      {
        stroke: '#cdcbcb',
        grid: {stroke: '#3d3d3d', width: 1},
        values: (_u, ticks) => ticks.map(formatBps),
        size: 80,
      },
    ],
    series: [
      {
        value: (_u, t) => {
          return t === null ? '--' : new Date(t * 1000).toLocaleTimeString();
        },
      },
      {
        label: 'TX',
        stroke: '#f59e0b',
        fill: 'rgba(245, 158, 11, 0.15)',
        width: 2,
        value: (_u, v) => (v === null ? '--' : formatBps(v)),
      },
      {
        label: 'RX',
        stroke: '#3b82f6',
        fill: 'rgba(59, 130, 246, 0.15)',
        width: 2,
        value: (_u, v) => (v === null ? '--' : formatBps(v)),
      },
    ],
    hooks: {
      draw: [
        u => {
          const {ctx} = u;
          const {left, top, width, height} = u.bbox;
          ctx.save();
          ctx.strokeStyle = '#3d3d3d';
          ctx.lineWidth = 1;
          ctx.strokeRect(left, top, width, height);
          ctx.restore();
        },
      ],
    },
  };

  // const [data, setData] = useState<[number[], number[]]>([[], []]);
  const bufferRef = useRef<[number[], number[], number[]]>([[], [], []]);
  const chartRef = useRef(null);
  // const currentBucketRef = useRef({bucketTs: 0, sum: 0, count: 1});
  // const latestTsRef = useRef(0);

  const handleData = useCallback(
    (data: InterfaceEventOut) => {
      if (!node) return;

      if (data.ifName !== 'eth0') return;

      console.log(data);

      console.log(node.containerId);
      if (data.containerId !== node.containerId) {
        return;
      }

      // const ts_sec = Date.parse(data.timestamp) / 1000;

      const ts_sec = Date.parse(data.timestamp) / 1000;
      // latestTsRef.current = Math.max(latestTsRef.current, ts_sec);

      // const bucketTs = Math.floor(ts_sec);
      // const bucket = currentBucketRef.current;
      const txValue = parseInt(data.txBps);
      const rxValue = parseInt(data.rxBps);

      console.log('TX PACKETS', txValue);
      console.log('RX PACKETS', rxValue);

      // if (bucket && bucket.bucketTs === bucketTs) {
      //   bucket.sum += value;
      //   bucket.count += 1;
      //   return;
      // }

      const [ts, txs, rxs] = bufferRef.current;

      if (ts.length === 0) {
        ts.push(ts_sec - 20);
        txs.push(txValue);
        rxs.push(rxValue);
      }
      // if (bucket) {
      ts.push(ts_sec);
      txs.push(txValue); // average, per earlier discussion
      rxs.push(rxValue); // average, per earlier discussion
      // }

      // const cutoff = ts_sec - 20;
      // while (ts.length && ts[0] < cutoff) {
      //   ts.shift();
      //   vs.shift();
      // }

      // currentBucketRef.current = {bucketTs, sum: value, count: 1};
      chartRef.current.setData([ts, txs, rxs]);
    },
    [props.nodeId],
  );

  return (
    <Tooltip
      ref={props.overlayRef}
      className="lab-details"
      place="right"
      imperativeModeOnly={true}
      border="1px solid var(--primary-color-border)"
      afterShow={onOpen}
      afterHide={onClose}
    >
      <If condition={node !== null}>
        <div className="flex flex-column gap-1">
          <div className="lab-details-title">{nodeName}</div>
          <div className="flex gap-1">
            <span className="property-title">Container ID:</span>
            <CopyableProperty value={node!.containerId} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">Container Name:</span>
            <CopyableProperty value={node!.containerName} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">IPv4:</span>
            <CopyableProperty value={node!.ipv4} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">IPv6:</span>
            <CopyableProperty value={node!.ipv6} />
          </div>

          <div className="flex gap-1">
            <span className="property-title">State:</span>
            <span className="property-value node-dVetails-target">
              {node!.state}
            </span>
          </div>
        </div>
        <div className="button-container">
          <Button
            icon={
              <span className="material-symbols-outlined">
                quick_reference_all
              </span>
            }
            outlined
            onClick={props.onOpenLogs}
            disabled={!nodeActionChecker.canShowLogs}
            tooltip="Show Logs"
            tooltipOptions={buttonTooltipOptions}
          />
          <Button
            icon={<span className="material-symbols-outlined">terminal</span>}
            outlined
            onClick={props.onOpenTerminal}
            disabled={!nodeActionChecker.canOpenTerminal}
            tooltip="Open Terminal"
            tooltipOptions={buttonTooltipOptions}
          />
          <div className="flex-grow-1"></div>
          <Button
            icon="pi pi-play"
            severity="success"
            outlined
            onClick={props.onNodeStart}
            disabled={!nodeActionChecker.canStart}
            tooltip="Start Node"
            tooltipOptions={buttonTooltipOptions}
          />
          <Button
            icon="pi pi-sync"
            severity="warning"
            outlined
            onClick={props.onNodeRestart}
            disabled={!nodeActionChecker.canRestart}
            tooltip="Restart Node"
            tooltipOptions={buttonTooltipOptions}
          />
          <Button
            icon="pi pi-power-off"
            severity="danger"
            outlined
            onClick={props.onNodeStop}
            disabled={!nodeActionChecker.canStop}
            tooltip="Stop Node"
            tooltipOptions={buttonTooltipOptions}
          />
        </div>
        <div className="lab-details-plot-container">
          <UplotReact
            options={options}
            // data={data}
            onCreate={chart => {
              chartRef.current = chart;
            }}
          />
        </div>
      </If>
      <PrimeTooltip target=".property-value" />
    </Tooltip>
  );
});

export default LabDetailsOverlay;

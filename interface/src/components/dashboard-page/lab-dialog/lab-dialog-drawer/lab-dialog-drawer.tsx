import './lab-dialog-drawer.sass';
import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {InstanceNode, InterfaceEventOut, Lab} from '@sb/types/domain/lab';
import UplotReact from 'uplot-react';
import {useLabStore} from '@sb/lib/stores/root-store';
import uPlot from 'uplot';
import {getNodeDisplayName} from '@sb/lib/utils/utils';
import {Divider} from 'primereact/divider';
import {Button} from 'primereact/button';
import SBCopyableProperty from '@sb/components/common/sb-copyable-property/sb-copyable-property';
import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {If} from '@sb/types/control';

import 'uplot/dist/uPlot.min.css';

interface LabDialogDrawer {
  lab: Lab | null;
  nodeName: string | null;

  onOpenTerminal: () => void;
  onOpenLogs: () => void;

  onNodeStart: () => void;
  onNodeStop: () => void;
  onNodeRestart: () => void;
}

const LabDialogDrawer = (props: LabDialogDrawer) => {
  const labStore = useLabStore();

  const wrapperRef = useRef(null);
  const widthRef = useRef(800);
  const trafficChartsRef = useRef<Map<string, uPlot | null>>(new Map());
  const trafficBuffersRef = useRef<Map<string, [number[], number[], number[]]>>(
    new Map(),
  );

  // Reference of the last opened node used for unsubscribing when closing the drawer
  const openNodeRef = useRef<InstanceNode | null>(null);

  const node = useMemo(() => {
    if (!props.lab?.instance || !props.nodeName) return null;
    return props.lab.instance.nodes.find(n => n.name === props.nodeName)!;
  }, [props.lab, props.nodeName]);

  const nodeActionChecker = useMemo(() => {
    if (!props.lab?.instance || !node) return null;
    return new NodeActionChecker(props.lab.instance, node);
  }, [props.lab, node]);

  const nodeName = useMemo(() => {
    return getNodeDisplayName(node?.name ?? '', props.lab?.instance, node);
  }, [node]);

  useEffect(() => {
    if (!wrapperRef.current) return;

    const observer = new ResizeObserver(onResizeDrawer);
    observer.observe(wrapperRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!props.lab) return;

    if (!node) {
      unsubscribeFromNode(openNodeRef.current);
    } else {
      openNodeRef.current = node;

      const nodeInterfaces = Object.keys(node.interfaceCaptures);
      trafficBuffersRef.current = new Map(
        nodeInterfaces.map(ifName => [ifName, [[], [], []]]),
      );

      Object.keys(node.interfaceCaptures).forEach(ifName => {
        labStore.subscribeInterfaceEvents(node.containerId, ifName, handleData);
      });
    }
  }, [node]);

  function unsubscribeFromNode(node: InstanceNode | null) {
    if (!node) return;

    Object.keys(node.interfaceCaptures).forEach(ifName => {
      labStore.unsubscribeInterfaceEvents(node.containerId, ifName, handleData);
    });
  }

  function onResizeDrawer(entries: ResizeObserverEntry[]) {
    const {width} = entries[0].contentRect;
    widthRef.current = width;
    trafficChartsRef.current.entries().forEach(([ifName, chart]) => {
      if (!chart) return;
      chart.setSize({width, height: 250});
      chart.setData(trafficBuffersRef.current.get(ifName)!);
    });
  }

  function formatBps(v: number | null) {
    if (!v) return '';

    const abs = Math.abs(v);
    const fmt = (n: number) => n.toFixed(1).replace(/\.0$/, '');
    if (abs >= 1e9) return fmt(v / 1e9) + ' Gbps';
    if (abs >= 1e6) return fmt(v / 1e6) + ' Mbps';
    if (abs >= 1e3) return fmt(v / 1e3) + ' Kbps';

    return v.toFixed(0) + ' bps';
  }

  function getPlotOptions(ifName: string): uPlot.Options {
    return {
      width: 800,
      height: 250,
      cursor: {
        drag: {
          x: false,
          y: false,
        },
        points: {show: false},
      },
      padding: [null, 70, null, null],
      scales: {
        x: {
          time: true,
          range: () => {
            if (!trafficBuffersRef.current.has(ifName)) return [0, 1];
            const [ts] = trafficBuffersRef.current.get(ifName)!;
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
  }

  const handleData = useCallback(
    (data: InterfaceEventOut) => {
      if (!node || data.containerId !== node.containerId) return;

      console.log('Node data:', data);

      const ts_sec = Date.parse(data.timestamp) / 1000;

      const [ts, txs, rxs] = trafficBuffersRef.current.get(data.ifName)!;

      const txValue = parseInt(data.txBps);
      const rxValue = parseInt(data.rxBps);

      // Add initial point to draw line to the left side when graph is empty
      if (ts.length === 0) {
        ts.push(ts_sec - 20);
        txs.push(txValue);
        rxs.push(rxValue);
      }

      ts.push(ts_sec);
      txs.push(txValue);
      rxs.push(rxValue);

      if (trafficChartsRef.current.has(data.ifName)) {
        trafficChartsRef.current.get(data.ifName)!.setData([ts, txs, rxs]);
      }
    },
    [node],
  );

  return (
    <div className="lab-dialog-drawer-content" ref={wrapperRef}>
      <If condition={node && nodeActionChecker}>
        <div className="lab-dialog-drawer-content-inner">
          <div className="lab-dialog-drawer-title">
            {nodeName} ({node!.state})
          </div>
          <div className="flex flex-row gap-4 justify-content-between">
            <div className="flex flex-column gap-1">
              <div className="flex gap-1">
                <span className="property-title">Container ID:</span>
                <SBCopyableProperty value={node!.containerId} />
              </div>

              <div className="flex gap-1">
                <span className="property-title">Container Name:</span>
                <SBCopyableProperty value={node!.containerName} />
              </div>

              <div className="flex gap-1">
                <span className="property-title">Mgmt IPv4:</span>
                <SBCopyableProperty value={node!.ipv4} />
              </div>

              <div className="flex gap-1">
                <span className="property-title">Mgmt IPv6:</span>
                <SBCopyableProperty value={node!.ipv6} />
              </div>

              <div className="flex gap-1">
                <span className="property-title">Interfaces:</span>
                <span className="property-value">
                  {Object.keys(node!.interfaceCaptures).join(', ')}
                </span>
              </div>
            </div>
            <div className="lab-dialog-drawer-special-buttons">
              <Button
                icon={
                  <span className="material-symbols-outlined">
                    quick_reference_all
                  </span>
                }
                label="Open Terminal"
                outlined
                onClick={props.onOpenLogs}
                disabled={!nodeActionChecker!.canShowLogs}
              />
              <Button
                icon={
                  <span className="material-symbols-outlined">terminal</span>
                }
                label="Show Logs"
                outlined
                onClick={props.onOpenTerminal}
                disabled={!nodeActionChecker!.canOpenTerminal}
              />
            </div>
          </div>
          {Object.keys(node!.interfaceCaptures).map(ifname => (
            <div style={{position: 'relative'}}>
              <Divider />
              <div className="lab-details-plot-title">{ifname}</div>
              <UplotReact
                options={getPlotOptions(ifname)}
                onCreate={chart => {
                  trafficChartsRef.current.set(ifname, chart);
                  chart.setSize({width: widthRef.current, height: 250});
                }}
                data={[]}
              />
              <Button
                style={{position: 'absolute', top: 4, right: 0}}
                outlined
                icon="pi pi-eye"
                label="Start Capture"
                onClick={() => {}}
                aria-label="Submit"
              />
            </div>
          ))}
        </div>
        <div className="lab-dialog-drawer-control-buttons">
          <Button
            icon="pi pi-play"
            severity="success"
            label="Start"
            outlined
            onClick={props.onNodeStart}
            disabled={!nodeActionChecker!.canStart}
          />
          <Button
            icon="pi pi-sync"
            severity="warning"
            label="Restart"
            outlined
            onClick={props.onNodeRestart}
            disabled={!nodeActionChecker!.canRestart}
          />
          <Button
            icon="pi pi-power-off"
            severity="danger"
            label="Shutdown"
            outlined
            onClick={props.onNodeStop}
            disabled={!nodeActionChecker!.canStop}
          />
        </div>
      </If>
    </div>
  );
};

export default LabDialogDrawer;

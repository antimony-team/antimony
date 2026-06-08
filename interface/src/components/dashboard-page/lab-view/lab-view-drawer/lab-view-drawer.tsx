import './lab-view-drawer.sass';
import React, {useEffect, useMemo, useRef} from 'react';
import {Lab, NodeInterfaceStatsOut, NodeStatsOut} from '@sb/types/domain/lab';
import UplotReact from 'uplot-react';
import {
  useLabStore,
  useServerConfig,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import uPlot from 'uplot';
import {
  formatBytes,
  getInterfaceCaptureCommand,
  getNodeDisplayName,
} from '@sb/lib/utils/utils';
import {Divider} from 'primereact/divider';
import {Button} from 'primereact/button';
import SBCopyableProperty from '@sb/components/common/sb-copyable-property/sb-copyable-property';
import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {If} from '@sb/types/control';

import 'uplot/dist/uPlot.min.css';

interface LabViewDrawer {
  lab: Lab | null;
  nodeName: string | null;

  onOpenTerminal: () => void;
  onOpenLogs: () => void;

  onNodeStart: () => void;
  onNodeStop: () => void;
  onNodeRestart: () => void;
}

const LabDialogDrawer = (props: LabViewDrawer) => {
  const labStore = useLabStore();
  const serverConfig = useServerConfig();
  const statusMessageStore = useStatusMessages();

  const wrapperRef = useRef(null);
  const widthRef = useRef(800);
  const cpuUsageChartRef = useRef<uPlot | null>(null);
  const memoryUsageChartRef = useRef<uPlot | null>(null);
  const trafficChartsRef = useRef<Map<string, uPlot | null>>(new Map());

  const trafficBuffersRef = useRef<Map<string, [number[], number[], number[]]>>(
    new Map(),
  );
  const cpuUsageBufferRef = useRef<[number[], number[]]>([[], []]);
  const memoryUsageBufferRef = useRef<[number[], number[]]>([[], []]);
  const memoryTotalRef = useRef<number>(0);

  const node = useMemo(() => {
    if (!props.lab?.instance || !props.nodeName) {
      return null;
    }
    return props.lab.instance.nodes.find(n => n.name === props.nodeName)!;
  }, [props.lab, props.nodeName]);

  const nodeActionChecker = useMemo(() => {
    if (!props.lab?.instance || !node) {
      return null;
    }
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

    if (node) {
      trafficBuffersRef.current = new Map(
        node.interfaces.map(iface => [iface.name, [[], [], []]]),
      );
      cpuUsageBufferRef.current = [[], []];
      memoryUsageBufferRef.current = [[], []];

      labStore.subscribeNodeStats(node.containerId, handleData);
    }

    return () => {
      if (!node) return;
      labStore.unsubscribeNodeStats(node.containerId, handleData);
    };
  }, [node]);

  function onResizeDrawer(entries: ResizeObserverEntry[]) {
    const {width} = entries[0].contentRect;
    widthRef.current = width;
    trafficChartsRef.current.entries().forEach(([ifName, chart]) => {
      if (!chart) return;
      chart.setSize({width, height: 200});
      chart.setData(trafficBuffersRef.current.get(ifName)!);
    });
    cpuUsageChartRef.current?.setSize({width: width / 2, height: 200});
    memoryUsageChartRef.current?.setSize({width: width / 2, height: 200});
  }

  function formatBps(v: number | null) {
    if (v === null) return '';

    const abs = Math.abs(v);
    const fmt = (n: number) => n.toFixed(1).replace(/\.0$/, '');
    if (abs >= 1e9) return fmt(v / 1e9) + ' Gbps';
    if (abs >= 1e6) return fmt(v / 1e6) + ' Mbps';
    if (abs >= 1e3) return fmt(v / 1e3) + ' Kbps';

    return v.toFixed(0) + ' bps';
  }

  function getMemoryUsagePlotOptions(): uPlot.Options {
    return {
      width: 800,
      height: 200,
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
            if (!cpuUsageBufferRef.current) return [0, 1];
            const [ts] = cpuUsageBufferRef.current;
            const end = ts.length ? ts[ts.length - 1] : Date.now() / 1000;
            return [end - 20, end];
          },
        },
        y: {
          range: (_u, _min, max) => [0, max * 1.8 || 100],
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
          values: (_u, ticks) => ticks.map(n => formatBytes(n)),
          size: 65,
        },
      ],
      series: [
        {
          value: (_u, t) => {
            const [ys] = memoryUsageBufferRef.current;
            const lastValue = ys[ys.length - 1];
            const value = t === null ? lastValue : t;
            return value !== undefined
              ? new Date(value * 1000).toLocaleTimeString()
              : '--';
          },
        },
        {
          label: 'Usage',
          stroke: '#3fcfad',
          fill: 'rgba(63, 207, 173, 0.15)',
          width: 2,
          value: (_u, v) => {
            const [, ts] = memoryUsageBufferRef.current;
            const lastValue = ts[ts.length - 1];
            const value = v === null ? lastValue : v;
            return value !== undefined ? formatBytes(value) : '--';
          },
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

  function getCPUPlotOptions(): uPlot.Options {
    return {
      width: 800,
      height: 200,
      cursor: {
        drag: {
          x: false,
          y: false,
        },
        points: {show: false},
      },
      padding: [null, 55, null, null],
      scales: {
        x: {
          time: true,
          range: () => {
            if (!cpuUsageBufferRef.current) return [0, 1];
            const [ts] = cpuUsageBufferRef.current;
            const end = ts.length ? ts[ts.length - 1] : Date.now() / 1000;
            return [end - 20, end];
          },
        },
        y: {
          range: () => [0, 1],
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
          values: (_u, ticks) => ticks.map(n => `${n * 100}%`),
          size: 80,
        },
      ],
      series: [
        {
          value: (_u, t) => {
            const [ys] = cpuUsageBufferRef.current;
            const lastValue = ys[ys.length - 1];
            const value = t === null ? lastValue : t;
            return value !== undefined
              ? new Date(value * 1000).toLocaleTimeString()
              : '--';
          },
        },
        {
          label: 'Usage',
          stroke: '#3fcfad',
          fill: 'rgba(63, 207, 173, 0.15)',
          width: 2,
          value: (_u, v) => {
            const [, ts] = cpuUsageBufferRef.current;
            const lastValue = ts[ts.length - 1];
            const value = v === null ? lastValue : v;
            return value !== undefined ? `${(value * 100).toFixed(1)}%` : '--';
          },
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

  function getNetworkPlotOptions(ifName: string): uPlot.Options {
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
            const [ys] = trafficBuffersRef.current.get(ifName)!;
            const lastValue = ys[ys.length - 1];
            const value = t === null ? lastValue : t;
            return value !== undefined
              ? new Date(value * 1000).toLocaleTimeString()
              : '--';
          },
        },
        {
          label: 'TX',
          stroke: '#f59e0b',
          fill: 'rgba(245, 158, 11, 0.15)',
          width: 2,
          value: (_u, v) => {
            const [, tsx] = trafficBuffersRef.current.get(ifName)!;
            const lastValue = tsx[tsx.length - 1];
            const value = v === null ? lastValue : v;
            return value !== undefined ? formatBps(value) : '--';
          },
        },
        {
          label: 'RX',
          stroke: '#3b82f6',
          fill: 'rgba(59, 130, 246, 0.15)',
          width: 2,
          value: (_u, v) => {
            const [, , rsx] = trafficBuffersRef.current.get(ifName)!;
            const lastValue = rsx[rsx.length - 1];
            const value = v === null ? lastValue : v;
            return value !== undefined ? formatBps(value) : '--';
          },
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

  function handleData(data: NodeStatsOut) {
    if (!node) return;

    const ts_sec = Date.parse(data.timestamp) / 1000;

    addCpuUsageData(data, ts_sec);
    addMemoryUsageData(data, ts_sec);

    for (const ifName in data.interfaces) {
      addInterfaceData(ifName, data.interfaces[ifName], ts_sec);
    }
  }

  function addCpuUsageData(data: NodeStatsOut, currentSeconds: number) {
    if (!cpuUsageChartRef.current) return;

    const [ts, tx] = cpuUsageBufferRef.current;

    // Add initial point to draw line to the bottom when graph is not yet filled
    if (ts.length === 0) {
      ts.push(currentSeconds - 1);
      tx.push(0);
    }

    ts.push(currentSeconds);
    tx.push(data.cpuPercent);

    cpuUsageChartRef.current.setData([ts, tx]);
  }

  function addMemoryUsageData(data: NodeStatsOut, currentSeconds: number) {
    if (!memoryUsageChartRef.current) return;

    const [ts, tx] = memoryUsageBufferRef.current;

    // Add initial point to draw line to the bottom when graph is not yet filled
    if (ts.length === 0) {
      ts.push(currentSeconds - 1);
      tx.push(0);
    }

    memoryTotalRef.current = data.memoryLimit;

    ts.push(currentSeconds);
    tx.push(data.memoryUsage);

    memoryUsageChartRef.current.setData([ts, tx]);
  }

  function addInterfaceData(
    ifName: string,
    data: NodeInterfaceStatsOut,
    currentSeconds: number,
  ) {
    if (!trafficBuffersRef.current.has(ifName)) return;

    const [ts, txs, rxs] = trafficBuffersRef.current.get(ifName)!;

    const txValue = data.txBps;
    const rxValue = data.rxBps;

    // Add initial point to draw line to the bottom when graph is not yet filled
    if (ts.length === 0) {
      ts.push(currentSeconds - 1);
      txs.push(0);
      rxs.push(0);
    }

    ts.push(currentSeconds);
    txs.push(txValue);
    rxs.push(rxValue);

    trafficChartsRef.current.get(ifName)!.setData([ts, txs, rxs]);
  }

  function copyCaptureToClipboard(ifName: string) {
    if (!node) return;

    const cmd = getInterfaceCaptureCommand(
      node.containerName,
      ifName,
      window.location.hostname,
      serverConfig.capture.port,
    );
    void navigator.clipboard.writeText(cmd);

    statusMessageStore.success('Capture command copied to clipboard!');
  }

  return (
    <div className="lab-dialog-drawer-content" ref={wrapperRef}>
      <If condition={node && nodeActionChecker}>
        <div className="lab-dialog-drawer-content-inner">
          <div className="lab-dialog-drawer-title">
            {nodeName} ({node!.state})
          </div>
          <div className="flex flex-row gap-4 justify-content-between">
            <div className="flex flex-column gap-1">
              <div className="flex gap-1 flex-wrap">
                <span className="property-title">Container ID:</span>
                <SBCopyableProperty value={node!.containerId} />
              </div>

              <div className="flex gap-1 flex-wrap">
                <span className="property-title">Container Name:</span>
                <SBCopyableProperty value={node!.containerName} />
              </div>

              <div className="flex gap-1 flex-wrap">
                <span className="property-title">Mgmt IPv4:</span>
                <SBCopyableProperty value={node!.ipv4} />
              </div>

              <div className="flex gap-1 flex-wrap">
                <span className="property-title">Mgmt IPv6:</span>
                <SBCopyableProperty value={node!.ipv6} />
              </div>

              <div className="flex gap-1 flex-wrap">
                <span className="property-title">Interfaces:</span>
                <span className="property-value">
                  {node!.interfaces.map(iface => iface.name).join(', ')}
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
                label="Show Logs"
                aria-label="Show Logs"
                outlined
                onClick={props.onOpenLogs}
                disabled={!nodeActionChecker!.canShowLogs}
              />
              <Button
                icon={
                  <span className="material-symbols-outlined">terminal</span>
                }
                label="Open Terminal"
                aria-label="Open Terminal"
                outlined
                onClick={props.onOpenTerminal}
                disabled={!nodeActionChecker!.canOpenTerminal}
              />
            </div>
          </div>
          <div className="flex mt-4">
            <div>
              <div className="lab-details-plot-title">CPU Usage</div>
              <UplotReact
                options={getCPUPlotOptions()}
                onCreate={chart => {
                  cpuUsageChartRef.current = chart;
                  chart.setSize({width: widthRef.current / 2, height: 200});
                }}
                data={[]}
              />
            </div>
            <div>
              <div className="lab-details-plot-title">Memory Usage</div>
              <UplotReact
                options={getMemoryUsagePlotOptions()}
                onCreate={chart => {
                  memoryUsageChartRef.current = chart;
                  chart.setSize({width: widthRef.current / 2, height: 200});
                }}
                data={[]}
              />
            </div>
          </div>
          {node!.interfaces.map((iface, i) => (
            <div style={{position: 'relative'}} key={i}>
              <Divider />
              <div className="lab-details-plot-title">{iface.name}</div>
              <UplotReact
                options={getNetworkPlotOptions(iface.name)}
                onCreate={chart => {
                  trafficChartsRef.current.set(iface.name, chart);
                  chart.setSize({width: widthRef.current, height: 200});
                }}
                data={[]}
              />
              <Button
                style={{position: 'absolute', top: 4, right: 0}}
                outlined
                icon="pi pi-eye"
                label="Start Capture"
                onClick={() => copyCaptureToClipboard(iface.name)}
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

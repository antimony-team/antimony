import './lab-view-drawer.sass';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  InstanceNode,
  InstanceNodeState,
  Lab,
  NodeInterfaceStats,
  NodeStats,
} from '@sb/types/domain/lab';
import UplotReact from 'uplot-react';
import {
  useLabStore,
  useServerConfig,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import uPlot from 'uplot';
import {formatBytes, getInterfaceCaptureCommand} from '@sb/lib/utils/utils';
import {Divider} from 'primereact/divider';
import {Button} from 'primereact/button';
import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {Choose, If, Otherwise, When} from '@sb/types/control';

import 'uplot/dist/uPlot.min.css';
import {Message} from 'primereact/message';
import SBCopyableProperty from '@sb/components/common/sb-copyable-property/sb-copyable-property';
import {ProgressBar} from 'primereact/progressbar';

interface LabViewDrawer {
  lab: Lab | null;
  nodeName: string | null;

  onOpenTerminal: (nodeId: string | null) => void;
  onOpenLogs: (nodeId: string | null) => void;

  onNodeStart: (nodeId: string | null) => void;
  onNodeStop: (nodeId: string | null) => void;
  onNodeRestart: (nodeId: string | null) => void;
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

  const [networkRates, setNetworkRates] = useState<
    Record<string, {tx: number; rx: number}>
  >({});

  const [cpuRate, setCpuRate] = useState<number>(0);
  const [memoryRate, setMemoryRate] = useState<number>(0);

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

  const memoryOptions = useMemo(() => getMemoryUsagePlotOptions(), []);
  const cpuOptions = useMemo(() => getCPUPlotOptions(), []);

  const ifaceOptions = useMemo(
    () =>
      Object.fromEntries(
        (node?.interfaces ?? []).map(i => [
          i.name,
          getNetworkPlotOptions(i.name),
        ]),
      ),
    [node?.interfaces],
  );

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

      if (node.state === InstanceNodeState.Running) {
        labStore.subscribeNodeStats(node.containerId, handleData);
      }
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
      chart.setSize({width, height: 100});
      chart.setData(trafficBuffersRef.current.get(ifName)!);
    });
    cpuUsageChartRef.current?.setSize({width: width / 2 - 28, height: 50});
    memoryUsageChartRef.current?.setSize({width: width / 2 - 28, height: 50});
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

  function getCPUPlotOptions(): uPlot.Options {
    return {
      width: 300, // overridden by the resize observer
      height: 50,
      legend: {show: false},
      cursor: {show: false},
      padding: [2, 0, 2, 0],
      axes: [{show: false}, {show: false}],
      scales: {
        x: {
          time: true,
          range: () => {
            const [ts] = cpuUsageBufferRef.current;
            const end = ts.length ? ts[ts.length - 1] : Date.now() / 1000;
            return [end - 20, end];
          },
        },
        y: {range: (_u, _min, max) => [0, Math.max(max * 1.5, 0.1)]},
      },
      series: [
        {},
        {
          stroke: '#3fcfad',
          fill: 'rgba(63, 207, 173, 0.08)',
          width: 1.5,
          points: {show: false},
        },
      ],
    };
  }

  function getMemoryUsagePlotOptions(): uPlot.Options {
    return {
      width: 300,
      height: 50,
      legend: {show: false},
      cursor: {show: false},
      padding: [2, 0, 2, 0],
      axes: [{show: false}, {show: false}],
      scales: {
        x: {
          time: true,
          range: () => {
            const [ts] = memoryUsageBufferRef.current;
            const end = ts.length ? ts[ts.length - 1] : Date.now() / 1000;
            return [end - 20, end];
          },
        },
        y: {
          range: (_u, _min, max) => [
            0,
            Math.max(max * 1.5, memoryTotalRef.current * 0.25 || 1),
          ],
        },
      },
      series: [
        {},
        {
          stroke: '#3fcfad',
          fill: 'rgba(63, 207, 173, 0.08)',
          width: 1.5,
          points: {show: false},
        },
      ],
    };
  }

  function getNetworkPlotOptions(ifName: string): uPlot.Options {
    return {
      width: 300,
      height: 100,
      legend: {show: false},
      cursor: {show: false},
      padding: [2, 32, 2, 0],
      axes: [
        {
          show: false,
          stroke: '#8b93a1',
          splits: (_u, _axisIdx, min, max) => [min, max],
          values: (_u, ticks) =>
            ticks.map(t => new Date(t * 1000).toLocaleTimeString()),
        },
        {show: false},
      ],
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
        y: {range: (_u, _min, max) => [0, max * 1.2 || 100]},
      },
      series: [
        {},
        {
          stroke: '#f59e0b',
          fill: 'rgba(245, 158, 11, 0.12)',
          width: 1.5,
          points: {show: false},
        },
        {
          stroke: '#3b82f6',
          fill: 'rgba(59, 130, 246, 0.12)',
          width: 1.5,
          points: {show: false},
        },
      ],
    };
  }
  function handleData(data: NodeStats) {
    if (!node) return;

    const ts_sec = Date.parse(data.timestamp) / 1000;

    addCpuUsageData(data, ts_sec);
    addMemoryUsageData(data, ts_sec);

    for (const ifName in data.interfaces) {
      addInterfaceData(ifName, data.interfaces[ifName], ts_sec);
    }
  }

  function addCpuUsageData(data: NodeStats, currentSeconds: number) {
    if (!cpuUsageChartRef.current) return;
    const value = Math.min(data.cpuPercent, 1);

    const [ts, tx] = cpuUsageBufferRef.current;

    // Add initial point to draw line to the bottom when graph is not yet filled
    if (ts.length === 0) {
      ts.push(currentSeconds - 20);
      tx.push(value);
    }

    setCpuRate(data.cpuPercent);

    // We clamp the CPU percentage to 100% to prevent weird spikes when restarting
    ts.push(currentSeconds);
    tx.push(value);

    cpuUsageChartRef.current.setData([ts, tx]);
  }

  function addMemoryUsageData(data: NodeStats, currentSeconds: number) {
    if (!memoryUsageChartRef.current) return;

    const [ts, tx] = memoryUsageBufferRef.current;

    // Add initial point to draw line to the bottom when graph is not yet filled
    if (ts.length === 0) {
      ts.push(currentSeconds - 20);
      tx.push(data.memoryUsage);
    }

    memoryTotalRef.current = data.memoryLimit;

    setMemoryRate(data.memoryUsage);

    ts.push(currentSeconds);
    tx.push(data.memoryUsage);

    memoryUsageChartRef.current.setData([ts, tx]);
  }

  function addInterfaceData(
    ifName: string,
    data: NodeInterfaceStats,
    currentSeconds: number,
  ) {
    if (!trafficBuffersRef.current.has(ifName)) return;

    const [ts, txs, rxs] = trafficBuffersRef.current.get(ifName)!;

    const txValue = data.txBps;
    const rxValue = data.rxBps;

    setNetworkRates(prev => ({
      ...prev,
      [ifName]: {tx: txValue, rx: rxValue},
    }));

    // Add initial point to draw line to the bottom when graph is not yet filled
    if (ts.length === 0) {
      ts.push(currentSeconds - 20);
      txs.push(txValue);
      rxs.push(rxValue);
    }

    ts.push(currentSeconds);
    txs.push(txValue);
    rxs.push(rxValue);

    trafficChartsRef.current.get(ifName)!.setData([ts, txs, rxs]);
  }

  function copyCaptureToClipboard(ifName: string) {
    if (!node) return;

    const cmd = getInterfaceCaptureCommand(
      node.containerId,
      ifName,
      window.location.hostname,
      serverConfig.capture.port,
    );
    void navigator.clipboard.writeText(cmd);

    statusMessageStore.success('Capture command copied to clipboard!');
  }

  function runtimeValue(value: string | undefined) {
    if (node!.state === InstanceNodeState.Starting) {
      return <span className="pending">Pending</span>;
    }
    if (!value) {
      return <span>N/A</span>;
    }
    return <SBCopyableProperty value={value} />;
  }

  return (
    <div className="lab-dialog-drawer-content" ref={wrapperRef}>
      <If condition={node && nodeActionChecker}>
        <div className="lab-dialog-drawer-content-inner">
          <NodeHeader node={node!} />
          <Divider />
          <dl className="lab-dialog-drawer-props">
            <dt>Name</dt>
            <dd>
              <SBCopyableProperty value={node!.name} />
            </dd>

            <dt>Kind</dt>
            <dd>
              <SBCopyableProperty value={node!.kind} />
            </dd>

            <If condition={node!.state !== InstanceNodeState.Stopped}>
              <dt>Container ID</dt>
              <dd>{runtimeValue(node!.containerId)}</dd>

              <dt>Container Name</dt>
              <dd>{runtimeValue(node!.containerName)}</dd>

              <dt>Mgmt IPv4</dt>
              <dd>{runtimeValue(node!.ipv4)}</dd>

              <dt>Mgmt IPv6</dt>
              <dd>{runtimeValue(node!.ipv6)}</dd>

              <dt>Interfaces</dt>
              <dd>
                <Choose>
                  <When
                    condition={
                      !node!.isReady &&
                      node!.state === InstanceNodeState.Starting
                    }
                  >
                    <span className="pending">Pending</span>
                  </When>
                  <When condition={node!.interfaces!.length === 0}>
                    <span>None</span>
                  </When>
                  <Otherwise>
                    <span>
                      {node!.interfaces!.map(iface => iface.name).join(', ')}
                    </span>
                  </Otherwise>
                </Choose>
              </dd>
            </If>
          </dl>
          <div className="lab-dialog-drawer-special-buttons">
            <Button
              icon={
                <span className="material-symbols-outlined">
                  quick_reference_all
                </span>
              }
              label="Node Logs"
              aria-label="Node Logs"
              outlined
              onClick={() => props.onOpenLogs(props.nodeName)}
              disabled={!nodeActionChecker!.canShowLogs}
            />
            <Button
              icon={<span className="material-symbols-outlined">terminal</span>}
              label="Open Terminal"
              aria-label="Open Terminal"
              outlined
              onClick={() => props.onOpenTerminal(props.nodeName)}
              disabled={!nodeActionChecker!.canOpenTerminal}
            />
          </div>
          <If condition={node!.isReady}>
            <div className="flex mt-4 gap-4">
              <div className="lab-details-plot">
                <div className="lab-details-plot-header">
                  <div>
                    <div className="lab-details-plot-title">CPU</div>
                    <div className="lab-details-plot-rates">
                      {cpuRate.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <ProgressBar
                  value={Math.round(cpuRate)}
                  showValue={false}
                  className="metric-bar"
                />
                <UplotReact
                  options={cpuOptions}
                  onCreate={chart => {
                    cpuUsageChartRef.current = chart;
                    chart.setSize({
                      width: widthRef.current / 2 - 28,
                      height: 50,
                    });
                  }}
                  data={[]}
                />
              </div>
              <div className="lab-details-plot">
                <div className="lab-details-plot-header">
                  <div>
                    <div className="lab-details-plot-title">Memory Usage</div>
                    <div className="lab-details-plot-rates">
                      {formatBytes(memoryRate)}
                    </div>
                  </div>
                </div>
                <ProgressBar
                  value={((memoryRate / memoryTotalRef.current) * 100).toFixed(
                    2,
                  )}
                  showValue={false}
                  className="metric-bar"
                />
                <UplotReact
                  options={memoryOptions}
                  onCreate={chart => {
                    memoryUsageChartRef.current = chart;
                    chart.setSize({
                      width: widthRef.current / 2 - 28,
                      height: 50,
                    });
                  }}
                  data={[]}
                />
              </div>
            </div>
          </If>
          {node!.interfaces.map((iface, i) => (
            <div className="lab-details-plot" key={i}>
              <Divider />
              <div className="lab-details-plot-header">
                <div>
                  <div className="lab-details-net-plot-title">{iface.name}</div>
                  <div className="lab-details-net-plot-rates">
                    <span>
                      <i className="swatch tx" /> TX{' '}
                      {formatBps(networkRates[iface.name]?.tx ?? 0)}
                    </span>
                    <span>
                      <i className="swatch rx" /> RX{' '}
                      {formatBps(networkRates[iface.name]?.rx ?? 0)}
                    </span>
                  </div>
                </div>
                <Button
                  outlined
                  icon="pi pi-copy"
                  label="Copy Capture Command"
                  onClick={() => copyCaptureToClipboard(iface.name)}
                  aria-label="Submit"
                />
              </div>
              <UplotReact
                options={ifaceOptions[iface.name]}
                onCreate={chart => {
                  trafficChartsRef.current.set(iface.name, chart);
                  chart.setSize({width: widthRef.current, height: 100});
                }}
                data={[]}
              />
            </div>
          ))}
        </div>
        <div className="lab-dialog-drawer-control-buttons">
          <If condition={!node?.canRestart}>
            <Message
              severity="info"
              text={`Nodes with kind '${node?.kind}' can't be manually started`}
            />
          </If>
          <div className="flex gap-2">
            <Button
              icon="pi pi-sync"
              label="Restart"
              outlined
              onClick={() => props.onNodeRestart(props.nodeName)}
              disabled={!nodeActionChecker!.canRestart}
            />
            <Choose>
              <When condition={nodeActionChecker!.canStart}>
                <Button
                  icon="pi pi-play"
                  label="Start"
                  outlined
                  onClick={() => props.onNodeStart(props.nodeName)}
                  disabled={!nodeActionChecker!.canStart}
                />
              </When>
              <Otherwise>
                <Button
                  icon="pi pi-power-off"
                  severity="danger"
                  label="Shutdown"
                  outlined
                  onClick={() => props.onNodeStop(props.nodeName)}
                  disabled={!nodeActionChecker!.canStop}
                />
              </Otherwise>
            </Choose>
          </div>
        </div>
      </If>
    </div>
  );
};

function NodeHeader({node}: {node: InstanceNode}) {
  const stateString = useMemo(() => {
    let state = node.state;

    if (state === InstanceNodeState.Running && !node.isReady) {
      state = InstanceNodeState.Starting;
    }

    return InstanceNodeState[state].toLocaleLowerCase();
  }, [node]);

  return (
    <div className={`lab-dialog-drawer-header ${stateString}`}>
      <span className="lab-dialog-drawer-header-title">{node.name}</span>
      <span className="lab-dialog-drawer-header-state">{stateString}</span>
    </div>
  );
}

export default LabDialogDrawer;

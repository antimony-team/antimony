import {DataStore} from '@sb/lib/stores/data-store';
import {DeviceInfo, InterfaceConfig} from '@sb/types/domain/device-info';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {TopologyNode} from '@sb/types/domain/topology';

export class DeviceStore extends DataStore<DeviceInfo, DeviceInfo, DeviceInfo> {
  protected get resourcePath(): string {
    return '/devices';
  }

  protected handleUpdate(response: DataResponse<DeviceInfo[]>): void {
    this.data = response.payload;
    this.lookup = new Map(this.data.map(device => [device.kind, device]));
  }

  public getNodeIcon(node?: TopologyNode | null): string {
    let iconPath = '/icons/nodes/client.svg';
    const icon = node?.labels?.['graph-icon'];
    if (icon !== undefined) {
      if (NodeIconMap.has(icon)) {
        iconPath = `/icons/nodes/${NodeIconMap.get(icon)!}.svg`;
      }
    }
    return iconPath;
  }

  public getAllIcons(): string[][] {
    return [...new Set(NodeIconMap.values())].map(entry => [
      entry,
      `/icons/nodes/${NodeIconMap.get(entry)!}.svg`,
    ]);
  }

  public getNodeShape(node?: TopologyNode | null): string {
    let iconShape = 'octagon';
    const icon = node?.labels?.['graph-icon'];
    if (icon !== undefined) {
      if (IconShapeMap.has(icon)) {
        iconShape = IconShapeMap.get(icon)!;
      }
    }
    return iconShape;
  }

  /**
   * Returns the interface config of a given node.
   *
   * If the node's kind does not have a specific config, the default config
   * is returned instead.
   */
  public getInterfaceConfig(nodeKind?: string) {
    if (!nodeKind) return DefaultDeviceConfig;

    return this.lookup.get(nodeKind) ?? DefaultDeviceConfig;
  }
}

const NodeIconMap = new Map<string, string>([
  ['pe', 'router'],
  ['router', 'router'],
  ['dcgw', 'dcgw'],
  ['leaf', 'switch'],
  ['switch', 'switch'],
  ['spine', 'spine'],
  ['server', 'server'],
  ['pon', 'pon'],
  ['controller', 'controller'],
  ['rgw', 'rgw'],
  ['client', 'client'],
]);

const IconShapeMap = new Map<string, string>([
  ['pe', 'ellipse'],
  ['router', 'ellipse'],
  ['dcgw', 'ellipse'],
  ['leaf', 'ellipse'],
  ['switch', 'ellipse'],
  ['spine', 'ellipse'],
  ['server', 'octagon'],
  ['pon', 'octagon'],
  ['controller', 'octagon'],
  ['rgw', 'octagon'],
  ['client', 'octagon'],
]);

const DefaultDeviceConfig: InterfaceConfig = {
  interfacePattern: 'eth$',
  interfaceStart: 1,
};

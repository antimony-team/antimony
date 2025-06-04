import {DataStore} from '@sb/lib/stores/data-store';
import {DeviceInfo, InterfaceConfig} from '@sb/types/domain/device-info';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

export class DeviceStore extends DataStore<DeviceInfo, DeviceInfo, DeviceInfo> {
  protected get resourcePath(): string {
    return '/devices';
  }

  protected handleUpdate(response: DataResponse<DeviceInfo[]>): void {
    this.data = response.payload;
    this.lookup = new Map(this.data.map(device => [device.kind, device]));
  }
  /*
  public getNodeIcon(kind?: string) {
    let iconName;
    if (kind) {
      const deviceInfo = this.lookup.get(kind);

      if (deviceInfo) {
        iconName = IconMap.get(deviceInfo?.type);
      } else {
        iconName = 'generic';
      }
    }
    if (!kind || !iconName) iconName = 'generic';

    return '/icons/' + iconName + '.svg';
  }*/

  public getNodeIcon(node: TopologyNode | undefined) {
    let icon_path = '/icons/generic.svg';
    const icon = node?.labels?.['graph-icon'];
    if (icon !== undefined) {
      if (IconMap.get(icon) !== undefined) {
        icon_path = `/icons/${IconMap.get(icon)}.svg`;
      }
    }
    return icon_path;
  }
  /**
   * Returns the interface config of a given node.
   *
   * If the node's kind does not have a specific config, the default config
   * is returned instead.
   */
  public getInterfaceConfig(nodeKind: string) {
    return this.lookup.get(nodeKind) ?? DefaultDeviceConfig;
  }
}
/*
const IconMap = new Map([
  ['VM', 'virtualserver'],
  ['Generic', 'generic'],
  ['Router', 'router'],
  ['Switch', 'switch'],
  ['Linux', 'linux'],
  ['Cisco', 'cisco'],
  ['Container', 'computer'],
  ['Docker', 'docker'],
]);
*/
const IconMap = new Map<string, string>([
  ['pe', 'router'],
  ['router', 'router'],
  ['dcgw', 'router'],
  ['leaf', 'switch'],
  ['switch', 'switch'],
  ['spine', 'switch'],
  ['server', 'linux'],
  ['pon', 'generic'],
  ['controller', 'cisco'],
  ['rgw', 'docker'],
  ['client', 'computer'],
]);

const DefaultDeviceConfig: InterfaceConfig = {
  interfacePattern: 'eth$',
  interfaceStart: 1,
};

export type DeviceInfo = InterfaceConfig & {
  kind: string;

  // Other names containerlab accepts for the kind, e.g. srl for nokia_srlinux
  kindAliases?: string[];
  name: string;
  images: string[];
  type: string;
};

/**
 * A way to name the interfaces of a device, $ stands for the number of the
 * interface, e.g. e1-$. The first interface has the start number.
 */
export type InterfacePattern = {
  pattern: string;
  start: number;
};

export type InterfaceConfig = {
  // The patterns name the same interfaces, new interfaces are named after the first one
  interfaces: InterfacePattern[];
};

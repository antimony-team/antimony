export type DeviceInfo = InterfaceConfig & {
  kind: string;
  name: string;
  images: string[];
  type: string;
};

export type InterfaceConfig = {
  interfacePattern: string;
  interfaceStart: number;
};

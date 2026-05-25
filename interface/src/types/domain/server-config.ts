export type ServerConfig = {
  capture: CaptureConfig;
};

export type CaptureConfig = {
  enabled: boolean;
  port: number;
  excludedInterfaces: string[];
};

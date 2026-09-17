export type ServerConfig = {
  capture: CaptureConfig;
  deployment: DeploymentConfig;
};

export type DeploymentConfig = {
  provider: string;
};

export type CaptureConfig = {
  enabled: boolean;
  port: number;
  excludedInterfaces: string[];
};

export type ServerConfig = {
  ssh: SSHConfig;
  capture: CaptureConfig;
  deployment: DeploymentConfig;
};

export type SSHConfig = {
  enabled: boolean;
  port: number;
};

export type CaptureConfig = {
  enabled: boolean;
  excludedInterfaces: string[];
};

export type DeploymentConfig = {
  provider: string;
};

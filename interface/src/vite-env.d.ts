/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional overrides at build time
  readonly SB_API_SERVER_URL?: string;
  readonly SB_SOCKET_SERVER_URL?: string;
}

interface Window {
  // Set by the electron app's preload script, undefined in the browser
  antimonyDesktop?: {
    serverUrl: string;
    token: string;
  };
}

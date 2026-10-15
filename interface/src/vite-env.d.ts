/// <reference types="vite/client" />

interface Window {
  // Set by the desktop app's preload script, undefined in the browser
  antimonyDesktop?: {
    config: () => Promise<{serverUrl: string; token: string}>;
  };
}

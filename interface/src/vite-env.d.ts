/// <reference types="vite/client" />

interface ImportMetaEnv {
  // The version of the interface, from package.json
  readonly SB_VERSION: string;
  // The short hash of the commit the interface was built from, null if it isn't known
  readonly SB_COMMIT: string | null;
}

interface Window {
  // Set by the desktop app's preload script, undefined in the browser
  antimonyDesktop?: {
    config: () => Promise<{serverUrl: string; token: string}>;
  };
}

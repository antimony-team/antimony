import {contextBridge, ipcRenderer} from 'electron';

/*
 * Hands the interface the address of the server the app started and the token to log in with,
 * see startServer in main.ts. The values are asked for at runtime, so they never appear on a
 * command line, where other users of the machine could read them.
 */
contextBridge.exposeInMainWorld('antimonyDesktop', {
  config: (): Promise<{serverUrl: string; token: string}> =>
    ipcRenderer.invoke('antimony:desktop'),
});

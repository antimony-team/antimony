import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';

import {DesktopConfig, startServer, stopServer} from './server';
import {Splash} from './splash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let window: BrowserWindow | null = null;
let tray: Tray | null = null;

// Set when the app quits for real, closing the window only hides it in the tray
let isQuitting = false;

// Only the instance that started the server stops it, a second instance quits without touching it
let hasServer = false;
let isServerStopped = false;

function showWindow() {
  if (!window) {
    createWindow();
    return;
  }

  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
  });

  // Open external links in the user's browser, not inside the app.
  window.webContents.setWindowOpenHandler(({url}) => {
    void shell.openExternal(url);
    return {action: 'deny'};
  });

  // Closing the window keeps Antimony and its labs running in the tray
  window.on('close', event => {
    if (isQuitting) return;

    event.preventDefault();
    window?.hide();
  });
  window.on('closed', () => (window = null));

  void window.loadFile(path.join(__dirname, '../dist/index.html'));
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, '../dist/icons/favicon-dark.png'))
    .resize({width: 22, height: 22});

  tray = new Tray(icon);
  tray.setToolTip('Antimony');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {label: 'Open Antimony', click: showWindow},
      {type: 'separator'},
      {label: 'Quit Antimony', click: () => app.quit()},
    ]),
  );
  tray.on('click', showWindow);
}

function fail(error: unknown) {
  dialog.showErrorBox(
    'Antimony',
    error instanceof Error ? error.message : String(error),
  );
  app.quit();
}

// Only one instance runs at a time, it has the server; starting the app again shows its window
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    const splash = new Splash();
    hasServer = true;

    let desktop: DesktopConfig;
    try {
      const server = await startServer((text, progress) =>
        splash.setStatus(text, progress),
      );
      desktop = server.desktop;

      void server.exited.then(code => {
        if (isQuitting) return;
        fail(
          `The Antimony server stopped unexpectedly (code ${code}). See server.log in ${app.getPath('userData')}.`,
        );
      });
    } catch (error) {
      splash.close();
      fail(error);
      return;
    }

    // The window asks for the server's address and token, they never appear on a command line
    ipcMain.handle('antimony:desktop', () => desktop);

    createTray();
    createWindow();
    splash.close();

    app.on('activate', showWindow);
  });
}

// The app keeps running in the tray when its window is closed
app.on('window-all-closed', () => {});

app.on('before-quit', () => (isQuitting = true));

// The server's container is removed before the app exits, quitting waits for it
app.on('will-quit', event => {
  if (!hasServer || isServerStopped) return;

  event.preventDefault();
  void stopServer()
    .catch(error => console.error('Failed to stop the Antimony server', error))
    .finally(() => {
      isServerStopped = true;
      app.quit();
    });
});

// Ctrl+C in a terminal quits the app the same way, so the server is removed too
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => app.quit());
}

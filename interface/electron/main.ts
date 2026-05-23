import {app, BrowserWindow, shell} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    autoHideMenuBar: true,
  });

  // Open external links in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({url}) => {
    void shell.openExternal(url);
    return {action: 'deny'};
  });

  void win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

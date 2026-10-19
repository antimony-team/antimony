import {BrowserWindow} from 'electron';

// The startup window's page, a status line and a progress bar that runs without a known progress
const SPLASH_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; flex-direction: column; justify-content: center; gap: 14px;
    padding: 0 28px; box-sizing: border-box;
    background: #17171c; color: #e8e8ee;
    font: 14px system-ui, sans-serif; user-select: none; -webkit-app-region: drag;
  }
  h1 { margin: 0; font-size: 17px; font-weight: 600; }
  #status { color: #a4a4b0; min-height: 1.2em; }
  .bar { height: 6px; border-radius: 3px; background: #2a2a33; overflow: hidden; position: relative; }
  #fill { height: 100%; width: 0; background: #f59a3c; transition: width 0.2s; }
  .bar.indeterminate #fill { width: 30%; position: absolute; animation: slide 1.2s ease-in-out infinite; }
  @keyframes slide { from { left: -30%; } to { left: 100%; } }
</style>
</head>
<body>
  <h1>Antimony</h1>
  <div id="status">Starting…</div>
  <div class="bar indeterminate" id="bar"><div id="fill"></div></div>
  <script>
    function setStatus(text, progress) {
      document.getElementById('status').textContent = text;
      const bar = document.getElementById('bar');
      bar.classList.toggle('indeterminate', progress === null);
      document.getElementById('fill').style.width = progress === null ? '' : progress * 100 + '%';
    }
  </script>
</body>
</html>`;

/**
 * A small window that shows what the app does while it starts, e.g. downloading the server.
 */
export class Splash {
  private readonly window: BrowserWindow;
  private readonly isLoaded: Promise<void>;

  constructor() {
    this.window = new BrowserWindow({
      width: 440,
      height: 150,
      frame: false,
      resizable: false,
      center: true,
      show: false,
      backgroundColor: '#17171c',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.window.once('ready-to-show', () => this.window.show());
    this.isLoaded = this.window
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_PAGE)}`,
      )
      .then(() => undefined);
  }

  // Shows a status, with a progress between 0 and 1 if it's known
  public setStatus(text: string, progress?: number) {
    void this.isLoaded.then(() => {
      if (this.window.isDestroyed()) return;

      void this.window.webContents.executeJavaScript(
        `setStatus(${JSON.stringify(text)}, ${progress ?? null})`,
      );
    });
  }

  public close() {
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}

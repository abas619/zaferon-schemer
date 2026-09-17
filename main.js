'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  desktopCapturer,
  shell,
  clipboard,
  Menu,
  nativeImage
} = require('electron');

const path = require('path');
const fs = require('fs');

const { createPickerOverlay } = require('./picker-overlay');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 *  Profile directory — pinned, because this app has been renamed twice
 *
 *  Electron puts `userData` — and therefore the renderer's localStorage, which
 *  is where every favourite, the history and the preferences live — under
 *  `app.name`, and `app.name` prefers package.json's `productName` over
 *  `name`. So each rename quietly points the app at an empty directory and the
 *  user's saved colours look like they vanished, while the real data sits
 *  untouched one folder over.
 *
 *  Resolve it by looking for the names this app has actually shipped under,
 *  newest first, and fall back to the current name only when none exists —
 *  which is a genuine first run. `setPath` throws on a missing directory, so
 *  the existence test is load-bearing, not decoration.
 * ------------------------------------------------------------------ */

const PROFILE_NAMES = [
  'Saffron Scheme', // productName until the Zaferon Schemer rename
  'zaferon-scheme', // the package `name`, in case Electron preferred that
  'ColorSchemer Studio' // the original productName
];

const appDataDir = app.getPath('appData');
const adoptedProfile = PROFILE_NAMES.map((n) => path.join(appDataDir, n)).find((p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
});

if (adoptedProfile) app.setPath('userData', adoptedProfile);

let mainWindow = null;
let pickerSession = null;
let lastDir = null;

/* ================================================================== *
 *  Main window
 * ================================================================== */

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 780,
    minHeight: 500,
    frame: false,
    show: false,
    backgroundColor: '#f0f0f0',
    title: 'Zaferon Schemer',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(SRC, 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const emitState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('win:state', {
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen()
    });
  };
  mainWindow.on('maximize', emitState);
  mainWindow.on('unmaximize', emitState);
  mainWindow.on('enter-full-screen', emitState);
  mainWindow.on('leave-full-screen', emitState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // DevTools + a few native accelerators the custom menu bar can't own.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ================================================================== *
 *  Window controls
 * ================================================================== */

ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());

ipcMain.on('win:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on('win:close', () => mainWindow && mainWindow.close());

/* ================================================================== *
 *  Files
 * ================================================================== */

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml'
};

function mimeFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

ipcMain.handle('file:openImage', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Image',
    defaultPath: lastDir || undefined,
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;

  const file = res.filePaths[0];
  lastDir = path.dirname(file);
  const buf = await fs.promises.readFile(file);
  return {
    name: path.basename(file),
    path: file,
    mime: mimeFor(file),
    dataUrl: `data:${mimeFor(file)};base64,${buf.toString('base64')}`
  };
});

ipcMain.handle('file:openText', async (_e, opts = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'Open',
    defaultPath: lastDir || undefined,
    filters: opts.filters || [{ name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;

  const file = res.filePaths[0];
  lastDir = path.dirname(file);
  const text = await fs.promises.readFile(file, 'utf8');
  return { name: path.basename(file), path: file, text };
});

ipcMain.handle('file:save', async (_e, opts = {}) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: opts.title || 'Save',
    defaultPath: opts.defaultName || path.join(lastDir || app.getPath('documents'), 'untitled'),
    filters: opts.filters || [{ name: 'All Files', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePath) return null;

  lastDir = path.dirname(res.filePath);
  const encoding = opts.encoding === 'base64' ? 'base64' : 'utf8';
  const data = encoding === 'base64' ? Buffer.from(opts.content || '', 'base64') : opts.content || '';
  await fs.promises.writeFile(res.filePath, data, encoding === 'base64' ? undefined : 'utf8');
  return res.filePath;
});

ipcMain.handle('file:exportPng', async (_e, opts = {}) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Image',
    defaultPath: opts.defaultName || path.join(lastDir || app.getPath('pictures'), 'export.png'),
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });
  if (res.canceled || !res.filePath) return null;

  lastDir = path.dirname(res.filePath);
  const dataUrl = String(opts.dataUrl || '');
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  await fs.promises.writeFile(res.filePath, Buffer.from(base64, 'base64'));
  return res.filePath;
});

ipcMain.handle('file:openPath', async (_e, filePath) => {
  if (!filePath) return null;
  const buf = await fs.promises.readFile(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    mime: mimeFor(filePath),
    dataUrl: `data:${mimeFor(filePath)};base64,${buf.toString('base64')}`
  };
});

/* ================================================================== *
 *  Clipboard / shell
 * ================================================================== */

ipcMain.handle('clipboard:writeText', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return true;
});

ipcMain.handle('clipboard:readText', () => clipboard.readText());

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  await shell.openExternal(url);
  return true;
});

/* ================================================================== *
 *  Screen colour picker (eyedropper)
 * ================================================================== */

ipcMain.handle('picker:start', async () => {
  if (pickerSession) return null;

  // Make our own window invisible so it does not end up in the frozen
  // screenshot the user picks from. Opacity avoids taskbar flicker.
  let restoreOpacity = 1;
  if (mainWindow && !mainWindow.isDestroyed()) {
    restoreOpacity = mainWindow.getOpacity();
    mainWindow.setOpacity(0);
  }

  let overlays = [];
  try {
    await sleep(170);

    const displays = screen.getAllDisplays();
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)), 1280);
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)), 720);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxW, height: maxH }
    });

    if (!sources.length) throw new Error('No screen sources available');

    const result = await new Promise((resolve) => {
      let settled = false;

      const finish = (color) => {
        if (settled) return;
        settled = true;
        pickerSession = null;
        overlays.forEach((w) => {
          try {
            if (!w.isDestroyed()) w.destroy();
          } catch (_) {
            /* ignore */
          }
        });
        overlays = [];
        resolve(color || null);
      };

      pickerSession = { finish };

      displays.forEach((display) => {
        const source =
          sources.find((s) => String(s.display_id) === String(display.id)) ||
          (display.id === screen.getPrimaryDisplay().id ? sources[0] : null);
        if (!source) return;

        const built = createPickerOverlay(display, source.thumbnail, {
          onClosed: () => {
            if (settled) return;
            // If the last overlay goes away without a pick, treat as cancel.
            if (overlays.every((w) => w.isDestroyed())) finish(null);
          }
        });
        if (!built) return;

        overlays.push(built.overlay);
      });

      if (!overlays.length) {
        finish(null);
        return;
      }

      // Safety net in case a display produced no window at all.
      setTimeout(() => {
        if (!settled && overlays.every((w) => w.isDestroyed())) finish(null);
      }, 1500);
    });

    return result;
  } catch (err) {
    overlays.forEach((w) => {
      try {
        if (!w.isDestroyed()) w.destroy();
      } catch (_) {
        /* ignore */
      }
    });
    pickerSession = null;
    return null;
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setOpacity(restoreOpacity);
      mainWindow.focus();
    }
  }
});

ipcMain.on('picker:pick', (_e, color) => {
  if (pickerSession) pickerSession.finish(color);
});

ipcMain.on('picker:cancel', () => {
  if (pickerSession) pickerSession.finish(null);
});

/* ================================================================== *
 *  Lifecycle
 * ================================================================== */

Menu.setApplicationMenu(null);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

'use strict';

/* Throwaway: boot the app against a COPY of the user's real profile and dump
 * the workspace DOM, so a missing dock/palette panel can be diagnosed without
 * touching the original state. */

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots', 'dbg');
fs.mkdirSync(OUT, { recursive: true });

const SRC = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Saffron Scheme'
);
const DST = path.join(os.tmpdir(), 'cs-real-profile');
fs.rmSync(DST, { recursive: true, force: true });
try {
  fs.cpSync(SRC, DST, { recursive: true });
  console.log('copied profile:', SRC, '->', DST);
} catch (e) {
  console.log('profile copy failed:', e.message);
}
app.setPath('userData', DST);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(m + '\n');

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true).catch((e) => 'EVAL FAILED ' + e.message);
}

app.whenReady().then(async () => {
  ipcMain.handle('clipboard:writeText', (_e, t) => { clipboard.writeText(String(t == null ? '' : t)); return true; });
  ipcMain.handle('clipboard:readText', () => clipboard.readText());
  ['file:save', 'file:openImage', 'file:openText', 'file:openPath'].forEach((c) => ipcMain.handle(c, async () => null));
  ipcMain.handle('shell:openExternal', async () => true);
  ipcMain.handle('picker:start', async () => null);
  ipcMain.on('win:minimize', () => {});
  ipcMain.on('win:maximize', () => {});
  ipcMain.on('win:close', () => {});

  const win = new BrowserWindow({
    width: 1080,
    height: 753,
    show: true,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.webContents.on('console-message', (...args) => {
    let level = 0;
    let message = '';
    if (args.length >= 5) [, level, message] = args;
    else if (args[1] && typeof args[1] === 'object') { level = args[1].level; message = args[1].message; }
    if (level === 3 || level === 'error') log('  ! console: ' + message);
  });

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(2200);

  log('persisted flags: ' + JSON.stringify(await js(win, `({
     showPalette: CS.Store.get('showPalette', 'MISSING'),
     showFavorites: CS.Store.get('showFavorites', 'MISSING'),
     showBaseColor: CS.Store.get('showBaseColor', 'MISSING'),
     dockSizes: CS.Store.get('dockSizes', 'MISSING'),
     document: CS.Store.get('document'),
     matchingTab: CS.Store.get('matchingTab'),
     scheme: CS.Store.get('scheme')
   })`)));

  log('favorites: ' + JSON.stringify(await js(win, `({
     n: CS.Store.state.favorites.length,
     types: CS.Store.state.favorites.map((c) => typeof c).join(','),
     sample: CS.Store.state.favorites.slice(0, 3),
     historyTypes: CS.Store.state.history.map((c) => typeof c).join(',').slice(0, 60),
     historyN: CS.Store.state.history.length
   })`)));

  log('roundtrip: ' + JSON.stringify(await js(win, `(() => {
     const before = CS.Store.state.favorites.length;
     const added = CS.Store.addFavorite('#123456');
     const dup = CS.Store.addFavorite('#123456');
     const bad = CS.Store.addFavorite('not-a-colour');
     const after = CS.Store.state.favorites.length;
     CS.Store.removeFavorite('#123456');
     return { before, added, dup, bad, after, restored: CS.Store.state.favorites.length };
   })()`)));

  log('dom: ' + JSON.stringify(await js(win, `(() => {
     const info = (sel) => {
       const n = document.querySelector(sel);
       if (!n) return 'MISSING ELEMENT';
       const cs = getComputedStyle(n);
       const r = n.getBoundingClientRect();
       return {
         cls: n.className,
         kids: n.childElementCount,
         html: n.innerHTML.length,
         display: cs.display,
         box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
         firstKid: n.firstElementChild ? n.firstElementChild.className : null
       };
     };
     return {
       workspace: info('#workspace'),
       dockLeft: info('#dock-left'),
       center: info('#center-column'),
       docHost: info('#doc-host'),
       splitterPalette: info('#splitter-palette'),
       paletteHost: info('#palette-host'),
       dockRight: info('#dock-right'),
       panels: [...document.querySelectorAll('.panel')].map((p) => {
         const r = p.getBoundingClientRect();
         const t = p.querySelector('.panel-title-text');
         return (t ? t.textContent : '?') + ' [' + Math.round(r.width) + 'x' + Math.round(r.height) + ']';
       })
     };
   })()`)));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'real-profile.png'), img.toPNG());
  log('captured shots/dbg/real-profile.png');

  app.exit(0);
});

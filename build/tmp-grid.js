'use strict';

/* Temporary: measure the Matching tab grids against their pane. */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'colorschemer-grid-profile');
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}

app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(m + '\n');

async function run(win) {
  const js = (_w, code) => win.webContents.executeJavaScript(code, true).catch((e) => {
    log(`JS FAILED: ${e.message}`);
    return null;
  });

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1700);
  await js(win, `CS.App.openDocument('matching'); 'ok'`);
  await sleep(600);

  for (const [tab, sel] of [
    ['mixer', '.mixer-grid'],
    ['variations', '.variations-grid'],
    ['live', '.live-canvas']
  ]) {
    await js(win, `document.querySelector('#doc-host .panel-tabrow .tab[data-id="${tab}"]').click(); 'ok'`);
    await sleep(700);
    const out = await js(win, `(() => {
      const n = document.querySelector('${sel}');
      const pane = n ? n.closest('.panel-body') : null;
      if (!n || !pane) return null;
      const r = n.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      const round = (v) => Math.round(v * 10) / 10;
      return JSON.stringify({
        sel: '${sel}',
        pane: [round(p.left), round(p.top), round(p.width), round(p.height)],
        box: [round(r.left), round(r.top), round(r.width), round(r.height)],
        margin: {
          left: round(r.left - p.left),
          right: round(p.right - r.right),
          top: round(r.top - p.top),
          bottom: round(p.bottom - r.bottom)
        }
      });
    })()`);
    log(out || `  ${tab}: ${sel} not found`);
  }

  app.quit();
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280, height: 860, show: true, frame: false,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  run(win).catch((e) => { log(`RUN FAILED ${e && e.stack}`); app.quit(); });
});

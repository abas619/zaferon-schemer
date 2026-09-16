'use strict';

/* Temporary: dump the box of every element whose size looks runaway. */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'colorschemer-size-profile');
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (_) {}

app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(m + '\n');

async function run(win) {
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1800);

  const dump = await win.webContents.executeJavaScript(
    `(() => {
       const out = [];
       document.querySelectorAll('*').forEach((n) => {
         const r = n.getBoundingClientRect();
         if (r.width > 1400 || r.height > 1400 || r.height < 0 || r.width < 0) {
           out.push({
             tag: n.tagName.toLowerCase(),
             cls: (n.className || '').toString().slice(0, 48),
             box: [Math.round(r.width), Math.round(r.height)],
             scroll: [n.scrollWidth, n.scrollHeight]
           });
         }
       });
       const canvases = [...document.querySelectorAll('canvas')].map((c) => {
         const r = c.getBoundingClientRect();
         return {
           cls: c.className,
           attr: [c.width, c.height],
           css: [Math.round(r.width), Math.round(r.height)]
         };
       });
       return { runaway: out.slice(0, 25), canvases };
     })()`,
    true
  );
  log(JSON.stringify(dump, null, 2));
  app.quit();
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    show: true,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  run(win).catch((e) => {
    log(`RUN FAILED ${e && e.stack}`);
    app.quit();
  });
});

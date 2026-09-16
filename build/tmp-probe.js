'use strict';

/* Temporary layout probe. */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'colorschemer-probe-profile');
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

const SEL = process.argv.find((a) => a.startsWith('--sel=')) || '--sel=#dock-left';

async function run(win) {
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1800);
  const doc = (process.argv.find((a) => a.startsWith('--doc=')) || '').replace('--doc=', '');
  if (doc) {
    await win.webContents.executeJavaScript(`CS.App.openDocument(${JSON.stringify(doc)}); 'ok'`, true);
    await sleep(900);
  }
  const sel = SEL.replace('--sel=', '');
  const out = await win.webContents.executeJavaScript(
    `(() => {
       const host = document.querySelector(${JSON.stringify(sel)});
       if (!host) return { error: 'no ' + ${JSON.stringify(sel)} };
       const hr = host.getBoundingClientRect();
       const hits = [];
       host.querySelectorAll('*').forEach((n) => {
         const r = n.getBoundingClientRect();
         if (r.width < 1 || r.height < 1) return;
         // anything sitting in the top-left 70x70 of the host
         if (r.left - hr.left < 70 && r.top - hr.top < 70) {
           const cs = getComputedStyle(n);
           hits.push({
             tag: n.tagName.toLowerCase(),
             cls: (n.className || '').toString().slice(0, 50),
             box: [Math.round(r.left - hr.left), Math.round(r.top - hr.top), Math.round(r.width), Math.round(r.height)],
             bg: cs.backgroundColor,
             border: cs.borderTopWidth + ' ' + cs.borderTopColor,
             z: cs.zIndex, pos: cs.position
           });
         }
       });
       return { sel: ${JSON.stringify(sel)}, hostBox: [Math.round(hr.width), Math.round(hr.height)], hits };
     })()`,
    true
  );
  log(JSON.stringify(out, null, 2));
  app.quit();
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
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

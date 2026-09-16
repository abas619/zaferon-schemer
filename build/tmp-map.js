'use strict';

/* Temporary: map where sendInputEvent coordinates actually land. */

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'colorschemer-map-profile');
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
  await sleep(1500);
  win.focus();
  win.moveTop();
  await sleep(400);

  log(`window bounds ${JSON.stringify(win.getBounds())}  content ${JSON.stringify(win.getContentBounds())}`);
  log(`display scaleFactor ${screen.getPrimaryDisplay().scaleFactor}`);
  log(`renderer ${await js(win, `JSON.stringify({
    dpr: window.devicePixelRatio,
    inner: [window.innerWidth, window.innerHeight],
    outer: [window.outerWidth, window.outerHeight],
    screenX: window.screenX, screenY: window.screenY
  })`)}`);

  await js(win, `(() => {
    window.__land = [];
    document.addEventListener('pointerdown', (e) => {
      window.__land.push(e.clientX + ',' + e.clientY + ' -> ' +
        (e.target.tagName || '?').toLowerCase() + '.' + (e.target.className || '').toString().split(' ')[0]);
    }, true);
    return 'ok';
  })()`);

  const probes = [[100, 200], [400, 300], [571, 366], [700, 300], [900, 400], [1100, 300]];
  for (const [x, y] of probes) {
    const at = await js(win, `(() => {
      const n = document.elementFromPoint(${x}, ${y});
      return n ? n.tagName.toLowerCase() + '.' + (n.className || '').toString().split(' ')[0] : 'none';
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(60);
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await sleep(120);
    log(`sent ${x},${y}  elementFromPoint=${at}`);
  }

  log('landed:');
  const land = JSON.parse((await js(win, `JSON.stringify(window.__land)`)) || '[]');
  land.forEach((l) => log('  ' + l));

  app.quit();
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1180, height: 760, show: true,
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

'use strict';

/* Temporary: why does the wheel canvas stop responding to clicks, and why does
 * the wheel -> favourites pointer drag never arm? */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'colorschemer-drag-profile');
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
  const js = (_win, code) => win.webContents.executeJavaScript(code, true).catch((e) => {
    log(`JS FAILED: ${e.message}`);
    return null;
  });
  const mouseMove = async (x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    await sleep(80);
  };
  const mouseDown = async (x, y) => {
    win.webContents.sendInputEvent({
      type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1
    });
    await sleep(80);
  };
  const mouseUp = async (x, y) => {
    win.webContents.sendInputEvent({
      type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1
    });
    await sleep(80);
  };

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1800);

  win.focus();
  win.moveTop();
  await sleep(400);
  log(`visible=${win.isVisible()} focused=${win.isFocused()}`);

  /* Does *any* pointerdown reach the renderer at all? */
  await js(win, `(() => {
    window.__all = [];
    document.addEventListener('pointerdown', (e) => {
      const n = e.target;
      window.__all.push((n.tagName || '?').toLowerCase() + '.' + (n.className || '').toString().split(' ')[0]);
    }, true);
    return 'ok';
  })()`);

  await js(win, `CS.App.openDocument('matching'); 'ok'`);
  await sleep(500);
  await js(win, `document.querySelector('#doc-host .panel-tabrow .tab[data-id="wheel"]').click(); 'ok'`);
  await js(win, `CS.Store.setColor('#477AD3'); CS.Store.set('scheme', 'triadic'); CS.App.refreshAll(); 'ok'`);
  await sleep(900);

  /* Tap the canvas in the capture phase so we know the event arrives at all. */
  await js(win, `(() => {
    window.__hits = [];
    const c = document.querySelector('.wheel-canvas');
    c.addEventListener('pointerdown', (e) => {
      window.__hits.push({ x: e.clientX, y: e.clientY, target: e.target.className });
    }, true);
    return 'ok';
  })()`);

  const rect = JSON.parse(await js(win, `(() => {
    const r = document.querySelector('.wheel-canvas').getBoundingClientRect();
    return JSON.stringify({ left: r.left, top: r.top, w: r.width, h: r.height });
  })()`));
  log(`wheel-canvas ${JSON.stringify(rect)}`);

  const cx = rect.left + rect.w / 2;
  const cy = rect.top + rect.h / 2;
  log(`centre ${cx.toFixed(1)},${cy.toFixed(1)}`);

  for (const frac of [0.0, 0.3, 0.55, 0.75, 0.9]) {
    const d = (Math.min(rect.w, rect.h) / 2) * frac;
    const x = Math.round(cx + d);
    const y = Math.round(cy);
    await js(win, `CS.Store.setColor('#808080'); 'ok'`);
    await mouseMove(win, x, y);
    await mouseDown(win, x, y);
    await mouseUp(win, x, y);
    await sleep(140);
    const hex = await js(win, `CS.Store.hexUpper()`);
    log(`  right @r=${frac.toFixed(2)} (${d.toFixed(0)}px) ${x},${y} -> ${hex}`);
  }

  log(`pointerdown hits: ${await js(win, `JSON.stringify(window.__hits)`)}`);
  log(`all pointerdowns: ${await js(win, `JSON.stringify(window.__all)`)}`);

  /* Does the canvas listen at all? Count listeners is not exposed, so probe the
   * handler's own inputs: the geometry it subtracts. */
  log(`store after: ${await js(win, `JSON.stringify(CS.Store.hsv())`)}`);

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

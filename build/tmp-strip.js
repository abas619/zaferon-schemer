'use strict';

/* Temporary: in the LiveSchemes strip view, does the app actually draw one
 * arrow per handle? The verify probe counts dark pixel runs on a single row,
 * which can merge or miss. */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'colorschemer-strip-profile');
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}

app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(m + '\n');

const PROBE = `(() => {
  const c = document.querySelector('.live-canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const w = r.width, h = r.height;
  const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const pad = cl(Math.min(w, h) * 0.09, 16, 44);
  const barH = Math.min(70, Math.max(12, h - pad * 2));
  const barY = (h - barH) / 2;
  const dpr = window.devicePixelRatio || 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  /* Scan every row in the band above the bar and collect dark runs, so an
   * arrow that sits a pixel or two off the single probe row is still found. */
  const rows = [];
  const y0 = Math.max(0, Math.round((barY - 16) * dpr));
  const y1 = Math.max(1, Math.round((barY - 1) * dpr));
  for (let y = y0; y <= y1; y++) {
    const d = ctx.getImageData(0, y, c.width, 1).data;
    let run = null;
    for (let x = 0; x < c.width; x++) {
      const i = x * 4;
      const dark = d[i + 3] > 100 && d[i] < 190 && d[i + 1] < 190 && d[i + 2] < 190;
      if (dark) { if (!run) run = { a: x, b: x }; else run.b = x; }
      else if (run) { rows.push({ y, a: run.a, b: run.b }); run = null; }
    }
    if (run) rows.push({ y, a: run.a, b: run.b });
  }

  /* The verify.js probe scans exactly one row at (barY - 6) CSS px. Report the
   * runs on that row, and on the rows around it, so a merge or a miss shows. */
  const rowRuns = (cssY) => {
    const y = Math.max(0, Math.round(cssY * dpr));
    const d = ctx.getImageData(0, y, c.width, 1).data;
    const out = [];
    let run = null;
    for (let x = 0; x < c.width; x++) {
      const i = x * 4;
      const dark = d[i + 3] > 100 && d[i] < 190 && d[i + 1] < 190 && d[i + 2] < 190;
      if (dark) { if (!run) run = { a: x, b: x }; else run.b = x; }
      else if (run) { out.push(run); run = null; }
    }
    if (run) out.push(run);
    return out.map((rn) => [
      Math.round((rn.a / dpr) * 10) / 10,
      Math.round((rn.b / dpr) * 10) / 10,
      Math.round(((rn.b - rn.a) / dpr) * 10) / 10
    ]);
  };

  const merged = (() => {
    const runs = rowRuns(barY - 6);
    const out = [];
    let g = null;
    runs.forEach((rn) => {
      if (g && rn[0] - g[1] <= 16) g = [g[0], rn[1]];
      else { if (g) out.push(Math.round(((g[0] + g[1]) / 2) * 10) / 10); g = [rn[0], rn[1]]; }
    });
    if (g) out.push(Math.round(((g[0] + g[1]) / 2) * 10) / 10);
    return out;
  })();

  return JSON.stringify({
    canvas: [Math.round(w), Math.round(h)],
    pad: Math.round(pad),
    barY: Math.round(barY),
    markers: merged,
    rows: {
      'barY-9': rowRuns(barY - 9),
      'barY-6': rowRuns(barY - 6),
      'barY-3': rowRuns(barY - 3)
    },
    labels: [...document.querySelectorAll('.live-swatch-label')].map((n) => n.textContent),
    stepper: document.querySelector('.live-viewbar .stepper-num').value
  });
})()`;

async function run(win) {
  const js = (_w, code) => win.webContents.executeJavaScript(code, true).catch((e) => {
    log(`JS FAILED: ${e.message}`);
    return null;
  });

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1700);

  await js(win, `CS.App.openDocument('matching'); 'ok'`);
  await sleep(500);
  await js(win, `document.querySelector('#doc-host .panel-tabrow .tab[data-id="live"]').click(); 'ok'`);
  await sleep(500);
  await js(win, `(() => {
    const b = [...document.querySelectorAll('#doc-host .icon-btn')].find((n) => n.title === 'Strip view');
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(800);

  log(`initial      ${await js(win, PROBE)}`);

  const bump = (which) => js(win, `(() => {
    const b = document.querySelectorAll('.live-viewbar .stepper-btn')[${which}];
    if (!b) return null;
    b.click();
    return document.querySelector('.live-viewbar .stepper-num').value;
  })()`);

  for (let i = 0; i < 2; i++) log(`  bump up -> ${await bump(0)}`);
  await sleep(900);
  log(`after 2 ups  ${await js(win, PROBE)}`);

  /* Reproduce verify.js's arrow drag step by step. */
  const crect = JSON.parse(await js(win, `(() => {
    const r = document.querySelector('.live-canvas').getBoundingClientRect();
    return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height });
  })()`));
  const barY = 78;
  const rowY = crect.y + barY - 6;

  const mouseMove = async (x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    await sleep(80);
  };
  const mouseDown = async (x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await sleep(80);
  };
  const mouseUp = async (x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await sleep(80);
  };
  const cursors = () => js(win, `getComputedStyle(document.querySelector('.live-canvas')).cursor`);

  const before = JSON.parse(await js(win, PROBE));
  log(`markers before drag: ${JSON.stringify(before.markers)}`);

  /* Sweep the pointer across the bar at the probe row and record where the
   * canvas reports a grab cursor. That is the app's own hit test talking. */
  log('cursor sweep at barY-6:');
  let line = '';
  for (let x = 0; x <= 709; x += 10) {
    await mouseMove(win, crect.x + x, rowY);
    const c = await cursors();
    line += c === 'grab' ? 'G' : '.';
  }
  log('  ' + line);

  /* And at a few other rows, in case the grab band is offset. */
  for (const dy of [-20, -12, -6, 0, 4]) {
    let l = '';
    for (let x = 0; x <= 709; x += 10) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(crect.x + x), y: Math.round(crect.y + 78.5 + dy) });
      await sleep(30);
      const c = await cursors();
      l += c === 'grab' ? 'G' : '.';
    }
    log(`  barY${dy >= 0 ? '+' : ''}${dy}: ${l}`);
  }

  /* Where exactly does the grab band start and end, in viewport coords? */
  log('y sweep at x=186.8 (canvas-relative y : grab?):');
  const yHits = [];
  for (let y = 40; y <= 110; y += 1) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(crect.x + 186.8), y: Math.round(crect.y + y) });
    await sleep(35);
    const c = await cursors();
    yHits.push(c === 'grab' ? y : null);
  }
  const grabbed = yHits.filter((v) => v !== null);
  log(`  grab y range (canvas-relative): ${grabbed.length ? grabbed[0] + '..' + grabbed[grabbed.length - 1] : 'NONE'}`);
  log(`  crect.y=${crect.y}  (viewport y range: ${grabbed.length ? crect.y + grabbed[0] : '?'}..${grabbed.length ? crect.y + grabbed[grabbed.length - 1] : '?'})`);

  const from = before.markers[0];
  const to = from + 55;
  log(`drag from ${from} to ${to}`);

  await mouseMove(win, crect.x + from, rowY);
  log(`  cursor over arrow: ${await cursors()}`);
  await mouseDown(win, crect.x + from, rowY);
  log(`  cursor after down: ${await cursors()}`);
  for (const step of [0.25, 0.5, 0.75, 1]) {
    const x = from + (to - from) * step;
    await mouseMove(win, crect.x + x, rowY);
    const p = JSON.parse(await js(win, PROBE));
    log(`  pointer ${Math.round(x)} -> markers ${JSON.stringify(p.markers)}`);
  }
  await mouseUp(win, crect.x + to, rowY);
  await sleep(400);
  log(`after up     ${await js(win, PROBE)}`);

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

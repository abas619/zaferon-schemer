'use strict';

/**
 * Support-dialog / QR verification.
 *
 *   npm run support-check      (npx electron build/support-check.js)
 *
 * The menu audit proves the Help item *opens a dialog*. It cannot prove the
 * QR inside it is real, that it encodes the address printed next to it, or
 * that it survives the dark theme. This does:
 *
 *   1. non-blank        — the canvas has both ink and paper pixels
 *   2. encodes the text — the expected payload is read out of `CS.Donate` at
 *                         RUNTIME (never named in this file), the module grid
 *                         is reconstructed from the canvas PIXELS, and the two
 *                         are compared for that exact string (see readGrid
 *                         below). This is the "scan it with a phone" criterion,
 *                         checked without a phone and without a QR decoder —
 *                         and it survives swapping the address in the data file.
 *   3. crisp            — every sampled pixel is pure ink or pure paper, so no
 *                         module straddles a half pixel at DPR 1.25
 *   4. theme-invariant  — ink/paper are identical in light and dark
 *   5. derived, not copied — changing the address changes the grid
 *   6. production-clean — no DEMO caption, no demo footer warning
 *   7. copy             — the Copy button puts the address on the clipboard
 *
 * Captures shots/support-light.png and shots/support-dark.png.
 */

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

/* In-script, before the GPU process spawns — see harnesses.md. */
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
};

let lastClip = null;
ipcMain.handle('clipboard:writeText', (_e, t) => {
  lastClip = t;
  clipboard.writeText(t);
  return true;
});
ipcMain.handle('clipboard:readText', () => clipboard.readText());
ipcMain.handle('shell:openExternal', async () => true);
ipcMain.handle('picker:start', async () => null);
ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));

/* Runs in the renderer. Reconstructs the module grid from pixels alone: the
 * dark bounding box IS the QR content area, because the three finder patterns
 * put a dark module on all four extremes. The module pitch is the shortest
 * run length across the top scanlines — the finder ring is one module thick.
 * Nothing here reads unit/offset/QUIET out of support.js, so the geometry is
 * derived from the image rather than copied from the painter. */
const READ_GRID = `(function (canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const isDark = (x, y) => {
    const i = (y * W + x) * 4;
    return d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100;
  };
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, dark = 0, light = 0, mid = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < 100 && g < 100 && b < 100) dark++;
      else if (r > 200 && g > 200 && b > 200) light++;
      else mid++;
      if (isDark(x, y)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { blank: true, dark, light, mid, w: W, h: H };

  let unit = 1e9;
  for (let y = y0; y <= Math.min(y1, y0 + 12); y++) {
    let run = 1;
    for (let x = x0 + 1; x <= x1; x++) {
      if (isDark(x, y) === isDark(x - 1, y)) run++;
      else { if (run < unit) unit = run; run = 1; }
    }
  }
  const span = x1 - x0 + 1;
  const count = Math.round(span / unit);
  let grid = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      grid += isDark(x0 + c * unit + Math.floor(unit / 2), y0 + r * unit + Math.floor(unit / 2)) ? '1' : '0';
    }
  }
  return { blank: false, dark, light, mid, w: W, h: H, unit, count, span, grid,
           square: Math.abs(span - (y1 - y0 + 1)) <= 1 };
})`;

/** The encoder's own matrix for the same string — the reference to compare against. */
const EXPECTED_GRID = `(function (text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(String(text).trim());
  qr.make();
  const n = qr.getModuleCount();
  let g = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) g += qr.isDark(r, c) ? '1' : '0';
  return { count: n, grid: g };
})`;

async function openAndRead(win) {
  return win.webContents.executeJavaScript(
    `(function () {
       if (window.__dlg) { try { window.__dlg.close(); } catch (e) {} }
       window.__dlg = CS.Support.open();
       const canvas = document.querySelector('canvas.support-qr');
       if (!canvas) return { missing: true };
       /* The payload is whatever the data file says *now* — the harness never
        * names an address, so swapping the demo entry for a production one
        * changes the expectation without changing this file. */
       return {
         info: (${READ_GRID})(canvas),
         addr: CS.Donate.readyWallets()[0].address,
         shown: document.querySelector('.support-addr').textContent
       };
     })()`,
    true
  );
}

async function run(win) {
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1700);

  const hasSupport = await win.webContents.executeJavaScript(
    `!!(window.CS && CS.Support && typeof CS.Support.open === 'function' && window.qrcode)`,
    true
  );
  check(hasSupport, 'CS.Support.open and the qrcode global are both present');
  if (!hasSupport) return;

  /* ---------- 1. light theme ---------- */
  const light = await openAndRead(win);
  check(!light.missing && !light.info.blank, 'light: a QR canvas exists and is not blank');
  if (light.missing || light.info.blank) return;

  const addr = light.addr;
  console.log(`      expected payload from CS.Donate: ${addr}`);
  check(
    typeof addr === 'string' && addr.length > 0 && addr.indexOf('PLACEHOLDER') === -1,
    'light: CS.Donate hands the harness a real, configured payload to encode'
  );
  check(light.shown === addr, 'light: the printed address IS the CS.Donate payload');
  console.log(
    `      canvas ${light.info.w}x${light.info.h} device px, pitch ${light.info.unit}px, ${light.info.count} modules`
  );
  check(light.info.dark > 0 && light.info.light > 0, 'light: both ink and paper pixels present');
  check(light.info.square === true, 'light: the dark bounding box is square (finder patterns found)');

  /* The reconstructed grid must equal the encoder's matrix for this address. */
  const exp = await win.webContents.executeJavaScript(
    `(${EXPECTED_GRID})(${JSON.stringify(addr)})`,
    true
  );
  check(
    exp.count === light.info.count && exp.grid === light.info.grid,
    `light: pixel grid matches the encoder matrix for "${addr}" (${exp.count}x${exp.count})`
  );
  check(light.info.mid === 0, `light: no antialiased pixels (mid=${light.info.mid}) — modules are crisp`);

  await win.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'support-light.png'), img.toPNG());
  });
  console.log('      wrote shots/support-light.png');

  /* ---------- 2. dark theme ---------- */
  await win.webContents.executeJavaScript(`CS.Theme.set('dark')`, true);
  await sleep(250);
  const dark = await openAndRead(win);
  check(!dark.missing && !dark.info.blank, 'dark: a QR canvas exists and is not blank');
  check(
    dark.info.grid === light.info.grid && dark.info.count === light.info.count,
    'dark: the module grid is byte-identical to light (QR is theme-invariant)'
  );
  check(dark.info.mid === 0, `dark: no antialiased pixels (mid=${dark.info.mid})`);

  const colors = await win.webContents.executeJavaScript(
    `(function () {
       const c = document.querySelector('canvas.support-qr');
       const ctx = c.getContext('2d');
       const corner = ctx.getImageData(0, 0, 1, 1).data;   // quiet zone = paper
       const rs = getComputedStyle(document.documentElement);
       return {
         paper: [corner[0], corner[1], corner[2]],
         inkVar: rs.getPropertyValue('--qr-ink').trim(),
         paperVar: rs.getPropertyValue('--qr-paper').trim(),
         theme: document.documentElement.getAttribute('data-theme')
       };
     })()`,
    true
  );
  check(colors.theme === 'dark', 'dark: data-theme is set on <html>');
  check(
    colors.paper[0] === 255 && colors.paper[1] === 255 && colors.paper[2] === 255,
    `dark: paper is still white (${colors.paper.join(',')})`
  );
  console.log(`      tokens in dark: --qr-ink ${colors.inkVar}, --qr-paper ${colors.paperVar}`);

  await win.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'support-dark.png'), img.toPNG());
  });
  console.log('      wrote shots/support-dark.png');

  await win.webContents.executeJavaScript(`CS.Theme.set('light')`, true);
  await sleep(200);

  /* ---------- 3. derived, not copied ---------- */
  const changed = await win.webContents.executeJavaScript(
    `(function () {
       if (window.__dlg) { try { window.__dlg.close(); } catch (e) {} }
       const w = CS.Donate.readyWallets()[0];
       const before = w.address;
       w.address = 'TCHANGEDADDRESSFORTHEDERIVATIONCHECK99';
       window.__dlg = CS.Support.open();
       const canvas = document.querySelector('canvas.support-qr');
       const info = (${READ_GRID})(canvas);
       const shown = document.querySelector('.support-addr').textContent;
       const exp = (${EXPECTED_GRID})(w.address);
       w.address = before;                      /* put it back */
       return { info, shown, exp, before };
     })()`,
    true
  );
  check(
    changed.info.grid !== light.info.grid,
    'derivation: editing the address changes the painted QR'
  );
  check(
    changed.exp.grid === changed.info.grid,
    'derivation: the new grid matches the encoder matrix for the NEW string'
  );
  check(
    changed.shown === 'TCHANGEDADDRESSFORTHEDERIVATIONCHECK99',
    `derivation: the printed address changed too ("${changed.shown}")`
  );
  await win.webContents.executeJavaScript(`if (window.__dlg) window.__dlg.close();`, true);

  /* ---------- 4. production data renders clean ---------- */
  const demo = await win.webContents.executeJavaScript(
    `(function () {
       if (window.__dlg) { try { window.__dlg.close(); } catch (e) {} }
       window.__dlg = CS.Support.open();
       const q = (s) => document.querySelector(s);
       return {
         cap: q('.support-qr-cap') ? q('.support-qr-cap').textContent : null,
         warn: q('.support-warn') ? q('.support-warn').textContent : null,
         hasDemo: CS.Donate.hasDemo(),
         demoFlag: CS.Donate.readyWallets().some(function (w) { return !!w.demo; }),
         grid: (${READ_GRID})(q('canvas.support-qr')).grid
       };
     })()`,
    true
  );
  check(demo.hasDemo === false, 'production: CS.Donate.hasDemo() is false');
  check(demo.demoFlag === false, 'production: no visible wallet carries demo: true');
  check(demo.cap === null, 'production: no DEMO caption under the QR');
  check(demo.warn === null, 'production: no demo footer warning');
  check(demo.grid === light.info.grid, 'production: the clean dialog still paints the same payload');

  /* ---------- 5. copy ---------- */
  lastClip = null;
  await win.webContents.executeJavaScript(
    `(function () {
       const btn = Array.prototype.slice.call(document.querySelectorAll('.support-acts .btn'))
         .filter(function (b) { return b.textContent === 'Copy'; })[0];
       if (btn) btn.click();
       return !!btn;
     })()`,
    true
  );
  await sleep(300);
  check(lastClip === addr, `copy: clipboard holds the address ("${lastClip}")`);

  /* ---------- 6. enlarged dialog ---------- */
  const big = await win.webContents.executeJavaScript(
    `(function () {
       if (window.__dlg) { try { window.__dlg.close(); } catch (e) {} }
       window.__big = CS.Support.openLarge(CS.Donate.readyWallets()[0]);
       const c = document.querySelector('canvas.support-qr-big');
       if (!c) return { missing: true };
       const r = c.getBoundingClientRect();
       const info = (${READ_GRID})(c);
       return { css: Math.round(r.width) + 'x' + Math.round(r.height), info };
     })()`,
    true
  );
  check(!big.missing, 'enlarged: the 240px dialog opened');
  if (!big.missing) {
    check(big.css === '240x240', `enlarged: canvas CSS box is ${big.css}`);
    check(!big.info.blank && big.info.mid === 0, 'enlarged: QR is painted and crisp');
  }
  await win.webContents.capturePage().then((img) => {
    fs.writeFileSync(path.join(OUT, 'support-large.png'), img.toPNG());
  });
  console.log('      wrote shots/support-large.png');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    show: true,
    frame: false,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.webContents.on('console-message', (_e, level, message) => {
    /* A harness artefact, not an app defect: this harness reads the QR canvas
     * back with getImageData many times, which is exactly what the hint is
     * about. The app never does that (smoke reports 0 problems), and the hint
     * cannot be silenced by asking for the context again — the attribute is
     * fixed at creation. */
    if (/willReadFrequently/.test(message)) return;
    if (level >= 2) problems.push(`CONSOLE  ${message}`);
  });

  try {
    await run(win);
  } catch (err) {
    problems.push(`HARNESS CRASH  ${(err && err.stack) || err}`);
  }

  console.log('\n============ SUPPORT CHECK ============');
  if (problems.length) problems.forEach((p) => console.log('  ' + p));
  else console.log('  no problems found.');
  console.log(`problems: ${problems.length}`);
  console.log('=======================================\n');

  setTimeout(() => app.exit(problems.length ? 1 : 0), 300);
});

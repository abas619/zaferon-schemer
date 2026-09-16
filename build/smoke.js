'use strict';

/**
 * Visual smoke test.
 *
 *   npm run smoke        (npx electron build/smoke.js)
 *
 * Boots the real renderer, walks every tab, document and dialog, captures a
 * PNG of each state into ./shots and reports console errors, uncaught
 * exceptions and layout problems.
 */

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ensureInput, releaseInput } = require('./input-guard');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

// Throwaway profile so localStorage is always empty at the start.
const SMOKE_PROFILE = path.join(os.tmpdir(), 'zaferon-smoke-profile');
try {
  fs.rmSync(SMOKE_PROFILE, { recursive: true, force: true });
} catch (_) {
  /* ignore */
}
app.setPath('userData', SMOKE_PROFILE);

// No usable GPU in this environment; software rendering is fine for layout.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

process.env.CS_SMOKE = '1';

const problems = [];
const shots = [];
const trace = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Relative luminance of a `#rrggbb` string, or null if it is not one.
 * The theme audit asserts *darkness*, not a specific hex — hard-coding the
 * palette here meant every redesign broke the audit for no good reason. */
function relLum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = [16, 8, 0].map((sh) => {
    const c = ((n >> sh) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

const log = (m) => {
  trace.push(m);
  process.stdout.write('  · ' + m + '\n');
};

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

function wireDiagnostics(win) {
  ipcMain.on('smoke:error', (_e, stack) => {
    problems.push(`UNCAUGHT  ${stack}`);
  });

  win.webContents.on('console-message', (...args) => {
    let level = 0;
    let message = '';
    let line = 0;
    let source = '';
    if (args.length >= 5) {
      [, level, message, line, source] = args;
    } else if (args[1] && typeof args[1] === 'object') {
      level = args[1].level;
      message = args[1].message;
      line = args[1].lineNumber;
      source = args[1].sourceId;
    }
    const isError = level === 3 || level === 'error';
    const isWarn = level === 2 || level === 'warning';
    /* Chromium emits this when a ResizeObserver callback changes layout and the
     * follow-up notification misses the same frame. It is a known benign
     * warning, it is not actionable from application code, and it fires
     * sporadically — so it is filtered by exact text. Nothing else is. */
    if (/ResizeObserver loop (completed|limit exceeded)/.test(message)) return;
    if (isError || isWarn) {
      problems.push(`${isError ? 'ERROR' : 'WARN'}  ${message}   (${String(source).replace(/^.*\//, '')}:${line})`);
    }
  });

  win.webContents.on('render-process-gone', (_e, d) => problems.push(`RENDERER GONE  ${JSON.stringify(d)}`));
  win.webContents.on('preload-error', (_e, p, err) => problems.push(`PRELOAD ERROR  ${p}  ${err && err.message}`));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => problems.push(`LOAD FAILED  ${code} ${desc} ${url}`));
  win.webContents.on('unresponsive', () => problems.push('RENDERER UNRESPONSIVE'));
}

async function shot(win, name) {
  await sleep(380);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const img = await win.webContents.capturePage();
      const png = img.toPNG();
      if (!png || png.length < 200) throw new Error('empty capture');
      const file = path.join(OUT, `${name}.png`);
      fs.writeFileSync(file, png);
      shots.push(file);
      log(`captured ${name}`);
      return;
    } catch (err) {
      if (attempt === 3) {
        problems.push(`CAPTURE FAILED  ${name}: ${err.message}`);
        log(`capture FAILED ${name}: ${err.message}`);
      } else {
        await sleep(500);
      }
    }
  }
}

function js(win, code) {
  return win.webContents.executeJavaScript(code, true).catch((e) => {
    problems.push(`EVAL FAILED  ${e.message}`);
    return null;
  });
}

/* Real cursor movement. sendInputEvent mouseMove only reaches the renderer when
 * the window is visible, and it is the only way to exercise hit-testing — a
 * synthetic PointerEvent bypasses it entirely. */
async function mouseMove(win, x, y) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  await sleep(55);
}

const clickTab = (label) => `
  (() => {
    const b = [...document.querySelectorAll('.tab')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return 'missing tab: ' + ${JSON.stringify(label)};
    b.click();
    return 'ok';
  })()`;

/* Base Color tabs must be addressed by data-id, not by label: the dock is
 * narrow enough that "Spectrum"/"Library" render as "Spec"/"Lib", so a label
 * lookup silently missed and the capture showed whatever tab was open before. */
const clickBaseTab = (id) => `
  (() => {
    const b = document.querySelector('.panel-tabrow .tab[data-id=' + ${JSON.stringify(JSON.stringify(id))} + ']');
    if (!b) return 'missing base tab: ' + ${JSON.stringify(id)};
    b.click();
    return 'ok';
  })()`;

const clickTool = (i) => `
  (() => {
    const b = document.querySelectorAll('#toolbar-tools .tool-btn')[${i}];
    if (!b) return 'missing tool ${i}';
    b.click();
    return 'ok';
  })()`;

/* ------------------------------------------------------------------ *
 * Stubbed IPC so the harness can run the real renderer standalone
 * ------------------------------------------------------------------ */

ipcMain.handle('clipboard:writeText', (_e, t) => {
  clipboard.writeText(String(t == null ? '' : t));
  return true;
});
ipcMain.handle('clipboard:readText', () => clipboard.readText());
ipcMain.handle('file:save', async () => path.join(OUT, 'saved-test.json'));
ipcMain.handle('file:openImage', async () => null);
ipcMain.handle('file:openText', async () => null);
ipcMain.handle('file:exportPng', async () => null);
ipcMain.handle('file:openPath', async () => null);
ipcMain.handle('shell:openExternal', async () => true);
ipcMain.handle('picker:start', async () => null);
ipcMain.on('win:minimize', () => {});
ipcMain.on('win:maximize', () => {});
ipcMain.on('win:close', () => {});

/* ------------------------------------------------------------------ *
 * Main flow
 * ------------------------------------------------------------------ */

async function run(win) {
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1700);

  /* See build/input-guard.js: an occluded window routes synthetic input to
   * whatever is really on top of that screen coordinate, so pin the window
   * above everything and prove input lands before any test trusts it. */
  const inputOk = await ensureInput(win);
  log(`synthetic input reaching renderer: ${inputOk}`);
  if (!inputOk) {
    problems.push('INPUT  synthetic mouse events never reached the renderer — window is occluded, input results below are meaningless');
  }

  log('booted');
  await shot(win, '01-matching-wheel');

  /* ---- Matching Colors wheel: margins + rotation animation ----
   * The wheel must sit inside its pane with breathing room on every side, at
   * any hue — every wedge is drawn 6% past the ring and used to be clipped.
   * A hash of the pixel buffer tells us whether the wedges animate or teleport. */
  const wheelMetrics = await js(
    win,
    `(() => {
       const c = document.querySelector('.wheel-canvas');
       if (!c) return null;
       const box = c.getBoundingClientRect();
       const dpr = window.devicePixelRatio || 1;
       const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
       let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
       for (let y = 0; y < c.height; y++) {
         for (let x = 0; x < c.width; x++) {
           if (d[(y * c.width + x) * 4 + 3] > 8) {
             if (x < minX) minX = x; if (x > maxX) maxX = x;
             if (y < minY) minY = y; if (y > maxY) maxY = y;
           }
         }
       }
       let h = 0x811c9dc5;
       for (let i = 0; i < d.length; i += 4) {
         h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3];
         h = (h * 0x01000193) >>> 0;
       }
       return { w: Math.round(box.width), h: Math.round(box.height),
                min: Math.round(Math.min(minX, minY, c.width - 1 - maxX, c.height - 1 - maxY) / dpr),
                hash: h };
     })()`
  );
  if (!wheelMetrics) {
    problems.push('WHEEL  no .wheel-canvas found');
  } else {
    log(`wheel ${wheelMetrics.w}x${wheelMetrics.h} min margin ${wheelMetrics.min}px`);
    if (wheelMetrics.min < 6) {
      problems.push(`WHEEL  painted content is ${wheelMetrics.min}px from the canvas edge — clipped or too tight`);
    }
    // widest wedge is the base one; sweep hues and confirm none overflows
    let worst = wheelMetrics.min;
    let worstHue = null;
    for (let hue = 0; hue < 360; hue += 45) {
      await js(win, `window.CS.Store.setColor('hsl(${hue}, 100%, 50%)'); 'ok'`);
      await sleep(700); // let the rotation settle
      const m = await js(
        win,
        `(() => { const c = document.querySelector('.wheel-canvas');
           const dpr = window.devicePixelRatio || 1;
           const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
           let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
           for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
             if (d[(y * c.width + x) * 4 + 3] > 8) {
               if (x < minX) minX = x; if (x > maxX) maxX = x;
               if (y < minY) minY = y; if (y > maxY) maxY = y; } }
           return Math.round(Math.min(minX, minY, c.width - 1 - maxX, c.height - 1 - maxY) / dpr); })()`
      );
      if (typeof m === 'number' && m < worst) { worst = m; worstHue = hue; }
    }
    log(`wheel worst margin ${worst}px (hue ${worstHue})`);
    if (worst < 6) problems.push(`WHEEL  hue ${worstHue} leaves only ${worst}px of margin — wedge clipped`);

    // rotation animation: sample the buffer while it is still moving.
    // Hash the pixels AND record the buffer size — a repaint at a different
    // size changes the hash for reasons unrelated to the animation.
    const sampleWheel = () =>
      js(
        win,
        `(() => { const c = document.querySelector('.wheel-canvas');
           const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0,0,c.width,c.height).data;
           let h = 0x811c9dc5;
           for (let i = 0; i < d.length; i += 4) { h ^= d[i] + d[i+1]*3 + d[i+2]*7 + d[i+3]; h = (h*0x01000193)>>>0; }
           return { h: h, w: c.width, ht: c.height }; })()`
      );

    await js(win, `window.CS.Store.setColor('#FF0000'); 'ok'`);
    await sleep(900);
    const restA = await sampleWheel();
    await js(win, `window.CS.Store.setColor('#00B0FF'); 'ok'`);
    await sleep(90);
    const mid = await sampleWheel();
    await sleep(1100);

    // Poll until two consecutive samples agree at the same size.
    let settled = await sampleWheel();
    let stable = false;
    for (let i = 0; i < 6 && !stable; i++) {
      await sleep(400);
      const next = await sampleWheel();
      if (next.h === settled.h && next.w === settled.w && next.ht === settled.ht) stable = true;
      else settled = next;
    }
    if (restA.h === settled.h) problems.push('WHEEL  colour change did not repaint');
    if (mid.h === settled.h) problems.push('WHEEL  wedges teleported - no rotation animation');
    if (!stable) problems.push('WHEEL  rotation never settled (still repainting after ~3.5s)');
    log(`wheel rotation animates (mid ${mid.h} != settled ${settled.h}, stable=${stable})`);
    await js(win, `window.CS.Store.setColor('#BFBD1F'); 'ok'`);
    await sleep(800);
  }

  await js(win, clickTab('LiveSchemes'));
  await shot(win, '02-matching-live');

  await js(win, clickTab('Mixer'));
  await shot(win, '03-matching-mixer');

  await js(win, clickTab('Variations'));
  await shot(win, '04-matching-variations');

  await js(win, clickBaseTab('spectrum'));
  await shot(win, '05-base-spectrum');

  await js(win, clickBaseTab('library'));
  await shot(win, '06-base-library');

  await js(win, clickBaseTab('rgb'));
  await shot(win, '07-base-rgb');

  await js(win, clickTool(1));
  await shot(win, '08-gallery');

  await js(win, clickTool(2));
  await sleep(1000);
  await shot(win, '09-photo');

  await js(win, clickTool(3));
  await shot(win, '10-builder');

  await js(win, clickTool(4));
  await shot(win, '11-browser');

  // open the Adjust menu and hover a submenu
  await js(win, `document.querySelectorAll('.menubar-item')[2].click(); 'ok'`);
  await shot(win, '12-menu-adjust');
  await js(
    win,
    `(() => {
       const items = [...document.querySelectorAll('.menu-popup > .menu-item')];
       const withSub = items.find(i => i.querySelector('.menu-subwrap'));
       if (withSub) withSub.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
       return 'ok';
     })()`
  );
  await shot(win, '13-menu-submenu');
  await js(win, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); 'ok'`);
  await sleep(200);

  /* ---- real pointer input: can the cursor actually get INTO a submenu? ----
   * The synthetic PointerEvent above only proves the handler runs; it cannot
   * catch the case where a submenu row's own pointerenter closes its parent.
   * That needs genuine hit-testing, so drive the mouse through sendInputEvent. */
  await js(win, `document.querySelectorAll('.menubar-item')[2].click(); 'ok'`);
  await sleep(200);
  const subRowPt = await js(
    win,
    `(() => {
       const pop = document.querySelector('.menu-popup');
       const row = [...pop.children].find(x => x.classList.contains('menu-item') && x.querySelector('.menu-subwrap'));
       if (!row) return null;
       const r = row.getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right };
     })()`
  );
  if (!subRowPt) {
    problems.push('SUBMENU  no row carrying a submenu in the Adjust menu');
  } else {
    const y = Math.round(subRowPt.y);
    await mouseMove(win, subRowPt.x, y);
    const opened = await js(
      win,
      `(() => { const w = document.querySelector('.menu-subwrap.is-open'); if (!w) return null;
         const s = w.querySelector('.menu-popup').getBoundingClientRect();
         return { left: Math.round(s.left), right: Math.round(s.right) }; })()`
    );
    if (!opened) problems.push('SUBMENU  hovering the parent row did not open a submenu');

    if (opened) {
      // step the cursor across the seam between parent row and submenu
      let closedAt = null;
      for (let x = Math.round(subRowPt.right) - 8; x <= opened.left + 40; x += 2) {
        await mouseMove(win, x, y);
        const stillOpen = await js(win, `!!document.querySelector('.menu-subwrap.is-open')`);
        if (!stillOpen) { closedAt = x; break; }
      }
      if (closedAt !== null) {
        problems.push(`SUBMENU  closed while moving into it (x=${closedAt}, parent.right=${Math.round(subRowPt.right)}, sub.left=${opened.left})`);
      } else {
        log(`submenu enterable: parent.right=${Math.round(subRowPt.right)} sub.left=${opened.left}`);
      }

      // hovering one of the submenu's own items must not close it
      await js(win, `(() => { const w = document.querySelector('.menu-subwrap.is-open');
         const it = w && w.querySelector('.menu-popup > .menu-item'); if (it) it.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
         return 'ok'; })()`);
      const afterItem = await js(win, `!!document.querySelector('.menu-subwrap.is-open')`);
      if (!afterItem) problems.push('SUBMENU  hovering a submenu item closed the submenu');

      // switching to a sibling branch must leave exactly one submenu open
      const sibPt = await js(
        win,
        `(() => { const pop = document.querySelector('.menu-popup');
           const rows = [...pop.children].filter(x => x.classList.contains('menu-item'));
           const row = rows.find(x => x.querySelector('.menu-subwrap') && !x.querySelector('.menu-subwrap.is-open'));
           if (!row) return null; const r = row.getBoundingClientRect();
           return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
      );
      if (sibPt) {
        await mouseMove(win, sibPt.x, Math.round(sibPt.y));
        const n = await js(win, `document.querySelectorAll('.menu-subwrap.is-open').length`);
        if (n !== 1) problems.push(`SUBMENU  sibling branch left ${n} submenus open (expected 1)`);
      }

      await shot(win, '13b-menu-submenu-hover');
    }
  }
  await js(win, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); 'ok'`);
  await sleep(200);

  // dialogs
  await js(win, `CS.App.contrastAnalyzer(); 'ok'`);
  await shot(win, '14-contrast');
  await js(win, `document.querySelector('.modal-close').click(); 'ok'`);

  await js(win, `CS.App.quickPreview(); 'ok'`);
  await shot(win, '15-quickpreview');
  await js(win, `document.querySelector('.modal-close').click(); 'ok'`);

  await js(win, `CS.App.exportPalette(); 'ok'`);
  await shot(win, '16-export');
  await js(win, `document.querySelector('.modal-close').click(); 'ok'`);

  await js(win, `CS.App.aboutDialog(); 'ok'`);
  await shot(win, '17-about');
  await js(win, `document.querySelector('.modal-close').click(); 'ok'`);

  // favourites + a different harmony, back on the wheel
  const step18 = await js(
    win,
    `(() => {
       try {
         CS.Color.harmonyRgb(CS.Store.hsv(), 'triadic').forEach(c => CS.Store.addFavorite(c));
         CS.Store.set('scheme', 'analogous');
         CS.App.openDocument('matching');
         const m = CS.App.documents.matching;
         if (m && m.refreshAll) m.refreshAll();
         return 'ok';
       } catch (err) {
         return 'STACK: ' + (err && err.stack);
       }
     })()`
  );
  if (step18 && String(step18).startsWith('STACK')) problems.push(`STEP18  ${step18}`);
  await shot(win, '18-matching-analogous-favourites');

  // interaction checks: sliders, spectrum, mixer, photo markers, eyedropper
  const interaction = await js(    win,
    `(() => {
       const out = [];
       const fire = (node, type, x, y, extra) => {
         const r = node.getBoundingClientRect();
         node.dispatchEvent(new PointerEvent(type, Object.assign({
           bubbles: true, clientX: x == null ? r.left + r.width / 2 : x,
           clientY: y == null ? r.top + r.height / 2 : y, button: 0
         }, extra || {})));
       };

       try {
         // 1. drag the R slider in the Base Color panel
         const track = document.querySelector('.cslider-track');
         if (track) { fire(track, 'pointerdown'); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); out.push('slider drag ok'); }
         else out.push('slider track missing');

         // 2. spectrum pick
         const sq = document.querySelector('.bc-square');
         if (sq) { fire(sq, 'pointerdown'); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); out.push('spectrum ok'); }
         else out.push('spectrum canvas missing');

         // 3. click the colour wheel
         const wheel = document.querySelector('.wheel-canvas');
         if (wheel) { const r = wheel.getBoundingClientRect(); fire(wheel, 'pointerdown', r.left + r.width * 0.5, r.top + r.height * 0.2); out.push('wheel ok'); }
         else out.push('wheel canvas missing');

         // 4. cycle the harmony with the hub arrow
         const up = document.querySelector('.hub-arrow');
         if (up) { up.click(); out.push('hub arrow ok'); } else out.push('hub arrow missing');

         // 5. open the eyedropper (stubbed to cancel)
         CS.App.pickFromScreen();
         out.push('picker invoked');

         // 6. library search
         const search = document.querySelector('.bc-lib-search input');
         if (search) { search.value = 'blue'; search.dispatchEvent(new Event('input', { bubbles: true })); out.push('library search ok'); }
         else out.push('library search missing');

         // 7. mixer path + steps
         const mixerTab = [...document.querySelectorAll('.tab')].find(x => x.textContent.trim() === 'Mixer');
         if (mixerTab) mixerTab.click();
         const pathSel = document.querySelector('.mixer-head select');
         if (pathSel) { pathSel.value = 'rgb'; pathSel.dispatchEvent(new Event('change', { bubbles: true })); out.push('mixer path ok'); }
         else out.push('mixer select missing');
         const stepField = document.querySelector('.mixer-head .stepper-num');
         if (stepField) { stepField.value = '9'; stepField.dispatchEvent(new Event('change', { bubbles: true })); out.push('mixer steps ok'); }
         else out.push('mixer steps missing');

         // 8. variations intensity
         const varTab = [...document.querySelectorAll('.tab')].find(x => x.textContent.trim() === 'Variations');
         if (varTab) varTab.click();
         const varCells = document.querySelectorAll('.vr-sw').length;
         out.push('variation cells: ' + varCells);

         // 9. base colour: wheel + convert tabs (they live inside the panel tab row)
         const baseTab = (id) => document.querySelector('.panel-tabrow .tab[data-id="' + id + '"]');
         const bWheel = baseTab('wheel');
         if (bWheel) { bWheel.click(); out.push('base wheel tab ok'); } else out.push('base wheel tab missing');
         const wc = document.querySelector('canvas.bc-wheel');
         if (wc) {
           const r = wc.getBoundingClientRect();
           fire(wc, 'pointerdown', r.left + r.width * 0.5, r.top + 6);
           window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
           const r2 = wc.getBoundingClientRect();
           fire(wc, 'pointerdown', r2.left + r2.width * 0.5, r2.top + r2.height * 0.5);
           window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
           out.push('base wheel size: ' + wc.width + 'x' + wc.height);
           // prove the canvas actually has coloured pixels, not just a blank buffer
           const cx = wc.getContext('2d', { willReadFrequently: true });
           const probe = cx.getImageData(Math.round(wc.width * 0.5), Math.round(wc.height * 0.04), 1, 1).data;
           out.push('base wheel top pixel rgba: ' + [probe[0], probe[1], probe[2], probe[3]].join(','));
           if (probe[3] === 0) out.push('WHEEL BLANK — ring did not paint');

           // the HSV triangle must paint the centre too (regression guard for the
           // putImageData/clip bug that left the triangle blank)
           const mid = cx.getImageData(Math.round(wc.width * 0.5), Math.round(wc.height * 0.30), 1, 1).data;
           out.push('base wheel triangle pixel rgba: ' + [mid[0], mid[1], mid[2], mid[3]].join(','));
           if (mid[3] === 0) out.push('TRIANGLE BLANK — SV plane did not paint');
           // and the corners outside the triangle must stay transparent
           const corner = cx.getImageData(Math.round(wc.width * 0.08), Math.round(wc.height * 0.92), 1, 1).data;
           out.push('base wheel outside-triangle alpha: ' + corner[3]);
         } else out.push('base wheel canvas missing');

         const bConv = baseTab('convert');
         if (bConv) { bConv.click(); out.push('convert tab ok'); } else out.push('convert tab missing');

         // 9b. wheel pick must agree with the painted triangle
         bWheel.click();
         const wcv = document.querySelector('canvas.bc-wheel');
         if (wcv) {
           const rr = wcv.getBoundingClientRect();
           const pickAt = (fx, fy) => {
             CS.Store.setColor('#FF0000'); // reset hue so probes are independent
             wcv.dispatchEvent(new PointerEvent('pointerdown', {
               bubbles: true, button: 0,
               clientX: rr.left + rr.width * fx, clientY: rr.top + rr.height * fy
             }));
             window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
             const hv = CS.Store.hsv();
             return { h: Math.round(hv.h), s: Math.round(hv.s * 100), v: Math.round(hv.v * 100) };
           };
           const ringTop = pickAt(0.5, 0.05);
           out.push('ring top pick -> ' + JSON.stringify(ringTop));
           if (ringTop.s < 70 || ringTop.v < 70) out.push('RING PICK wrong: expected saturated bright hue');
           const apex = pickAt(0.5, 0.30);
           out.push('triangle apex pick -> ' + JSON.stringify(apex));
           if (apex.s < 50 || apex.v < 50) out.push('TRIANGLE PICK wrong at apex: expected high S/V');
           const dark = pickAt(0.42, 0.72);
           out.push('triangle black-corner pick -> ' + JSON.stringify(dark));
           if (dark.v > 75) out.push('TRIANGLE PICK wrong at black corner: expected low V');

           /* 9c. The SV marker must sit exactly under the cursor.
            *
            * The triangle is a barycentric blend of its three corners, and HSV
            * maps onto it as pure = v*s, white = v*(1-s), black = 1-v. Derive the
            * position independently here, click it, and require the store to come
            * back with the same s/v — that is precisely "the marker follows the
            * mouse". The old code had white/black swapped in the *marker* draw,
            * so clicking right-of-centre parked the ring on the far left.
            *
            * Then read the pixel at the marker centre (the ring is stroked, not
            * filled, so the gradient shows through) and compare it with
            * Color.hsvToRgb — proving the triangle is an exact HSV map. */
           const geo = (() => {
             const r = wcv.getBoundingClientRect();
             const w = r.width, h = r.height;
             const outer = Math.max(24, Math.min(w, h) / 2 - 2);
             const ringW = Math.max(8, Math.min(outer * 0.16, outer * 0.34));
             const inner = Math.max(8, outer - ringW);
             const cx = w / 2, cy = h / 2;
             const R = Math.max(4, inner * 0.92);
             const hue = CS.Store.hsv().h;
             const rot = ((hue - 90) * Math.PI) / 180;
             const pt = (a, rad) => [cx + Math.cos((a * Math.PI) / 180 + rot) * rad,
                                     cy + Math.sin((a * Math.PI) / 180 + rot) * rad];
             return { cx, cy, R, left: r.left, top: r.top, pure: pt(0, R), white: pt(120, R), black: pt(240, R) };
           })();
           const posFor = (s, v) => {
             const wH = v * s, wW = v * (1 - s), wB = 1 - v;
             return [wH * geo.pure[0] + wW * geo.white[0] + wB * geo.black[0],
                     wH * geo.pure[1] + wW * geo.white[1] + wB * geo.black[1]];
           };
           const clickAt = (px, py) => {
             wcv.dispatchEvent(new PointerEvent('pointerdown', {
               bubbles: true, button: 0,
               clientX: geo.left + px, clientY: geo.top + py
             }));
             window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
             const hv = CS.Store.hsv();
             return { s: hv.s, v: hv.v };
           };

           let worstDrift = 0;
           [[1, 1], [0, 1], [0, 0], [0.5, 1], [1, 0.5], [0.25, 0.75],
            [0.75, 0.25], [0.5, 0.5], [0.9, 0.9], [0.1, 0.5]].forEach(([s, v]) => {
             CS.Store.setColor('#FF0000'); // pin the hue so geometry is stable
             const p = posFor(s, v);
             const got = clickAt(p[0], p[1]);
             worstDrift = Math.max(worstDrift, Math.abs(got.s - s), Math.abs(got.v - v));
           });
           out.push('SV marker round-trip worst drift: ' + worstDrift.toFixed(4));
           if (worstDrift > 0.03) {
             out.push('SV MARKER off by ' + worstDrift.toFixed(3) + ' - marker does not follow the cursor');
           }

           // corners must be the three pure states
           CS.Store.setColor('#FF0000');
           const cPure = clickAt(geo.pure[0], geo.pure[1]);
           const cWhite = clickAt(geo.white[0], geo.white[1]);
           const cBlack = clickAt(geo.black[0], geo.black[1]);
           out.push('triangle corners -> pure s' + cPure.s.toFixed(2) + ' v' + cPure.v.toFixed(2)
             + ' / white s' + cWhite.s.toFixed(2) + ' v' + cWhite.v.toFixed(2)
             + ' / black s' + cBlack.s.toFixed(2) + ' v' + cBlack.v.toFixed(2));
           if (Math.abs(cPure.s - 1) > 0.03 || Math.abs(cPure.v - 1) > 0.03) out.push('TRIANGLE corner wrong: pure-hue corner is not s=1 v=1');
           if (Math.abs(cWhite.s) > 0.03 || Math.abs(cWhite.v - 1) > 0.03) out.push('TRIANGLE corner wrong: white corner is not s=0 v=1');
           if (Math.abs(cBlack.s) > 0.03 || Math.abs(cBlack.v) > 0.03) out.push('TRIANGLE corner wrong: black corner is not s=0 v=0');

           // the gradient under the marker must equal Color.hsvToRgb
           let worstPx = 0;
           const ctxW = wcv.getContext('2d', { willReadFrequently: true });
           const dprW = window.devicePixelRatio || 1;
           [[0.8, 0.8], [0.5, 0.7], [0.3, 0.6], [0.6, 0.4]].forEach(([s, v]) => {
             CS.Store.setColor({ h: 0, s, v });
             const p = posFor(s, v);
             const d = ctxW.getImageData(Math.round(p[0] * dprW), Math.round(p[1] * dprW), 1, 1).data;
             const want = CS.Color.hsvToRgb({ h: 0, s, v });
             worstPx = Math.max(worstPx, Math.abs(d[0] - want.r), Math.abs(d[1] - want.g), Math.abs(d[2] - want.b));
           });
           out.push('triangle gradient vs hsvToRgb worst delta: ' + worstPx);
           if (worstPx > 10) out.push('TRIANGLE gradient is not an exact HSV map (delta ' + worstPx + ')');
           CS.Store.setColor('#FF0000');
         }
         const convRows = document.querySelectorAll('.conv-row');
         out.push('conversion rows: ' + convRows.length);
         const convIds = [...document.querySelectorAll('.conv-tag')].map(t => t.textContent.trim()).join('/');
         out.push('conversion tags: ' + convIds);

         // 10. round-trip: type a hex into the conversion field
         const hexRow = [...document.querySelectorAll('.conv-row')].find(r => r.querySelector('.conv-tag').textContent.trim() === 'HEX');
         if (hexRow) {
           const inp = hexRow.querySelector('.conv-value');
           inp.value = '#3F8FD0';
           inp.dispatchEvent(new Event('change', { bubbles: true }));
           out.push('hex edit applied -> ' + CS.Store.hexUpper());
         } else out.push('hex conversion row missing');

         // 11. toggle a format chip off / on
         const chip = document.querySelector('.conv-chip');
         if (chip) { chip.click(); out.push('chip toggle ok'); chip.click(); } else out.push('conversion chip missing');

         // 12. theme toggle
         const tt = document.querySelector('.theme-toggle');
         if (tt) {
           tt.click();
           out.push('theme -> ' + (window.CS.Theme ? CS.Theme.current : '?'));
           tt.click();
           out.push('theme back -> ' + (window.CS.Theme ? CS.Theme.current : '?'));
         } else out.push('theme toggle missing');

         // back to the wheel for the final screenshot
         const wheelTabClickable = [...document.querySelectorAll('.tab')].find(x => x.textContent.trim() === 'Wheel');
         if (wheelTabClickable) wheelTabClickable.click();

         return JSON.stringify(out);
       } catch (err) {
         return JSON.stringify(['THREW: ' + err.message]);
       }
     })()`
  );
  (interaction ? JSON.parse(interaction) : []).forEach((i) => log('interaction: ' + i));

  await sleep(700);
  await shot(win, '19-after-interactions');

  /* ---- dark theme pass ---- */
  await js(win, `CS.Theme.set('dark'); 'ok'`);
  await sleep(400);
  await js(win, `document.querySelector('.panel-tabrow .tab[data-id="wheel"]').click(); 'ok'`);
  await shot(win, '20-dark-wheel');
  await js(win, `document.querySelector('.panel-tabrow .tab[data-id="convert"]').click(); 'ok'`);
  await shot(win, '21-dark-convert');
  await js(win, `document.querySelector('.panel-tabrow .tab[data-id="rgb"]').click(); 'ok'`);
  await shot(win, '22-dark-rgb');
  const darkVars = await js(
    win,
    `(() => {
       const cs = getComputedStyle(document.documentElement);
       return JSON.stringify({
         theme: document.documentElement.getAttribute('data-theme'),
         chrome: cs.getPropertyValue('--chrome').trim(),
         text: cs.getPropertyValue('--text').trim(),
         canvas: cs.getPropertyValue('--canvas').trim()
       });
     })()`
  );
  log('dark vars: ' + darkVars);
  const parsed = darkVars ? JSON.parse(darkVars) : null;
  if (!parsed || parsed.theme !== 'dark') problems.push('AUDIT  dark theme did not apply data-theme');
  if (parsed) {
    const chromeLum = relLum(parsed.chrome);
    const textLum = relLum(parsed.text);
    const canvasLum = relLum(parsed.canvas);
    if (chromeLum === null || canvasLum === null || textLum === null) {
      problems.push(`AUDIT  dark vars are not hex colours: ${JSON.stringify(parsed)}`);
    } else {
      if (chromeLum > 0.12) problems.push(`AUDIT  dark --chrome ${parsed.chrome} is not dark (lum ${chromeLum.toFixed(3)})`);
      if (canvasLum > 0.12) problems.push(`AUDIT  dark --canvas ${parsed.canvas} is not dark (lum ${canvasLum.toFixed(3)})`);
      if (textLum < 0.5) problems.push(`AUDIT  dark --text ${parsed.text} is not legible on dark (lum ${textLum.toFixed(3)})`);
      if (textLum <= chromeLum) problems.push('AUDIT  dark --text is not lighter than --chrome');
    }
  }
  await js(win, `CS.Theme.set('light'); 'ok'`);
  await sleep(300);

  // layout audit
  const audit = await js(
    win,
    `(() => {
       const out = [];
       const need = (sel, label) => { const n = document.querySelector(sel); if (!n) out.push(label + ' missing'); return n; };
       need('#doc-host .panel', 'document panel');
       need('#dock-left .panel', 'left dock panel');
       need('#dock-right .panel', 'right dock panel');
       need('#palette-host .panel', 'palette panel');
       need('.menubar-item', 'menu bar');
       need('.tool-btn', 'toolbar');
       need('#status-left', 'status bar');
       need('.current-color-value', 'toolbar hex field');

       const wheel = document.querySelector('.wheel-canvas');
       if (wheel && (wheel.width === 0 || wheel.height === 0)) out.push('wheel canvas has zero size');
       const baseWheel = document.querySelector('canvas.bc-wheel');
       if (baseWheel && (baseWheel.width === 0 || baseWheel.height === 0)) out.push('base wheel canvas has zero size');
       const conv = document.querySelectorAll('.conv-row');
       if (conv.length < 8) out.push('conversion rows = ' + conv.length + ' (expected >= 8)');
       if (!document.querySelector('.theme-toggle')) out.push('theme toggle missing from toolbar');
       const pal = document.querySelector('.palette-grid');
       if (pal && pal.children.length === 0) out.push('palette grid is empty');
       const status = document.querySelector('#status-left');
       if (status && !status.textContent.trim()) out.push('status bar text is empty');
       const hex = document.querySelector('.current-color-value');
       if (hex && !/^#[0-9A-F]{6}$/.test(hex.value)) out.push('toolbar hex field shows "' + hex.value + '"');

       // panels should not overflow the window horizontally
       const app = document.querySelector('#app');
       if (app && app.scrollWidth > app.clientWidth + 2) out.push('app overflows horizontally by ' + (app.scrollWidth - app.clientWidth) + 'px');
       return JSON.stringify(out);
     })()`
  );
  (audit ? JSON.parse(audit) : []).forEach((i) => problems.push(`AUDIT  ${i}`));
}

function report() {
  console.log('\n================ SMOKE RESULT ================');
  console.log(`steps logged: ${trace.length}`);
  console.log(`screenshots: ${shots.length}`);
  shots.forEach((s) => console.log('  ' + path.relative(ROOT, s)));
  console.log(`problems: ${problems.length}`);
  problems.forEach((p) => console.log('  ! ' + p));
  console.log('==============================================\n');
}

app.whenReady().then(async () => {
  const bail = setTimeout(() => {
    problems.push('TIMEOUT — harness exceeded 150s');
    report();
    process.exit(0);
  }, 150000);

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

  wireDiagnostics(win);

  try {
    await run(win);
  } catch (err) {
    problems.push(`HARNESS CRASH  ${(err && err.stack) || err}`);
  }

  clearTimeout(bail);
  releaseInput(win);
  report();

  setTimeout(() => {
    try {
      win.destroy();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  }, 250);
});

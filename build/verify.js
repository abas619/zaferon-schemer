'use strict';

/**
 * Targeted visual check for the panel-polish pass.
 *
 *   npx electron build/verify.js --disable-gpu --no-sandbox --in-process-gpu
 *
 * Boots the real renderer and captures clipped PNGs of the regions that were
 * changed (Base Color / Spec, the Matching Colors wheel tone, the PhotoSchemer
 * empty state + every effect, the toolbar) into ./shots/verify.
 */

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ensureInput, releaseInput } = require('./input-guard');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots', 'verify');
fs.mkdirSync(OUT, { recursive: true });

const PROFILE = path.join(os.tmpdir(), 'zaferon-verify-profile');
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (_) {
  /* ignore */
}
app.setPath('userData', PROFILE);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write('  · ' + m + '\n');

function wireDiagnostics(win) {
  win.webContents.on('console-message', (...args) => {
    let level = 0;
    let message = '';
    if (args.length >= 5) [, level, message] = args;
    else if (args[1] && typeof args[1] === 'object') {
      level = args[1].level;
      message = args[1].message;
    }
    /* Known benign Chromium warning; fires sporadically and is not actionable
     * from application code. Filtered by exact text — nothing else is. */
    if (/ResizeObserver loop (completed|limit exceeded)/.test(message)) return;
    if (level === 3 || level === 'error') problems.push(`ERROR  ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => problems.push(`RENDERER GONE ${JSON.stringify(d)}`));
  win.webContents.on('preload-error', (_e, p, err) => problems.push(`PRELOAD ${p} ${err && err.message}`));
}

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true).catch((e) => {
    problems.push(`EVAL FAILED ${e.message}`);
    return null;
  });
}

/** Capture the whole window, or just `rect` in CSS pixels. */
async function shot(win, name, rect) {
  /* capturePage(null) is not "the whole window" — it aborts the process with
   * a SkBitmap assertion, taking every remaining check with it. */
  if (!rect || !rect.width || !rect.height) {
    problems.push(`CAPTURE SKIPPED ${name}: nothing to capture (${JSON.stringify(rect)})`);
    return;
  }
  await sleep(420);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const img = await win.webContents.capturePage(rect);
      const png = img.toPNG();
      if (!png || png.length < 200) throw new Error('empty capture');
      fs.writeFileSync(path.join(OUT, `${name}.png`), png);
      log(`captured ${name}`);
      return;
    } catch (err) {
      if (attempt === 3) problems.push(`CAPTURE FAILED ${name}: ${err.message}`);
      else await sleep(400);
    }
  }
}

const rectOf = (sel) => `
  (() => {
    const n = document.querySelector(${JSON.stringify(sel)});
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`;

/* Mirror the wheel's own geometryFor() so a probe can aim at a real wedge.
 * toDeg() maps atan2(y,x) to hue via (rad*180/PI + 90), so the inverse for a
 * target hue h is rad = (h - 90) in degrees. */
const wedgePoint = (i) => `
  (() => {
    const c = document.querySelector('.wheel-canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const w = r.width, h = r.height;
    const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const pad = cl(Math.min(w, h) * 0.055, 14, 34);
    const R = Math.max(20, (Math.min(w, h) / 2 - pad - 7) / 1.06);
    const cx = w / 2, cy = h / 2;
    const base = CS.Store.hsv();
    const colors = CS.Color.harmony(base, CS.Store.get('scheme', 'complementary'));
    const c0 = colors[${i}];
    const display = { h: c0.h, s: cl(Math.max(base.s, 0.5), 0, 1), v: cl(Math.max(base.v, 0.42), 0, 1) };
    const rad = (c0.h - 90) * Math.PI / 180;
    const d = R * 0.85;
    return {
      hex: CS.Color.toHex(CS.Color.hsvToRgb(display)),
      x: Math.round(r.left + cx + d * Math.cos(rad)),
      y: Math.round(r.top + cy + d * Math.sin(rad))
    };
  })()`;

/** Blank lower area of the favourites body — the entire body must accept drops. */
const favDropRect = `
  (() => {
    const n = document.querySelector('#dock-right .fav-body');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.75) };
  })()`;

/* Real cursor input. sendInputEvent mouseMove only reaches the renderer when
 * the window is visible, and it is the only way to exercise hit-testing — a
 * synthetic PointerEvent bypasses it entirely. */
async function mouseMove(win, x, y) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  await sleep(60);
}

async function mouseDown(win, x, y) {
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: 1
  });
  await sleep(90);
}

async function mouseUp(win, x, y) {
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: 1
  });
  await sleep(90);
}

/* Selecting a Base Color tab by label is unsafe (a 180px dock renders
 * "Spectrum" as "Spec"), and a click that silently does nothing leaves the
 * captures showing the wrong tab. Always go through data-id and assert. */
const clickTab = (win, id) =>
  js(
    win,
    `(() => {
       const b = document.querySelector('.panel-tabrow .tab[data-id="' + ${JSON.stringify(id)} + '"]');
       if (!b) return { error: 'missing tab' };
       b.click();
       const active = document.querySelector('.panel-tabrow .tab.is-active');
       return { active: active ? active.dataset.id : null };
     })()`
  );

/* Synthetic input only reaches the renderer through the real hit test, so an
 * occluded window routes every mouseDown to whatever is actually on top of that
 * screen coordinate. The drag step then reports "no ghost, no highlight" and a
 * clean build looks broken. See build/input-guard.js. */
async function run(win) {
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1800);

  const inputOk = await ensureInput(win);
  log(`synthetic input reaching renderer: ${inputOk}`);
  if (!inputOk) {
    problems.push('INPUT  synthetic mouse events never reached the renderer — window is occluded, drag results below are meaningless');
  }

  /* Fail loudly if the renderer is not painting. An occluded window suspends
   * rAF, which turns every rAF-deferred draw into a no-op and makes
   * capturePage hand back the previous frame — so two different shots come
   * out byte-identical and the run still looks clean. */
  const painting = await js(
    win,
    `new Promise((resolve) => {
       const t = setTimeout(() => resolve('rAF never fired'), 2000);
       requestAnimationFrame(() => { clearTimeout(t); resolve('ok'); });
     })`
  );
  log(`renderer painting: ${painting}`);
  if (painting !== 'ok') problems.push(`RENDERER  not painting (${painting}) — captures will be stale`);

  /* --- toolbar ------------------------------------------------------ */
  const tools = await js(
    win,
    `(() => {
       const btns = [...document.querySelectorAll('#toolbar-tools .tool-btn')];
       return btns.map(b => b.title);
     })()`
  );
  log(`toolbar buttons: ${JSON.stringify(tools)}`);
  await shot(win, '01-toolbar', await js(win, rectOf('#toolbar')));

  /* --- arrows ------------------------------------------------------- */
  const arrows = await js(
    win,
    `(() => {
       const g = (sel) => { const n = document.querySelector(sel); if (!n) return null;
         const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
         return { font: cs.fontSize, w: Math.round(r.width), h: Math.round(r.height) }; };
       return {
         panelMenu: g('.panel-btn-menu'),
         panelClose: g('.panel-btn-close'),
         hubArrow: g('.hub-arrow')
       };
     })()`
  );
  log(`arrow sizes: ${JSON.stringify(arrows)}`);

  /* --- Matching Colors wheel: dark base then vivid base --------------- */
  /* The panel is created lazily — without this every capture of #doc-host
   * below shows an empty host and every probe reads a canvas that is not
   * there. */
  await js(win, `CS.App.openDocument('matching'); 'ok'`);
  await sleep(900);
  await js(win, `window.CS.Store.setColor('#1D1C18'); 'ok'`);
  await sleep(1400);
  await shot(win, '02-wheel-dark-base', await js(win, rectOf('#doc-host')));
  await js(win, `window.CS.Store.setColor('#BFBD1F'); 'ok'`);
  await sleep(1400);
  await shot(win, '03-wheel-vivid-base', await js(win, rectOf('#doc-host')));

  /* --- the selected wedge's ramp -------------------------------------
   * Same-hue schemes (Shades / Tints / Tones / Monochromatic) put every
   * wedge on one angle, so the last one drawn — the darkest — used to bury
   * the rest under a black blob. The selected wedge now carries the whole
   * family as a ramp: light end at the hub, the colour in the middle, dark
   * end at the rim. Sample along its centre line to prove all three. */
  /* The scheme picker is a W.select that the panel only mounts on the Color
   * Wheel tab, so reaching for `.panel-tabrow-tools select` silently matched
   * nothing on any other tab and left every probe below reading a stale
   * wheel. Drive the store instead — it is what the widget drives anyway. */
  const setScheme = (id) =>
    js(
      win,
      `(() => {
         CS.Store.set('scheme', ${JSON.stringify(id)});
         CS.App.refreshAll();
         return CS.Store.get('scheme');
       })()`
    );

  const wedgeSamples = () =>
    js(
      win,
      `(() => {
         const c = document.querySelector('.wheel-canvas');
         if (!c) return null;
         const rect = c.getBoundingClientRect();
         const w = rect.width;
         const h = rect.height;
         const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
         const pad = cl(Math.min(w, h) * 0.055, 14, 34);
         const R = Math.max(20, (Math.min(w, h) / 2 - pad - 7) / 1.06);
         const baseHsv = window.CS.Store.hsv();
         const hue = baseHsv.h;
         const tone = { s: cl(Math.max(baseHsv.s, 0.5), 0, 1), v: cl(Math.max(baseHsv.v, 0.42), 0, 1) };
         const expectedMiddle = window.CS.Color.toHexUpper(window.CS.Color.hsvToRgb({ h: hue, s: tone.s, v: tone.v }));
         const dpr = window.devicePixelRatio || 1;
         const ctx = c.getContext('2d', { willReadFrequently: true });
         const hex = (x, y) => {
           const p = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
           return '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
         };
         const polar = (angleDeg, rad) => {
           const ang = ((angleDeg - 90) * Math.PI) / 180;
           return [w / 2 + Math.cos(ang) * rad, h / 2 + Math.sin(ang) * rad];
         };
         const inner = R * 0.62;
         const outer = R * 1.06;
         const at = (t) => hex(...polar(hue, inner + (outer - inner) * t));
         // 17 degrees off the base hue: no harmony ever puts a wedge there,
         // so this is the plain ring, sampled at two radii.
         const ring = (rad) => hex(...polar(hue + 17, rad));
         return {
           base: window.CS.Store.hexUpper(),
           expectedMiddle,
           hub: at(0.12),
           mid: at(0.5),
           rim: at(0.88),
           // Inside band 1 the fill must be one flat colour, not a ramp.
           bandFlat: at(0.4) === at(0.6),
           // The ring must be flat across its width too.
           ringFlat: ring(R * 0.7) === ring(R * 0.9),
           ring: ring(R * 0.8)
         };
       })()`
    );

  for (const scheme of ['shades', 'tints', 'monochromatic', 'complementary']) {
    log(`scheme ${scheme}: ${await setScheme(scheme)}`);
    await sleep(1300);
    const ramp = await wedgeSamples();
    log(`  ramp ${JSON.stringify(ramp)}`);
    if (!ramp || ramp.mid !== ramp.expectedMiddle) {
      problems.push(`WEDGE middle does not match its wheel column: ${JSON.stringify(ramp)}`);
    }
    await shot(win, `03b-wedge-${scheme}`, await js(win, rectOf('#doc-host')));
  }
  await setScheme('complementary');
  await sleep(900);

  /* --- the relocated chrome ------------------------------------------ */
  await shot(win, '03c-toolbar', await js(win, rectOf('#toolbar')));
  await shot(win, '03d-statusbar', await js(win, rectOf('#statusbar')));

  /* The clear button must read as dead when there is nothing to clear — the
   * danger colour otherwise wins over .btn:disabled and it looks clickable. */
  const clearBtnState = () =>
    js(
      win,
      `(() => {
         const b = document.querySelector('.fav-actions .fav-action-clear');
         if (!b) return null;
         const cs = getComputedStyle(b);
         return { disabled: b.disabled, color: cs.color, border: cs.borderTopColor };
       })()`
    );

  const favState = () =>
    js(
      win,
      `(() => ({
         saved: window.CS.Store.state.favorites.length,
         chips: document.querySelectorAll('.fav-chip').length,
         dropNote: !!document.querySelector('.fav-drop')
       }))()`
    );

  log(`clear (empty): ${JSON.stringify(await clearBtnState())} ${JSON.stringify(await favState())}`);
  await shot(win, '03f-favorites-empty', await js(win, rectOf('#dock-right')));

  await js(win, `window.CS.Store.setFavorites(['#CB6FB0', '#4F86C6', '#D96A4A', '#3F8F34']); 'ok'`);
  await sleep(500);
  const filled = await favState();
  log(`clear (filled): ${JSON.stringify(await clearBtnState())} ${JSON.stringify(filled)}`);
  if (!filled || filled.chips !== 4) {
    problems.push(`FAVOURITES  grid did not render: ${JSON.stringify(filled)}`);
  }
  await shot(win, '03e-favorites', await js(win, rectOf('#dock-right')));

  await js(win, `window.CS.Store.clearFavorites(); 'ok'`);
  await sleep(400);

  /* --- Base Color: spectrum + wheel tabs ----------------------------- */
  const specTab = await clickTab(win, 'spectrum');
  log(`spectrum tab: ${JSON.stringify(specTab)}`);
  if (!specTab || specTab.active !== 'spectrum') {
    problems.push(`SPECTRUM  tab did not activate: ${JSON.stringify(specTab)}`);
  }
  await sleep(900);
  const sq = await js(
    win,
    `(() => {
       const c = document.querySelector('.bc-square');
       const w = c.parentElement;
       const cr = c.getBoundingClientRect();
       const wr = w.getBoundingClientRect();
       const ctx = c.getContext('2d', { willReadFrequently: true });
       const px = ctx.getImageData(Math.round(c.width * 0.5), Math.round(c.height - 3), 1, 1).data;
       return {
         css: [Math.round(cr.width), Math.round(cr.height)],
         backing: [c.width, c.height],
         wrap: [Math.round(wr.width), Math.round(wr.height)],
         dpr: window.devicePixelRatio,
         bottomPixel: [px[0], px[1], px[2], px[3]]
       };
     })()`
  );
  log(`spectrum square: ${JSON.stringify(sq)}`);
  if (!sq || !sq.backing || sq.backing[0] < 20) {
    problems.push(`SPECTRUM  canvas was never painted: ${JSON.stringify(sq && sq.backing)}`);
  }
  await shot(win, '04-base-spectrum', await js(win, rectOf('#dock-left')));
  await clickTab(win, 'wheel');
  await sleep(700);
  await shot(win, '05-base-wheel', await js(win, rectOf('#dock-left')));

  /* --- PhotoSchemer -------------------------------------------------- */
  await js(win, `CS.App.openDocument('photo'); 'ok'`);
  await sleep(900);
  await shot(win, '06-photo-empty', await js(win, rectOf('#doc-host')));

  // pull the bundled sample in through the panel menu path, then walk effects
  const loaded = await js(
    win,
    `(async () => {
       const p = CS.App.documents.photo;
       const res = await fetch('assets/sample-photo.png');
       const blob = await res.blob();
       const url = URL.createObjectURL(blob);
       const img = new Image();
       await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
       // drive the panel's own loader through a synthetic drop
       const dt = new DataTransfer();
       dt.items.add(new File([blob], 'sample-photo.png', { type: 'image/png' }));
       document.querySelector('.photo-stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
       return 'dropped';
     })()`
  );
  log(`photo drop: ${loaded}`);
  await sleep(900);

  const effects = await js(win, `CS.Panels && [...document.querySelectorAll('.photo-toolbar select option')].map(o => o.value)`);
  log(`effects: ${JSON.stringify(effects)}`);

  const loadedNow = await js(win, `!!document.querySelector('.photo-canvas') && document.querySelector('.photo-empty').classList.contains('hidden')`);
  log(`photo image visible: ${loadedNow}`);

  if (loadedNow) {
    const ids = effects || [];
    const setEffect = (id) =>
      js(
        win,
        `(() => { const s = document.querySelector('.photo-toolbar select');
           s.value = ${JSON.stringify(id)};
           s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`
      );
    for (let i = 0; i < ids.length; i++) {
      // Reset to None first so each capture is independent of the filter that
      // ran before it (canvas filters are easy to blame for the wrong thing).
      await setEffect('none');
      await sleep(260);
      await setEffect(ids[i]);
      await sleep(520);
      // Mean + peak absolute horizontal gradient over the whole canvas. The
      // peak is the honest "is it soft?" signal: a crisp edge keeps a large
      // jump, a resampled one smears it.
      const sharp = await js(
        win,
        `(() => {
           const c = document.querySelector('.photo-canvas');
           const ctx = c.getContext('2d', { willReadFrequently: true });
           const d = ctx.getImageData(0, 0, c.width, c.height).data;
           const w = c.width;
           let sum = 0;
           let n = 0;
           let peak = 0;
           for (let y = 0; y < c.height; y += 4) {
             for (let x = 4; x < w; x += 4) {
               const i = (y * w + x) * 4;
               const g = Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2]);
               sum += g;
               if (g > peak) peak = g;
               n++;
             }
           }
           return { mean: Math.round((sum / Math.max(1, n)) * 100) / 100, peak };
         })()`
      );
      log(`  effect ${ids[i]}: edge mean ${sharp && sharp.mean}, peak ${sharp && sharp.peak}`);
      await shot(win, `07-photo-${String(i).padStart(2, '0')}-${ids[i]}`, await js(win, rectOf('.photo-stage')));
    }
  } else {
    problems.push('PHOTO  could not load the sample image into the panel');
  }

  /* --- LiveSchemes strip: draggable arrows + adjustable count ---------
   * The arrows live on a canvas, so the only honest check is to drive a real
   * cursor across them and then read the marker positions back off the
   * pixels: an arrow that "changes a colour" but does not stay under the
   * pointer is exactly the failure this pass is meant to rule out. */
  await js(win, `CS.App.openDocument('matching'); 'ok'`);
  await sleep(700);
  log(`scheme for the strip: ${await setScheme('analogous')}`);
  await sleep(900);
  await js(win, `document.querySelector('.panel-tabrow .tab[data-id="live"]').click(); 'ok'`);
  await sleep(500);
  const pickedStrip = await js(
    win,
    `(() => {
       const b = [...document.querySelectorAll('.live-viewbar .icon-btn')].find(x => x.title === 'Strip view');
       if (!b) return 'no strip button';
       b.click();
       return b.classList.contains('is-active') ? 'ok' : 'strip button did not activate';
     })()`
  );
  log(`strip view: ${pickedStrip}`);
  if (pickedStrip !== 'ok') problems.push(`STRIP  ${pickedStrip}`);
  await sleep(800);

  /* Read the arrows back off the canvas: the heads are dark outlines over
   * transparent canvas, so a dark run at the head's mid-height is a stroke.
   * The alpha test is essential — unpainted canvas is (0,0,0,0), which reads
   * as "very dark" and would turn the whole row into one giant marker. Two
   * runs a few pixels apart are the two sides of one head, and anything
   * closer than a head's width to the previous group belongs to it. */
  const stripProbe = () =>
    js(
      win,
      `(() => {
         const c = document.querySelector('.live-canvas');
         if (!c) return null;
         const r = c.getBoundingClientRect();
         const w = r.width;
         const h = r.height;
         const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
         const pad = cl(Math.min(w, h) * 0.09, 16, 44);
         const barH = Math.min(70, Math.max(12, h - pad * 2));
         const y = (h - barH) / 2;
         const dpr = window.devicePixelRatio || 1;
         const ctx = c.getContext('2d', { willReadFrequently: true });
         const d = ctx.getImageData(0, Math.round((y - 6) * dpr), c.width, 1).data;
         const runs = [];
         let run = null;
         for (let x = 0; x < c.width; x++) {
           const i = x * 4;
           const dark = d[i + 3] > 100 && d[i] < 190 && d[i + 1] < 190 && d[i + 2] < 190;
           if (dark) { if (!run) run = { a: x, b: x }; else run.b = x; }
           else if (run) { runs.push(run); run = null; }
         }
         if (run) runs.push(run);
         const markers = [];
         let g = null;
         runs.forEach((rn) => {
           if (g && rn.a - g.b <= 16 * dpr) g.b = rn.b;
           else { if (g) markers.push((g.a + g.b) / 2 / dpr); g = { a: rn.a, b: rn.b }; }
         });
         if (g) markers.push((g.a + g.b) / 2 / dpr);
         const bar = document.querySelector('.live-viewbar');
         /* Arrows are drawn one per handle, so two handles that share a hue
          * draw on top of each other and the pixel scan sees a single arrow.
          * A scheme whose harmony list repeats the base hue (the base is often
          * listed twice) therefore legitimately has fewer arrows than handles.
          * Compare against distinct hues, not the handle count. */
         const hexes = [...document.querySelectorAll('.live-swatch-label')].map((n) => n.textContent);
         const hueList = hexes.map((h) => {
           const c = CS.Color.parse(h);
           return c ? CS.Color.rgbToHsv(c).h : null;
         });
         const distinct = [...new Set(hueList.filter((h) => h != null).map((h) => Math.round(h)))].sort((a, b) => a - b);
         /* Smallest gap between two distinct hues. Arrows closer together than
          * the scan's merge window (~16px) read as one, so the strict
          * one-arrow-per-hue check is only meaningful when the hues are far
          * enough apart to separate on screen. */
         let minGap = 360;
         for (let i = 1; i < distinct.length; i++) {
           minGap = Math.min(minGap, distinct[i] - distinct[i - 1]);
         }
         return {
           css: [Math.round(w), Math.round(h)],
           pad: Math.round(pad),
           barY: Math.round(y),
           hexes,
           distinctHues: distinct.length,
           minHueGap: distinct.length > 1 ? Math.round(minGap) : 360,
           markers: markers.map((v) => Math.round(v * 10) / 10),
           stepper: document.querySelector('.live-viewbar .stepper-num').value,
           viewbarOverflow: bar.scrollWidth - bar.clientWidth
         };
       })()`
    );

  /**
   * One arrow is drawn per handle, so two handles sharing a hue draw on top of
   * each other and the pixel scan legitimately sees fewer arrows than handles.
   * And two arrows within the scan's ~16px merge window read as one. So the
   * strict "one arrow per distinct hue" check only applies when the hues are
   * far enough apart; otherwise just require the arrows to be present and not
   * to outnumber the hues.
   */
  function arrowCountProblem(label, p) {
    if (!p) return `${label} probe returned nothing`;
    if (p.minHueGap >= 25) {
      return p.markers.length === p.distinctHues
        ? null
        : `${label} expected one arrow per distinct hue (${p.distinctHues}, min gap ${p.minHueGap}°), got ${JSON.stringify(p.markers)}`;
    }
    if (p.markers.length < 2) return `${label} only ${p.markers.length} arrow(s) drawn`;
    if (p.markers.length > p.distinctHues) {
      return `${label} drew ${p.markers.length} arrows for ${p.distinctHues} distinct hues`;
    }
    return null;
  }

  const strip0 = await stripProbe();
  log(`strip initial: ${JSON.stringify(strip0)}`);
  if (!strip0 || strip0.hexes.length !== 3) {
    problems.push(`STRIP  expected 3 handles, got ${JSON.stringify(strip0 && strip0.hexes)}`);
  } else {
    const bad = arrowCountProblem('STRIP initial', strip0);
    if (bad) problems.push(bad);
  }
  if (strip0 && strip0.viewbarOverflow > 0) {
    problems.push(`STRIP  view bar overflows by ${strip0.viewbarOverflow}px`);
  }
  await shot(win, '10-strip-initial', await js(win, rectOf('.live-canvas-wrap')));

  /** Drag the arrow nearest `from` to `to` and report what happened.
   *  The arrow is nudged into reach first: an arrow whose hue sits at the very
   *  edge of the strip window is drawn flush against the bar's edge, and a
   *  one-pixel aim is then a coin toss. */
  async function dragMarker(from, to) {
    const crect = await js(win, rectOf('.live-canvas'));
    const rowY = crect.y + strip0.barY - 6;
    let grabAt = from;
    let cursor = '';
    for (const nudge of [0, -2, 2, -4, 4]) {
      grabAt = from + nudge;
      await mouseMove(win, crect.x + grabAt, rowY);
      cursor = await js(win, `getComputedStyle(document.querySelector('.live-canvas')).cursor`);
      if (cursor === 'grab') break;
    }
    await mouseDown(win, crect.x + grabAt, rowY);
    await mouseMove(win, crect.x + (grabAt + to) / 2, rowY);
    await mouseMove(win, crect.x + to, rowY);
    const during = await stripProbe();
    await shot(win, '11-strip-dragging', await js(win, rectOf('.live-canvas-wrap')));
    await mouseUp(win, crect.x + to, rowY);
    await sleep(400);
    return { cursor, during, after: await stripProbe(), rowY, crect, grabAt };
  }

  if (strip0 && strip0.markers.length >= 2) {
    /* 1. A plain arrow: it must stay under the pointer, the ones it does not
     *    belong to must not move, and exactly one swatch must change.
     *    Aim at the arrow nearest the bar's centre — that is where the base
     *    sits, and it is never clipped against an edge. */
    const barCentre = strip0.pad + (strip0.css[0] - strip0.pad * 2) / 2;
    const others = strip0.markers.slice();
    const from = others.reduce((a, b) => (Math.abs(b - barCentre) < Math.abs(a - barCentre) ? b : a));
    const untouched = others.filter((m) => m !== from);
    const to = from + 55;
    const r1 = await dragMarker(from, to);
    log(`  cursor over an arrow: ${r1.cursor} (aimed at ${r1.grabAt})`);
    if (r1.cursor !== 'grab') problems.push(`STRIP  no grab cursor over an arrow (got "${r1.cursor}")`);

    const strip1 = r1.after;
    log(`strip after drag: ${JSON.stringify(strip1)}`);
    if (!strip1 || strip1.markers.length !== strip0.markers.length) {
      problems.push(`STRIP  arrow count changed during the drag: ${JSON.stringify(strip1 && strip1.markers)}`);
    } else {
      if (!r1.during || !r1.during.markers.some((m) => Math.abs(m - to) <= 4)) {
        problems.push(`STRIP  arrow lagged the pointer mid-drag: ${JSON.stringify(r1.during && r1.during.markers)}`);
      }
      if (!strip1.markers.some((m) => Math.abs(m - to) <= 4)) {
        problems.push(`STRIP  arrow did not follow the pointer to ${to}: ${JSON.stringify(strip1.markers)}`);
      }
      const stayed = untouched.filter((m0) => strip1.markers.some((m) => Math.abs(m - m0) <= 4));
      if (stayed.length !== untouched.length) {
        problems.push(`STRIP  dragging one arrow moved the others: ${JSON.stringify([strip0.markers, strip1.markers])}`);
      }
      const changed = strip0.hexes.filter((h, i) => h !== strip1.hexes[i]).length;
      if (changed !== 1) problems.push(`STRIP  expected exactly one colour to change, ${changed} did`);
    }

    /* 2. The base arrow. This is the one the bar used to be anchored to, so
     *    it is the case where a naive implementation leaves the arrow behind
     *    while the gradient slides out from under the pointer. */
    const centre = strip1.pad + (strip1.css[0] - strip1.pad * 2) / 2;
    const baseFrom = strip1.markers.reduce((a, b) => (Math.abs(b - centre) < Math.abs(a - centre) ? b : a));
    const baseTo = baseFrom + 45;
    const beforeHex = await js(win, `CS.Store.hex()`);
    const r2 = await dragMarker(baseFrom, baseTo);
    const afterHex = await js(win, `CS.Store.hex()`);
    log(`  base arrow ${baseFrom} -> ${baseTo}: ${beforeHex} -> ${afterHex}`);
    log(`strip after base drag: ${JSON.stringify(r2.after)}`);
    if (beforeHex === afterHex) {
      problems.push('STRIP  dragging the base arrow did not move the base colour');
    }
    if (!r2.after || !r2.after.markers.some((m) => Math.abs(m - baseTo) <= 4)) {
      problems.push(`STRIP  the base arrow did not stay under the pointer: ${JSON.stringify(r2.after && r2.after.markers)}`);
    }
    if (!r2.during || !r2.during.markers.some((m) => Math.abs(m - baseTo) <= 4)) {
      problems.push(`STRIP  the base arrow lagged the pointer mid-drag: ${JSON.stringify(r2.during && r2.during.markers)}`);
    }
  }
  await shot(win, '12-strip-after-drag', await js(win, rectOf('.live-canvas-wrap')));

  /* The count control has to drive the arrows, not just its own readout. */
  const bump = (which) =>
    js(
      win,
      `(() => {
         const b = document.querySelectorAll('.live-viewbar .stepper-btn')[${which}];
         if (!b) return null;
         b.click();
         return document.querySelector('.live-viewbar .stepper-num').value;
       })()`
    );

  log(`markers +1 -> ${await bump(0)}`);
  log(`markers +1 -> ${await bump(0)}`);
  await sleep(600);
  const grown = await stripProbe();
  log(`strip grown: ${JSON.stringify(grown)}`);
  if (!grown || grown.hexes.length !== 5) {
    problems.push(`STRIP  raising the count to 5 gave ${JSON.stringify(grown)}`);
  } else {
    const bad = arrowCountProblem('STRIP grown', grown);
    if (bad) problems.push(bad);
    if (grown.markers.length <= strip0.markers.length) {
      problems.push(`STRIP  raising the count did not add arrows: ${JSON.stringify([strip0.markers, grown.markers])}`);
    }
  }
  await shot(win, '13-strip-five-arrows', await js(win, rectOf('.live-canvas-wrap')));
  await shot(win, '16-strip-panel', await js(win, rectOf('#doc-host')));

  log(`markers -1 -> ${await bump(1)}`);
  log(`markers -1 -> ${await bump(1)}`);
  log(`markers -1 -> ${await bump(1)}`);
  await sleep(600);
  const shrunk = await stripProbe();
  log(`strip shrunk: ${JSON.stringify(shrunk)}`);
  if (!shrunk || shrunk.hexes.length !== 2) {
    problems.push(`STRIP  lowering the count to 2 gave ${JSON.stringify(shrunk)}`);
  } else {
    const bad = arrowCountProblem('STRIP shrunk', shrunk);
    if (bad) problems.push(bad);
    if (shrunk.markers.length >= grown.markers.length) {
      problems.push(`STRIP  lowering the count did not remove arrows: ${JSON.stringify([grown.markers, shrunk.markers])}`);
    }
  }
  await shot(win, '14-strip-two-arrows', await js(win, rectOf('.live-canvas-wrap')));

  await js(win, `CS.Theme.set('dark'); 'ok'`);
  await sleep(600);
  await shot(win, '15-strip-dark', await js(win, rectOf('.live-canvas-wrap')));
  await js(win, `CS.Theme.set('light'); 'ok'`);
  await sleep(400);

  /* --- dark theme sanity --------------------------------------------- */
  await js(win, `CS.Theme.set('dark'); 'ok'`);
  await sleep(600);
  await js(win, `CS.App.openDocument('matching'); 'ok'`);
  await sleep(900);
  await shot(win, '08-dark-wheel', await js(win, rectOf('#doc-host')));
  await js(win, `document.querySelector('.panel-tabrow .tab[data-id="spectrum"]').click(); 'ok'`);
  await sleep(700);
  await shot(win, '09-dark-base-spectrum', await js(win, rectOf('#dock-left')));
  await js(win, `CS.Theme.set('light'); 'ok'`);
  await sleep(400);

  /* --- Base Color RGB tab: hex field + colour model ------------------- */
  await js(win, `CS.App.documents.baseColor.showTab('rgb'); 'ok'`);
  await sleep(500);
  await js(win, `CS.Store.setColor('#477AD3'); CS.App.refreshAll(); 'ok'`);
  await sleep(500);

  const hexDom = await js(win, `(() => {
     const f = document.querySelector('#dock-left .bc-view:not(.hidden) .hex-input');
     const row = f ? f.closest('.bc-row') : null;
     /* An <input> has no textContent, so count the rendered '#' as DOM text
      * plus whatever the field's value carries. */
     const stray = row ? (row.textContent.match(/#/g) || []).length : -1;
     return {
       wrapped: !!document.querySelector('#dock-left .hex-field'),
       stray,
       value: f ? f.value : null,
       total: row ? stray + ((f.value.match(/#/g) || []).length) : -1
     };
   })()`);
  log(`hex row: ${JSON.stringify(hexDom)}`);
  /* The '#' belongs to the value. A separate span made it render "# #477AD3". */
  if (!hexDom || hexDom.wrapped) problems.push(`HEX still wrapped in .hex-field: ${JSON.stringify(hexDom)}`);
  if (!hexDom || hexDom.value !== '#477AD3') problems.push(`HEX field shows ${hexDom && hexDom.value}, expected #477AD3`);
  if (hexDom && hexDom.stray !== 0) problems.push(`HEX row has ${hexDom.stray} stray '#' outside the field`);
  if (hexDom && hexDom.total !== 1) problems.push(`HEX row renders ${hexDom.total} '#' characters, expected exactly 1`);

  /* Accepted with and without the hash; junk must revert, never throw. */
  for (const [typed, expect] of [['2ecc71', '#2ECC71'], ['#e74c3c', '#E74C3C'], ['477AD3', '#477AD3'], ['12', '#477AD3'], ['zzz', '#477AD3'], ['#', '#477AD3']]) {
    const got = await js(win, `(() => {
       const f = document.querySelector('#dock-left .bc-view:not(.hidden) .hex-input');
       f.focus();
       f.value = ${JSON.stringify(typed)};
       f.dispatchEvent(new Event('change', { bubbles: true }));
       const out = { hex: CS.Store.hexUpper(), field: f.value };
       f.blur();
       return out;
     })()`);
    await sleep(220);
    log(`hex "${typed}" -> ${JSON.stringify(got)}`);
    if (!got || got.hex !== expect || got.field !== expect) {
      problems.push(`HEX typing "${typed}" gave ${JSON.stringify(got)}, expected ${expect}`);
    }
  }

  /* A number box must follow its own arrow keys. Scoped to the visible view:
   * querySelectorAll returns sliders inside hidden tabs too. */
  const arrow = await js(win, `(() => {
     const sl = document.querySelectorAll('#dock-left .bc-view:not(.hidden) .cslider')[0];
     const f = sl.querySelector('.cslider-num');
     const before = f.value;
     f.focus();
     f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
     f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
     const after = f.value;
     f.blur();
     return { label: sl.querySelector('.cslider-label').textContent, before, after, hex: CS.Store.hexUpper() };
   })()`);
  await sleep(300);
  log(`slider ArrowUp x2: ${JSON.stringify(arrow)}`);
  if (!arrow || Number(arrow.after) !== Number(arrow.before) + 2) {
    problems.push(`SLIDER ArrowUp did not update its own readout: ${JSON.stringify(arrow)}`);
  }

  /* --- Adjustments: the colour-model picker --------------------------- */
  await js(win, `CS.Store.setColor('#477AD3'); CS.App.refreshAll(); 'ok'`);
  await sleep(400);
  const models = await js(win, `(() => {
     const sel = document.querySelector('#dock-left .bc-adj-head select');
     if (!sel) return null;
     const read = () => ({
       n: document.querySelectorAll('#dock-left .bc-adj .cslider').length,
       vals: [...document.querySelectorAll('#dock-left .bc-adj .cslider')].map((s) => {
         const l = s.querySelector('.cslider-label');
         return (l ? l.textContent : '?') + '=' + s.querySelector('.cslider-num').value;
       })
     });
     const out = { options: [...sel.options].map((o) => o.value), seen: {} };
     ['hsl', 'cmyk', 'lab', 'xyz', 'hsb'].forEach((id) => {
       sel.value = id;
       sel.dispatchEvent(new Event('change', { bubbles: true }));
       out.seen[id] = read();
     });
     return out;
   })()`);
  await sleep(400);
  log(`adjust models: ${JSON.stringify(models)}`);
  if (!models) {
    problems.push('ADJUSTMENTS colour-model picker is missing');
  } else {
    if (models.options.join(',') !== 'hsb,hsl,cmyk,lab,xyz') {
      problems.push(`ADJUSTMENTS options are ${models.options.join(',')}`);
    }
    const wantCount = { hsl: 3, cmyk: 4, lab: 3, xyz: 3, hsb: 3 };
    const wantVals = {
      hsl: ['H=218', 'S=61', 'L=55'],
      cmyk: ['C=66', 'M=42', 'Y=0', 'K=17'],
      hsb: ['H=218', 'S=66', 'B=83']
    };
    Object.keys(wantCount).forEach((id) => {
      const got = models.seen[id];
      if (!got || got.n !== wantCount[id]) {
        problems.push(`ADJUSTMENTS ${id} has ${got && got.n} sliders, expected ${wantCount[id]}`);
        return;
      }
      (wantVals[id] || []).forEach((want, i) => {
        if (got.vals[i] !== want) problems.push(`ADJUSTMENTS ${id} channel ${i} = ${got.vals[i]}, expected ${want}`);
      });
    });
  }
  await shot(win, '17-base-rgb-models', await js(win, rectOf('#dock-left')));

  /* --- drag a colour into Favorites ----------------------------------- */
  await js(win, `CS.App.openDocument('matching'); 'ok'`);
  await sleep(400);
  await js(win, `document.querySelector('#doc-host .panel-tabrow .tab[data-id="wheel"]').click(); 'ok'`);
  await js(win, `CS.Store.set('scheme', 'triadic'); CS.App.refreshAll(); 'ok'`);
  await sleep(900); // let the wedge swing settle before aiming at one

  const favsBefore = await js(win, `CS.Store.state.favorites.length`);

  /* A plain wedge click is inert: it must neither rotate the wheel by changing
   * the base colour nor add a favourite. The wedge remains a drag source. */
  const w1 = await js(win, wedgePoint(1));
  if (!w1) {
    problems.push('DRAG no .wheel-canvas to probe');
  } else {
    const beforeClickHex = await js(win, `CS.Store.hexUpper()`);
    await mouseMove(win, w1.x, w1.y);
    await mouseDown(win, w1.x, w1.y);
    await mouseUp(win, w1.x, w1.y);
    await sleep(300);
    const afterClick = await js(win, `({ hex: CS.Store.hexUpper(), n: CS.Store.state.favorites.length })`);
    log(`wedge click -> ${JSON.stringify(afterClick)} expect unchanged ${beforeClickHex} / ${favsBefore} favs`);
    if (!afterClick || afterClick.hex !== beforeClickHex) {
      problems.push(`WEDGE click changed the base colour (${beforeClickHex} -> ${afterClick && afterClick.hex})`);
    }
    if (afterClick && afterClick.n !== favsBefore) {
      problems.push(`WEDGE click added a favourite (${favsBefore} -> ${afterClick.n})`);
    }

    /* Dragging it to the dock must save it. */
    await js(win, `CS.Store.set('scheme', 'triadic'); CS.App.refreshAll(); 'ok'`);
    await sleep(900);
    const w2 = await js(win, wedgePoint(2));
    const drop = await js(win, favDropRect);
    log(`drag wedge ${JSON.stringify(w2)} -> drop ${JSON.stringify(drop)}`);
    if (!w2 || !drop) {
      problems.push(`DRAG could not resolve the wedge or the drop target (${JSON.stringify(w2)}, ${JSON.stringify(drop)})`);
    } else {
      /* Pointerdown on a wedge deliberately leaves Store.hex unchanged. The
       * drag ghost after clearing the slop is the assertion that it was armed. */
      await mouseMove(win, w2.x, w2.y);
      await mouseDown(win, w2.x, w2.y);
      /* the first move stays inside the 5px slop: no drag yet */
      await mouseMove(win, w2.x + 3, w2.y + 2);
      const early = await js(win, `!!document.querySelector('.colour-ghost')`);
      if (early) problems.push('DRAG started before the pointer cleared the slop');
      await mouseMove(win, w2.x + 30, w2.y - 10);
      await mouseMove(win, Math.round((w2.x + drop.x) / 2), Math.round((w2.y + drop.y) / 2));
      await mouseMove(win, drop.x, drop.y);
      await sleep(150);
      const mid = await js(win, `({
         ghost: !!document.querySelector('.colour-ghost'),
         bg: (() => { const g = document.querySelector('.colour-ghost'); return g ? getComputedStyle(g).backgroundColor : null; })(),
         lit: !!document.querySelector('#dock-right .is-drop-target')
       })`);
      log(`mid-drag: ${JSON.stringify(mid)}`);
      if (!mid || !mid.ghost) problems.push(`DRAG no ghost while dragging: ${JSON.stringify(mid)}`);
      if (!mid || !mid.lit) problems.push(`DRAG the favourites dock did not highlight: ${JSON.stringify(mid)}`);
      await shot(win, '18-drag-ghost', await js(win, rectOf('#workspace')));

      await mouseUp(win, drop.x, drop.y);
      await sleep(400);
      const after = await js(win, `({
         n: CS.Store.state.favorites.length,
         list: CS.Store.state.favorites.slice(0, 3),
         ghost: !!document.querySelector('.colour-ghost'),
         lit: !!document.querySelector('#dock-right .is-drop-target')
       })`);
      log(`after drop: ${JSON.stringify(after)} expect ${w2.hex}`);
      if (!after || after.n !== favsBefore + 1 || after.list[0] !== w2.hex) {
        problems.push(`DRAG drop did not save ${w2.hex}: ${JSON.stringify(after)}`);
      }
      if (after && (after.ghost || after.lit)) {
        problems.push(`DRAG left the ghost or the highlight behind: ${JSON.stringify(after)}`);
      }
      await shot(win, '19-favorites-after-drag', await js(win, rectOf('#dock-right')));

      /* Dropping on empty space must save nothing. */
      const n0 = await js(win, `CS.Store.state.favorites.length`);
      const w3 = await js(win, wedgePoint(1));
      if (!w3) {
        problems.push('DRAG could not resolve a wedge for the empty-space test');
      } else {
        await mouseMove(win, w3.x, w3.y);
        await mouseDown(win, w3.x, w3.y);
        await mouseMove(win, w3.x + 40, w3.y + 40);
        await mouseMove(win, 600, 700);
        await mouseUp(win, 600, 700);
        await sleep(300);
        const n1 = await js(win, `CS.Store.state.favorites.length`);
        log(`drop on empty space: ${n0} -> ${n1}`);
        if (n1 !== n0) problems.push(`DRAG dropping on empty space added a favourite (${n0} -> ${n1})`);
      }
    }
  }

  /* An HTML5 drag from a palette cell uses the same drop target. */
  const palDrag = await js(win, `(() => {
     const sw = document.querySelector('.pal-sw');
     const note = document.querySelector('#dock-right .fav-grid') || document.querySelector('#dock-right .drop-note.fav-drop');
     if (!sw || !note) return { ok: false, why: 'missing cell or target' };
     const dt = new DataTransfer();
     sw.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
     const payload = dt.getData('application/x-zaferon-color') || dt.getData('text/plain');
     note.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
     const lit = !!document.querySelector('#dock-right .is-drop-target');
     note.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
     return { ok: true, payload, lit };
   })()`);
  await sleep(400);
  const palAfter = await js(win, `({ n: CS.Store.state.favorites.length, list: CS.Store.state.favorites.slice(0, 2) })`);
  log(`palette drag: ${JSON.stringify(palDrag)} -> ${JSON.stringify(palAfter)}`);
  if (!palDrag || !palDrag.ok) problems.push(`PALETTE drag could not run: ${JSON.stringify(palDrag)}`);
  else {
    if (!palDrag.payload) problems.push('PALETTE dragstart set no payload');
    if (!palDrag.lit) problems.push('PALETTE dragover did not highlight the favourites dock');
    if (!palAfter || palAfter.list[0] !== palDrag.payload) {
      problems.push(`PALETTE drop did not save ${palDrag.payload}: ${JSON.stringify(palAfter)}`);
    }
  }

  await js(win, `CS.Store.set('scheme', 'complementary'); CS.App.refreshAll(); 'ok'`);
  await sleep(300);
}

app.whenReady().then(async () => {
  ipcMain.handle('clipboard:writeText', (_e, t) => {
    clipboard.writeText(String(t == null ? '' : t));
    return true;
  });
  ipcMain.handle('clipboard:readText', () => clipboard.readText());
  ipcMain.handle('file:save', async () => null);
  ipcMain.handle('file:openImage', async () => null);
  ipcMain.handle('file:openText', async () => null);
  ipcMain.handle('file:openPath', async () => null);
  ipcMain.handle('shell:openExternal', async () => true);
  ipcMain.handle('picker:start', async () => null);
  /* see build/smoke.js — the About box and the update notice read the real
   * version through this channel, so the stub has to answer it */
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }));
  ipcMain.on('win:minimize', () => {});
  ipcMain.on('win:maximize', () => {});
  ipcMain.on('win:close', () => {});

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    show: true,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      /* Without this, an occluded window has its rAF loop suspended: tab
       * switches set their classes but never run their rAF-deferred draw, and
       * capturePage hands back the last frame it managed to paint — so two
       * different shots come out byte-identical and everything looks fine. */
      backgroundThrottling: false
    }
  });
  wireDiagnostics(win);

  try {
    await run(win);
  } catch (err) {
    problems.push(`RUN THREW  ${err && err.stack}`);
  }

  releaseInput(win);

  console.log('\n================ VERIFY RESULT ================');
  console.log(`problems: ${problems.length}`);
  problems.forEach((p) => console.log('  ! ' + p));
  console.log('===============================================\n');
  app.exit(problems.length ? 1 : 0);
});

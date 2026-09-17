'use strict';

/**
 * Screen eyedropper test.
 *
 *   npm run picker-test
 *
 * Runs real GUI Electron (see the launch note in package.json: the sandbox sets
 * ELECTRON_RUN_AS_NODE, so the script clears it and passes --disable-gpu).
 *
 * There is no way to point this at a real desktop and know what colour should
 * come back, so the test does not use the desktop at all: it feeds the overlay
 * a synthetic screenshot made of four known quadrants and then checks that
 * moving the pointer and clicking report the quadrant that is actually under
 * the cursor. That turns the two things the eyedropper must get right — "the
 * reticle tracks the pointer" and "the pixel under the reticle is the pixel
 * reported" — into assertions.
 *
 * It deliberately mirrors the overlay construction in main.js rather than
 * importing it. If you change that construction, change it here too; the
 * geometry assertions below are what catch a drift.
 */

const { app, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const { createPickerOverlay } = require('../picker-overlay');

/* This sandbox has no usable GPU: Chromium's GPU process dies on startup and
 * takes the whole app with it ("GPU process isn't usable. Goodbye.", exit 3)
 * before `whenReady` ever fires. Software rendering has to be forced from
 * inside the script — an in-script switch runs before the GPU process is
 * spawned, so `npm run picker-test` needs no special flags. */
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');

const ROOT = path.join(__dirname, '..');

const problems = [];
const notes = [];
const note = (k, v) => notes.push({ k, v });

function check(name, ok, detail) {
  if (!ok) problems.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  (' + detail + ')' : ''}`);
  return ok;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * A synthetic "desktop" that encodes its own coordinates: R = x, G = y.
 *
 * The overlay maps the cursor onto the screenshot by ratio on each axis
 * independently (`imgW / innerWidth`), so reading the hex back says exactly
 * which source pixel was sampled. That precision is the point: a four-quadrant
 * image only fails once the error exceeds a quarter of the screen, which is
 * far too blunt to notice a mapping that is off by the height of a taskbar.
 *
 * Sized to the display's aspect ratio, because the axes scale independently
 * and a mismatched aspect would skew the expectation.
 *
 * `nativeImage` buffers are BGRA, so the bytes are written out reversed.
 * Getting that backwards paints a different colour than the assertions expect,
 * and looks exactly like an app bug.
 * ------------------------------------------------------------------ */
function makeTestImage(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = 0; // B — unused, keeps the readout legible
      buf[i + 1] = Math.round((y / (h - 1)) * 255); // G = y
      buf[i + 2] = Math.round((x / (w - 1)) * 255); // R = x
      buf[i + 3] = 255; // A
    }
  }
  return nativeImage.createFromBuffer(buf, { width: w, height: h });
}

/* Decode a sampled hex back to the source pixel. Each axis is quantised to
 * 8 bits over the image width/height, so this is good to about a pixel. */
function decodeHex(hex, w, h) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  return { x: Math.round((r / 255) * (w - 1)), y: Math.round((g / 255) * (h - 1)) };
}

/* The pixel the app SHOULD sample for a cursor at (fx, fy) of the display.
 *
 * Derived from the display bounds, never from the window's inner size — that
 * is the whole point. If the overlay comes back short by the height of the
 * taskbar, the app divides by the smaller inner height and lands on a
 * different row, while this expectation stays put. */
function expectedPixel(display, fx, fy, w, h) {
  const clientX = Math.round(display.bounds.width * fx);
  const clientY = Math.round(display.bounds.height * fy);
  const x = Math.max(0, Math.min(w - 1, Math.round((clientX * w) / display.bounds.width)));
  const y = Math.max(0, Math.min(h - 1, Math.round((clientY * h) / display.bounds.height)));
  return { x, y };
}

/* The overlay is built by the app's own factory, not a copy of it. An earlier
 * version of this test duplicated the construction, which meant the geometry
 * assertion below could never fail for the code that actually ships. */
function buildOverlay(display, image) {
  const consoleErrors = [];
  const consoleWarnings = [];

  const built = createPickerOverlay(display, image);
  if (!built) throw new Error('createPickerOverlay refused the capture');

  const { overlay, shown } = built;

  overlay.webContents.on('console-message', (_e, level, message) => {
    // 0 verbose, 1 info, 2 warning, 3 error
    if (level >= 3) consoleErrors.push(message);
    else if (level === 2) consoleWarnings.push(message);
  });

  return { overlay, ready: shown, consoleErrors, consoleWarnings };
}

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  console.log('Screen eyedropper test\n');
  note('electron', process.versions.electron);
  note('displays', displays.length);

  /* Image aspect matches the primary display's physical aspect. */
  const imgW = 400;
  const imgH = Math.round((imgW * primary.size.height) / primary.size.width);
  const image = makeTestImage(imgW, imgH);
  note('probeImage', { w: imgW, h: imgH });

  /* ---- 1. the overlay covers the whole display -------------------- */
  console.log('1. overlay geometry');
  const { overlay, ready, consoleErrors, consoleWarnings } = buildOverlay(primary, image);
  await ready;
  await sleep(900);

  const bounds = overlay.getBounds();
  note('overlayBounds', bounds);
  note('displayBounds', primary.bounds);

  check(
    'overlay covers the full display, not just the work area',
    bounds.width === primary.bounds.width && bounds.height === primary.bounds.height,
    `${bounds.width}x${bounds.height} vs display ${primary.bounds.width}x${primary.bounds.height}` +
      `, work area ${primary.workArea.width}x${primary.workArea.height}`
  );
  check('overlay is on screen', overlay.isVisible());

  /* ---- 2. the renderer is alive ----------------------------------- */
  console.log('\n2. renderer boot');
  const js = (code) => overlay.webContents.executeJavaScript(code, true);

  check('preload bridge is exposed', (await js('typeof window.pickerApi')) === 'object');
  check(
    'screenshot reached the renderer',
    /^url\("data:image\/png/.test(await js('getComputedStyle(document.getElementById("shot")).backgroundImage'))
  );

  /* `ready` is closure-private; the crosshair moving is the observable proxy. */
  check(
    'no uncaught error during boot',
    consoleErrors.length === 0,
    consoleErrors.join(' | ') || undefined
  );

  /* ---- 3. the reticle tracks the pointer -------------------------- */
  console.log('\n3. reticle tracks the pointer');

  /* Where the user's pointer physically is, as a fraction of the SCREEN.
   *
   * Deliberately not derived from the window bounds. Aiming relative to the
   * window would hide the bug: a short overlay would move the cursor up with
   * it, so 75% of the window and 75% of the image would still agree. A real
   * user aims at a spot on the screen, and the overlay is supposed to be
   * showing them that exact spot. */
  const screenPoint = (fx, fy) => ({
    x: Math.round(primary.bounds.width * fx),
    y: Math.round(primary.bounds.height * fy)
  });

  const probeAt = async (fx, fy) => {
    const { x, y } = screenPoint(fx, fy);
    overlay.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(260);
    const state = await js(`(function(){
      const cx = document.getElementById('cx');
      const cy = document.getElementById('cy');
      const c = document.getElementById('zoom');
      const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
      return {
        cxTop: cx.style.top, cyLeft: cy.style.left,
        hex: document.getElementById('hex').textContent,
        loupe: document.getElementById('loupe').style.left,
        painted: opaque
      };
    })()`);
    return { ...state, x, y, fx, fy };
  };

  /* Corners and edges are avoided so a one-pixel rounding difference can never
   * flip which source pixel is "expected". */
  const points = [
    [0.25, 0.25],
    [0.25, 0.75],
    [0.75, 0.25],
    [0.75, 0.75]
  ];

  /* The image quantises each axis to 8 bits, so a correct sample can still
   * decode a pixel or so away from the truth. Two is generous for that, and
   * still far tighter than the ~10px error a clamped overlay produces. */
  const TOLERANCE = 2;

  const seen = [];
  for (const [fx, fy] of points) {
    const want = expectedPixel(primary, fx, fy, imgW, imgH);
    const label = `${Math.round(fx * 100)}%/${Math.round(fy * 100)}%`;
    const s = await probeAt(fx, fy);
    seen.push({ ...s, want });

    check(
      `crosshair sits under the cursor at ${label}`,
      s.cxTop === `${s.y}px` && s.cyLeft === `${s.x}px`,
      `crosshair at ${s.cxTop || 'unset'}/${s.cyLeft || 'unset'}, cursor at ${s.y}px/${s.x}px`
    );
    check(`loupe is painted at ${label}`, s.painted > 1000, `${s.painted} opaque px`);

    const got = decodeHex(s.hex, imgW, imgH);
    check(
      `readout samples the pixel under the cursor at ${label}`,
      Math.abs(got.x - want.x) <= TOLERANCE && Math.abs(got.y - want.y) <= TOLERANCE,
      `${s.hex} → (${got.x}, ${got.y}), expected (${want.x}, ${want.y})`
    );
  }
  note('moves', seen);

  /* Visual evidence, and the only way a human can tell at a glance that the
   * reticle and loupe are actually drawn. `capturePage` is asynchronous and
   * returns a NativeImage; a null rect aborts the process, so pass the
   * window's own bounds. */
  try {
    const shotDir = path.join(ROOT, 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    const png = await overlay.webContents.capturePage();
    if (!png.isEmpty()) {
      fs.writeFileSync(path.join(shotDir, 'picker-overlay.png'), png.toPNG());
      note('screenshot', 'shots/picker-overlay.png');
    }
  } catch (err) {
    note('screenshotError', String(err && err.message ? err.message : err));
  }

  /* ---- 4. clicking reports the pixel under the reticle ------------ */
  console.log('\n4. click samples the reticle pixel');

  let picked = null;
  ipcMain.on('picker:pick', (_e, color) => {
    picked = color;
  });

  for (const [fx, fy] of points) {
    const want = expectedPixel(primary, fx, fy, imgW, imgH);
    const label = `${Math.round(fx * 100)}%/${Math.round(fy * 100)}%`;
    picked = null;
    const { x, y } = screenPoint(fx, fy);
    overlay.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(200);
    overlay.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    overlay.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await sleep(260);

    const got = picked === null ? null : decodeHex(picked, imgW, imgH);
    check(
      `click at ${label} picks the pixel under the cursor`,
      got !== null && Math.abs(got.x - want.x) <= TOLERANCE && Math.abs(got.y - want.y) <= TOLERANCE,
      picked === null
        ? 'nothing was reported'
        : `${picked} → (${got.x}, ${got.y}), expected (${want.x}, ${want.y})`
    );
  }

  /* ---- 5. the crosshair line spans the window --------------------- */
  console.log('\n5. crosshair spans the overlay');
  const span = await js(`(function(){
    const x = document.getElementById('cx').getBoundingClientRect();
    const y = document.getElementById('cy').getBoundingClientRect();
    return { xW: Math.round(x.width), yH: Math.round(y.height),
             winW: window.innerWidth, winH: window.innerHeight };
  })()`);
  note('crosshairSpan', span);
  check(
    'horizontal line spans the window',
    span.xW === span.winW,
    `${span.xW} vs ${span.winW}`
  );
  check(
    'vertical line spans the window',
    span.yH === span.winH,
    `${span.yH} vs ${span.winH}`
  );

  console.log('\n6. no errors across the whole run');
  note('consoleWarnings', consoleWarnings);
  check('renderer reported no errors', consoleErrors.length === 0, consoleErrors.join(' | ') || undefined);
  if (consoleWarnings.length) {
    console.log(`  note  ${consoleWarnings.length} warning(s), not fatal:`);
    consoleWarnings.forEach((w) => console.log(`        ${w.slice(0, 110)}`));
  }

  const report = { ok: problems.length === 0, problems, notes };
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'shots', 'picker-test.json'), JSON.stringify(report, null, 2));

  console.log(`\nproblems: ${problems.length}`);
  if (problems.length) problems.forEach((p) => console.log(`  - ${p}`));

  app.exit(problems.length ? 1 : 0);
});

setTimeout(() => {
  console.log('\nTIMEOUT — the picker test did not finish in 40s');
  app.exit(1);
}, 40000);

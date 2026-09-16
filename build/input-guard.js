'use strict';

/* Shared by smoke.js and verify.js.
 *
 * Synthetic input (`webContents.sendInputEvent`) only reaches the renderer
 * through the *real* hit test. An occluded window therefore delivers the event
 * to whatever is actually on top of that screen coordinate, and the harness
 * reports product failures ("no drag ghost", "the dock did not highlight") that
 * are really window-ordering flakes. `focus()` + `moveTop()` alone are not
 * enough — pin the window above everything, then prove input is landing before
 * any test trusts it.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureInput(win) {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  win.moveTop();

  await win.webContents.executeJavaScript(
    `(() => {
       window.__csPing = 0;
       document.addEventListener('mousemove', () => { window.__csPing++; }, true);
       return 'ok';
     })()`,
    true
  );

  for (let i = 0; i < 12; i++) {
    await sleep(250);
    const b = win.getContentBounds();
    /* Move only — never click. A mouseDown would land on real chrome (the
     * frameless title bar has a drag handler), and this probe must not mutate
     * app or window state. A mousemove proves the same input path. */
    const x = Math.round(b.x + b.width / 2);
    const y = Math.round(b.y + b.height / 2);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(150);
    const n = await win.webContents.executeJavaScript('window.__csPing', true).catch(() => 0);
    if (n > 0) return true;
  }
  return false;
}

function releaseInput(win) {
  try {
    win.setAlwaysOnTop(false);
  } catch (_) {}
}

module.exports = { ensureInput, releaseInput };

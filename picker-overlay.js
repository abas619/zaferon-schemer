'use strict';

/**
 * Screen-picker overlay window.
 *
 * One frameless, always-on-top window per display, filled with a frozen
 * screenshot of that display, so the user can click a pixel without the window
 * they are clicking through having to stay still.
 *
 * This lives in its own module rather than inside main.js so the eyedropper
 * test can build the *same* window the app builds. The test used to copy this
 * construction, which meant a change here could not fail the test — and the
 * geometry below is exactly the kind of thing that changes silently.
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const ROOT = __dirname;

const OVERLAY_WEB_PREFERENCES = {
  preload: path.join(ROOT, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  // The overlay must keep painting and keep its screenshot decoded even when it
  // is not the focused window — the whole point is that it captures input while
  // another app is technically in front.
  backgroundThrottling: false
};

/**
 * @param {Electron.Display} display  the display this overlay covers
 * @param {Electron.NativeImage} image  a full-display screenshot of it
 * @param {{ onClosed?: Function }} [opts]
 * @returns {{ overlay: Electron.BrowserWindow, size: {width:number,height:number}, shown: Promise<boolean> } | null}
 *          null when the capture came back unusable, so the caller can skip it.
 */
function createPickerOverlay(display, image, opts) {
  const size = image.getSize();
  if (!size.width || !size.height) return null;

  const isPrimary = display.id === screen.getPrimaryDisplay().id;

  const overlay = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#000000',
    useContentSize: true,
    webPreferences: OVERLAY_WEB_PREFERENCES
  });

  try {
    overlay.setAlwaysOnTop(true, 'screen-saver');
  } catch (_) {
    /* ignore — best effort, the plain alwaysOnTop still applies */
  }

  overlay.loadFile(path.join(ROOT, 'src', 'picker.html'));

  const shown = new Promise((resolve) => {
    overlay.webContents.once('did-finish-load', () => {
      if (overlay.isDestroyed()) {
        resolve(false);
        return;
      }

      overlay.webContents.send('picker:init', {
        image: image.toDataURL(),
        imageWidth: size.width,
        imageHeight: size.height,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        isPrimary
      });

      overlay.show();

      /* Windows clamps a frameless window to the *work area* when it is
       * created, so on a 1536x864 display with a taskbar the overlay comes back
       * 1536x816 — 48px short. The frozen screenshot is a full-display capture
       * though, and the renderer maps cursor position onto it by ratio
       * (`imgH / innerHeight`), so that missing strip stretches the whole image
       * vertically: every sample drifts further down the screen the lower you
       * click, and the bottom of the screen is not covered by the overlay at
       * all. Re-assert the bounds once the window is actually on screen — only
       * then does the platform take the full rect instead of re-clamping it. */
      overlay.setBounds(display.bounds);

      if (isPrimary) overlay.focus();
      resolve(true);
    });
  });

  if (opts && opts.onClosed) overlay.on('closed', opts.onClosed);

  return { overlay, size, shown };
}

module.exports = { createPickerOverlay, OVERLAY_WEB_PREFERENCES };

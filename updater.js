'use strict';

/* ==================================================================
 * Auto-update — main process only.
 *
 * Lives at the repo ROOT next to `main.js`, `preload.js` and `picker-overlay.js`,
 * not inside `src/js/`: everything under `src/js/` is renderer code loaded by
 * `src/index.html` under a `script-src 'self' file:` CSP with no Node access, so
 * a `require('electron')` file sitting in that tree is a category error — and
 * since `build.files` ships `src/` wholesale, it would ride into the asar as if
 * it were UI.
 *
 * The renderer never touches the network. It subscribes to `update:status` and
 * invokes the `update:*` channels, which `main.js` registers against the
 * exports below; every request to GitHub happens here.
 *
 * `app.isPackaged` is the gate on everything. An unpackaged run (`npm start`,
 * and every GUI harness) does no network I/O at all — which is what keeps the
 * README's "no requests while you use it" honest for development, and stops a
 * dev build from ever offering to replace itself with a published binary.
 * ================================================================== */

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

/* electron-updater only needs an object with these methods. `electron-log` is
 * the usual partner and is deliberately NOT a dependency: it would be the
 * package's whole reason for existing, and in a packaged Windows app stdout
 * still reaches the terminal the installer was started from, which is enough
 * to diagnose a failed update. */
const logger = {
  info: (...a) => console.log('[updater]', ...a),
  warn: (...a) => console.warn('[updater]', ...a),
  error: (...a) => console.error('[updater]', ...a)
};

let win = null;
let armed = false;

/** Latest known state, so a dialog opened after the boot check can still tell the truth. */
let last = { type: 'idle' };

const isPackaged = () => !!app.isPackaged;

function send(payload) {
  last = payload;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send('update:status', payload);
}

/**
 * Wire the updater to a window. Safe to call once per app run; calling it again
 * with a new window only re-points the event stream (dev reloads destroy the
 * old webContents).
 */
function init(browserWindow) {
  win = browserWindow;

  if (armed) return;
  armed = true;

  autoUpdater.logger = logger;
  /* The banner has an explicit Download step. Auto-downloading on check would
   * pull tens of megabytes over a link the user never asked for. */
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    send({
      type: 'available',
      version: info.version,
      releaseNotes: flattenNotes(info.releaseNotes)
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    send({ type: 'not-available', version: (info && info.version) || app.getVersion() });
  });

  autoUpdater.on('download-progress', (p) => {
    send({
      type: 'progress',
      percent: Number(p.percent) || 0,
      transferred: p.transferred,
      total: p.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    /* A missing release, an offline machine and a revoked token all land here.
     * None of them is worth interrupting the user for — the banner only shows
     * on a real result, so an error is reported to whoever asked. */
    logger.error(err && (err.stack || err.message) ? err.stack || err.message : err);
    send({ type: 'error', message: (err && err.message) || 'Update check failed.' });
  });

  if (!isPackaged()) {
    logger.info('not packaged — no update checks will run');
    return;
  }

  /* A short delay: the window is still painting its first frame, and an update
   * dialog stealing focus at launch is worse than one ten seconds later. */
  setTimeout(() => {
    check().catch(() => {});
  }, 10000);
}

/** Release notes arrive either as a string or as an array of {note}. */
function flattenNotes(notes) {
  if (!notes) return '';
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes.map((n) => (typeof n === 'string' ? n : (n && n.note) || '')).join('\n');
  }
  return '';
}

/** @returns {Promise<{packaged: boolean}>} resolves as soon as the outcome is known. */
async function check() {
  if (!isPackaged()) return { packaged: false };
  await autoUpdater.checkForUpdates();
  return { packaged: true };
}

async function download() {
  if (!isPackaged()) return { packaged: false };
  await autoUpdater.downloadUpdate();
  return { packaged: true };
}

/** Install and relaunch. Only meaningful after `update-downloaded`. */
function install() {
  if (!isPackaged()) return { packaged: false };
  autoUpdater.quitAndInstall(false, true);
  return { packaged: true };
}

/** The renderer can ask what already happened (e.g. after a reload). */
function status() {
  return { packaged: isPackaged(), state: last };
}

module.exports = { init, check, download, install, status };

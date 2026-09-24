/* ==================================================================
 * Update UI — banner + the "Check for Updates…" dialog.
 *
 * The renderer asks and listens; it never reaches the network. Everything
 * arrives over `window.cs.update` (see preload.js) from `updater.js`.
 *
 * Two surfaces, deliberately different:
 *
 *   · the **banner** is the only unprompted UI, and it appears only once there
 *     is something to act on — an available release, a download percentage, or
 *     an update ready to install. A boot-time check that finds nothing says
 *     nothing, which is the whole point of checking in the background.
 *   · the **dialog** is the answer to a request. It reports every state,
 *     including "up to date" and "this build has no update service", because
 *     someone who chose Help ▸ Check for Updates… asked a question and is
 *     owed an answer.
 *
 * Both class names are literal strings in `el()` specs so that
 * `build/css-coverage.js` can see them — a computed class hides the name from
 * that scan, and a dropped rule then presents as an unstyled strip.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const el = CS.Util.el;
  const on = CS.Util.on;
  const W = CS.Widgets;

  let banner = null;
  let bannerLine = null;
  let bannerFill = null;
  let bannerBar = null;
  let btnDownload = null;
  let btnInstall = null;

  /* The open dialog, if any. Status events land here too, so a check the user
   * started stays conversational instead of turning into a surprise strip. */
  let dlg = null;
  let dlgLine = null;

  let projectUrl = '';
  let listening = false;

  const bridge = () => (window.cs && window.cs.update ? window.cs.update : null);

  /* ---------------------------------------------------------------- *
   * Banner
   * ---------------------------------------------------------------- */

  function buildBanner() {
    if (banner) return;

    bannerLine = el('span.update-status', { text: '' });

    bannerFill = el('div.update-progress-fill');
    bannerBar = el('div.update-progress', {}, [bannerFill]);

    btnDownload = el('button.btn.btn-mini', { type: 'button', text: 'Download' });
    on(btnDownload, 'click', () => call('download'));

    btnInstall = el('button.btn.btn-mini.btn-primary', { type: 'button', text: 'Install & Restart' });
    on(btnInstall, 'click', () => call('install'));

    const dismiss = el('button.btn.btn-mini', { type: 'button', text: 'Later' });
    on(dismiss, 'click', hideBanner);

    banner = el('div.update-banner', {}, [
      bannerLine,
      bannerBar,
      el('div.update-acts', {}, [dismiss, btnDownload, btnInstall])
    ]);

    /* Below the titlebar, not above it: the titlebar carries the drag region
     * and the window controls, and a strip over it makes the window undraggable
     * for as long as an update is pending. */
    const app = document.getElementById('app') || document.body;
    const bar = document.getElementById('titlebar');
    app.insertBefore(banner, bar ? bar.nextSibling : app.firstChild);
  }

  function showBanner(text, mode) {
    buildBanner();
    bannerLine.textContent = text;
    banner.style.display = 'flex';
    btnDownload.style.display = mode === 'available' ? '' : 'none';
    btnInstall.style.display = mode === 'downloaded' ? '' : 'none';
    bannerBar.style.display = mode === 'progress' ? '' : 'none';
  }

  function hideBanner() {
    if (banner) banner.style.display = 'none';
  }

  function setProgress(percent) {
    buildBanner();
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    bannerFill.style.width = p.toFixed(1) + '%';
  }

  /* ---------------------------------------------------------------- *
   * Dialog
   * ---------------------------------------------------------------- */

  function dialogLine(text) {
    if (dlgLine) dlgLine.textContent = text;
  }

  function openDialog(first) {
    if (dlg) return;
    dlgLine = el('p.update-dialog-line', { text: first });
    const content = el('div.about-body', {}, [el('p', { text: 'Zaferon Schemer updates' }), dlgLine]);
    dlg = W.dialog({
      title: 'Check for Updates',
      width: 460,
      content,
      buttons: [
        { label: 'Close', value: null },
        { label: 'Open Project Page', value: 'open', primary: true }
      ],
      onClose: (v) => {
        dlg = null;
        dlgLine = null;
        /* The same https-only guard support.js applies: the channel will open
         * anything, so the caller decides what is worth opening. */
        if (v === 'open' && /^https:\/\//i.test(projectUrl) && window.cs && window.cs.shell) {
          window.cs.shell.openExternal(projectUrl);
        }
      }
    });
  }

  function call(method) {
    const u = bridge();
    if (!u || typeof u[method] !== 'function') return;
    const p = u[method]();
    /* `install` tears the process down, so its reply may never arrive. */
    if (p && p.catch) p.catch(() => dialogLine('The app could not reach its update service.'));
  }

  /* ---------------------------------------------------------------- *
   * Status reducer
   * ---------------------------------------------------------------- */

  function apply(s) {
    if (!s || !s.type) return;
    switch (s.type) {
      case 'available':
        showBanner(`Version ${s.version} is available.`, 'available');
        dialogLine(`Version ${s.version} is available. Download it now, or install it when it has finished.`);
        break;
      case 'progress':
        setProgress(s.percent);
        showBanner(`Downloading the update… ${Math.round(Number(s.percent) || 0)}%`, 'progress');
        dialogLine(`Downloading… ${Math.round(Number(s.percent) || 0)}%`);
        break;
      case 'downloaded':
        showBanner(`Version ${s.version} is ready to install.`, 'downloaded');
        dialogLine('The update is downloaded. Installing restarts Zaferon Schemer.');
        break;
      case 'checking':
        dialogLine('Checking for updates…');
        break;
      case 'not-available':
        hideBanner();
        dialogLine('You are up to date.');
        break;
      case 'error':
        hideBanner();
        dialogLine(`Update check failed: ${s.message || 'unknown error'}`);
        break;
      default:
        break;
    }
  }

  /**
   * Help ▸ Check for Updates…
   * @param {{projectUrl?: string}} opts the project URL, read from app.js rather
   *        than duplicated here.
   */
  function check(opts) {
    if (opts && opts.projectUrl) projectUrl = opts.projectUrl;
    const u = bridge();

    if (!u) {
      openDialog(
        'This view has no bridge to the app, so it cannot check for updates. Run the installed app, or use the project page.'
      );
      return;
    }

    u.status()
      .then((s) => {
        if (!s || !s.packaged) {
          openDialog(
            'This build is running from source, so it has no update service and will never install a release over itself. Use the project page to see published builds.'
          );
          return;
        }
        openDialog('Checking for updates…');
        if (s.state && s.state.type && s.state.type !== 'idle') apply(s.state);
        u.check().catch(() => dialogLine('The app could not reach its update service.'));
      })
      .catch(() => {
        openDialog('The app could not reach its update service.');
      });
  }

  function init() {
    if (listening) return;
    const u = bridge();
    if (!u || typeof u.onStatus !== 'function') return;
    listening = true;
    u.onStatus(apply);
  }

  CS.Update = { init, check, apply, hideBanner, showBanner };
})();

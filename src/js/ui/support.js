/* ==================================================================
 * Support dialog — donation channels with a scannable QR per wallet.
 *
 * Every address shown here comes from `CS.Donate` and is read AT DIALOG-OPEN
 * TIME. There is no cache, no persistence, no codegen and no second copy of
 * any address anywhere in this file: the QR is derived from the same string
 * that is printed next to it. Editing `src/js/data/donate.js` — including
 * swapping the demo address for a real one and deleting `demo: true` —
 * changes the rendered QR on the next open.
 *
 * Encoding is done by `src/js/vendor/qrcode-generator.js` (Kazuhiko Arase,
 * MIT), vendored because the CSP forbids fetching anything at runtime and the
 * renderer has no npm resolution. If that global is ever missing the rows
 * still render, just without art — nothing here throws.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const el = CS.Util.el;
  const on = CS.Util.on;
  const W = CS.Widgets;

  /* The QR spec requires a four-module quiet zone; without it most scanners
   * fail to find the finder patterns at all. */
  const QUIET = 4;
  const QR_SMALL = 84;
  const QR_BIG = 240;

  const DEMO_CAPTION = 'DEMO — not a real address';
  const DEMO_FOOTER =
    'Demo donation data present — replace it in src/js/data/donate.js before release.';
  const EMPTY_NOTE =
    'Donation channels are being set up — nothing is configured yet. Check back in a later version.';
  const SAFETY_NOTE =
    'Public addresses only. No one from this project will ever ask for a private key or seed phrase.';

  /** A CSS custom property, with a literal fallback for a headless context. */
  function token(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }

  /* Both of these go through the preload bridge. Absent in `build/preview.html`,
   * which has no bridge at all, so each is guarded rather than assumed. */
  function copy(text) {
    const s = String(text);
    if (window.cs && window.cs.clipboard) window.cs.clipboard.writeText(s);
    if (CS.App && CS.App.setStatus) CS.App.setStatus(`Copied: ${s}`);
    else console.log('[support] copied', s);
  }

  function openUrl(url) {
    /* https only — the channel refuses anything else. */
    if (!/^https:\/\//i.test(String(url))) {
      if (CS.App && CS.App.setStatus) CS.App.setStatus('Refusing to open a non-https URL.');
      return;
    }
    if (window.cs && window.cs.shell) window.cs.shell.openExternal(url);
    if (CS.App && CS.App.setStatus) CS.App.setStatus(`Opening ${url}`);
  }

  /**
   * Paint `text` as a QR into `canvas`.
   *
   * `cssSize` is forced onto the element as an inline style before measuring.
   * That is deliberate: a canvas with no definite CSS box makes `fitCanvas`
   * feed a xDPR loop until `createImageData` throws inside a Store listener.
   * The stylesheet carries the same value, so this is a belt-and-braces
   * guarantee rather than a second source of truth.
   *
   * Modules are drawn on integer *device* pixel boundaries — the transform
   * from `fitCanvas` is replaced with identity once the backing store is
   * sized. At DPR 1.25 a CSS-unit module would land on a half pixel and
   * antialias, which is exactly how a QR becomes unscannable on screen.
   *
   * @returns {boolean} false when no QR could be drawn (no encoder, no room).
   */
  function paintQr(canvas, text, cssSize) {
    if (!canvas || !window.qrcode) return false;

    if (cssSize) {
      canvas.style.width = cssSize + 'px';
      canvas.style.height = cssSize + 'px';
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    /* Sizes the backing store to the CSS box x DPR. Returns null on a bad
     * measurement, which is what an unattached canvas would produce. */
    const fit = W.fitCanvas(canvas, ctx);
    if (!fit) return false;

    let qr;
    try {
      qr = window.qrcode(0, 'M');
      qr.addData(String(text).trim());
      qr.make();
    } catch (err) {
      console.error('[support] QR encoding failed', err);
      return false;
    }

    const count = qr.getModuleCount();
    const total = count + QUIET * 2;
    const pw = canvas.width;
    const ph = canvas.height;

    const unit = Math.floor(Math.min(pw, ph) / total);
    if (unit < 1) {
      console.warn('[support] no room for a QR at', pw + 'x' + ph);
      return false;
    }

    const size = unit * total;
    const ox = Math.floor((pw - size) / 2);
    const oy = Math.floor((ph - size) / 2);

    const paper = token('--qr-paper', '#ffffff');
    const ink = token('--qr-ink', '#000000');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, pw, ph);
    ctx.fillStyle = ink;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(ox + (c + QUIET) * unit, oy + (r + QUIET) * unit, unit, unit);
        }
      }
    }
    return true;
  }

  /**
   * Wrap a QR canvas in its white paper card. The canvas is built by the
   * caller with a literal class name (`el('canvas.support-qr')`) so that
   * `build/css-coverage.js` can still see it — a computed class string hides
   * the name from that scan.
   *
   * @returns {{card: HTMLElement, paint: Function}}
   */
  function makeCard(canvas, text, size, demo, onActivate) {
    const card = el('button.support-qr-card', {
      type: 'button',
      title: onActivate ? 'Click to enlarge' : ''
    });
    card.appendChild(canvas);
    if (demo) card.appendChild(el('div.support-qr-cap', { text: DEMO_CAPTION }));
    if (onActivate) on(card, 'click', onActivate);
    return { card, paint: () => paintQr(canvas, text, size) };
  }

  function actionButtons(w) {
    const row = el('div.support-acts');

    const copyBtn = el('button.btn.btn-mini', { type: 'button', text: 'Copy' });
    on(copyBtn, 'click', () => copy(w.address));
    row.appendChild(copyBtn);

    /* Only offered when the entry actually carries an explorer URL. The seeded
     * demo wallet has explorer: '', so this stays hidden until it is filled in. */
    if (w.explorer) {
      const url = String(w.explorer).replace('{addr}', encodeURIComponent(w.address));
      const viewBtn = el('button.btn.btn-mini', { type: 'button', text: 'View' });
      on(viewBtn, 'click', () => openUrl(url));
      row.appendChild(viewBtn);
    }
    return row;
  }

  function walletRow(w, pending) {
    const row = el('div.support-row');
    const qr = makeCard(el('canvas.support-qr'), w.address, QR_SMALL, !!w.demo, () => openLarge(w));

    row.appendChild(qr.card);
    row.appendChild(
      el('div.support-col', {}, [
        el('div.support-label', { text: w.label }),
        el('div.support-net', { text: w.network }),
        el('div.support-addr', { text: w.address })
      ])
    );
    row.appendChild(actionButtons(w));

    pending.push(qr.paint);
    return row;
  }

  function linkRow(l) {
    const row = el('div.support-row');
    row.appendChild(el('div.support-col', {}, [el('div.support-label', { text: l.label })]));

    const acts = el('div.support-acts');
    const openBtn = el('button.btn.btn-mini', { type: 'button', text: 'Open' });
    on(openBtn, 'click', () => openUrl(l.url));
    acts.appendChild(openBtn);
    row.appendChild(acts);
    return row;
  }

  /** The scan-from-screen path: a 240px QR, the address, and a Copy button. */
  function openLarge(w) {
    const body = el('div.support-body.support-large');
    const qr = makeCard(el('canvas.support-qr-big'), w.address, QR_BIG, !!w.demo, null);
    body.appendChild(qr.card);
    body.appendChild(el('div.support-addr', { text: w.address }));

    const dlg = W.dialog({
      title: `${w.label} — ${w.network}`,
      width: 320,
      buttons: [
        { label: 'Copy Address', value: 'copy' },
        { label: 'Close', value: null, primary: true }
      ],
      onClose: (v) => {
        if (v === 'copy') copy(w.address);
      }
    });

    /* Appended before painting: `fitCanvas` measures `getBoundingClientRect`,
     * which is all zeros on a canvas that is not in the document yet. */
    dlg.body.appendChild(body);
    qr.paint();
    return dlg;
  }

  function open() {
    const wallets = CS.Donate.readyWallets();
    const links = CS.Donate.readyLinks();
    const body = el('div.support-body');
    const pending = [];

    if (!wallets.length && !links.length) {
      body.appendChild(el('div.support-note', { text: EMPTY_NOTE }));
    }

    wallets.forEach((w) => body.appendChild(walletRow(w, pending)));
    links.forEach((l) => body.appendChild(linkRow(l)));

    if (CS.Donate.hasDemo()) body.appendChild(el('div.support-warn', { text: DEMO_FOOTER }));
    body.appendChild(el('div.support-note', { text: SAFETY_NOTE }));

    const dlg = W.dialog({
      title: 'Support Zaferon Schemer',
      width: 520,
      buttons: [{ label: 'Close', value: null, primary: true }]
    });

    dlg.body.appendChild(body);
    pending.forEach((fn) => fn());
    return dlg;
  }

  CS.Support = { open, openLarge, paintQr, DEMO_CAPTION, DEMO_FOOTER, EMPTY_NOTE, SAFETY_NOTE };
})();

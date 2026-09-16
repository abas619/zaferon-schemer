/* ==================================================================
 * Screen Color Picker overlay.
 * Shows a frozen screenshot of one display with a crosshair and a
 * magnifier loupe. Click picks a pixel, Esc cancels.
 * ================================================================== */
(function () {
  'use strict';

  const shot = document.getElementById('shot');
  const cx = document.getElementById('cx');
  const cy = document.getElementById('cy');
  const loupe = document.getElementById('loupe');
  const zoom = document.getElementById('zoom');
  const swatch = document.getElementById('swatch');
  const hexOut = document.getElementById('hex');
  const subOut = document.getElementById('sub');
  const copiedOut = document.getElementById('copied');

  const zctx = zoom.getContext('2d');

  let img = null;
  let imgW = 1;
  let imgH = 1;
  let frozen = null; // { px, py } when the user pressed Space
  let ready = false;

  const ZOOM_PIXELS = 17; // source pixels shown in the loupe
  const ZOOM_SIZE = 272; // canvas pixels

  /* ------------------------------------------------------------------ */

  function toHex(r, g, b) {
    const p = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + p(r) + p(g) + p(b);
  }

  function hsvOf(r, g, b) {
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rr) h = ((gg - bb) / d) % 6;
      else if (max === gg) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: Math.round(h), s: Math.round((max === 0 ? 0 : d / max) * 100), v: Math.round(max * 100) };
  }

  function sample(px, py) {
    const x = Math.max(0, Math.min(imgW - 1, Math.round(px)));
    const y = Math.max(0, Math.min(imgH - 1, Math.round(py)));
    if (!img) return { r: 0, g: 0, b: 0, px: x, py: y };

    // Draw the image once into an offscreen buffer so we can read pixels.
    if (!sample.buf || sample.buf.width !== imgW || sample.buf.height !== imgH) {
      sample.buf = document.createElement('canvas');
      sample.buf.width = imgW;
      sample.buf.height = imgH;
      sample.bufCtx = sample.buf.getContext('2d', { willReadFrequently: true });
      sample.bufCtx.drawImage(img, 0, 0, imgW, imgH);
    }
    const d = sample.bufCtx.getImageData(x, y, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], px: x, py: y };
  }

  /* ------------------------------------------------------------------ */

  function devicePoint(clientX, clientY) {
    const sx = imgW / Math.max(1, window.innerWidth);
    const sy = imgH / Math.max(1, window.innerHeight);
    return { px: clientX * sx, py: clientY * sy };
  }

  function paintLoupe(clientX, clientY, px, py) {
    if (!img) return;

    const half = Math.floor(ZOOM_PIXELS / 2);
    const sx = Math.max(0, Math.min(imgW - ZOOM_PIXELS, Math.round(px) - half));
    const sy = Math.max(0, Math.min(imgH - ZOOM_PIXELS, Math.round(py) - half));

    zctx.imageSmoothingEnabled = false;
    zctx.clearRect(0, 0, ZOOM_SIZE, ZOOM_SIZE);
    zctx.fillStyle = '#ffffff';
    zctx.fillRect(0, 0, ZOOM_SIZE, ZOOM_SIZE);
    zctx.drawImage(img, sx, sy, ZOOM_PIXELS, ZOOM_PIXELS, 0, 0, ZOOM_SIZE, ZOOM_SIZE);

    // highlight the centre cell
    const cell = ZOOM_SIZE / ZOOM_PIXELS;
    const cxCell = (Math.round(px) - sx) * cell;
    const cyCell = (Math.round(py) - sy) * cell;

    zctx.save();
    zctx.strokeStyle = 'rgba(0,0,0,0.85)';
    zctx.lineWidth = 3;
    zctx.strokeRect(cxCell + 1.5, cyCell + 1.5, cell - 3, cell - 3);
    zctx.strokeStyle = '#ffffff';
    zctx.lineWidth = 1.5;
    zctx.strokeRect(cxCell + 3, cyCell + 3, cell - 6, cell - 6);
    zctx.restore();

    // grid
    zctx.save();
    zctx.strokeStyle = 'rgba(0,0,0,0.10)';
    zctx.lineWidth = 1;
    for (let i = 1; i < ZOOM_PIXELS; i++) {
      zctx.beginPath();
      zctx.moveTo(i * cell, 0);
      zctx.lineTo(i * cell, ZOOM_SIZE);
      zctx.moveTo(0, i * cell);
      zctx.lineTo(ZOOM_SIZE, i * cell);
      zctx.stroke();
    }
    zctx.restore();

    // place the loupe away from the cursor
    const LW = 138;
    const LH = 182;
    let lx = clientX + 22;
    let ly = clientY + 22;
    if (lx + LW > window.innerWidth - 6) lx = clientX - LW - 22;
    if (ly + LH > window.innerHeight - 6) ly = clientY - LH - 22;
    if (lx < 6) lx = 6;
    if (ly < 6) ly = 6;
    loupe.style.left = Math.round(lx) + 'px';
    loupe.style.top = Math.round(ly) + 'px';
  }

  function update(clientX, clientY) {
    if (!ready) return;

    const pt = frozen || devicePoint(clientX, clientY);
    const px = Math.max(0, Math.min(imgW - 1, pt.px));
    const py = Math.max(0, Math.min(imgH - 1, pt.py));

    const c = sample(px, py);
    const hex = toHex(c.r, c.g, c.b);
    const hsv = hsvOf(c.r, c.g, c.b);

    swatch.style.background = hex;
    hexOut.textContent = hex.toUpperCase();
    subOut.textContent = `R ${c.r}  G ${c.g}  B ${c.b}   ·   H ${hsv.h}° S ${hsv.s}% V ${hsv.v}%`;

    cx.style.top = Math.round(clientY) + 'px';
    cy.style.left = Math.round(clientX) + 'px';

    paintLoupe(clientX, clientY, px, py);

    update.last = { clientX, clientY };
  }

  /* ------------------------------------------------------------------ */

  document.addEventListener('mousemove', (e) => {
    if (frozen) {
      // still move the crosshair visually but keep sampling the frozen pixel
      cx.style.top = Math.round(e.clientY) + 'px';
      cy.style.left = Math.round(e.clientX) + 'px';
      update(e.clientX, e.clientY);
      return;
    }
    update(e.clientX, e.clientY);
  });

  document.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      e.preventDefault();
      window.pickerApi.cancel();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    const pt = frozen || devicePoint(e.clientX, e.clientY);
    const c = sample(pt.px, pt.py);
    window.pickerApi.pick(toHex(c.r, c.g, c.b));
  });

  document.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.pickerApi.cancel();
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      if (window.cs && window.cs.clipboard) window.cs.clipboard.writeText(hexOut.textContent);
      copiedOut.classList.add('show');
      setTimeout(() => copiedOut.classList.remove('show'), 1100);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (frozen) {
        frozen = null;
      } else if (update.last) {
        frozen = devicePoint(update.last.clientX, update.last.clientY);
      }
      document.querySelector('.hint').style.background = frozen ? 'rgba(47,125,31,0.92)' : 'rgba(28,28,28,0.9)';
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const base = frozen || (update.last ? devicePoint(update.last.clientX, update.last.clientY) : { px: imgW / 2, py: imgH / 2 });
      const nx = Math.max(0, Math.min(imgW - 1, base.px + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0)));
      const ny = Math.max(0, Math.min(imgH - 1, base.py + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)));
      frozen = { px: nx, py: ny };

      const scale = window.innerWidth / imgW;
      const clientX = nx * scale;
      const clientY = ny * (window.innerHeight / imgH);
      cx.style.top = Math.round(clientY) + 'px';
      cy.style.left = Math.round(clientX) + 'px';

      const c = sample(nx, ny);
      const hex = toHex(c.r, c.g, c.b);
      const hsv = hsvOf(c.r, c.g, c.b);
      swatch.style.background = hex;
      hexOut.textContent = hex.toUpperCase();
      subOut.textContent = `R ${c.r}  G ${c.g}  B ${c.b}   ·   H ${hsv.h}° S ${hsv.s}% V ${hsv.v}%`;
      paintLoupe(clientX, clientY, nx, ny);
      update.last = { clientX, clientY };
    }
  });

  window.addEventListener('blur', () => {
    // ignore — the window may lose focus when another overlay is clicked
  });

  /* ------------------------------------------------------------------ */

  window.pickerApi.onInit((data) => {
    imgW = data.imageWidth || 1;
    imgH = data.imageHeight || 1;

    shot.style.backgroundImage = `url(${data.image})`;

    img = new Image();
    img.onload = () => {
      primePixels();
      ready = true;
      const startX = Math.round(window.innerWidth / 2);
      const startY = Math.round(window.innerHeight / 2);
      update(startX, startY);
    };
    img.src = data.image;
  });

  // Show the loupe immediately at the centre so the UI never looks empty.
  loupe.style.left = '40px';
  loupe.style.top = '60px';
})();

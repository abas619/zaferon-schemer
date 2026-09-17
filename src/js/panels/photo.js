/* ==================================================================
 * PhotoSchemer panel — pull a palette out of a picture.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, clamp, clear } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  const SAMPLE_IMAGE = 'assets/sample-photo.png';

  /* Every effect is applied to the *displayed* picture only — the sampled
   * colours always come from the untouched pixels, so a marker keeps reporting
   * the same colour whatever filter is on top of it. */
  const EFFECTS = [
    { id: 'none', label: 'None' },
    { id: 'mosaic', label: 'Mosaic' },
    { id: 'pixelate', label: 'Pixelate' },
    { id: 'blur', label: 'Blur' },
    { id: 'grayscale', label: 'Black & White' },
    { id: 'sepia', label: 'Sepia' },
    { id: 'invert', label: 'Invert' },
    { id: 'posterize', label: 'Posterize' },
    { id: 'vignette', label: 'Vignette' }
  ];

  function create() {
    /* --- state ---------------------------------------------------- */
    const image = new Image();
    let imgReady = false;
    let fileName = '';
    let markers = []; // { x, y } in 0..1 image space
    // `photoMosaic` is the old boolean key — honour it once, then use photoEffect.
    let effect = Store.get('photoEffect', Store.get('photoMosaic', false) ? 'mosaic' : 'none');
    if (!EFFECTS.some((e) => e.id === effect)) effect = 'none';
    let colorCount = Store.get('photoColors', 5);
    let sampleCanvas = document.createElement('canvas');
    let sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    let pixelCache = null;
    let scratch = null;

    /* --- chrome --------------------------------------------------- */
    const panel = W.panel('PhotoSchemer', {
      onClose: () => CS.App.closeDocument('photo'),
      onMenu: () => [
        { label: 'Open Image…', action: openImage },
        { label: 'Load Sample Image', action: () => loadImage(SAMPLE_IMAGE, 'sample-photo.png') },
        { separator: true },
        { label: 'Extract Dominant Colours', action: extractDominant },
        { label: 'Randomize Sample Points', action: randomize },
        { label: 'Reset Sample Points', action: () => { placeEvenly(); render(); } },
        { separator: true },
        {
          label: 'Effect',
          submenu: EFFECTS.map((e) => ({
            label: e.label,
            checked: effect === e.id,
            action: () => setEffect(e.id)
          }))
        },
        { separator: true },
        { label: 'Add Palette to Favourites', action: addPalette },
        { label: 'Open Matching Colors', action: () => CS.App.openDocument('matching') }
      ]
    });

    const openBtn = el('button.tool-inline', {
      type: 'button',
      html: iconFolder() + '<span>Open…</span>',
      title: 'Open an image file'
    });

    const effectSelect = W.select({
      options: EFFECTS.map((e) => ({ id: e.id, label: e.label })),
      value: effect,
      width: 118,
      onChange: (id) => setEffect(id)
    });

    const randomBtn = el('button.tool-inline', {
      type: 'button',
      html: iconImage() + '<span>Randomize!</span>',
      title: 'Scatter the sample points randomly'
    });

    const countStepper = W.stepper({
      value: colorCount,
      min: 1,
      max: 16,
      label: '# Colors:',
      compact: true,
      onChange: (v) => {
        colorCount = v;
        Store.set('photoColors', v);
        resizeMarkers(v);
        render();
      }
    });

    const addBtn = el('button.add-btn', { type: 'button', text: 'Add to Favorites', title: 'Add all extracted colors to Favorites' });

    const toolbar = el('div.photo-toolbar', {}, [
      openBtn,
      el('span.field-label', { text: 'Effect:' }),
      effectSelect,
      randomBtn,
      countStepper,
      el('div.spacer'),
      addBtn
    ]);

    const swatchRow = el('div.photo-swatches');
    const stage = el('div.photo-stage');
    const canvas = el('canvas.photo-canvas');
    const markerLayer = el('div.photo-markers');

    /* --- empty state ---------------------------------------------- */
    const emptyTitle = el('div.photo-empty-title', { text: 'No image loaded' });
    const emptyText = el('div.photo-empty-text', {
      text: 'Open a picture, or drag & drop one onto this panel.'
    });
    const emptyBtn = el('button.btn.btn-mini', { type: 'button', text: 'Open Image…' });
    const emptyNote = el('div.photo-empty', {}, [
      el('div.photo-empty-card', {}, [emptyTitle, emptyText, emptyBtn])
    ]);
    on(emptyBtn, 'click', openImage);

    stage.append(canvas, markerLayer, swatchRow, emptyNote);
    panel.body.append(toolbar, stage);

    /* --- image loading -------------------------------------------- */

    /**
     * Load an image into the panel.
     *
     * Always resolves — with `true` on success, `false` on failure. A rejected
     * promise here had no catch anywhere, so a missing/broken source surfaced as
     * an "Uncaught (in promise)" console error even though the panel already
     * shows a friendly message. Failure is a normal outcome, not an exception.
     */
    function loadImage(src, name) {
      return new Promise((resolve) => {
        image.onload = () => {
          imgReady = true;
          fileName = name || 'image';
          panel.setTitle(`PhotoSchemer - ${fileName}`);
          sampleCanvas.width = image.naturalWidth;
          sampleCanvas.height = image.naturalHeight;
          sampleCtx.drawImage(image, 0, 0);
          try {
            pixelCache = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
          } catch (_) {
            pixelCache = null;
          }
          emptyNote.classList.add('hidden');
          placeEvenly();
          render();
          resolve(true);
        };
        image.onerror = () => {
          imgReady = false;
          pixelCache = null;
          // Drop any previously painted image so the canvas can't show a stale
          // picture underneath the error note. render() bails while !imgReady.
          const cctx = canvas.getContext('2d');
          cctx.setTransform(1, 0, 0, 1, 0, 0);
          cctx.clearRect(0, 0, canvas.width, canvas.height);
          markerLayer.replaceChildren();
          swatchRow.replaceChildren();
          emptyNote.classList.remove('hidden');
          emptyTitle.textContent = 'Could not load that image';
          emptyText.textContent = 'Try another file, or drag & drop a picture onto this panel.';
          resolve(false);
        };
        image.src = src;
      });
    }

    function openImage() {
      if (!window.cs || !window.cs.file) return;
      window.cs.file.openImage().then((res) => {
        if (!res) return;
        loadImage(res.dataUrl, res.name).then((ok) => {
          if (ok) CS.App.setStatus(`Loaded ${res.name}.`);
        });
      });
    }

    /* --- effects -------------------------------------------------- */

    function setEffect(id) {
      effect = EFFECTS.some((e) => e.id === id) ? id : 'none';
      Store.set('photoEffect', effect);
      effectSelect.value = effect;
      render();
      CS.App.setStatus(`Effect: ${EFFECTS.find((e) => e.id === effect).label}`);
    }

    /** A reusable offscreen buffer, resized on demand. */
    function scratchFor(w, h) {
      if (!scratch) scratch = document.createElement('canvas');
      if (scratch.width !== w || scratch.height !== h) {
        scratch.width = w;
        scratch.height = h;
      }
      const sctx = scratch.getContext('2d', { willReadFrequently: true });
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, w, h);
      return { canvas: scratch, ctx: sctx };
    }

    /** Paint the picture into `L` with the active effect applied. */
    function paintImage(ctx, L) {
      if (effect === 'pixelate') {
        const block = Math.max(3, Math.round(Math.min(L.w, L.h) / 64));
        const sw = Math.max(1, Math.round(L.w / block));
        const sh = Math.max(1, Math.round(L.h / block));
        const sc = scratchFor(sw, sh);
        sc.ctx.imageSmoothingEnabled = true;
        sc.ctx.drawImage(image, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sc.canvas, 0, 0, sw, sh, L.x, L.y, L.w, L.h);
        ctx.imageSmoothingEnabled = true;
        return;
      }

      if (effect === 'blur') {
        ctx.save();
        // Clip first: a blurred drawImage bleeds past its rect otherwise.
        ctx.beginPath();
        ctx.rect(L.x, L.y, L.w, L.h);
        ctx.clip();
        ctx.filter = `blur(${Math.max(2, Math.round(Math.min(L.w, L.h) / 70))}px)`;
        ctx.drawImage(image, L.x, L.y, L.w, L.h);
        ctx.restore();
        return;
      }

      // Every remaining effect draws the picture at full quality first…
      ctx.drawImage(image, L.x, L.y, L.w, L.h);

      /* …and then rewrites the pixels in place.
       *
       * Doing the colour maths by hand instead of leaning on ctx.filter keeps
       * every effect pixel-exact: the filtered path resamples the source
       * through Skia's image filter, and posterize in particular has to
       * quantise the real pixels rather than a downscaled stand-in. */
      if (effect === 'grayscale' || effect === 'sepia' || effect === 'invert' || effect === 'posterize') {
        transformPixels(ctx, L, effect);
      }
    }

    /** In-place colour transform over the device-pixel rect the image occupies. */
    function transformPixels(ctx, L, mode) {
      const dpr = window.devicePixelRatio || 1;
      const x0 = clamp(Math.round(L.x * dpr), 0, canvas.width);
      const y0 = clamp(Math.round(L.y * dpr), 0, canvas.height);
      const w0 = Math.min(canvas.width - x0, Math.round(L.w * dpr));
      const h0 = Math.min(canvas.height - y0, Math.round(L.h * dpr));
      if (w0 <= 0 || h0 <= 0) return;

      const data = ctx.getImageData(x0, y0, w0, h0);
      const d = data.data;
      const step = 255 / 3; // posterize: 4 levels per channel

      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        if (mode === 'grayscale') {
          const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          d[i] = y;
          d[i + 1] = y;
          d[i + 2] = y;
        } else if (mode === 'invert') {
          d[i] = 255 - r;
          d[i + 1] = 255 - g;
          d[i + 2] = 255 - b;
        } else if (mode === 'sepia') {
          d[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
          d[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
          d[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
        } else {
          d[i] = Math.round(r / step) * step;
          d[i + 1] = Math.round(g / step) * step;
          d[i + 2] = Math.round(b / step) * step;
        }
      }

      // putImageData ignores the transform, so the offset has to be in device
      // pixels — which is exactly what x0/y0 already are.
      ctx.putImageData(data, x0, y0);
    }

    /* --- markers -------------------------------------------------- */
    function placeEvenly() {
      const n = colorCount;
      markers = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        markers.push({ x: 0.12 + t * 0.76, y: 0.25 + Math.sin(t * Math.PI) * 0.5 });
      }
    }

    function resizeMarkers(n) {
      if (markers.length === n) return;
      if (markers.length > n) markers = markers.slice(0, n);
      else {
        while (markers.length < n) {
          markers.push({ x: Math.random(), y: Math.random() });
        }
      }
    }

    function randomize() {
      markers = markers.map(() => ({ x: 0.06 + Math.random() * 0.88, y: 0.06 + Math.random() * 0.88 }));
      render();
      CS.App.setStatus('Randomized sample points.');
    }

    function extractDominant() {
      if (!pixelCache) {
        CS.App.setStatus('Open an image first.');
        return;
      }
      const colors = Color.quantize(pixelCache.data, colorCount);
      if (!colors.length) return;

      // Find a pixel near each quantised colour to anchor the marker.
      const data = pixelCache.data;
      const w = sampleCanvas.width;
      const h = sampleCanvas.height;
      markers = colors.map((target) => {
        let best = { x: 0.5, y: 0.5 };
        let bestD = Infinity;
        for (let y = 4; y < h; y += 7) {
          for (let x = 4; x < w; x += 7) {
            const i = (y * w + x) * 4;
            const d =
              Math.pow(data[i] - target.r, 2) + Math.pow(data[i + 1] - target.g, 2) + Math.pow(data[i + 2] - target.b, 2);
            if (d < bestD) {
              bestD = d;
              best = { x: x / w, y: y / h };
            }
          }
        }
        return best;
      });
      colorCount = markers.length;
      Store.set('photoColors', colorCount);
      countStepper._stepper.set(colorCount);
      render();
      CS.App.setStatus(`Extracted ${markers.length} dominant colours.`);
    }

    function sampleAt(x, y) {
      if (!pixelCache) return { r: 128, g: 128, b: 128 };
      const px = clamp(Math.round(x * (sampleCanvas.width - 1)), 0, sampleCanvas.width - 1);
      const py = clamp(Math.round(y * (sampleCanvas.height - 1)), 0, sampleCanvas.height - 1);
      const i = (py * sampleCanvas.width + px) * 4;
      const d = pixelCache.data;
      return { r: d[i], g: d[i + 1], b: d[i + 2] };
    }

    function palette() {
      return markers.map((m) => sampleAt(m.x, m.y));
    }

    /* --- rendering ------------------------------------------------ */
    let layout = { x: 0, y: 0, w: 0, h: 0 };

    function computeLayout() {
      const rect = stage.getBoundingClientRect();
      const pad = 8;
      const availW = Math.max(10, rect.width - pad * 2);
      const availH = Math.max(10, rect.height - pad * 2);
      if (!imgReady) return { x: 0, y: 0, w: availW, h: availH };

      const scale = Math.min(availW / image.naturalWidth, availH / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      return {
        x: (rect.width - w) / 2,
        y: (rect.height - h) / 2,
        w,
        h
      };
    }

    function render() {
      if (!imgReady) return;
      layout = computeLayout();

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = stage.getBoundingClientRect();
      const cw = Math.max(1, Math.round(rect.width));
      const ch = Math.max(1, Math.round(rect.height));
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
      }
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const L = layout;
      paintImage(ctx, L);

      /* Mosaic works the other way round: it paints the picture itself, block by
       * block, snapped to the sampled palette. */
      if (effect === 'mosaic') {
        const pal = palette();
        const block = Math.max(6, Math.round(Math.min(L.w, L.h) / 42));
        ctx.imageSmoothingEnabled = false;
        for (let y = 0; y < L.h; y += block) {
          for (let x = 0; x < L.w; x += block) {
            const ux = (x + block / 2) / L.w;
            const uy = (y + block / 2) / L.h;
            const c = sampleAt(ux, uy);
            let best = pal[0];
            let bestD = Infinity;
            pal.forEach((p) => {
              const d = Math.pow(p.r - c.r, 2) + Math.pow(p.g - c.g, 2) + Math.pow(p.b - c.b, 2);
              if (d < bestD) {
                bestD = d;
                best = p;
              }
            });
            ctx.fillStyle = Color.toCssRgb(best);
            ctx.fillRect(L.x + x, L.y + y, block, block);
          }
        }
        ctx.imageSmoothingEnabled = true;
      }

      if (effect === 'vignette') {
        const cx = L.x + L.w / 2;
        const cy = L.y + L.h / 2;
        const g = ctx.createRadialGradient(
          cx,
          cy,
          Math.min(L.w, L.h) * 0.25,
          cx,
          cy,
          Math.max(L.w, L.h) * 0.72
        );
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = g;
        ctx.fillRect(L.x, L.y, L.w, L.h);
      }

      // frame
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1);

      paintMarkers();
      paintSwatches();
    }

    function paintMarkers() {
      clear(markerLayer);
      const L = layout;
      markerLayer.style.left = `${L.x}px`;
      markerLayer.style.top = `${L.y}px`;
      markerLayer.style.width = `${L.w}px`;
      markerLayer.style.height = `${L.h}px`;

      markers.forEach((m, i) => {
        const node = el('div.photo-marker', { title: 'Drag to move · double-click to remove' });
        node.style.left = `${m.x * 100}%`;
        node.style.top = `${m.y * 100}%`;
        node.dataset.index = String(i);

        on(node, 'pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = markerLayer.getBoundingClientRect();
          const move = (ev) => {
            m.x = clamp((ev.clientX - rect.left) / Math.max(1, rect.width));
            m.y = clamp((ev.clientY - rect.top) / Math.max(1, rect.height));
            node.style.left = `${m.x * 100}%`;
            node.style.top = `${m.y * 100}%`;
            paintSwatches();
            if (effect === 'mosaic') scheduleMosaic();
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            Store.persist();
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });

        on(node, 'dblclick', (e) => {
          e.stopPropagation();
          if (markers.length <= 1) return;
          markers.splice(i, 1);
          colorCount = markers.length;
          Store.set('photoColors', colorCount);
          countStepper._stepper.set(colorCount);
          render();
        });

        markerLayer.appendChild(node);
      });
    }

    let mosaicTimer = null;
    function scheduleMosaic() {
      clearTimeout(mosaicTimer);
      mosaicTimer = setTimeout(render, 90);
    }

    function paintSwatches() {
      clear(swatchRow);
      palette().forEach((c, i) => {
        const hex = Color.toHex(c);
        const chipEl = W.chip(hex, {
          size: 26,
          draggable: true,
          title: `${hex} — click to set as base colour`,
          onPick: () => Store.setColor(c)
        });
        const wrap = el('div.photo-swatch');
        wrap.append(chipEl, el('span.photo-swatch-label', { text: hex.toUpperCase() }));
        on(wrap, 'click', () => Store.setColor(c));
        on(wrap, 'contextmenu', (e) => {
          e.preventDefault();
          Store.addFavorite(hex);
          CS.App.setStatus(`Added ${hex.toUpperCase()} to Favourites.`);
        });
        void i;
        swatchRow.appendChild(wrap);
      });
    }

    /* --- stage interaction ---------------------------------------- */
    on(stage, 'pointerdown', (e) => {
      if (!imgReady) return;
      const L = layout;
      const rect = stage.getBoundingClientRect();
      const x = (e.clientX - rect.left - L.x) / Math.max(1, L.w);
      const y = (e.clientY - rect.top - L.y) / Math.max(1, L.h);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;

      // move the nearest marker, or add one
      let nearest = -1;
      let bestD = 0.09;
      markers.forEach((m, i) => {
        const d = Math.hypot(m.x - x, m.y - y);
        if (d < bestD) {
          bestD = d;
          nearest = i;
        }
      });

      if (nearest >= 0) {
        markers[nearest].x = x;
        markers[nearest].y = y;
      } else if (markers.length < 16) {
        markers.push({ x, y });
        colorCount = markers.length;
        Store.set('photoColors', colorCount);
        countStepper._stepper.set(colorCount);
      }
      render();
    });

    /* --- buttons -------------------------------------------------- */
    on(openBtn, 'click', openImage);
    on(randomBtn, 'click', randomize);
    on(addBtn, 'click', addPalette);

    function addPalette() {
      if (!imgReady) {
        CS.App.setStatus('Open an image first.');
        return;
      }
      let n = 0;
      palette().forEach((c) => {
        if (Store.addFavorite(c)) n++;
      });
      CS.App.setStatus(`Added ${n} colour${n === 1 ? '' : 's'} to Favourites.`);
    }

    /* --- drag & drop an image ------------------------------------- */
    on(stage, 'dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        stage.classList.add('is-drop-target');
      }
    });
    on(stage, 'dragleave', () => stage.classList.remove('is-drop-target'));
    on(stage, 'drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      stage.classList.remove('is-drop-target');
      const file = files[0];
      if (!/^image\//.test(file.type)) return;
      const reader = new FileReader();
      reader.onload = () => loadImage(reader.result, file.name);
      reader.readAsDataURL(file);
    });

    /* --- sizing --------------------------------------------------- */
    const ro = new ResizeObserver(() => render());
    ro.observe(stage);

    /* No image is loaded on start-up on purpose: PhotoSchemer is a tool, not a
     * demo, and a pre-filled sample made it look like the panel had already
     * done something. The empty card offers Open / drag & drop instead, and the
     * panel menu can still pull the bundled sample in. */

    return {
      root: panel.root,
      refresh() {},
      destroy() {
        ro.disconnect();
      }
    };
  }

  function iconFolder() {
    return CS.Icons.svg('folder-open', 13);
  }

  function iconImage() {
    return CS.Icons.svg('image', 13);
  }

  CS.Panels = CS.Panels || {};
  CS.Panels.Photo = { create };
})();

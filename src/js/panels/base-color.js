/* ==================================================================
 * Base Color panel — RGB sliders / 2D spectrum / named colour library.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, drag, clamp, clear } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  const INCREMENTS = [1, 5, 10, 25];

  function create() {
    let syncing = false;
    let activeTab = Store.get('baseTab', 'wheel');
    if (!['wheel', 'rgb', 'spectrum', 'convert', 'library'].includes(activeTab)) activeTab = 'wheel';
    let lastNarrow = null;

    const panel = W.panel('Base Color', {
      onMenu: () => [
        { label: 'Reset to Black', action: () => Store.setColor('#000000') },
        { label: 'Reset to White', action: () => Store.setColor('#FFFFFF') },
        { label: 'Randomize Colour', action: () => Store.setColor(Color.randomRgb()) },
        { separator: true },
        { label: 'Copy Hex Value', action: () => copyHex() },
        { label: 'Make Web Safe', action: () => Store.setColor(Color.toWebsafe(Store.rgb())) },
        { separator: true },
        { label: 'Close Panel', action: () => CS.App.togglePanel('baseColor') }
      ]
    });

    /* ---------------------------------------------------------------- *
     * Preview + shared pieces
     * ---------------------------------------------------------------- */

    const preview = el('div.bc-preview');
    /* The big swatch is the most obvious thing to grab — drag it into the
     * Favorite Colors panel to save the current colour. */
    W.makeDraggable(preview, () => Store.hex());
    preview.title = 'Drag into Favorite Colors to save';

    const previewWrap = el('div.bc-preview-wrap', {}, [preview]);

    /* ---------------------------------------------------------------- *
     * RGB tab
     * ---------------------------------------------------------------- */

    const rgbView = el('div.bc-view');

    const gradR = () => {
      const { g, b } = Store.rgb();
      return `linear-gradient(90deg, rgb(0,${g},${b}), rgb(255,${g},${b}))`;
    };
    const gradG = () => {
      const { r, b } = Store.rgb();
      return `linear-gradient(90deg, rgb(${r},0,${b}), rgb(${r},255,${b}))`;
    };
    const gradB = () => {
      const { r, g } = Store.rgb();
      return `linear-gradient(90deg, rgb(${r},${g},0), rgb(${r},${g},255))`;
    };

    const sR = W.slider({ label: 'R', min: 0, max: 255, gradient: gradR, onInput: (v, live) => setChannel('r', v, live) });
    const sG = W.slider({ label: 'G', min: 0, max: 255, gradient: gradG, onInput: (v, live) => setChannel('g', v, live) });
    const sB = W.slider({ label: 'B', min: 0, max: 255, gradient: gradB, onInput: (v, live) => setChannel('b', v, live) });

    function setChannel(ch, value, live) {
      if (syncing) return;
      const rgb = Store.rgb();
      rgb[ch] = clamp(Math.round(value), 0, 255);
      Store.setColor(rgb, { history: !live });
    }

    /* ---------------------------------------------------------------- *
     * Adjustments — pick the colour model the sliders edit
     * ---------------------------------------------------------------- */

    /* Each model pairs its channels with a round trip through CS.Color, which
     * keeps the sliders themselves generic: whatever is selected, editing a
     * channel means "read the current values, replace one, convert back to
     * RGB". Adding another space is one entry here and nothing else. */
    const ADJ_MODELS = [
      {
        id: 'hsb',
        label: 'HSB',
        channels: [
          { label: 'H', min: 0, max: 360 },
          { label: 'S', min: 0, max: 100 },
          { label: 'B', min: 0, max: 100 }
        ],
        fromRgb: (rgb) => {
          const c = Color.rgbToHsv(rgb);
          return [c.h, c.s * 100, c.v * 100];
        },
        toRgb: (v) => Color.hsvToRgb({ h: v[0], s: v[1] / 100, v: v[2] / 100 })
      },
      {
        id: 'hsl',
        label: 'HSL',
        channels: [
          { label: 'H', min: 0, max: 360 },
          { label: 'S', min: 0, max: 100 },
          { label: 'L', min: 0, max: 100 }
        ],
        fromRgb: (rgb) => {
          const c = Color.rgbToHsl(rgb);
          return [c.h, c.s * 100, c.l * 100];
        },
        toRgb: (v) => Color.hslToRgb(v[0], v[1] / 100, v[2] / 100)
      },
      {
        id: 'cmyk',
        label: 'CMYK',
        channels: [
          { label: 'C', min: 0, max: 100 },
          { label: 'M', min: 0, max: 100 },
          { label: 'Y', min: 0, max: 100 },
          { label: 'K', min: 0, max: 100 }
        ],
        fromRgb: (rgb) => {
          const c = Color.rgbToCmyk(rgb);
          return [c.c * 100, c.m * 100, c.y * 100, c.k * 100];
        },
        toRgb: (v) => Color.cmykToRgb({ c: v[0] / 100, m: v[1] / 100, y: v[2] / 100, k: v[3] / 100 })
      },
      {
        id: 'lab',
        label: 'Lab',
        channels: [
          { label: 'L', min: 0, max: 100 },
          { label: 'a', min: -128, max: 127 },
          { label: 'b', min: -128, max: 127 }
        ],
        fromRgb: (rgb) => {
          const c = Color.rgbToLab(rgb);
          return [c.L, c.a, c.b];
        },
        toRgb: (v) => Color.labToRgb({ L: v[0], a: v[1], b: v[2] })
      },
      {
        id: 'xyz',
        label: 'XYZ',
        channels: [
          { label: 'X', min: 0, max: 100, decimals: 1 },
          { label: 'Y', min: 0, max: 100, decimals: 1 },
          { label: 'Z', min: 0, max: 110, decimals: 1 }
        ],
        fromRgb: (rgb) => {
          const c = Color.rgbToXyz(rgb);
          return [c.x, c.y, c.z];
        },
        toRgb: (v) => Color.xyzToRgb({ x: v[0], y: v[1], z: v[2] })
      }
    ];

    let adjModel = ADJ_MODELS.find((m) => m.id === Store.get('adjustModel', 'hsb')) || ADJ_MODELS[0];
    let adjSliders = [];

    const adjHost = el('div.bc-adj');

    /** A channel's track shows what that channel alone does to the colour. */
    function adjGradient(values, index) {
      const ch = adjModel.channels[index];
      const stops = [];
      for (let i = 0; i <= 10; i++) {
        const probe = values.slice();
        probe[index] = ch.min + (ch.max - ch.min) * (i / 10);
        const c = adjModel.toRgb(probe);
        stops.push(`rgb(${c.r},${c.g},${c.b}) ${i * 10}%`);
      }
      return `linear-gradient(90deg, ${stops.join(', ')})`;
    }

    function setAdjChannel(index, value, live) {
      if (syncing) return;
      const values = adjModel.fromRgb(Store.rgb());
      values[index] = value;
      Store.setColor(adjModel.toRgb(values), { history: !live });
    }

    function buildAdjSliders() {
      clear(adjHost);
      adjSliders = adjModel.channels.map((ch, i) =>
        W.slider({
          label: ch.label,
          min: ch.min,
          max: ch.max,
          decimals: ch.decimals || 0,
          compact: true,
          gradient: (v) => {
            const values = adjModel.fromRgb(Store.rgb());
            values[i] = v;
            return adjGradient(values, i);
          },
          onInput: (v, live) => setAdjChannel(i, v, live)
        })
      );
      adjHost.append(...adjSliders);
      refreshAdj();
    }

    function refreshAdj() {
      const values = adjModel.fromRgb(Store.rgb());
      adjSliders.forEach((s, i) => s._slider.set(values[i]));
    }

    const adjModelSelect = W.select({
      options: ADJ_MODELS.map((m) => ({ id: m.id, label: m.label })),
      value: adjModel.id,
      width: 78,
      onChange: (id) => {
        const next = ADJ_MODELS.find((m) => m.id === id);
        if (!next) return;
        adjModel = next;
        Store.set('adjustModel', id);
        buildAdjSliders();
      }
    });

    const adjHead = el('div.bc-row.bc-adj-head', {}, [
      el('span.bc-label', { text: 'Adjustments' }),
      adjModelSelect
    ]);

    /* Arrow-key step.
     *
     * These buttons only ever set a number — the effect is on the arrow keys,
     * and nothing in the UI said so, which is why the row reads as inert. So:
     * a label that names the control, a tooltip per button, and a caption that
     * spells out exactly what the step moves. */
    const stepTitle = (n) =>
      `Arrow keys move by ${n}. Up/Down in the Hex field nudges R, G and B; ` +
      `Left/Right nudges hue. Hold Shift for ${n * 10}.`;

    const incrementRow = el('div.bc-row');
    const incrementBtns = INCREMENTS.map((n) => {
      const b = el('button.bc-inc', { type: 'button', text: String(n), title: stepTitle(n) });
      on(b, 'click', () => {
        Store.set('increment', n);
        paintIncrement();
      });
      return b;
    });

    const incrementHint = el('div.bc-hint');

    function paintIncrement() {
      const cur = Store.get('increment', 5);
      incrementBtns.forEach((b, i) => b.classList.toggle('is-active', INCREMENTS[i] === cur));
      incrementHint.title = stepTitle(cur);
      clear(incrementHint);
      incrementHint.append(
        el('kbd', { text: '↑↓' }), ' R G B · ',
        el('kbd', { text: '←→' }), ' hue · ',
        el('kbd', { text: 'Shift' }), ' ×10'
      );
    }

    incrementRow.append(el('span.bc-label', { text: 'Step:' }), ...incrementBtns);

    /* hex field — the '#' belongs to the value, so the code is accepted with
     * or without it and is always normalised back to "#RRGGBB". Anything that
     * will not parse simply reverts to the current colour: the field never
     * reports an error. (It used to call an undefined `paintHex()` and throw.) */
    const hexInput = el('input.hex-input', { type: 'text', spellcheck: 'false' });

    function commitHex() {
      const c = Color.parse(hexInput.value);
      if (c) Store.setColor(c);
      hexInput.value = Store.hexUpper();
    }

    on(hexInput, 'change', commitHex);
    on(hexInput, 'keydown', (e) => {
      if (e.key === 'Enter') {
        hexInput.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = Store.get('increment', 5) * (e.key === 'ArrowUp' ? 1 : -1);
        const rgb = Store.rgb();
        Store.setColor({ r: clamp(rgb.r + step, 0, 255), g: clamp(rgb.g + step, 0, 255), b: clamp(rgb.b + step, 0, 255) });
        hexInput.value = Store.hexUpper();
      }
    });

    const hexRow = el('div.bc-row.bc-row-hex', {}, [
      el('span.bc-label', { text: 'Hex Value:' }),
      hexInput
    ]);

    rgbView.append(
      sR,
      sG,
      sB,
      el('div.bc-sep'),
      adjHead,
      adjHost,
      el('div.bc-sep'),
      incrementRow,
      incrementHint,
      hexRow
    );

    /* ---------------------------------------------------------------- *
     * Spectrum tab
     * ---------------------------------------------------------------- */

    const spectrumView = el('div.bc-view.bc-view-spectrum');

    const square = el('canvas.bc-square');
    const hueStrip = el('canvas.bc-huestrip');

    let squareSize = { w: 165, h: 150 };
    let hueSize = { w: 165, h: 30 };
    let squareScratch = null;

    function drawSquare() {
      const ctx = square.getContext('2d', { willReadFrequently: true });
      const { w, h } = W.fitCanvas(square, ctx);
      squareSize = { w, h };

      const { h: hue } = Store.hsv();
      const pw = Math.max(1, Math.round(w));
      const ph = Math.max(1, Math.round(h));
      const img = W.imageData(ctx, pw, ph, 'bc-square');
      if (!img) return;
      const data = img.data;

      for (let y = 0; y < ph; y++) {
        const v = 1 - y / Math.max(1, ph - 1);
        for (let x = 0; x < pw; x++) {
          const s = x / Math.max(1, pw - 1);
          const c = Color.hsvToRgb({ h: hue, s, v });
          const i = (y * pw + x) * 4;
          data[i] = c.r;
          data[i + 1] = c.g;
          data[i + 2] = c.b;
          data[i + 3] = 255;
        }
      }

      // putImageData ignores the DPR transform, so writing the buffer straight
      // to the canvas leaves an unpainted strip along the right and bottom
      // edges on any display that is not at 100% scaling. Composite through an
      // offscreen canvas and blit it with drawImage, which *is* transform-aware.
      let scratch = squareScratch;
      if (!scratch) scratch = squareScratch = document.createElement('canvas');
      scratch.width = pw;
      scratch.height = ph;
      scratch.getContext('2d').putImageData(img, 0, 0);
      ctx.drawImage(scratch, 0, 0, pw, ph, 0, 0, w, h);

      // marker
      const { s, v } = Store.hsv();
      const mx = s * w;
      const my = (1 - v) * h;
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(mx, my, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawHueStrip() {
      const ctx = hueStrip.getContext('2d');
      const { w, h } = W.fitCanvas(hueStrip, ctx);
      hueSize = { w, h };

      // The gradient only fills the top of the canvas; the handle lives in the
      // strip of empty pixels underneath it so it never covers the hues.
      const barH = Math.max(8, h - 10);

      const g = ctx.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 24; i++) {
        g.addColorStop(i / 24, `hsl(${(i / 24) * 360}, 100%, 50%)`);
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, barH);

      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, Math.max(0, w - 1), Math.max(0, barH - 1));

      /* Hue handle — sits *below* the bar, apex pointing back up at it. */
      const { h: hue } = Store.hsv();
      const x = clamp((hue / 360) * w, 3, Math.max(3, w - 3));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, barH + 1);
      ctx.lineTo(x - 6, barH + 9);
      ctx.lineTo(x + 6, barH + 9);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    function spectrumPick(e, target) {
      const rect = target.getBoundingClientRect();
      if (target === square) {
        const s = clamp((e.clientX - rect.left) / Math.max(1, rect.width));
        const v = 1 - clamp((e.clientY - rect.top) / Math.max(1, rect.height));
        const hsv = Store.hsv();
        Store.setColor({ h: hsv.h, s, v }, { history: false });
      } else {
        const h = clamp((e.clientX - rect.left) / Math.max(1, rect.width)) * 360;
        const hsv = Store.hsv();
        Store.setColor({ h, s: hsv.s, v: hsv.v }, { history: false });
      }
    }

    drag(square, {
      onStart: (e) => spectrumPick(e, square),
      onMove: (e) => spectrumPick(e, square),
      onEnd: () => Store.persist()
    });
    drag(hueStrip, {
      onStart: (e) => spectrumPick(e, hueStrip),
      onMove: (e) => spectrumPick(e, hueStrip),
      onEnd: () => Store.persist()
    });

    spectrumView.append(
      el('div.bc-canvas-wrap.bc-canvas-sq', {}, [square]),
      el('div.bc-canvas-wrap.bc-canvas-hue', {}, [hueStrip]),
      el('div.bc-sep'),
      (() => {
        const wrap = el('div.bc-row');
        const field = el('input.hex-input', { type: 'text', spellcheck: 'false', maxlength: '7' });
        on(field, 'change', () => {
          const c = Color.parse(field.value);
          if (c) Store.setColor(c);
        });
        wrap.append(el('span.bc-label', { text: 'Hex:' }), field);
        field._sync = () => (field.value = Store.hexUpper());
        spectrumView._hexField = field;
        return wrap;
      })()
    );

    /* ---------------------------------------------------------------- *
     * Wheel tab — hue ring + HSV triangle
     * ---------------------------------------------------------------- */

    const wheelView = el('div.bc-view.bc-view-wheel');

    const wheelCanvas = el('canvas.bc-wheel');
    const wheelSwatch = el('div.bc-wheel-sw');
    W.makeDraggable(wheelSwatch, () => Store.hex());
    wheelSwatch.title = 'Drag into Favorite Colors to save';
    const wheelMeta = el('div.bc-wheel-meta');

    let wheelSize = { w: 240, h: 240 };
    let wheelScratch = null;

    function cssVar(name, fallback) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    }

    function wheelGeometry(w, h) {
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.max(24, Math.min(w, h) / 2 - 2);
      const ring = Math.max(8, Math.min(outer * 0.16, outer * 0.34));
      const inner = Math.max(8, outer - ring);
      return { cx, cy, outer, inner, ring };
    }

    function drawWheel() {
      const ctx = wheelCanvas.getContext('2d', { willReadFrequently: true });
      const rect = wheelCanvas.getBoundingClientRect();
      // Nothing to paint while the tab is hidden or the layout is not ready.
      if (rect.width < 20 || rect.height < 20) return;
      const { w, h } = W.fitCanvas(wheelCanvas, ctx);
      wheelSize = { w, h };

      const { cx, cy, outer, inner, ring } = wheelGeometry(w, h);
      const { h: hue, s, v } = Store.hsv();
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, w, h);

      /* hue ring — one wedge per degree, capped for speed */
      const segs = 180;
      const step = 360 / segs;
      for (let i = 0; i < segs; i++) {
        const a0 = ((i * step - 90) * Math.PI) / 180;
        const a1 = (((i + 1) * step - 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.arc(cx, cy, inner, a0, a1 + 0.004);
        ctx.arc(cx, cy, outer, a1 + 0.004, a0, true);
        ctx.closePath();
        ctx.fillStyle = `hsl(${i * step}, 88%, 52%)`;
        ctx.fill();
      }

      /* thin separators between ring and triangle */
      ctx.strokeStyle = cssVar('--line-soft', '#dcdcdc');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, outer, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      ctx.stroke();

      /* HSV triangle sitting inside the inner circle.
       * `rot` maps hue straight onto canvas angle (hue 0 = ring top),
       * so the pure-hue corner always points at the ring marker. */
      const R = Math.max(4, inner * 0.92);
      const rot = ((hue - 90) * Math.PI) / 180;
      const pt = (angleDeg, radius) => {
        const a = (angleDeg * Math.PI) / 180 + rot;
        return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
      };
      // pure hue points outward at the current hue; white and black flank it
      const pure = pt(0, R);
      const white = pt(120, R);
      const black = pt(240, R);

      // Paint the SV plane into an ImageData buffer.
      // NOTE: ctx.clip() does NOT affect putImageData, so the triangle test is
      // done per pixel — points outside the triangle stay fully transparent.
      const minX = Math.max(0, Math.floor(Math.min(pure[0], white[0], black[0])) - 1);
      const maxX = Math.min(w, Math.ceil(Math.max(pure[0], white[0], black[0])) + 1);
      const minY = Math.max(0, Math.floor(Math.min(pure[1], white[1], black[1])) - 1);
      const maxY = Math.min(h, Math.ceil(Math.max(pure[1], white[1], black[1])) + 1);
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);

      // Signed area of the pure/white/black triangle (edge-function denominator).
      const area =
        (white[0] - pure[0]) * (black[1] - pure[1]) - (black[0] - pure[0]) * (white[1] - pure[1]);
      const img = W.imageData(ctx, bw, bh, 'bc-wheel');
      if (!img) return;
      const data = img.data;
      const hueRgb = Color.hsvToRgb({ h: hue, s: 1, v: 1 });

      // Edge functions for the three half-planes, oriented by sign(area).
      const edge = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      const sgn = area >= 0 ? 1 : -1;

      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const px = minX + x + 0.5;
          const py = minY + y + 0.5;
          const i = (y * bw + x) * 4;

          // Each edge function yields the barycentric weight of the vertex
          // OPPOSITE that edge: edge(pure,white) → black, edge(white,black)
          // → pure, edge(black,pure) → white.
          const eBlackEdge = sgn * edge(pure[0], pure[1], white[0], white[1], px, py);
          const ePureEdge = sgn * edge(white[0], white[1], black[0], black[1], px, py);
          const eWhiteEdge = sgn * edge(black[0], black[1], pure[0], pure[1], px, py);

          if (eBlackEdge < 0 || ePureEdge < 0 || eWhiteEdge < 0) {
            data[i + 3] = 0; // outside the triangle
            continue;
          }

          const sum = eBlackEdge + ePureEdge + eWhiteEdge;
          if (sum <= 0) {
            data[i + 3] = 0;
            continue;
          }
          const wHue = ePureEdge / sum;
          const wWhite = eWhiteEdge / sum;
          const wBlack = eBlackEdge / sum;

          // pure hue × wHue, white × wWhite, black × wBlack
          data[i] = wWhite * 255 + wHue * hueRgb.r;
          data[i + 1] = wWhite * 255 + wHue * hueRgb.g;
          data[i + 2] = wWhite * 255 + wHue * hueRgb.b;
          data[i + 3] = 255;
        }
      }
      // Composite through an offscreen canvas so the transparent pixels
      // outside the triangle leave the ring and backdrop untouched.
      // (putImageData would overwrite them outright.)
      let scratch = wheelScratch;
      if (!scratch) {
        scratch = wheelScratch = document.createElement('canvas');
      }
      scratch.width = bw;
      scratch.height = bh;
      const sctx = scratch.getContext('2d');
      sctx.putImageData(img, 0, 0);
      ctx.drawImage(scratch, minX, minY);

      /* triangle outline */
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pure[0], pure[1]);
      ctx.lineTo(white[0], white[1]);
      ctx.lineTo(black[0], black[1]);
      ctx.closePath();
      ctx.strokeStyle = Color.isDark(Store.rgb()) ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      /* hue handle on the ring */
      const hueAngle = ((hue - 90) * Math.PI) / 180;
      const hr = (inner + outer) / 2;
      const hx = cx + Math.cos(hueAngle) * hr;
      const hy = cy + Math.sin(hueAngle) * hr;
      ctx.save();
      ctx.lineWidth = 2 * Math.min(2, dpr);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.arc(hx, hy, ring * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.min(2, dpr);
      ctx.beginPath();
      ctx.arc(hx, hy, ring * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      /* SV marker inside the triangle.
       *
       * These weights must be the exact inverse of wheelPick(). The triangle is
       * a barycentric blend of its three corners, so HSV maps onto it as
       *   pure  = v * s        (saturation grows toward the pure-hue corner)
       *   white = v * (1 - s)  (desaturating walks toward white)
       *   black = 1 - v        (darkening walks toward black)
       * which is algebraically identical to Color.hsvToRgb — that is why the
       * pixel under the marker always matches the swatch. Swapping white/black
       * here (as it used to be) sent the marker to the opposite side of the
       * triangle from the cursor. */
      const cur = Color.hsvToRgb({ h: hue, s, v });
      const wHue = v * s;
      const wWhite = v * (1 - s);
      const wBlack = 1 - v;
      const mx = wHue * pure[0] + wWhite * white[0] + wBlack * black[0];
      const my = wHue * pure[1] + wWhite * white[1] + wBlack * black[1];
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = Color.isDark(cur) ? '#ffffff' : '#111111';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = Color.isDark(cur) ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.65)';
      ctx.stroke();
      ctx.restore();
    }

    /* --- wheel interaction --- */

    function barycentric(px, py, a, b, c) {
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (!den) return null;
      const w1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
      const w2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      return [w1, w2, 1 - w1 - w2];
    }

    function wheelPick(e) {
      const rect = wheelCanvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const g = wheelGeometry(w, h);
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - g.cx;
      const dy = y - g.cy;
      const dist = Math.hypot(dx, dy);

      if (dist >= g.inner - 2) {
        /* hue ring */
        let hh = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        hh = ((hh % 360) + 360) % 360;
        const hsv = Store.hsv();
        Store.setColor({ h: hh, s: hsv.s, v: hsv.v }, { history: false });
        return;
      }

      /* inside the triangle — solve for s/v from the barycentric weights */
      const hsv = Store.hsv();
      const R = Math.max(4, g.inner * 0.92);
      const rot = ((hsv.h - 90) * Math.PI) / 180;
      const pt = (angleDeg, radius) => {
        const a = (angleDeg * Math.PI) / 180 + rot;
        return [g.cx + Math.cos(a) * radius, g.cy + Math.sin(a) * radius];
      };
      const pure = pt(0, R);
      const white = pt(120, R);
      const black = pt(240, R);

      const bc = barycentric(x, y, pure, white, black);
      if (!bc) return;

      // Drop negatives and renormalise, so a drag that strays outside the
      // triangle projects onto its edge instead of producing a nonsense colour.
      const wHue = Math.max(0, bc[0]);
      const wWhite = Math.max(0, bc[1]);
      const wBlack = Math.max(0, bc[2]);
      const sum = wHue + wWhite + wBlack;
      if (sum <= 0) return;

      const np = wHue / sum;
      const nw = wWhite / sum;
      // Exact inverse of the marker weights above: v = wPure + wWhite,
      // s = wPure / v.
      const v = clamp(np + nw, 0, 1);
      const s = v > 0 ? clamp(np / v, 0, 1) : 0;
      Store.setColor({ h: hsv.h, s, v }, { history: false });
    }

    drag(wheelCanvas, {
      onStart: (e) => wheelPick(e),
      onMove: (e) => wheelPick(e),
      onEnd: () => Store.persist()
    });

    wheelView.append(
      el('div.bc-wheel-wrap', {}, [
        el('div.bc-wheel-stage', {}, [wheelCanvas]),
        el('div.bc-wheel-readout', {}, [wheelSwatch, wheelMeta])
      ])
    );

    /* ---------------------------------------------------------------- *
     * Conversion tab — every colour space at a glance
     * ---------------------------------------------------------------- */

    const convertView = el('div.bc-view.bc-view-convert');
    const convertBody = el('div.bc-convert');

    const COPY_ICON = CS.Icons.svg('copy', 12);
    const CHECK_ICON = CS.Icons.svg('check', 12, { stroke: 2.5 });

    /* Groups replace the flat chip list that used to sit above the table. Ten
     * chips repeated the same ten names the rows already carry, and that was
     * most of the clutter. Four headers keep the "hide what I don't need"
     * control while giving the table a hierarchy to scan. */
    const CONV_GROUPS = [
      { id: 'screen', label: 'Screen', formats: ['hex', 'rgb', 'rgbPct'] },
      { id: 'print', label: 'Print', formats: ['cmy', 'cmyk'] },
      { id: 'perceptual', label: 'Perceptual', formats: ['hsl', 'hsv', 'lab'] },
      { id: 'device', label: 'Device', formats: ['xyz', 'yiq'] }
    ];
    const collapsedGroups = new Set();

    function copyText(text, btn) {
      const done = () => {
        if (!btn) return;
        btn.innerHTML = CHECK_ICON;
        btn.classList.add('is-done');
        clearTimeout(btn._t);
        btn._t = setTimeout(() => {
          btn.innerHTML = COPY_ICON;
          btn.classList.remove('is-done');
        }, 900);
      };
      if (window.cs && window.cs.clipboard) {
        window.cs.clipboard.writeText(text);
        done();
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(done, () => {});
      }
    }

    /** Format the current colour in all eight spaces, ready to render. */
    function allFormats() {
      const rgb = Store.rgb();
      const f = Color.formatAll(rgb, 4);
      return [
        { id: 'hex', label: 'HEX', text: f.hex },
        { id: 'rgb', label: 'RGB', text: f.rgb.text },
        { id: 'rgbPct', label: 'RGB %', text: f.rgbPct.text },
        { id: 'cmy', label: 'CMY', text: f.cmy.text },
        { id: 'cmyk', label: 'CMYK', text: f.cmyk.text },
        { id: 'hsl', label: 'HSL', text: f.hsl.text },
        { id: 'hsv', label: 'HSV', text: f.hsv.text },
        { id: 'xyz', label: 'XYZ', text: f.xyz.text },
        { id: 'yiq', label: 'YIQ', text: f.yiq.text },
        { id: 'lab', label: 'Lab', text: (() => { const l = Color.rgbToLab(rgb); return `lab(${Math.round(l.L * 100) / 100}, ${Math.round(l.a * 100) / 100}, ${Math.round(l.b * 100) / 100})`; })() }
      ];
    }

    const convRows = new Map();

    function renderConversions() {
      const byId = new Map(allFormats().map((f) => [f.id, f]));
      clear(convertBody);
      convRows.clear();

      CONV_GROUPS.forEach((g) => {
        const items = g.formats.map((id) => byId.get(id)).filter(Boolean);
        if (!items.length) return;

        const collapsed = collapsedGroups.has(g.id);
        const group = el('div.conv-group');
        if (collapsed) group.classList.add('is-collapsed');

        const chev = el('span.conv-group-chev', {
          html: CS.Icons.svg(collapsed ? 'chevron-right' : 'chevron-down', 13)
        });
        const head = el(
          'button.conv-group-head',
          { type: 'button', title: `Show or hide the ${g.label} formats` },
          [chev, el('span.conv-group-label', { text: g.label })]
        );
        on(head, 'click', () => {
          if (collapsedGroups.has(g.id)) collapsedGroups.delete(g.id);
          else collapsedGroups.add(g.id);
          renderConversions();
        });

        const body = el('div.conv-group-body');
        items.forEach((f) => {
          const row = el('div.conv-row');
          const tag = el('span.conv-tag', { text: f.label });

          const value = el('input.conv-value', { type: 'text', spellcheck: 'false', value: f.text });
          value.title = 'Click to select, or edit and press Enter to apply';
          on(value, 'focus', () => value.select());
          on(value, 'change', () => applyConversion(f.id, value.value));
          on(value, 'keydown', (e) => {
            if (e.key === 'Enter') {
              applyConversion(f.id, value.value);
              value.blur();
            } else if (e.key === 'Escape') {
              value.value = f.text;
              value.blur();
            }
          });

          const copy = el('button.conv-copy', { type: 'button', title: `Copy ${f.label}`, html: COPY_ICON });
          on(copy, 'click', () => copyText(f.text, copy));

          row.append(tag, value, copy);
          body.appendChild(row);
          convRows.set(f.id, { value, row, text: f.text });
        });

        group.append(head, body);
        convertBody.appendChild(group);
      });

      renderCvd();
    }

    /** Parse an edited value back into RGB where the format allows it. */
    function applyConversion(formatId, raw) {
      const text = String(raw || '').trim();
      let rgb = null;
      const nums = text.match(/-?\d*\.?\d+/g);
      const n = nums ? nums.map(Number) : [];

      switch (formatId) {
        case 'hex':
          rgb = Color.parse(text);
          break;
        case 'rgb':
          if (n.length >= 3) rgb = { r: n[0], g: n[1], b: n[2] };
          break;
        case 'rgbPct':
          if (n.length >= 3) rgb = { r: (n[0] / 100) * 255, g: (n[1] / 100) * 255, b: (n[2] / 100) * 255 };
          break;
        case 'cmy':
          if (n.length >= 3) rgb = Color.cmyToRgb({ c: n[0] / 100, m: n[1] / 100, y: n[2] / 100 });
          break;
        case 'cmyk':
          if (n.length >= 4) rgb = Color.cmykToRgb({ c: n[0] / 100, m: n[1] / 100, y: n[2] / 100, k: n[3] / 100 });
          break;
        case 'hsl':
          if (n.length >= 3) rgb = Color.hslToRgb(n[0], n[1] / 100, n[2] / 100);
          break;
        case 'hsv':
          if (n.length >= 3) rgb = Color.hsvToRgb({ h: n[0], s: n[1] / 100, v: n[2] / 100 });
          break;
        case 'xyz':
          if (n.length >= 3) rgb = Color.xyzToRgb({ x: n[0], y: n[1], z: n[2] });
          break;
        case 'yiq':
          if (n.length >= 3) rgb = Color.yiqToRgb({ y: n[0] / 100, i: n[1] / 100, q: n[2] / 100 });
          break;
        case 'lab':
          if (n.length >= 3) rgb = Color.labToRgb({ L: n[0], a: n[1], b: n[2] });
          break;
        default:
          break;
      }

      if (rgb) Store.setColor(rgb);
      else renderConversions();
    }

    /* --- colour-vision-deficiency preview strip --- */

    const cvdStrip = el('div.conv-grid');

    /* Short names for the swatch overlay; the full condition name lives in the
     * tooltip. The unmodified colour leads the list as a reference point, which
     * also makes the count eight and the two-column grid come out even. */
    const CVD_SHORT = {
      none: 'Normal',
      protanopia: 'Protanopia',
      protanomaly: 'Protanomaly',
      deuteranopia: 'Deuteranopia',
      deuteranomaly: 'Deuteranomaly',
      tritanopia: 'Tritanopia',
      tritanomaly: 'Tritanomaly',
      achromatopsia: 'Achromatopsia',
      grayscale: 'Grayscale'
    };

    function renderCvd() {
      clear(cvdStrip);
      (Color.CVD_TYPES || []).forEach((t) => {
        const sim = Color.simulateCvd(Store.rgb(), t.id);
        const hex = Color.toHexUpper(sim);
        const box = el('div.conv-cvd');
        box.style.background = Color.toHex(sim);
        box.title = `${t.id === 'none' ? 'Normal vision' : t.label} — ${hex}`;
        box.setAttribute('data-hex', hex);
        /* White ink vanishes into a pale swatch, so flip it on luminance. */
        if (Color.relativeLuminance(sim) > 0.45) box.classList.add('is-light');
        box.appendChild(el('span', { text: CVD_SHORT[t.id] || t.label }));
        on(box, 'click', () => copyText(hex));
        cvdStrip.appendChild(box);
      });
    }

    convertView.append(
      convertBody,
      el('div.bc-sep'),
      el('div.section-label', { text: 'Colour Vision Preview' }),
      cvdStrip
    );

    /* ---------------------------------------------------------------- *
     * Library tab
     * ---------------------------------------------------------------- */

    const libraryView = el('div.bc-view.bc-view-library');

    const libSelect = W.select({
      options: CS.NamedColors.LIBRARIES.map((l) => ({ id: l.id, label: l.label })),
      value: Store.get('librarySet', 'html'),
      width: '100%',
      onChange: (id) => {
        Store.set('librarySet', id);
        renderLibrary();
      }
    });

    const libList = el('div.bc-lib-list');
    const libSearch = el('input', { type: 'text', placeholder: 'Search Colors', spellcheck: 'false' });

    const libSearchField = el('div.search-field.bc-lib-search', {}, [
      (() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '11');
        svg.setAttribute('height', '11');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.innerHTML =
          '<circle cx="6.6" cy="6.6" r="4.4" fill="none" stroke="#666" stroke-width="1.6"/><path d="M10 10 L14 14" stroke="#666" stroke-width="1.8" stroke-linecap="round"/>';
        return svg;
      })(),
      libSearch
    ]);

    function renderLibrary() {
      const lib = CS.NamedColors.get(Store.get('librarySet', 'html'));
      const q = libSearch.value.trim().toLowerCase();
      const items = q
        ? lib.colors.filter((c) => c.name.toLowerCase().includes(q) || c.hex.toLowerCase().includes(q))
        : lib.colors;

      clear(libList);
      if (!items.length) {
        libList.appendChild(el('div.empty-note', { text: 'No matching colours.' }));
        return;
      }

      items.forEach((c) => {
        const row = el('button.lib-row', { type: 'button', title: `${c.name} — ${c.hex.toUpperCase()}` });
        const sw = el('span.lib-sw');
        sw.style.background = c.hex;
        row.append(sw, el('span.lib-name', { text: c.name }));
        on(row, 'click', () => Store.setColor(c));
        libList.appendChild(row);
      });
    }

    on(libSearch, 'input', renderLibrary);

    libraryView.append(libSelect, libList, libSearchField);

    /* ---------------------------------------------------------------- *
     * Assembly
     * ---------------------------------------------------------------- */

    const views = {
      wheel: wheelView,
      rgb: rgbView,
      spectrum: spectrumView,
      convert: convertView,
      library: libraryView
    };
    const stack = el('div.bc-stack', {}, [wheelView, rgbView, spectrumView, convertView, libraryView]);

    const tabHost = el('div');
    const toolsHost = el('div.panel-tabrow-tools');
    const tabRow = el('div.panel-tabrow', {}, [tabHost, toolsHost]);

    const TAB_DEFS = [
      { id: 'wheel', label: 'Wheel' },
      { id: 'rgb', label: 'RGB' },
      { id: 'spectrum', label: 'Spectrum', short: 'Spec' },
      { id: 'convert', label: 'Convert', short: 'Conv' },
      { id: 'library', label: 'Library', short: 'Lib' }
    ];

    function renderTabs() {
      clear(tabHost);
      // Narrow docks: fall back to the short label so all five tabs fit.
      const narrow = panel.body.clientWidth > 0 && panel.body.clientWidth < 215;
      lastNarrow = narrow;
      tabHost.appendChild(
        W.tabs(
          TAB_DEFS.map((t) => ({ id: t.id, label: narrow && t.short ? t.short : t.label })),
          activeTab,
          (id) => {
            activeTab = id;
            Store.set('baseTab', id);
            showTab();
          }
        )
      );
    }

    function showTab() {
      if (!views[activeTab]) activeTab = 'wheel';
      Object.keys(views).forEach((k) => views[k].classList.toggle('hidden', k !== activeTab));
      if (activeTab === 'spectrum') {
        requestAnimationFrame(() => {
          drawSquare();
          drawHueStrip();
        });
      } else if (activeTab === 'wheel') {
        requestAnimationFrame(drawWheel);
      }
    }

    panel.body.append(tabRow, previewWrap, stack);
    renderTabs();
    showTab();
    paintIncrement();
    buildAdjSliders();
    renderLibrary();
    renderConversions();

    /* ---------------------------------------------------------------- *
     * Refresh from store
     * ---------------------------------------------------------------- */

    const ro = new ResizeObserver(() => {
      // Re-label the tabs when the dock crosses the narrow threshold.
      const narrow = panel.body.clientWidth > 0 && panel.body.clientWidth < 215;
      if (narrow !== lastNarrow) {
        lastNarrow = narrow;
        renderTabs();
      }
      if (activeTab === 'spectrum') {
        drawSquare();
        drawHueStrip();
      } else if (activeTab === 'wheel') {
        drawWheel();
      }
    });
    ro.observe(square.parentElement);

    function refresh() {
      syncing = true;
      const rgb = Store.rgb();
      const hsv = Store.hsv();

      preview.style.background = Color.toHex(rgb);

      sR._slider.set(rgb.r);
      sG._slider.set(rgb.g);
      sB._slider.set(rgb.b);

      refreshAdj();

      if (document.activeElement !== hexInput) hexInput.value = Store.hexUpper();
      if (spectrumView._hexField && document.activeElement !== spectrumView._hexField) {
        spectrumView._hexField.value = Store.hexUpper();
      }

      /* wheel readout — kept to one line inside a narrow dock */
      wheelSwatch.style.background = Store.hex();
      wheelMeta.textContent = `${Store.hexUpper()} · H${Math.round(hsv.h)} S${Math.round(
        hsv.s * 100
      )} B${Math.round(hsv.v * 100)}`;
      wheelMeta.title = `Hue ${Math.round(hsv.h)}°  ·  Saturation ${Math.round(
        hsv.s * 100
      )}%  ·  Brightness ${Math.round(hsv.v * 100)}%`;

      syncing = false;

      if (activeTab === 'spectrum') {
        drawSquare();
        drawHueStrip();
      } else if (activeTab === 'wheel') {
        drawWheel();
      }

      /* conversion rows — skip the field the user is editing */
      const formats = allFormats();
      formats.forEach((f) => {
        const entry = convRows.get(f.id);
        if (entry && document.activeElement !== entry.value) entry.value.value = f.text;
      });
      renderCvd();
    }

    refresh();
    const offColor = Store.on('color', refresh);
    const offTheme = CS.Theme && CS.Theme.onChange(() => {
      if (activeTab === 'wheel') drawWheel();
      else if (activeTab === 'spectrum') {
        drawSquare();
        drawHueStrip();
      }
    });

    // keyboard: arrow keys nudge by the current increment
    on(panel.root, 'keydown', (e) => {
      const step = Store.get('increment', 5) * (e.shiftKey ? 10 : 1);
      if (e.key === 'ArrowLeft') Store.nudge(-step, 0, 0);
      else if (e.key === 'ArrowRight') Store.nudge(step, 0, 0);
    });

    return {
      root: panel.root,
      refresh,
      showTab(id) {
        if (!views[id]) return;
        activeTab = id;
        Store.set('baseTab', id);
        renderTabs();
        showTab();
      },
      destroy() {
        offColor();
        if (offTheme) offTheme();
        ro.disconnect();
      }
    };
  }

  function copyHex() {
    if (window.cs && window.cs.clipboard) window.cs.clipboard.writeText(CS.Store.hexUpper());
    CS.App.setStatus(`Copied ${CS.Store.hexUpper()} to the clipboard.`);
  }

  CS.Panels = CS.Panels || {};
  CS.Panels.BaseColor = { create };
})();

/* ==================================================================
 * Matching Colors panel
 *   tabs: Color Wheel | LiveSchemes | Mixer | Variations
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, drag, clamp, clear, wrapHue } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  const TAU = Math.PI * 2;
  const toRad = (deg) => ((deg - 90) * Math.PI) / 180;
  const toDeg = (rad) => ((rad * 180) / Math.PI + 90 + 360) % 360;

  /* Every wedge is three *flat* bands — a light step, the colour itself and a
   * dark step — not a gradient.
   *
   * The steps are a target amount of lightness, not a fixed proportion toward
   * white/black. A proportional mix reads as near-black on a light colour and
   * as an invisible step on a dark one: the app's own #1D1C18 base produced a
   * dark band only 2 L units away from the base. A target step keeps the trio
   * evenly spaced and readable whatever the base is, and caps how dark the
   * dark band is allowed to get. */
  const BAND_STEP = 18; // wanted Lab L difference, up and down
  const BAND_ROOM = 0.75; // never spend more than this much of the headroom
  const WHITE = { r: 255, g: 255, b: 255 };
  const BLACK = { r: 0, g: 0, b: 0 };
  const BANDS = 3;

  /** [light, base, dark] as flat hex strings, light nearest the hub. */
  function bandsFor(hsv) {
    const rgb = Color.hsvToRgb({ h: hsv.h, s: hsv.s, v: hsv.v });
    const L = Color.rgbToLab(rgb).L;

    // Near-white has almost no room above it and near-black almost none below,
    // so take the smaller of the target step and what is actually available.
    const up = Math.min(BAND_STEP, (100 - L) * BAND_ROOM);
    const down = Math.min(BAND_STEP, L * BAND_ROOM);

    // mix() shifts L proportionally, so convert each wanted step into its t.
    const tUp = 100 - L > 0 ? clamp(up / (100 - L)) : 0;
    const tDown = L > 0 ? clamp(down / L) : 0;

    return [
      Color.toHex(Color.mix(rgb, WHITE, tUp, 'lab')),
      Color.toHex(rgb),
      Color.toHex(Color.mix(rgb, BLACK, tDown, 'lab'))
    ];
  }

  function wedgePath(ctx, cx, cy, rIn, rOut, a0, a1) {
    ctx.beginPath();
    ctx.arc(cx, cy, rOut, a0, a1);
    ctx.arc(cx, cy, rIn, a1, a0, true);
    ctx.closePath();
  }

  function cssHsv(hsv) {
    return Color.toHex(Color.hsvToRgb(hsv));
  }

  /* ================================================================== *
   * Color Wheel
   * ================================================================== */

  function buildWheel() {
    const root = el('div.panel-fill.wheel-wrap');
    const canvas = el('canvas.wheel-canvas');
    const hub = el('div.wheel-hub');

    const hubUp = el('button.hub-arrow', {
      type: 'button',
      title: 'Previous scheme',
      html: CS.Icons.svg('chevron-up', 14)
    });
    const hubDown = el('button.hub-arrow', {
      type: 'button',
      title: 'Next scheme',
      html: CS.Icons.svg('chevron-down', 14)
    });
    const hubLabel = el('span.hub-label', { text: 'COMPLEMENTS' });
    hub.append(hubUp, hubLabel, hubDown);

    root.append(canvas, hub);

    let geom = { cx: 0, cy: 0, R: 0, rIn: 0, rOut: 0 };

    /* The base wedge is drawn 16% past the hue ring and carries a drop shadow,
     * so the visible extent is larger than R. Reserve that overshoot *plus* a
     * breathing margin, or the wheel gets clipped by the pane on short axes. */
    const WEDGE_OUT = 1.16;
    const SHADOW = 7;
    const MARGIN_FRAC = 0.055;
    const MARGIN_MIN = 14;
    const MARGIN_MAX = 34;

    /* ------------------------------------------------------------------ *
     * Rotation effect — the scheme wedges swing to their new angles when a
     * colour is picked instead of teleporting. The hue ring never moves: it is
     * the fixed reference mapping angle → hue, so rotating it would make the
     * picker lie. Only the wedges (and their spokes) lag behind.
     * ------------------------------------------------------------------ */

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const EASE_PER_FRAME = 0.2; // fraction of the remaining gap closed per 60fps frame
    const SETTLE_DEG = 0.15;

    let animHue = null; // hue currently drawn (deliberately lags)
    let targetHue = null; // hue the store actually holds
    let raf = 0;
    let lastFrame = 0;
    let hubSize = 0;

    function geometryFor(w, h) {
      const pad = clamp(Math.min(w, h) * MARGIN_FRAC, MARGIN_MIN, MARGIN_MAX);
      const R = Math.max(20, (Math.min(w, h) / 2 - pad - SHADOW) / WEDGE_OUT);
      return { cx: w / 2, cy: h / 2, R, rIn: R * 0.62, rOut: R };
    }

    /* The hue ring is static for a given size *and tone*, so rasterise it once
     * and blit it. That leaves only the wedges to redraw on each frame. */
    let ringCache = null;

    /* The ring's angle → hue mapping is fixed (that is what makes it a picker),
     * but its *tone* follows the base colour, so a near-black base no longer
     * sits next to a shouting full-brightness rainbow. Saturation and value are
     * floored because a fully black or fully grey ring would be impossible to
     * pick a hue from — the floors keep it dim but still readable. */
    function ringTone() {
      const { s, v } = Store.hsv();
      return {
        s: clamp(0.5 + s * 0.5, 0.5, 1),
        v: clamp(0.42 + v * 0.58, 0.42, 1)
      };
    }

    function ringFor(w, h, dpr, g, segs, tone) {
      const key = `${w}x${h}@${dpr}/${segs}/${Math.round(g.R * 10)}/${tone.s.toFixed(2)}/${tone.v.toFixed(2)}`;
      if (ringCache && ringCache.key === key) return ringCache.canvas;

      const c = ringCache ? ringCache.canvas : document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      const rc = c.getContext('2d');
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      rc.clearRect(0, 0, w, h);

      const { cx, cy, rIn, rOut } = g;
      // Each segment is one flat colour. A tiny angular overlap keeps
      // neighbouring flats from leaving antialiased hairline seams.
      const seam = 0.004;
      for (let i = 0; i < segs; i++) {
        const hue = (i / segs) * 360;
        const start = ((hue - 360 / segs / 2 - 90) * Math.PI) / 180;
        const end = ((hue + 360 / segs / 2 - 90) * Math.PI) / 180;

        rc.beginPath();
        rc.arc(cx, cy, rOut, start, end + seam);
        rc.arc(cx, cy, rIn, end + seam, start, true);
        rc.closePath();
        rc.fillStyle = cssHsv({ h: hue, s: tone.s, v: tone.v });
        rc.fill();
      }

      // inner ring outline
      rc.beginPath();
      rc.arc(cx, cy, rIn, 0, TAU);
      rc.strokeStyle = 'rgba(0,0,0,0.35)';
      rc.lineWidth = 1;
      rc.stroke();

      // outer ring outline
      rc.beginPath();
      rc.arc(cx, cy, rOut, 0, TAU);
      rc.strokeStyle = 'rgba(0,0,0,0.28)';
      rc.stroke();

      ringCache = { key, canvas: c };
      return c;
    }

    function sizeHub() {
      const r = geom.R || 80;
      const d = Math.max(60, r * 0.6);
      if (Math.abs(d - hubSize) < 0.5) return; // unchanged during the rotation
      hubSize = d;
      hub.style.width = `${d}px`;
      hub.style.height = `${d}px`;
      // Big enough that the ▲/▼ arrows read as controls rather than specks.
      hub.style.fontSize = `${clamp(d * 0.105, 7, 13)}px`;
    }

    function paint() {
      // Check the box BEFORE fitCanvas touches the buffer. During a window
      // resize the panel can momentarily report 0×0; fitCanvas would then
      // shrink the backing store to 1px and we'd bail, leaving the wheel
      // permanently blank because no further resize event is coming.
      // Bailing early instead keeps the last good frame on screen.
      const box = canvas.getBoundingClientRect();
      if (box.width < 20 || box.height < 20) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const { w, h, dpr } = W.fitCanvas(canvas, ctx);
      ctx.clearRect(0, 0, w, h);

      const g = geometryFor(w, h);
      geom = g;
      const { cx, cy, R } = g;

      const segs = Math.max(6, Store.get('prefs.colorWheelSegments', 24) || 24);
      const tone = ringTone();
      ctx.drawImage(ringFor(w, h, dpr, g, segs, tone), 0, 0, w, h);

      // --- scheme wedges, offset by the rotation lag ---
      const schemeId = Store.get('scheme', 'complementary');
      const colors = Color.harmony(Store.hsv(), schemeId);
      const halfAngle = ((360 / segs) * 0.78 * Math.PI) / 180;
      // Shortest signed gap, so crossing 0°/360° rotates the short way round
      // instead of flinging the wedges backwards across the whole circle.
      const lag = CS.Util.hueDelta(targetHue, animHue);

      /* Every wedge is three flat bands — light at the hub, the colour itself
       * in the middle, dark at the rim — so you can read the tint and the
       * shade of a colour without leaving the wheel.
       *
       * That only works if nothing is stacked on top of it. Same-hue schemes
       * (Shades, Tints, Tones, Monochromatic) put every wedge on one angle,
       * so the last one drawn — always the darkest — used to bury the rest
       * under a black blob. Drop those duplicates and let the bands carry the
       * whole family; draw the base wedge last so nothing can cover it. */
      const baseHue = colors[0].h;
      const visible = colors
        .map((c, index) => ({ c, index }))
        .filter((w) => w.index === 0 || Math.abs(CS.Util.hueDelta(w.c.h, baseHue)) > 0.5)
        .sort((a, b) => (a.index === 0 ? 1 : 0) - (b.index === 0 ? 1 : 0));

      function drawWedge(c, index) {
        const isBase = index === 0;
        const outer = R * (isBase ? WEDGE_OUT : 1.1);
        const inner = R * (isBase ? 0.48 : 0.54);
        const a = toRad(c.h + lag);
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const step = (outer - inner) / BANDS;
        const band = bandsFor(c);

        const bandAt = (i) => [inner + step * i, inner + step * (i + 1)];

        /* One shadowed silhouette underneath, so the bands cannot shade each
         * other — a shadow per band would smear band 2 over band 1. */
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.28)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 1;
        wedgePath(ctx, cx, cy, inner, outer, a - halfAngle, a + halfAngle);
        ctx.fillStyle = band[1];
        ctx.fill();
        ctx.restore();

        for (let i = 0; i < BANDS; i++) {
          const [r0, r1] = bandAt(i);

          wedgePath(ctx, cx, cy, r0, r1, a - halfAngle, a + halfAngle);
          ctx.fillStyle = band[i];
          ctx.fill();

          // Hard white rule between the bands — this is what makes them read
          // as three separate colours rather than one smeared ramp.
          ctx.strokeStyle = 'rgba(255,255,255,0.92)';
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }

        // spoke from hub out to the wedge
        if (!isBase) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(cx + dx * R * 0.33, cy + dy * R * 0.33);
          ctx.lineTo(cx + dx * inner * 0.98, cy + dy * inner * 0.98);
          ctx.strokeStyle = 'rgba(0,0,0,0.30)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }
      }

      visible.forEach((w) => drawWedge(w.c, w.index));

      // hub circle
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.3, 0, TAU);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.lineWidth = 1;
      ctx.stroke();

      sizeHub();
    }

    function stopAnim() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
    }

    function step(now) {
      const dt = lastFrame ? Math.min(64, now - lastFrame) : 16.67;
      lastFrame = now;

      const d = CS.Util.hueDelta(animHue, targetHue);
      // frame-rate independent exponential ease
      animHue = wrapHue(animHue + d * (1 - Math.pow(1 - EASE_PER_FRAME, dt / 16.67)));

      if (Math.abs(d) < SETTLE_DEG) {
        animHue = targetHue;
        raf = 0;
        lastFrame = 0;
        paint();
        return;
      }
      paint();
      raf = requestAnimationFrame(step);
    }

    function draw() {
      const hue = Store.hsv().h;

      // First paint, or the user asked for less motion: snap, never animate.
      if (reduceMotion || targetHue === null || animHue === null) {
        targetHue = hue;
        animHue = hue;
        stopAnim();
        paint();
        return;
      }

      targetHue = hue;
      if (animHue === targetHue) {
        stopAnim();
        paint();
        return;
      }
      if (!raf) {
        lastFrame = 0;
        raf = requestAnimationFrame(step);
      }
    }

    /* Redraw once the layout has settled. ResizeObserver can fire while the
     * pane is still collapsed, so the first pass may legitimately do nothing. */
    let settleRaf = 0;
    let settleTries = 0;

    function scheduleDraw() {
      if (settleRaf) cancelAnimationFrame(settleRaf);
      settleRaf = requestAnimationFrame(() => {
        settleRaf = 0;
        draw();
        const box = canvas.getBoundingClientRect();
        if ((box.width < 20 || box.height < 20) && settleTries < 8) {
          settleTries++;
          scheduleDraw();
        } else {
          settleTries = 0;
        }
      });
    }

    function refresh() {
      hubLabel.textContent = Color.schemeLabel(Store.get('scheme', 'complementary'));
      draw();
      sizeHub();
    }

    function cycle(dir) {
      const list = Color.SCHEMES;
      const cur = list.findIndex((s) => s.id === Store.get('scheme', 'complementary'));
      const next = list[(cur + dir + list.length) % list.length];
      Store.set('scheme', next.id);
      CS.App.setStatus(`Scheme: ${next.label}`);
      refresh();
      CS.App.refreshAll();
    }

    on(hubUp, 'click', (e) => {
      e.stopPropagation();
      cycle(-1);
    });
    on(hubDown, 'click', (e) => {
      e.stopPropagation();
      cycle(1);
    });

    /* Wedges are painted into a <canvas>, which cannot start an HTML5 drag, so
     * carrying one to Favourites uses the pointer drag instead. It only turns
     * into a drag once the cursor clears a few pixels, so a plain click still
     * just picks the colour. */
    function armColourDrag(hex, e) {
      const startX = e.clientX;
      const startY = e.clientY;
      const SLOP = 5;
      let live = true;

      const stop = () => {
        live = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      const move = (ev) => {
        if (!live) return;
        if (Math.abs(ev.clientX - startX) < SLOP && Math.abs(ev.clientY - startY) < SLOP) return;
        stop();
        W.colourDrag(hex, { x: ev.clientX, y: ev.clientY, label: hex.toUpperCase() });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    }

    /** Resolve the exact light / base / dark band under a pointer. */
    function wedgeHit(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - geom.cx;
      const y = e.clientY - rect.top - geom.cy;
      const radius = Math.hypot(x, y);
      const angle = toDeg(Math.atan2(y, x));
      const colors = Color.harmony(Store.hsv(), Store.get('scheme', 'complementary'));
      const baseHue = colors[0].h;
      const lag = targetHue === null || animHue === null ? 0 : CS.Util.hueDelta(targetHue, animHue);
      const halfAngle = (360 / (Store.get('prefs.colorWheelSegments', 24) || 24)) * 0.78;
      const visible = colors
        .map((c, index) => ({ c, index }))
        .filter((w) => w.index === 0 || Math.abs(CS.Util.hueDelta(w.c.h, baseHue)) > 0.5)
        .sort((a, b) => (a.index === 0 ? 1 : 0) - (b.index === 0 ? 1 : 0))
        .reverse();

      for (const item of visible) {
        const isBase = item.index === 0;
        const outer = geom.R * (isBase ? WEDGE_OUT : 1.1);
        const inner = geom.R * (isBase ? 0.48 : 0.54);
        if (radius < inner || radius > outer) continue;
        if (Math.abs(CS.Util.hueDelta(item.c.h + lag, angle)) > halfAngle) continue;
        const bands = bandsFor(item.c);
        const bandIndex = Math.min(BANDS - 1, Math.floor(((radius - inner) / (outer - inner)) * BANDS));
        return { ...item, bands, bandIndex, hex: bands[bandIndex] };
      }
      return null;
    }

    function addWedgeColors(colors, description) {
      let added = 0;
      colors.forEach((hex) => {
        if (Store.addFavorite(hex)) added++;
      });
      CS.App.setStatus(`Added ${added} ${description} colour${added === 1 ? '' : 's'} to Favourites.`);
    }

    // click the ring or a wedge to change the base colour
    on(canvas, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - geom.cx;
      const y = e.clientY - rect.top - geom.cy;
      const d = Math.sqrt(x * x + y * y);
      const angle = toDeg(Math.atan2(y, x));

      const base = Store.hsv();

      // did we hit a wedge?
      const hit = wedgeHit(e);
      if (hit) {
        Store.setColor(hit.c);
        armColourDrag(hit.hex, e);
        return;
      }
      if (d >= geom.rIn * 0.95) {
        const picked = { h: angle, s: base.s, v: base.v };
        Store.setColor(picked);
        armColourDrag(Color.toHex(Color.hsvToRgb(picked)), e);
      }
    });

    on(canvas, 'contextmenu', (e) => {
      const hit = wedgeHit(e);
      if (!hit) return;
      e.preventDefault();
      const point = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 };
      W.menu(point, [
        { label: 'Add All Colors', action: () => addWedgeColors(hit.bands, 'wedge') },
        { label: 'Light Color Only', action: () => addWedgeColors([hit.bands[0]], 'light') },
        { label: 'Middle Color Only', action: () => addWedgeColors([hit.bands[1]], 'middle') },
        { label: 'Dark Color Only', action: () => addWedgeColors([hit.bands[2]], 'dark') }
      ]);
    });

    return {
      root,
      refresh,
      onResize: () => {
        draw(); // immediate, so resizing feels instant
        scheduleDraw(); // and again once the layout has settled
      },
      destroy: () => {
        stopAnim();
        if (settleRaf) cancelAnimationFrame(settleRaf);
      },
      tools() {
        const sel = W.select({
          options: Color.SCHEMES.map((s) => ({ id: s.id, label: s.label })),
          value: Store.get('scheme', 'complementary'),
          width: 128,
          onChange: (id) => {
            Store.set('scheme', id);
            refresh();
            CS.App.refreshAll();
          }
        });
        sel._sync = () => (sel.value = Store.get('scheme', 'complementary'));
        return sel;
      }
    };
  }

  /* ================================================================== *
   * LiveSchemes
   * ================================================================== */

  function buildLive() {
    const root = el('div.panel-fill.live-wrap');

    const viewBar = el('div.live-viewbar');
    const canvas = el('canvas.live-canvas');
    const canvasWrap = el('div.live-canvas-wrap', {}, [canvas]);
    const footer = el('div.live-footer');

    const titleNode = el('span.live-title', { text: 'Untitled' });
    const addBtn = el('button.add-btn', { type: 'button', text: '+', title: 'Add these colours to Favourites' });
    const swatchRow = el('div.live-swatches');

    footer.append(
      el('div.live-footer-head', {}, [titleNode, el('div.spacer'), el('span.field-label', { text: 'Add' }), addBtn]),
      swatchRow
    );

    root.append(viewBar, canvasWrap, footer);

    /* --- state --- */
    let handles = [];
    let viewMode = 'wheel';
    /* Hue sitting at the middle of the strip bar. Its own state rather than a
     * read of handles[0].h — see stripT() for why. */
    let stripCentre = 0;
    let localHistory = [];
    let historyIndex = -1;

    /* --- geometry constants --------------------------------------------
     * One layout function feeds both the painting and the hit-testing, so
     * the art and the pointers can never drift apart. Margins are a
     * fraction of the short side with a floor and a ceiling: the old fixed
     * `- 16` / `pad = 12` values jammed the art against the pane edges as
     * soon as the panel got short, and left the wide axis lopsided.
     *
     * Strip view: how much of the hue circle the bar spans, how many arrows
     * the scheme may hold, and the arrow's own geometry — the grab zone is
     * deliberately larger than the head so a marker can be caught without a
     * pixel-perfect click, but small enough that a click meant for the bar
     * underneath still falls through to the bar. */
    const MARGIN_FRAC = 0.09;
    const MARGIN_MIN = 16;
    const MARGIN_MAX = 44;
    const STRIP_GAP = 10;
    const STRIP_SPAN = 120;
    const MAX_HANDLES = 8;
    const MARKER_HALF = 6;
    const MARKER_RISE = 10;
    const MARKER_GRAB = 11;
    const MARKER_GRAB_UP = 24;
    const MARKER_GRAB_DOWN = 6;

    function resetFromStore() {
      const base = Store.hsv();
      const schemeId = Store.get('scheme', 'complementary');
      const colors = Color.harmony(base, schemeId).slice(0, 3);
      while (colors.length < 3) colors.push(Object.assign({}, colors[0]));
      /* Handle 0 *is* the base colour — refresh() enforces that on every
       * colour change, so build it that way from the start. In a scheme whose
       * base entry is not first (analogous, for one) the panel otherwise opens
       * with the wrong swatch labelled "(base)" and, in strip view, an arrow
       * parked away from the middle of the bar. */
      const at = colors.findIndex((c) => Math.abs(CS.Util.hueDelta(base.h, c.h)) < 0.001);
      if (at > 0) colors.unshift(colors.splice(at, 1)[0]);
      handles = colors;
      stripCentre = handles[0].h;
      localHistory = [snapshot()];
      historyIndex = 0;
    }

    function snapshot() {
      return handles.map((c) => ({ h: c.h, s: c.s, v: c.v }));
    }

    function pushLocal() {
      localHistory = localHistory.slice(0, historyIndex + 1);
      localHistory.push(snapshot());
      if (localHistory.length > 40) localHistory.shift();
      historyIndex = localHistory.length - 1;
      paintBar();
    }

    function restoreLocal(i) {
      const snap = localHistory[i];
      if (!snap) return;
      handles = snap.map((c) => Object.assign({}, c));
      historyIndex = i;
      Store.setColor(handles[0]);
      paintBar();
      draw();
      paintSwatches();
    }

    /* --- view bar --- */
    const undoBtn = el('button.icon-btn', { type: 'button', title: 'Undo', html: icon('undo') });
    const redoBtn = el('button.icon-btn', { type: 'button', title: 'Redo', html: icon('redo') });
    const viewBtns = [
      { id: 'wheel', title: 'Wheel view', svg: icon('wheel') },
      { id: 'square', title: 'Square view', svg: icon('square') },
      { id: 'strip', title: 'Strip view', svg: icon('strip') }
    ].map((v) => {
      const b = el('button.icon-btn', { type: 'button', title: v.title, html: v.svg });
      on(b, 'click', () => {
        viewMode = v.id;
        hoverIndex = -1;
        canvas.style.cursor = '';
        /* Entering the strip — or clicking its button again — starts a window
         * centred on the base colour, so the bar is never left showing a stale
         * slice of the wheel from an earlier session. */
        if (v.id === 'strip') stripCentre = Store.hsv().h;
        paintBar();
        draw();
      });
      return Object.assign(b, { _id: v.id });
    });

    /* How many arrows the scheme holds. The stepper is the one place the count
     * is set; addHandle() / truncation keep it in sync through paintBar(). */
    const countStepper = W.stepper({
      label: 'Markers',
      value: 3,
      min: 1,
      max: MAX_HANDLES,
      compact: true,
      onChange: setHandleCount
    });

    const refreshBtn = el('button.icon-btn', { type: 'button', title: 'Rebuild from base colour', html: icon('refresh') });
    on(refreshBtn, 'click', () => {
      resetFromStore();
      Store.setColor(handles[0]);
      paintBar();
      draw();
      paintSwatches();
    });

    on(undoBtn, 'click', () => restoreLocal(Math.max(0, historyIndex - 1)));
    on(redoBtn, 'click', () => restoreLocal(Math.min(localHistory.length - 1, historyIndex + 1)));
    on(addBtn, 'click', () => {
      let n = 0;
      handles.forEach((c) => {
        if (Store.addFavorite(cssHsv(c))) n++;
      });
      CS.App.setStatus(`Added ${n} colour${n === 1 ? '' : 's'} to Favourites.`);
    });

    viewBar.append(
      el('span.field-label', { text: 'View:' }),
      undoBtn,
      redoBtn,
      el('div.toolbar-sep'),
      ...viewBtns,
      el('div.toolbar-sep'),
      countStepper,
      el('div.spacer'),
      refreshBtn
    );

    function paintBar() {
      undoBtn.disabled = historyIndex <= 0;
      redoBtn.disabled = historyIndex >= localHistory.length - 1;
      viewBtns.forEach((b) => b.classList.toggle('is-active', b._id === viewMode));
      // Silent: a stepper that fired onChange here would re-enter setHandleCount.
      countStepper._stepper.set(handles.length);
    }

    /* --- geometry ------------------------------------------------------ */

    function marginFor(w, h) {
      return clamp(Math.min(w, h) * MARGIN_FRAC, MARGIN_MIN, MARGIN_MAX);
    }

    /** Where the wheel / square / strip actually sit inside a w×h pane. */
    function liveLayout(w, h, mode) {
      const m = marginFor(w, h);

      if (mode === 'strip') {
        const barH = Math.min(70, Math.max(12, h - m * 2));
        return { pad: m, barH, y: (h - barH) / 2 };
      }

      if (mode === 'wheel') {
        // Leave room for the handle rings (r = 8 + a 2px stroke) to sit on
        // the rim without touching the edge.
        const R = Math.max(20, Math.min(w, h) / 2 - m);
        return { cx: w / 2, cy: h / 2, R };
      }

      // Square view: a true square (not a stretched rect) with the hue
      // strip tucked underneath, the whole group centred in the pane.
      const stripH = clamp(Math.min(w, h) * 0.05, 12, 20);
      const side = Math.floor(
        Math.max(20, Math.min(w - m * 2, h - m * 2 - STRIP_GAP - stripH))
      );
      const top = (h - (side + STRIP_GAP + stripH)) / 2;
      const left = (w - side) / 2;
      return {
        left,
        top,
        side,
        stripH,
        stripGap: STRIP_GAP,
        stripY: top + side + STRIP_GAP
      };
    }

    /* --- strip view: hue bar + draggable arrows -----------------------
     *
     * The bar shows a STRIP_SPAN-degree slice of the hue circle and its
     * centre, `stripCentre`, is state of its own — deliberately *not* read
     * back from handles[0].h.
     *
     * Anchoring the bar to the base hue makes the base arrow impossible to
     * drag: the arrow's position is derived from the bar, so the moment the
     * bar re-centres on the base the arrow snaps back to the middle and the
     * gradient slides out from under the pointer instead of following it.
     * Freezing the window for the duration of a drag is the only mapping in
     * which the arrow tracks the cursor exactly and the colour under it is
     * the colour it becomes. The window catches up with the base whenever the
     * base changes from anywhere else (refresh()), and re-starts centred on
     * it when the strip view is entered. */
    function stripT(c) {
      return clamp(0.5 + CS.Util.hueDelta(stripCentre, c.h) / STRIP_SPAN);
    }

    function stripX(t, w, L) {
      return L.pad + t * (w - L.pad * 2);
    }

    function stripTAt(x, w, L) {
      return clamp((x - L.pad) / Math.max(1, w - L.pad * 2));
    }

    function stripHueAt(t) {
      return wrapHue(stripCentre + (t - 0.5) * STRIP_SPAN);
    }

    /** Index of the arrow under (x, y), or -1. Heads win over the bar. */
    function stripHit(x, y, w, h) {
      const L = liveLayout(w, h, 'strip');
      if (y < L.y - MARKER_GRAB_UP || y > L.y + MARKER_GRAB_DOWN) return -1;
      let best = -1;
      let bestD = Infinity;
      handles.forEach((c, i) => {
        const d = Math.abs(x - stripX(stripT(c), w, L));
        if (d <= MARKER_GRAB && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    }

    /* New arrows land in the widest empty stretch of the bar, so raising the
     * count spreads the set out instead of stacking everything on the base. */
    function addHandle() {
      const base = handles[0];
      const marks = [0, 1].concat(handles.slice(1).map(stripT)).sort((a, b) => a - b);
      let best = 0.5;
      let bestGap = -1;
      for (let i = 1; i < marks.length; i++) {
        const gap = marks[i] - marks[i - 1];
        if (gap > bestGap) {
          bestGap = gap;
          best = (marks[i] + marks[i - 1]) / 2;
        }
      }
      handles.push({ h: stripHueAt(best), s: base.s, v: base.v });
    }

    /** Grow or shrink the scheme to exactly `n` arrows. */
    function setHandleCount(n) {
      const want = Math.round(clamp(n, 1, MAX_HANDLES));
      if (want > handles.length) {
        while (handles.length < want) addHandle();
      } else if (want < handles.length) {
        handles.length = want;
        if (dragIndex >= want) dragIndex = -1;
        if (hoverIndex >= want) hoverIndex = -1;
      } else {
        paintBar();
        return;
      }
      paintBar();
      draw();
      paintSwatches();
      pushLocal();
    }

    /* SV space ↔ pane coordinates. Both directions live here so a marker is
     * always exactly where a click at the same spot would put it. */
    function squarePoint(c, L) {
      const span = Math.max(1, L.side - 1);
      return { x: L.left + c.s * span, y: L.top + (1 - c.v) * span };
    }

    function squareValue(x, y, L) {
      const span = Math.max(1, L.side - 1);
      return {
        s: clamp((x - L.left) / span),
        v: 1 - clamp((y - L.top) / span)
      };
    }

    /* --- drawing --- */

    /* `putImageData` ignores the current transform, so a buffer built in CSS
     * pixels lands in the top-left corner of a device-pixel backing store:
     * at 125% scaling the gradient came out at 80% size, jammed into the
     * corner of an outline drawn at the correct size, with a marker sitting
     * outside the colour field it belonged to. Blit through an offscreen
     * canvas instead — `drawImage` *does* honour the transform. */
    let scratch = null;

    function blit(ctx, img, x, y) {
      const iw = Math.max(1, img.width);
      const ih = Math.max(1, img.height);
      if (!scratch) scratch = document.createElement('canvas');
      if (scratch.width !== iw || scratch.height !== ih) {
        scratch.width = iw;
        scratch.height = ih;
      }
      const sctx = scratch.getContext('2d');
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.putImageData(img, 0, 0);
      ctx.drawImage(scratch, x, y, iw, ih);
    }

    function draw() {
      // Bail before fitCanvas touches the buffer: a transient 0×0 layout
      // would shrink the backing store to 1px and blank the pane.
      const box = canvas.getBoundingClientRect();
      if (box.width < 20 || box.height < 20) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const { w, h } = W.fitCanvas(canvas, ctx);
      ctx.clearRect(0, 0, w, h);

      if (viewMode === 'strip') return drawStrip(ctx, w, h);

      const L = liveLayout(w, h, viewMode);

      if (viewMode === 'wheel') {
        // HSV disc: angle = hue, radius = saturation, centre = white.
        // Only the disc's bounding box is rasterised, so the buffer stays
        // small and the centre lands on the pane centre exactly.
        const { cx, cy, R } = L;
        const size = Math.max(1, Math.round(R * 2));
        const img = W.imageData(ctx, size, size, 'live-wheel');
        if (!img) return;
        const data = img.data;
        const mid = size / 2;
        for (let y = 0; y < size; y++) {
          const dy = y + 0.5 - mid;
          for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - mid;
            const d = Math.sqrt(dx * dx + dy * dy);
            const i = (y * size + x) * 4;
            if (d > R) {
              data[i + 3] = 0;
              continue;
            }
            const hue = toDeg(Math.atan2(dy, dx));
            const sat = clamp(d / R);
            const c = Color.hsvToRgb({ h: hue, s: sat, v: 1 });
            const edge = clamp((R - d) / 1.2);
            data[i] = c.r;
            data[i + 1] = c.g;
            data[i + 2] = c.b;
            data[i + 3] = Math.round(255 * edge);
          }
        }
        blit(ctx, img, cx - size / 2, cy - size / 2);
        drawHandles(ctx, cx, cy, R, false);
      } else {
        // SV square at the base hue, with a hue strip below.
        const hue = handles[0].h;
        const { left, top, side, stripH, stripY } = L;

        const size = Math.max(1, Math.round(side));
        const img = W.imageData(ctx, size, size, 'live-square');
        if (!img) return;
        const data = img.data;
        for (let y = 0; y < size; y++) {
          const v = 1 - y / Math.max(1, size - 1);
          for (let x = 0; x < size; x++) {
            const s = x / Math.max(1, size - 1);
            const c = Color.hsvToRgb({ h: hue, s, v });
            const i = (y * size + x) * 4;
            data[i] = c.r;
            data[i + 1] = c.g;
            data[i + 2] = c.b;
            data[i + 3] = 255;
          }
        }
        blit(ctx, img, left, top);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, side - 1, side - 1);

        const g = ctx.createLinearGradient(left, 0, left + side, 0);
        for (let i = 0; i <= 24; i++) g.addColorStop(i / 24, `hsl(${(i / 24) * 360},100%,50%)`);
        ctx.fillStyle = g;
        ctx.fillRect(left, stripY, side, stripH);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.strokeRect(left + 0.5, stripY + 0.5, side - 1, stripH - 1);

        // handles as dots on the square
        handles.forEach((c, i) => {
          const p = squarePoint(c, L);
          marker(ctx, p.x, p.y, i === 0);
        });
      }
    }

    function drawHandles(ctx, cx, cy, R, square) {
      void square;
      const pts = handles.map((c) => ({
        x: cx + Math.cos(toRad(c.h)) * c.s * R,
        y: cy + Math.sin(toRad(c.h)) * c.s * R
      }));

      ctx.save();
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(20,20,20,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      pts.forEach((p, i) => marker(ctx, p.x, p.y, i === 0));
    }

    function marker(ctx, x, y, isBase) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, isBase ? 8 : 7, 0, TAU);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, isBase ? 6 : 5, 0, TAU);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    function drawStrip(ctx, w, h) {
      const base = handles[0];
      const L = liveLayout(w, h, 'strip');
      const { pad, barH, y } = L;
      const barW = w - pad * 2;

      const grad = ctx.createLinearGradient(pad, 0, pad + barW, 0);
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        grad.addColorStop(t, cssHsv({ h: stripHueAt(t), s: base.s, v: base.v }));
      }
      ctx.fillStyle = grad;
      ctx.fillRect(pad, y, barW, barH);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pad + 0.5, y + 0.5, barW - 1, barH - 1);

      const active = dragIndex >= 0 ? dragIndex : hoverIndex;

      handles.forEach((c, i) => {
        const x = stripX(stripT(c), w, L);
        const isActive = i === active;

        /* With several arrows in play the head alone is ambiguous, so the one
         * under the pointer drops a rule down the bar to show which colour it
         * is reporting. Two tones, because one of them disappears against
         * either a light or a dark bar. */
        if (isActive) {
          ctx.save();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.beginPath();
          ctx.moveTo(x + 0.5, y);
          ctx.lineTo(x + 0.5, y + barH);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath();
          ctx.moveTo(x + 1.5, y);
          ctx.lineTo(x + 1.5, y + barH);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x - MARKER_HALF, y - MARKER_RISE);
        ctx.lineTo(x + MARKER_HALF, y - MARKER_RISE);
        ctx.closePath();
        ctx.fillStyle = isActive ? '#d6e6f7' : '#ffffff';
        ctx.strokeStyle = i === 0 ? '#111111' : '#666666';
        ctx.lineWidth = isActive ? 2 : 1.5;
        ctx.lineJoin = 'round';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    /* --- handle dragging --- */
    let dragIndex = -1;
    let hoverIndex = -1;

    /** Cursor + highlight feedback; only the strip has hoverable arrows. */
    function updateHover(x, y, rect) {
      if (viewMode !== 'strip') {
        if (hoverIndex === -1) return;
        hoverIndex = -1;
        canvas.style.cursor = '';
        return;
      }
      const hit = stripHit(x, y, rect.width, rect.height);
      if (hit === hoverIndex) return;
      hoverIndex = hit;
      canvas.style.cursor = hit >= 0 ? 'grab' : '';
      draw();
    }

    on(canvas, 'pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (viewMode === 'strip') {
        // An arrow wins over the bar: grabbing one must never also move the
        // base colour, or the bar would jump the moment a drag starts.
        const hit = stripHit(x, y, rect.width, rect.height);
        if (hit >= 0) {
          dragIndex = hit;
          hoverIndex = hit;
          canvas.setPointerCapture(e.pointerId);
          canvas.style.cursor = 'grabbing';
          draw();
          return;
        }
        const L = liveLayout(rect.width, rect.height, 'strip');
        const t = stripTAt(x, rect.width, L);
        handles[0] = { h: stripHueAt(t), s: handles[0].s, v: handles[0].v };
        Store.setColor(handles[0], { history: false });
        draw();
        paintSwatches();
        return;
      }

      const L = liveLayout(rect.width, rect.height, viewMode);
      let best = -1;
      let bestD = 18;
      handles.forEach((c, i) => {
        let p;
        if (viewMode === 'wheel') {
          p = { x: L.cx + Math.cos(toRad(c.h)) * c.s * L.R, y: L.cy + Math.sin(toRad(c.h)) * c.s * L.R };
        } else {
          p = squarePoint(c, L);
        }
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });

      if (best < 0) {
        // clicking empty space adds a new handle
        if (handles.length < MAX_HANDLES && viewMode === 'wheel') {
          const dx = x - L.cx;
          const dy = y - L.cy;
          const d = Math.hypot(dx, dy);
          if (d <= L.R) {
            handles.push({ h: toDeg(Math.atan2(dy, dx)), s: clamp(d / L.R), v: 1 });
            dragIndex = handles.length - 1;
            pushLocal();
            draw();
            paintSwatches();
          }
        }
        return;
      }

      dragIndex = best;
      canvas.setPointerCapture(e.pointerId);
    });

    on(canvas, 'pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (dragIndex < 0) {
        updateHover(x, y, rect);
        return;
      }

      const L = liveLayout(rect.width, rect.height, viewMode);

      if (viewMode === 'strip') {
        const c = handles[dragIndex];
        handles[dragIndex] = { h: stripHueAt(stripTAt(x, rect.width, L)), s: c.s, v: c.v };
        if (dragIndex === 0) Store.setColor(handles[0], { history: false });
        draw();
        paintSwatches();
        return;
      }

      if (viewMode === 'wheel') {
        const dx = x - L.cx;
        const dy = y - L.cy;
        const d = Math.hypot(dx, dy);
        handles[dragIndex] = {
          h: toDeg(Math.atan2(dy, dx)),
          s: clamp(d / L.R),
          v: handles[dragIndex].v
        };
      } else {
        const sv = squareValue(x, y, L);
        handles[dragIndex] = { h: handles[0].h, s: sv.s, v: sv.v };
      }

      if (dragIndex === 0) Store.setColor(handles[0], { history: false });
      draw();
      paintSwatches();
    });

    on(canvas, 'pointerup', (e) => {
      if (dragIndex >= 0) {
        pushLocal();
        Store.persist();
        dragIndex = -1;
        canvas.style.cursor = hoverIndex >= 0 ? 'grab' : '';
        draw();
      }
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    });

    on(canvas, 'pointerleave', () => {
      if (dragIndex >= 0 || hoverIndex === -1) return;
      hoverIndex = -1;
      canvas.style.cursor = '';
      draw();
    });

    function paintSwatches() {
      clear(swatchRow);
      handles.forEach((c, i) => {
        const hex = cssHsv(c);
        const node = el('div.live-swatch');
        const chipEl = W.chip(hex, {
          width: 58,
          height: 36,
          draggable: true,
          title: `${hex}${i === 0 ? ' (base)' : ''}`,
          onPick: () => {
            Store.setColor(c);
            CS.App.setStatus(`Base colour set to ${hex}.`);
          }
        });
        node.append(chipEl, el('span.live-swatch-label', { text: hex }));
        swatchRow.appendChild(node);
      });
    }

    resetFromStore();
    paintBar();
    paintSwatches();
    requestAnimationFrame(draw);

    return {
      root,
      refresh() {
        // keep handle 0 locked to the base colour when it changes elsewhere
        const base = Store.hsv();
        if (handles.length) {
          handles[0] = { h: base.h, s: base.s, v: base.v };
          /* The strip window only follows the base when the colour came from
           * outside the strip. A drag always leaves the base inside the
           * window, so this can never fight the pointer mid-drag. */
          if (Math.abs(CS.Util.hueDelta(stripCentre, base.h)) > STRIP_SPAN / 2 + 0.001) {
            stripCentre = base.h;
          }
          draw();
          paintSwatches();
        }
      },
      rebuild() {
        resetFromStore();
        paintBar();
        draw();
        paintSwatches();
      },
      onResize: draw
    };
  }

  /* ================================================================== *
   * Mixer
   * ================================================================== */

  function buildMixer() {
    const root = el('div.panel-fill.mixer-wrap');

    const head = el('div.mixer-head');
    const gridWrap = el('div.mixer-grid-wrap');
    const grid = el('div.mixer-grid');
    gridWrap.appendChild(grid);

    const chipA = el('div.mixer-chip');
    const chipB = el('div.mixer-chip');
    const arrow = el('div.mixer-arrow', { html: CS.Icons.svg('arrow-right', 16) });

    const pathSelect = W.select({
      options: Color.MIX_SPACES.map((s) => ({ id: s.id, label: s.label })),
      value: Store.get('mixSpace', 'lab'),
      width: 92,
      onChange: (v) => {
        Store.set('mixSpace', v);
        render();
      }
    });

    const stepsStepper = W.stepper({
      value: Store.get('mixSteps', 12),
      min: 2,
      max: 40,
      label: 'Steps:',
      onChange: (v) => {
        Store.set('mixSteps', v);
        render();
      }
    });

    const addAll = el('button.add-btn', { type: 'button', text: '+', title: 'Add all mixes to Favourites' });
    on(addAll, 'click', () => {
      let n = 0;
      allMixes().forEach((c) => {
        if (Store.addFavorite(c)) n++;
      });
      CS.App.setStatus(`Added ${n} mixed colour${n === 1 ? '' : 's'} to Favourites.`);
    });

    head.append(
      chipA,
      arrow,
      chipB,
      el('div.spacer'),
      el('span.field-label', { text: 'Path:' }),
      pathSelect,
      stepsStepper,
      addAll
    );

    function openPicker(which) {
      const current = which === 'a' ? Store.get('mixFrom') : Store.get('mixTo');
      const content = el('div', {}, [
        el('div.form-hint', { text: `Choose the ${which === 'a' ? 'start' : 'end'} colour.` }),
        el('div', { style: { marginTop: '8px' } }, [
          (() => {
            const f = el('input', { type: 'text', value: Color.toHexUpper(current) });
            f.style.width = '110px';
            f.style.fontFamily = 'var(--mono)';
            return f;
          })()
        ])
      ]);
      const field = content.querySelector('input');
      const dlg = W.dialog({
        title: 'Mixer Colour',
        width: 320,
        content,
        buttons: [
          { label: 'Cancel', value: null },
          {
            label: 'Use Current Base',
            value: 'base'
          },
          { label: 'OK', value: 'ok', primary: true }
        ],
        onClose: (v) => {
          if (v === 'base') {
            setMix(which, Store.rgb());
          } else if (v === 'ok') {
            const c = Color.parse(field.value);
            if (c) setMix(which, c);
          }
        }
      });
      void dlg;
    }

    function setMix(which, rgb) {
      Store.set(which === 'a' ? 'mixFrom' : 'mixTo', rgb);
      render();
    }

    on(chipA, 'click', () => openPicker('a'));
    on(chipB, 'click', () => openPicker('b'));

    const ROWS = 5;
    /* Upper bound on a single mix swatch, in CSS px. */
    const MIX_CELL = 34;

    function allMixes() {
      const a = Store.get('mixFrom');
      const b = Store.get('mixTo');
      const space = Store.get('mixSpace', 'lab');
      const steps = Store.get('mixSteps', 12);
      const out = [];
      for (let r = 0; r < ROWS; r++) {
        const tint = (r / (ROWS - 1)) * 0.55;
        for (let c = 0; c < steps; c++) {
          const mixed = Color.mix(a, b, steps === 1 ? 0 : c / (steps - 1), space);
          out.push(Color.mix(mixed, { r: 255, g: 255, b: 255 }, tint, 'rgb'));
        }
      }
      return out;
    }

    function render() {
      const a = Store.get('mixFrom');
      const b = Store.get('mixTo');
      chipA.style.background = Color.toHex(a);
      chipB.style.background = Color.toHex(b);
      chipA.title = Color.toHexUpper(a);
      chipB.title = Color.toHexUpper(b);
      pathSelect.value = Store.get('mixSpace', 'lab');
      stepsStepper._stepper.set(Store.get('mixSteps', 12));

      const steps = Store.get('mixSteps', 12);
      /* `minmax(0, Npx)` rather than `1fr`: the swatches keep a readable size
       * in a wide pane, and shrink (down to 0) rather than overflow when the
       * pane is narrow. The wrap centres the result. */
      grid.style.gridTemplateColumns = `repeat(${steps}, minmax(0, ${MIX_CELL}px))`;
      clear(grid);

      allMixes().forEach((c) => {
        const hex = Color.toHex(c);
        const sw = el('div.mx-sw');
        sw.style.background = hex;
        sw.title = hex.toUpperCase();
        on(sw, 'click', () => Store.setColor(c));
        on(sw, 'contextmenu', (e) => {
          e.preventDefault();
          Store.addFavorite(hex);
          CS.App.setStatus(`Added ${hex.toUpperCase()} to Favourites.`);
        });
        W.dropZone(sw, () => {});
        grid.appendChild(sw);
      });
    }

    render();

    root.append(head, gridWrap);

    return { root, refresh: render, onResize: () => {} };
  }

  /* ================================================================== *
   * Variations
   * ================================================================== */

  const VARIATION_MODES = [
    { id: 'hue-saturation', label: 'Hue / Saturation' },
    { id: 'hue-brightness', label: 'Hue / Brightness' },
    { id: 'saturation-brightness', label: 'Saturation / Brightness' },
    { id: 'tint-shade', label: 'Tint / Shade' },
    { id: 'hue-only', label: 'Hue Only' },
    { id: 'lightness', label: 'Lightness Ladder' }
  ];

  function buildVariations() {
    const root = el('div.panel-fill.variations-wrap');

    const head = el('div.variations-head');
    const gridWrap = el('div.variations-grid-wrap');
    const grid = el('div.variations-grid');
    gridWrap.appendChild(grid);

    const modeSelect = W.select({
      options: VARIATION_MODES,
      value: Store.get('variationMode', 'hue-saturation'),
      width: 150,
      onChange: (v) => {
        Store.set('variationMode', v);
        render();
      }
    });

    const intensity = W.stepper({
      value: Store.get('variationIntensity', 50),
      min: 1,
      max: 100,
      label: 'Intensity:',
      onChange: (v) => {
        Store.set('variationIntensity', v);
        render();
      }
    });

    head.append(modeSelect, el('div.spacer'), intensity);

    const COLS = 16;
    const ROWS = 10;

    function compute() {
      const base = Store.hsv();
      const mode = Store.get('variationMode', 'hue-saturation');
      const k = Store.get('variationIntensity', 50) / 100;
      const out = [];

      for (let r = 0; r < ROWS; r++) {
        const row = [];
        const ty = ROWS === 1 ? 0 : (r / (ROWS - 1)) * 2 - 1; // -1..1
        for (let c = 0; c < COLS; c++) {
          const tx = COLS === 1 ? 0 : (c / (COLS - 1)) * 2 - 1; // -1..1
          let hsv;

          switch (mode) {
            case 'hue-brightness':
              hsv = { h: base.h + tx * 180 * k, s: base.s, v: clamp(base.v + ty * 0.5 * k) };
              break;
            case 'saturation-brightness':
              hsv = { h: base.h, s: clamp(base.s + tx * 0.9 * k), v: clamp(base.v + ty * 0.5 * k) };
              break;
            case 'tint-shade':
              hsv = { h: base.h, s: base.s, v: base.v };
              if (tx >= 0) hsv = Color.rgbToHsv(Color.mix(Color.hsvToRgb(hsv), { r: 255, g: 255, b: 255 }, tx * k, 'lab'));
              else hsv = Color.rgbToHsv(Color.mix(Color.hsvToRgb(hsv), { r: 0, g: 0, b: 0 }, -tx * k, 'lab'));
              if (ty < 0) hsv.s = clamp(hsv.s * (1 + ty * 0.3 * k));
              break;
            case 'hue-only':
              hsv = { h: base.h + tx * 180 * k, s: base.s, v: clamp(base.v + ty * 0.25 * k) };
              break;
            case 'lightness':
              hsv = { h: base.h + tx * 30 * k, s: clamp(base.s + ty * 0.35 * k), v: base.v };
              break;
            case 'hue-saturation':
            default:
              hsv = { h: base.h + tx * 180 * k, s: clamp(base.s + ty * 0.35 * k), v: base.v };
              break;
          }
          row.push(Color.hsvToRgb(hsv));
        }
        out.push(row);
      }
      return out;
    }

    function render() {
      modeSelect.value = Store.get('variationMode', 'hue-saturation');
      intensity._stepper.set(Store.get('variationIntensity', 50));

      const cells = compute();
      grid.style.gridTemplateColumns = `repeat(${COLS}, minmax(0, 1fr))`;
      clear(grid);

      cells.forEach((row) => {
        row.forEach((c) => {
          const hex = Color.toHex(c);
          const sw = el('div.vr-sw');
          sw.style.background = hex;
          sw.title = hex.toUpperCase();
          on(sw, 'click', () => Store.setColor(c));
          on(sw, 'contextmenu', (e) => {
            e.preventDefault();
            Store.addFavorite(hex);
            CS.App.setStatus(`Added ${hex.toUpperCase()} to Favourites.`);
          });
          grid.appendChild(sw);
        });
      });
    }

    render();

    root.append(head, gridWrap);

    return { root, refresh: render, onResize: () => {} };
  }

  /* ================================================================== *
   * Panel factory
   * ================================================================== */

  function create() {
    let activeTab = Store.get('matchingTab', 'wheel');

    const panel = W.panel('Matching Colors', {
      onMenu: () => [
        {
          label: 'Randomize Base Colour',
          action: () => Store.setColor(Color.randomRgb())
        },
        { separator: true },
        { label: 'Copy Scheme as Hex List', action: () => copyScheme() },
        { label: 'Add Scheme to Favourites', action: () => addSchemeToFavorites() },
        { separator: true },
        { label: 'Close Panel', action: () => CS.App.togglePanel('matching') }
      ]
    });

    const views = {
      wheel: buildWheel(),
      live: buildLive(),
      mixer: buildMixer(),
      variations: buildVariations()
    };

    const stack = el('div.matching-stack', {}, Object.keys(views).map((k) => views[k].root));

    const tabHost = el('div');
    const toolsHost = el('div.panel-tabrow-tools');
    const tabRow = el('div.panel-tabrow', {}, [tabHost, toolsHost]);

    let wheelSelect = null;

    function renderTabs() {
      clear(tabHost);
      tabHost.appendChild(
        W.tabs(
          [
            { id: 'wheel', label: 'Color Wheel' },
            { id: 'live', label: 'LiveSchemes' },
            { id: 'mixer', label: 'Mixer' },
            { id: 'variations', label: 'Variations' }
          ],
          activeTab,
          (id) => {
            activeTab = id;
            Store.set('matchingTab', id);
            showTab();
          }
        )
      );

      clear(toolsHost);
      if (activeTab === 'wheel') {
        if (!wheelSelect) wheelSelect = views.wheel.tools();
        toolsHost.appendChild(wheelSelect);
        if (wheelSelect._sync) wheelSelect._sync();
      }
    }

    function showTab() {
      Object.keys(views).forEach((k) => views[k].root.classList.toggle('hidden', k !== activeTab));
      renderTabs();
      requestAnimationFrame(() => {
        const v = views[activeTab];
        if (v.refresh) v.refresh();
        if (v.onResize) v.onResize();
      });
    }

    panel.body.append(tabRow, stack);
    renderTabs();
    showTab();
    refresh();

    const ro = new ResizeObserver(() => {
      const v = views[activeTab];
      if (v && v.onResize) v.onResize();
    });
    ro.observe(stack);

    function refresh() {
      if (wheelSelect && wheelSelect._sync) wheelSelect._sync();
      const v = views[activeTab];
      if (v && v.refresh) v.refresh();
    }

    function refreshAll() {
      Object.keys(views).forEach((k) => {
        if (views[k].refresh) views[k].refresh();
      });
      if (wheelSelect && wheelSelect._sync) wheelSelect._sync();
    }

    const offColor = Store.on('color', refresh);
    const offState = Store.on('state', (e) => {
      if (e && e.key === 'scheme' && views.live.rebuild) views.live.rebuild();
    });

    return {
      root: panel.root,
      refresh,
      refreshAll,
      showTab(id) {
        activeTab = id;
        showTab();
      },
      destroy() {
        offColor();
        offState();
        Object.keys(views).forEach((k) => {
          if (views[k].destroy) views[k].destroy();
        });
        ro.disconnect();
      }
    };
  }

  function copyScheme() {
    const colors = Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary'));
    const text = colors.map((c) => Color.toHexUpper(c)).join(', ');
    if (window.cs && window.cs.clipboard) window.cs.clipboard.writeText(text);
    CS.App.setStatus(`Copied scheme: ${text}`);
  }

  function addSchemeToFavorites() {
    let n = 0;
    Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary')).forEach((c) => {
      if (Store.addFavorite(c)) n++;
    });
    CS.App.setStatus(`Added ${n} scheme colour${n === 1 ? '' : 's'} to Favourites.`);
  }

  /* ------------------------------------------------------------------ *
   * Icons — the shared Lucide set (js/ui/icons.js)
   * ------------------------------------------------------------------ */

  const VIEW_ICONS = {
    undo: 'undo-2',
    redo: 'redo-2',
    wheel: 'circle-dot',
    square: 'square',
    strip: 'align-horizontal-justify-start',
    refresh: 'refresh-cw'
  };

  function icon(name) {
    return CS.Icons.svg(VIEW_ICONS[name] || name, 14);
  }

  CS.Panels = CS.Panels || {};
  CS.Panels.Matching = { create };
})();

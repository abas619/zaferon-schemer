/* ==================================================================
 * Central application state + tiny pub/sub.
 * The base colour is kept in HSV so repeated edits never drift.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const Color = CS.Color;

  const STORAGE_KEY = 'zaferon-scheme/state/v1';
  /* Pre-rename key. Read once, and only for favourites + preferences — see load(). */
  const STORAGE_KEY_LEGACY = 'colorschemer-studio/state/v1';

  /* Saffron (زعفران) — what the app opens on the very first run. After that the
   * saved baseHsv wins, so a returning user gets their last chosen colour. */
  const FIRST_RUN_HEX = '#F4C430';

  const DEFAULTS = {
    /* colour */
    baseHsv: Color.rgbToHsv(Color.parse(FIRST_RUN_HEX)),

    /* which panel/tab is showing */
    document: 'matching', // matching | gallery | photo | builder | browser
    baseTab: 'rgb', // wheel | rgb | spectrum | library | convert
    matchingTab: 'wheel', // wheel | live | mixer | variations
    scheme: 'complementary',
    adjustModel: 'hsb', // hsb | hsl | cmyk | lab | xyz — the Base Color "Adjustments" sliders

    /* appearance */
    theme: 'light', // light | dark

    /* mixer */
    mixFrom: Color.parse('#4F86C6'),
    mixTo: Color.parse('#D96A4A'),
    mixSpace: 'lab',
    mixSteps: 12,

    /* variations */
    variationMode: 'hue-saturation',
    variationIntensity: 50,

    /* photo */
    photoColors: 5,
    photoEffect: 'none', // none | mosaic | pixelate | blur | grayscale | sepia | invert | posterize | vignette
    photoMosaic: false, // legacy boolean, read once to seed photoEffect

    /* adjustments */
    increment: 5,
    websafeMode: false,
    cvd: 'none',

    /* library */
    librarySet: 'html',

    /* preferences */
    prefs: {
      previewSize: 'medium',
      showStatusHints: true,
      colorWheelSegments: 36,
      autoCopyHex: true,
      confirmOnClear: true,
      contrastFormat: 'wcag' // last format chosen in the conversion view
    },

    /* colour history (toolbar back / forward) */
    history: [],
    historyIndex: -1,

    favorites: [],
    paletteSet: 'default'
  };

  /* ------------------------------------------------------------------ */

  const listeners = new Map();

  const state = {
    _raw: null,
    _suppress: 0
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * Coerce anything colour-ish into a lowercase "#rrggbb" string.
   *
   * `favorites` and `history` are string arrays as far as the rest of the app
   * is concerned — panels call `.toUpperCase()` / `.toLowerCase()` on the
   * entries directly. They must therefore never hold the {r,g,b} objects that
   * `Color.parse` returns.
   */
  function normaliseHexList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach((c) => {
      const parsed = Color.parse(c);
      if (parsed) out.push(Color.toHex(parsed));
    });
    return out;
  }

  function readKey(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  let migratedFromLegacy = false;

  /**
   * First launch under the new name falls back to the legacy key — but only for
   * the state the user actually invested in.
   *
   * The base colour is deliberately NOT carried over: the first run of the
   * renamed app is meant to open on saffron, and copying the old base across
   * would silently defeat that. History goes with it, so `historyIndex` can
   * never end up pointing at a colour that is not the current base.
   */
  function load() {
    const saved = readKey(STORAGE_KEY);
    const legacy = saved ? null : readKey(STORAGE_KEY_LEGACY);

    const merged = Object.assign(clone(DEFAULTS), saved || {});
    if (legacy) {
      merged.favorites = legacy.favorites || [];
      merged.prefs = legacy.prefs || {};
      migratedFromLegacy = true;
    }
    merged.prefs = Object.assign(clone(DEFAULTS.prefs), merged.prefs || {});

    // Normalise colours that may have been serialised oddly.
    merged.baseHsv = normaliseHsv(merged.baseHsv) || clone(DEFAULTS.baseHsv);
    merged.mixFrom = Color.parse(merged.mixFrom) || clone(DEFAULTS.mixFrom);
    merged.mixTo = Color.parse(merged.mixTo) || clone(DEFAULTS.mixTo);
    // These two are string lists, NOT colour objects — see normaliseHexList.
    merged.favorites = normaliseHexList(merged.favorites);
    merged.history = normaliseHexList(merged.history);

    state._raw = merged;
    return merged;
  }

  function normaliseHsv(h) {
    if (!h || typeof h !== 'object') return null;
    if (typeof h.h !== 'number' || typeof h.s !== 'number' || typeof h.v !== 'number') return null;
    if (!isFinite(h.h) || !isFinite(h.s) || !isFinite(h.v)) return null;
    return { h: ((h.h % 360) + 360) % 360, s: Math.min(1, Math.max(0, h.s)), v: Math.min(1, Math.max(0, h.v)) };
  }

  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state._raw));
      } catch (_) {
        /* quota — ignore */
      }
    }, 250);
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
  }

  function emit(event, payload) {
    if (state._suppress > 0) return;
    const set = listeners.get(event);
    if (set) set.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[store] listener for "${event}" failed`, err);
      }
    });
    const all = listeners.get('*');
    if (all) all.forEach((fn) => fn(event, payload));
  }

  function batch(fn) {
    state._suppress++;
    try {
      fn();
    } finally {
      state._suppress--;
    }
  }

  /* ------------------------------------------------------------------ *
   * Colour accessors
   * ------------------------------------------------------------------ */

  function hsv() {
    return Object.assign({}, state._raw.baseHsv);
  }

  function rgb() {
    return Color.hsvToRgb(state._raw.baseHsv);
  }

  function hex() {
    return Color.toHex(rgb());
  }

  function hexUpper() {
    return Color.toHexUpper(rgb());
  }

  /* ------------------------------------------------------------------ *
   * History (back / forward through edited colours)
   * ------------------------------------------------------------------ */

  const HISTORY_LIMIT = 80;

  function pushHistory(hsvValue) {
    const hexValue = Color.toHex(Color.hsvToRgb(hsvValue));
    const h = state._raw.history;
    // truncate the redo tail
    if (state._raw.historyIndex < h.length - 1) h.length = state._raw.historyIndex + 1;
    if (h[h.length - 1] === hexValue) return;
    h.push(hexValue);
    if (h.length > HISTORY_LIMIT) h.shift();
    state._raw.historyIndex = h.length - 1;
  }

  function canGoBack() {
    return state._raw.historyIndex > 0;
  }

  function canGoForward() {
    return state._raw.historyIndex < state._raw.history.length - 1;
  }

  function goBack() {
    if (!canGoBack()) return false;
    state._raw.historyIndex--;
    const c = Color.parse(state._raw.history[state._raw.historyIndex]);
    if (!c) return false;
    state._raw.baseHsv = Color.rgbToHsv(c);
    emit('color', hex());
    emit('history');
    persist();
    return true;
  }

  function goForward() {
    if (!canGoForward()) return false;
    state._raw.historyIndex++;
    const c = Color.parse(state._raw.history[state._raw.historyIndex]);
    if (!c) return false;
    state._raw.baseHsv = Color.rgbToHsv(c);
    emit('color', hex());
    emit('history');
    persist();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Mutations
   * ------------------------------------------------------------------ */

  /**
   * setColor('#ff0000') | setColor({r,g,b}) | setColor({h,s,v})
   */
  function setColor(input, opts = {}) {
    let next = null;

    if (input && typeof input === 'object' && 'h' in input && 's' in input && 'v' in input) {
      next = { h: input.h, s: input.s, v: input.v };
    } else {
      const rgbValue = Color.parse(input);
      if (!rgbValue) return false;
      next = Color.rgbToHsv(rgbValue);
    }

    next.h = ((next.h % 360) + 360) % 360;
    next.s = Math.min(1, Math.max(0, next.s));
    next.v = Math.min(1, Math.max(0, next.v));

    const before = hex();
    state._raw.baseHsv = next;
    const after = hex();

    if (before !== after) {
      if (opts.history !== false) pushHistory(next);
      emit('color', after);
      emit('history');
      persist();
    } else {
      emit('color', after);
    }
    return true;
  }

  function nudge(dh, ds, dv) {
    const h = hsv();
    return setColor({ h: h.h + (dh || 0), s: h.s + (ds || 0), v: h.v + (dv || 0) });
  }

  function set(key, value) {
    const parts = key.split('.');
    let target = state._raw;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof target[parts[i]] !== 'object' || target[parts[i]] === null) target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
    emit('state', { key, value });
    emit('state:' + key, value);
    persist();
  }

  function get(key, fallback) {
    const parts = key.split('.');
    let target = state._raw;
    for (const p of parts) {
      if (target == null || typeof target !== 'object') return fallback;
      target = target[p];
    }
    return target === undefined ? fallback : target;
  }

  /* ------------------------------------------------------------------ *
   * Favourites
   * ------------------------------------------------------------------ */

  /**
   * The favourites list, guaranteed to be lowercase "#rrggbb" strings.
   *
   * Repairs in place if anything ever put non-strings in there — a list that
   * holds {r,g,b} objects makes every panel that calls `.toUpperCase()` on an
   * entry throw, which is exactly how the dock went blank.
   */
  function favoritesList() {
    const list = state._raw.favorites;
    if (!Array.isArray(list)) {
      state._raw.favorites = [];
    } else if (list.some((c) => typeof c !== 'string')) {
      state._raw.favorites = normaliseHexList(list);
    }
    return state._raw.favorites;
  }

  function addFavorite(color) {
    const c = Color.parse(color);
    if (!c) return false;
    const h = Color.toHex(c);
    const list = favoritesList();
    if (list.includes(h)) return false;
    list.unshift(h);
    if (list.length > 200) list.length = 200;
    emit('favorites', list.slice());
    persist();
    return true;
  }

  function removeFavorite(color) {
    const c = Color.parse(color);
    if (!c) return false;
    const h = Color.toHex(c);
    const list = favoritesList();
    const i = list.indexOf(h);
    if (i < 0) return false;
    list.splice(i, 1);
    emit('favorites', list.slice());
    persist();
    return true;
  }

  function clearFavorites() {
    state._raw.favorites = [];
    emit('favorites', []);
    persist();
  }

  function reorderFavorites(from, to) {
    const list = favoritesList();
    if (from < 0 || from >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, item);
    emit('favorites', list.slice());
    persist();
  }

  /** Unparseable entries are dropped rather than flattened to black. */
  function setFavorites(list) {
    state._raw.favorites = normaliseHexList(list);
    emit('favorites', state._raw.favorites.slice());
    persist();
  }

  /* ------------------------------------------------------------------ *
   * Reset
   * ------------------------------------------------------------------ */

  function reset() {
    state._raw = clone(DEFAULTS);
    emit('color', hex());
    emit('favorites', []);
    emit('state', { key: '*' });
    persist();
  }

  /* ------------------------------------------------------------------ */

  state._raw = load();
  if (state._raw.history.length === 0) pushHistory(state._raw.baseHsv);
  /* Write the migrated state under the new key immediately, so the legacy key is
   * read exactly once and every later launch is a plain load. */
  if (migratedFromLegacy) persist();

  CS.Store = {
    state: state._raw,
    on,
    emit,
    batch,
    hsv,
    rgb,
    hex,
    hexUpper,
    setColor,
    nudge,
    set,
    get,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    addFavorite,
    removeFavorite,
    clearFavorites,
    reorderFavorites,
    setFavorites,
    reset,
    persist
  };
})();

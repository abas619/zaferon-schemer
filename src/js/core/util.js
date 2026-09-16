/* Small DOM / math helpers shared by every module. */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});

  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

  const lerp = (a, b, t) => a + (b - a) * t;

  const round = (v, p = 0) => {
    const f = Math.pow(10, p);
    return Math.round(v * f) / f;
  };

  /** Wrap a hue into [0, 360). */
  const wrapHue = (h) => ((h % 360) + 360) % 360;

  /** Shortest signed distance from a to b in degrees. */
  const hueDelta = (a, b) => {
    let d = wrapHue(b) - wrapHue(a);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };

  /* ---------------------------- DOM ---------------------------- */

  /**
   * el('div.panel', { title: 'x' }, [child, 'text'])
   */
  function el(spec, attrs, children) {
    let tag = 'div';
    let classes = [];
    let id = '';

    const m = String(spec).match(/^([a-zA-Z0-9-]*)((?:[.#][^.#]+)*)$/);
    if (m) {
      if (m[1]) tag = m[1];
      const rest = m[2] || '';
      rest.split(/(?=[.#])/).forEach((part) => {
        if (!part) return;
        if (part[0] === '.') classes.push(part.slice(1));
        else if (part[0] === '#') id = part.slice(1);
      });
    } else {
      tag = spec;
    }

    const node = document.createElement(tag);
    if (id) node.id = id;
    if (classes.length) node.className = classes.join(' ');

    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !(attrs instanceof Node)) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') {
          node.className = (node.className ? node.className + ' ' : '') + v;
        } else if (k === 'style' && typeof v === 'object') {
          Object.assign(node.style, v);
        } else if (k === 'dataset' && typeof v === 'object') {
          Object.assign(node.dataset, v);
        } else if (k === 'text') {
          node.textContent = v;
        } else if (k === 'html') {
          node.innerHTML = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'value') {
          node.value = v;
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, v);
        }
      });
    } else if (attrs != null) {
      children = attrs;
    }

    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children == null) return node;
    const list = Array.isArray(children) ? children : [children];
    list.forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    return () => target.removeEventListener(type, handler, opts);
  }

  /** Pointer drag helper. Returns a disposer. */
  function drag(target, { onStart, onMove, onEnd } = {}) {
    const down = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      if (onStart) onStart(e, start);

      const move = (ev) => {
        if (onMove) onMove(ev, start);
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (onEnd) onEnd(ev, start);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    target.addEventListener('pointerdown', down);
    return () => target.removeEventListener('pointerdown', down);
  }

  /* --------------------------- misc --------------------------- */

  function throttle(fn, ms = 60) {
    let last = 0;
    let timer = null;
    let lastArgs = null;
    return function (...args) {
      const now = performance.now();
      lastArgs = args;
      if (now - last >= ms) {
        last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = performance.now();
          fn.apply(this, lastArgs);
        }, ms - (now - last));
      }
    };
  }

  function debounce(fn, ms = 150) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  const uid = (() => {
    let n = 0;
    return (prefix = 'id') => `${prefix}-${++n}`;
  })();

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Format a number with a fixed number of decimals, no trailing zeros. */
  function num(v, p = 0) {
    if (!isFinite(v)) return '0';
    return String(round(v, p));
  }

  CS.Util = {
    clamp,
    clamp255,
    lerp,
    round,
    wrapHue,
    hueDelta,
    el,
    append,
    qs,
    qsa,
    clear,
    on,
    drag,
    throttle,
    debounce,
    uid,
    escapeHtml,
    num
  };
})();

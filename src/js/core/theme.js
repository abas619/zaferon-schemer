/* ==================================================================
 * Theme controller — light / dark, persisted on the store.
 * Applies `data-theme` on <html> and re-renders canvas widgets that
 * bake theme colours into their pixels (wheel, spectrum, gradients).
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const Store = CS.Store;

  const THEMES = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' }
  ];

  let current = 'light';
  const listeners = new Set();

  function apply(theme) {
    const next = THEMES.some((t) => t.id === theme) ? theme : 'light';
    const changed = next !== current;
    current = next;

    document.documentElement.setAttribute('data-theme', next);
    // Give the window chrome (Electron titlebar) the matching base colour.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#1e1f22' : '#f0f0f0');

    if (changed) listeners.forEach((fn) => {
      try {
        fn(next);
      } catch (err) {
        console.error('[theme] listener failed', err);
      }
    });
    return next;
  }

  function init() {
    apply(Store.get('theme', 'light'));
    // React to programmatic changes (menu item, settings, etc.)
    Store.on('state:theme', (value) => apply(value));
    // Follow the OS preference only when the user has never chosen one.
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (!Store.get('theme', null) && mq.matches) apply('dark');
    }
  }

  /** Set + persist + apply. */
  function set(theme) {
    Store.set('theme', theme);
    return apply(theme);
  }

  function toggle() {
    return set(current === 'dark' ? 'light' : 'dark');
  }

  /** Subscribe to theme changes; returns an unsubscriber. */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** True when a dark theme is active — handy inside canvas painters. */
  function isDark() {
    return current === 'dark';
  }

  CS.Theme = { THEMES, init, set, toggle, onChange, isDark, get current() { return current; } };
})();

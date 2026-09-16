/* ==================================================================
 * Color Palette panel — the swatch grid docked under Matching Colors.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, clear } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  function create() {
    const sub = W.subPanel('Color Palette', {
      onMenu: () => CS.Palettes.SETS.map((s) => ({
        label: s.label,
        checked: Store.get('paletteSet', 'default') === s.id,
        action: () => {
          Store.set('paletteSet', s.id);
          render();
        }
      })).concat([
        { separator: true },
        { label: 'Copy Whole Palette', action: copyAll },
        { label: 'Add Palette to Favourites', action: addAll },
        { separator: true },
        { label: 'Hide Panel', action: () => CS.App.togglePalette(false) }
      ])
    });

    const grid = el('div.palette-grid');
    sub.body.appendChild(grid);

    let cells = [];

    function render() {
      const setId = Store.get('paletteSet', 'default');
      const rows = CS.Palettes.build(setId);
      clear(grid);
      cells = [];

      const cols = rows.reduce((m, r) => Math.max(m, r.length), 1);
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

      rows.forEach((row) => {
        row.forEach((hex) => {
          const sw = el('div.pal-sw');
          sw.style.background = hex;
          sw.title = `${hex.toUpperCase()} — click to use, drag to Favourites`;
          sw.dataset.hex = hex;
          on(sw, 'click', () => Store.setColor(hex));
          on(sw, 'contextmenu', (e) => {
            e.preventDefault();
            Store.addFavorite(hex);
            CS.App.setStatus(`Added ${hex.toUpperCase()} to Favourites.`);
          });
          W.makeDraggable(sw, hex);
          W.dropZone(sw, () => {});
          grid.appendChild(sw);
          cells.push(sw);
        });
      });

      highlight();
    }

    function highlight() {
      const cur = Store.hex();
      cells.forEach((c) => c.classList.toggle('is-current', c.dataset.hex.toLowerCase() === cur));
    }

    function copyAll() {
      const rows = CS.Palettes.build(Store.get('paletteSet', 'default'));
      const text = rows.map((r) => r.map((h) => h.toUpperCase()).join(' ')).join('\n');
      if (window.cs && window.cs.clipboard) window.cs.clipboard.writeText(text);
      CS.App.setStatus('Palette copied to the clipboard.');
    }

    function addAll() {
      const rows = CS.Palettes.build(Store.get('paletteSet', 'default'));
      let n = 0;
      rows.forEach((r) => r.forEach((h) => {
        if (Store.addFavorite(h)) n++;
      }));
      CS.App.setStatus(`Added ${n} colours to Favourites.`);
    }

    render();
    const offColor = Store.on('color', highlight);

    return {
      root: sub.root,
      refresh: highlight,
      destroy: offColor
    };
  }

  CS.Panels = CS.Panels || {};
  CS.Panels.Palette = { create };
})();

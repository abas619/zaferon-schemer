/* ==================================================================
 * Favorite Colors panel — a dockable palette of saved colours.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, clear } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  /* Lucide, stroked with currentColor so both themes follow along. */
  const FAV_ICON = {
    add: CS.Icons.svg('plus', 13, { stroke: 2.25 }),
    clear: CS.Icons.svg('trash-2', 13)
  };

  function create() {
    let viewMode = Store.get('favoriteView', 'grid');
    if (!['grid', 'compact', 'list'].includes(viewMode)) viewMode = 'grid';

    const panel = W.panel('Favorite Colors', {
      menuAlign: 'end',
      onMenu: () => [
        { label: 'Add Current Colour', action: () => { Store.addFavorite(Store.hex()); CS.App.setStatus(`Added ${Store.hexUpper()}.`); } },
        { label: 'Add Scheme', action: () => addScheme() },
        { separator: true },
        { label: 'Copy All as Hex', action: copyAll },
        { label: 'Export Palette…', action: () => CS.App.exportPalette() },
        { label: 'Import Palette…', action: () => CS.App.importPalette() },
        { separator: true },
        { label: 'Clear Favourites', action: clearAll }
      ]
    });

    const body = el('div.fav-body');

    /* --- actions ------------------------------------------------------
     * Add-to-favourites and clear used to live in the status bar, far from
     * the colours they act on. They belong here, at the top of the panel,
     * and stay visible in both the empty and the filled state. */
    const addBtn = el('button.btn.btn-mini.fav-action-btn', {
      type: 'button',
      title: 'Add current colour to Favourites  (Ctrl+D)',
      html: `${FAV_ICON.add}<span>Add current</span>`
    });
    const clearBtn = el('button.btn.btn-mini.fav-action-btn.fav-action-clear', {
      type: 'button',
      title: 'Clear Favourites',
      html: `${FAV_ICON.clear}<span>Clear</span>`
    });

    on(addBtn, 'click', () => {
      if (Store.addFavorite(Store.hex())) CS.App.setStatus(`Added ${Store.hexUpper()} to Favourites.`);
      else CS.App.setStatus(`${Store.hexUpper()} is already in Favourites.`);
    });
    on(clearBtn, 'click', clearAll);

    const actions = el('div.fav-actions', {}, [addBtn, clearBtn]);
    const viewButtons = ['grid', 'compact', 'list'].map((mode) => {
      const icon = mode === 'grid' ? 'layout-grid' : mode === 'compact' ? 'grid-3x3' : 'list';
      const label = mode === 'grid' ? 'Grid view' : mode === 'compact' ? 'Compact view' : 'List view';
      const button = el('button.view-mode-btn', {
        type: 'button',
        title: label,
        html: CS.Icons.svg(icon, 13)
      });
      button.dataset.view = mode;
      button.setAttribute('aria-label', label);
      on(button, 'click', () => {
        if (viewMode === mode) return;
        viewMode = mode;
        Store.set('favoriteView', mode);
        updateViewButtons();
        render();
      });
      return button;
    });
    const viewBar = el('div.view-mode-bar', {}, [
      el('span.view-mode-label', { text: 'View' }),
      el('div.view-mode-switcher', { role: 'group', 'aria-label': 'Favorite color view' }, viewButtons)
    ]);

    function updateViewButtons() {
      viewButtons.forEach((button) => {
        const active = button.dataset.view === viewMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    updateViewButtons();
    panel.body.append(actions, viewBar, body);

    /* --- drop handling ------------------------------------------------
     * Two mechanisms land here: native HTML5 drags (favourite chips, palette
     * cells, the base-colour preview) and the pointer drag that the canvas
     * color wheel has to use, since an HTML5 drag cannot start from a canvas.
     * Both must behave identically. */
    function acceptDrop(hex) {
      if (Store.addFavorite(hex)) CS.App.setStatus(`Added ${hex.toUpperCase()} to Favourites.`);
      else CS.App.setStatus(`${hex.toUpperCase()} is already in Favourites.`);
    }

    /* The whole scrolling body is one stable drop target. Registering the
     * transient empty note / grid left most of the visible panel as dead space
     * and leaked pointer-drop registrations every time render() replaced it. */
    W.dropZone(body, acceptDrop);
    const offColourDrop = W.colourDropZone(body, acceptDrop);

    /* --- empty state --- */
    function buildEmpty() {
      const note = el('div.drop-note.fav-drop', {
        text: 'Drag & drop colors here to add to your Favorite Colors'
      });
      return note;
    }

    /* --- filled state --- */
    let dragFrom = -1;

    function buildGrid(list) {
      const grid = el('div.fav-grid');
      grid.classList.add({ grid: 'view-grid', compact: 'view-compact', list: 'view-list' }[viewMode]);

      list.forEach((hex, index) => {
        const node = W.chip(hex, {
          size: '100%',
          draggable: true,
          removable: true,
          title: `${hex.toUpperCase()} — click to use, drag to Mixer or reorder`,
          onPick: () => Store.setColor(hex),
          onRemove: () => {
            Store.removeFavorite(hex);
            CS.App.setStatus(`Removed ${hex.toUpperCase()}.`);
          },
          onContext: (h, e) => {
            W.menu(e.target, [
              { label: 'Use as Base Colour', action: () => Store.setColor(h) },
              { label: 'Copy Hex', action: () => window.cs.clipboard.writeText(h.toUpperCase()) },
              {
                label: 'Make Web Safe',
                action: () => {
                  const w = Color.toWebsafe(Color.parse(h));
                  Store.setColor(w);
                }
              },
              { separator: true },
              { label: 'Remove', action: () => Store.removeFavorite(h) }
            ]);
          }
        });

        node.classList.add('fav-chip');
        node.dataset.index = String(index);

        on(node, 'dragstart', () => {
          dragFrom = index;
        });
        on(node, 'dragover', (e) => {
          if (dragFrom < 0) return;
          e.preventDefault();
          node.classList.add('is-drop-target');
        });
        on(node, 'dragleave', () => node.classList.remove('is-drop-target'));
        on(node, 'drop', (e) => {
          node.classList.remove('is-drop-target');
          if (dragFrom < 0) return;
          e.preventDefault();
          e.stopPropagation();
          Store.reorderFavorites(dragFrom, index);
          dragFrom = -1;
        });
        on(node, 'dragend', () => {
          dragFrom = -1;
        });

        const item = el('div.fav-item', {}, [
          node,
          el('span.fav-item-label', { text: hex.toUpperCase() })
        ]);
        grid.appendChild(item);
      });

      return grid;
    }

    /* --- actions --- */
    function addScheme() {
      let n = 0;
      Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary')).forEach((c) => {
        if (Store.addFavorite(c)) n++;
      });
      CS.App.setStatus(`Added ${n} scheme colour${n === 1 ? '' : 's'}.`);
    }

    function copyAll() {
      const text = Store.state.favorites.map((h) => h.toUpperCase()).join(', ');
      window.cs.clipboard.writeText(text);
      CS.App.setStatus('Favourite colours copied to the clipboard.');
    }

    function clearAll() {
      if (!Store.state.favorites.length) return;
      const go = () => {
        Store.clearFavorites();
        CS.App.setStatus('Favourites cleared.');
      };
      if (!Store.get('prefs.confirmOnClear', true)) return go();
      W.dialog({
        title: 'Clear Favourites',
        width: 340,
        content: el('div', { text: `Remove all ${Store.state.favorites.length} saved colours? This cannot be undone.` }),
        buttons: [
          { label: 'Cancel', value: null },
          { label: 'Clear', value: 'ok', primary: true }
        ],
        onClose: (v) => {
          if (v === 'ok') go();
        }
      });
    }

    /* --- render --- */
    function render() {
      /* Never trust the shape of persisted state. A non-string entry reaching
       * `hex.toUpperCase()` below used to throw straight out of boot() and
       * blank every dock that had not been built yet. */
      const list = (Store.state.favorites || [])
        .map((c) => Color.parse(c))
        .filter(Boolean)
        .map((c) => Color.toHex(c));
      clearBtn.disabled = list.length === 0;
      clear(body);
      if (!list.length) body.appendChild(buildEmpty());
      else body.appendChild(buildGrid(list));
    }

    render();
    const off = Store.on('favorites', render);

    return {
      root: panel.root,
      refresh: render,
      destroy() {
        off();
        offColourDrop();
      }
    };
  }

  CS.Panels = CS.Panels || {};
  CS.Panels.Favorites = { create };
})();

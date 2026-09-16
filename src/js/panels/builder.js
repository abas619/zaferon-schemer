/* ==================================================================
 * SchemeBuilder + SchemeBrowser documents (Tools menu).
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { el, on, clear } = CS.Util;
  const Color = CS.Color;
  const Store = CS.Store;
  const W = CS.Widgets;

  /* ================================================================== *
   * SchemeBuilder — assemble a custom scheme from harmony suggestions.
   * ================================================================== */

  function createBuilder() {
    let working = [];

    const panel = W.panel('SchemeBuilder', {
      onClose: () => CS.App.closeDocument('builder'),
      onMenu: () => [
        { label: 'Clear Working Scheme', action: () => { working = []; render(); } },
        { label: 'Load Current Harmony', action: loadHarmony },
        { separator: true },
        { label: 'Add to Favourites', action: addAll },
        { label: 'Export Scheme…', action: () => CS.App.exportPalette(working) },
        { separator: true },
        { label: 'Open Matching Colors', action: () => CS.App.openDocument('matching') }
      ]
    });

    const scroll = el('div.panel-scroll');
    const baseRow = el('div.builder-base');
    const suggestions = el('div.builder-suggestions');
    const workArea = el('div.builder-work');

    scroll.append(
      el('div.builder-section', {}, [el('div.builder-section-title', { text: 'Base Colour' }), baseRow]),
      el('div.builder-section', {}, [
        el('div.builder-section-title', { text: 'Harmony Suggestions — click to add' }),
        suggestions
      ]),
      el('div.builder-section', {}, [
        el('div.builder-section-title', { text: 'Your Scheme' }),
        workArea
      ])
    );
    panel.body.appendChild(scroll);

    function loadHarmony() {
      working = Color.harmonyRgb(Store.hsv(), Store.get('scheme', 'complementary'));
      render();
    }

    function addAll() {
      let n = 0;
      working.forEach((c) => {
        if (Store.addFavorite(c)) n++;
      });
      CS.App.setStatus(`Added ${n} colour${n === 1 ? '' : 's'} to Favourites.`);
    }

    function renderBase() {
      clear(baseRow);
      const hex = Store.hex();
      const chipEl = W.chip(hex, {
        size: 54,
        draggable: true,
        label: hex.toUpperCase(),
        onPick: () => Store.setColor(hex)
      });
      baseRow.append(
        chipEl,
        el('div.builder-base-meta', {}, [
          el('div', { text: `Hex  ${hex.toUpperCase()}` }),
          el('div', { text: `RGB  ${Store.rgb().r}, ${Store.rgb().g}, ${Store.rgb().b}` }),
          el('div', { text: `HSL  ${Color.toCssHsl(Store.rgb()).replace('hsl(', '').replace(')', '')}` }),
          el('div', { text: `HSV  ${Math.round(Store.hsv().h)}°, ${Math.round(Store.hsv().s * 100)}%, ${Math.round(Store.hsv().v * 100)}%` })
        ])
      );
    }

    function renderSuggestions() {
      clear(suggestions);
      Color.SCHEMES.forEach((scheme) => {
        const row = el('div.builder-sug-row');
        row.appendChild(el('span.builder-sug-name', { text: scheme.label }));
        const strip = el('div.builder-sug-strip');
        Color.harmonyRgb(Store.hsv(), scheme.id).forEach((c) => {
          const hex = Color.toHex(c);
          const sw = el('div.builder-sug-sw');
          sw.style.background = hex;
          sw.title = `${hex.toUpperCase()} — click to add to your scheme`;
          on(sw, 'click', () => {
            working.push(c);
            renderWork();
          });
          strip.appendChild(sw);
        });
        row.appendChild(strip);
        suggestions.appendChild(row);
      });
    }

    function renderWork() {
      clear(workArea);
      if (!working.length) {
        workArea.appendChild(el('div.empty-note', { text: 'No colours yet — click suggestions above, or drop colours here.' }));
      } else {
        const strip = el('div.builder-work-strip');
        working.forEach((c, i) => {
          const hex = Color.toHex(c);
          const wrap = el('div.builder-work-item');
          const chipEl = W.chip(hex, {
            size: 44,
            draggable: true,
            removable: true,
            title: `${hex.toUpperCase()} — drag to reorder`,
            onPick: () => Store.setColor(c),
            onRemove: () => {
              working.splice(i, 1);
              renderWork();
            }
          });
          wrap.append(chipEl, el('span.builder-work-label', { text: hex.toUpperCase() }));
          strip.appendChild(wrap);
        });
        workArea.appendChild(strip);
      }

      const actions = el('div.builder-actions', {}, [
        (() => {
          const b = el('button.btn.btn-mini', { type: 'button', text: 'Add All to Favourites' });
          on(b, 'click', addAll);
          return b;
        })(),
        (() => {
          const b = el('button.btn.btn-mini', { type: 'button', text: 'Export…' });
          on(b, 'click', () => CS.App.exportPalette(working));
          return b;
        })(),
        (() => {
          const b = el('button.btn.btn-mini', { type: 'button', text: 'Clear' });
          on(b, 'click', () => {
            working = [];
            renderWork();
          });
          return b;
        })()
      ]);
      workArea.appendChild(actions);

      W.dropZone(workArea, (hex) => {
        const c = Color.parse(hex);
        if (c) {
          working.push(c);
          renderWork();
        }
      });
    }

    function render() {
      renderBase();
      renderSuggestions();
      renderWork();
    }

    loadHarmony();

    return {
      root: panel.root,
      refresh() {
        renderBase();
        renderSuggestions();
      },
      destroy() {}
    };
  }

  /* ================================================================== *
   * SchemeBrowser — search across favourites and the bundled library.
   * ================================================================== */

  function createBrowser() {
    let query = '';
    let source = 'favorites';

    const panel = W.panel('SchemeBrowser', {
      onClose: () => CS.App.closeDocument('browser'),
      onMenu: () => [
        { label: 'Favourites', checked: source === 'favorites', action: () => { source = 'favorites'; render(); } },
        { label: 'Scheme Library', checked: source === 'library', action: () => { source = 'library'; render(); } },
        { separator: true },
        { label: 'Open Matching Colors', action: () => CS.App.openDocument('matching') }
      ]
    });

    const searchInput = el('input', { type: 'text', placeholder: 'Search colors', spellcheck: 'false' });
    const head = el('div.browser-head', {}, [
      W.select({
        options: [
          { id: 'favorites', label: 'Favourite Colors' },
          { id: 'library', label: 'Scheme Library' }
        ],
        value: source,
        width: 130,
        onChange: (v) => {
          source = v;
          render();
        }
      }),
      el('div.search-field', { style: { flex: '1 1 auto' } }, [searchInput])
    ]);

    const scroll = el('div.panel-scroll');
    panel.body.append(head, scroll);

    on(searchInput, 'input', () => {
      query = searchInput.value.trim().toLowerCase();
      render();
    });

    function render() {
      clear(scroll);

      if (source === 'favorites') {
        const list = Store.state.favorites.filter((h) => !query || h.toLowerCase().includes(query));
        if (!list.length) {
          scroll.appendChild(el('div.empty-note', { text: 'No favourite colours yet. Drag colours into the Favorite Colors panel.' }));
          return;
        }
        const grid = el('div.browser-grid');
        list.forEach((hex) => {
          const cell = el('div.browser-cell');
          const chipEl = W.chip(hex, {
            width: '100%',
            height: 30,
            draggable: true,
            onPick: () => Store.setColor(hex),
            onContext: (h, e) => W.menu(e.target, [
              { label: 'Use as Base', action: () => Store.setColor(h) },
              { label: 'Copy Hex', action: () => window.cs.clipboard.writeText(h.toUpperCase()) },
              { separator: true },
              { label: 'Remove', action: () => Store.removeFavorite(h) }
            ])
          });
          cell.append(chipEl, el('span.browser-label', { text: hex.toUpperCase() }));
          grid.appendChild(cell);
        });
        scroll.appendChild(grid);
        return;
      }

      const schemes = CS.SchemeLibrary.search(query);
      if (!schemes.length) {
        scroll.appendChild(el('div.empty-note', { text: 'No schemes matched.' }));
        return;
      }
      const grid = el('div.gallery-grid.browser-schemes');
      schemes.forEach((scheme) => {
        const card = el('div.scheme-card');
        const swatches = el('div.scheme-swatches');
        scheme.colors.forEach((hex) => {
          const sw = el('div.scheme-sw');
          sw.style.background = hex;
          sw.title = hex;
          on(sw, 'click', () => Store.setColor(hex));
          swatches.appendChild(sw);
        });
        card.append(
          el('div.scheme-card-head', {}, [el('span.scheme-name', { text: scheme.name })]),
          swatches,
          el('div.scheme-meta', { text: `by ${scheme.author}` })
        );
        grid.appendChild(card);
      });
      scroll.appendChild(grid);
    }

    render();

    return {
      root: panel.root,
      refresh: render,
      destroy() {}
    };
  }

  CS.Panels = CS.Panels || {};
  CS.Panels.Builder = { create: createBuilder };
  CS.Panels.Browser = { create: createBrowser };
})();
